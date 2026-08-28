'use strict';
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { createCollector } = require('./collector.js');
const { createDemoCollector } = require('./demo.js');
const { createHistory } = require('./history.js');

const ROOT = path.join(__dirname, '..');
const PUBLIC = path.join(ROOT, 'public');

const argv = process.argv.slice(2);
const DEMO = argv.includes('--demo');
const OPEN = argv.includes('--open');
const arg = (k, d) => { const a = argv.find((x) => x.startsWith(`--${k}=`)); return a ? a.split('=')[1] : d; };

let config = { port: 8787, namespaces: { include: [], exclude: [], dim: [] } };
try { config = { ...config, ...JSON.parse(fs.readFileSync(path.join(ROOT, 'config.json'), 'utf8')) }; }
catch (e) { console.warn('[afkops] using defaults, config.json unreadable:', e.message); }
const PORT = Number(arg('port', process.env.PORT || config.port)) || 8787;
config.clockSpeed = Number(arg('clock-speed', 1)) || 1;
config.demoBeatMs = Number(arg('beat', config.demoBeatMs || 2600));
config.demoNodes = Number(arg('nodes', config.demoNodes || 6));
config.demoPods = Number(arg('pods', config.demoPods || 34));

// A 24/7 wallboard must never die from one bad frame. Log and carry on.
process.on('uncaughtException', (e) => console.error('[afkops] uncaught:', e && e.stack || e));
process.on('unhandledRejection', (e) => console.error('[afkops] unhandled:', e && e.stack || e));

// Where the 24h history lives. Installed under node_modules the package
// directory is often read-only and is never the right place for user data, so
// fall back to the user's home directory.
function stateDir() {
  if (process.env.AFKOPS_STATE) return process.env.AFKOPS_STATE;
  const local = path.join(ROOT, 'state');
  try {
    fs.mkdirSync(local, { recursive: true });
    fs.accessSync(local, fs.constants.W_OK);
    return local;
  } catch {}
  const home = path.join(require('node:os').homedir(), '.afkops');
  try { fs.mkdirSync(home, { recursive: true }); } catch {}
  return home;
}

const history = createHistory(path.join(stateDir(), 'history.json'));
history.load();
// Demo mode starts with a plausible day already on the ribbon, so the 24h view
// is visible immediately instead of after a full day of real samples.
const SEEDED = DEMO && argv.includes('--seed-history');
if (SEEDED) history.seedSynthetic();

// ---- SSE clients -----------------------------------------------------------
const clients = new Set();
function broadcast(event, data) {
  if (!clients.size) return;
  const frame = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const res of [...clients]) {
    try { res.write(frame); } catch { clients.delete(res); try { res.end(); } catch {} }
  }
}

// Transitions are pushed as they happen, batched over a short window so a
// 50-pod scale-up becomes one frame instead of fifty.
let txBuf = [];
let txTimer = null;
const TX_CAP = 400;
function queueTransition(ev) {
  if (txBuf.length < TX_CAP) txBuf.push(ev);
  history.incident(ev.t || Date.now(), isIncident(ev.type) ? 1 : 0);
  if (!txTimer) {
    txTimer = setTimeout(() => {
      txTimer = null;
      if (!txBuf.length) return;
      const batch = txBuf; txBuf = [];
      broadcast('tx', batch);
    }, 120);
    if (txTimer.unref) txTimer.unref();
  }
}
function isIncident(type) {
  return type === 'pod_restart' || type === 'pod_crashloop' || type === 'pod_failed'
      || type === 'pod_evicted' || type === 'pod_preempted' || type === 'pod_oom'
      || type === 'node_notready' || type === 'node_removed' || type === 'pod_unschedulable';
}

const collector = (DEMO ? createDemoCollector : createCollector)({
  config,
  onTransition: queueTransition,
  onLinkChange: (link) => {
    console.log(`[afkops] link ${link.ok ? 'UP' : 'DOWN'}${link.error ? ': ' + link.error : ''}`);
    broadcast('link', link);
  },
});

// ---- periodic snapshot -----------------------------------------------------
let lastWorld = null;
function tickSnapshot() {
  try {
    const w = collector.snapshot();
    lastWorld = w;
    const cpuFrac = w.totals.cpuAlloc ? w.totals.cpuReq / w.totals.cpuAlloc : 0;
    const memFrac = w.totals.memAlloc ? w.totals.memReq / w.totals.memAlloc : 0;
    const useFrac = w.totals.cpuAlloc && w.hasUsage ? w.totals.cpuUse / w.totals.cpuAlloc : 0;
    history.sample(Date.now(), { cpuFrac, memFrac, useFrac });
    broadcast('state', w);
  } catch (e) {
    console.error('[afkops] snapshot failed:', e.message);
  }
}

function seriesPayload() {
  const s = history.series();
  const b64 = (u8) => Buffer.from(u8).toString('base64');
  return { slots: s.cpu.length, slotMs: history.SLOT_MS,
           cpu: b64(s.cpu), mem: b64(s.mem), use: b64(s.use), inc: b64(s.inc), filled: b64(s.filled) };
}

// ---- static files ----------------------------------------------------------
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.woff2': 'font/woff2',
  '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon' };

function serveStatic(req, res, urlPath) {
  const rel = urlPath === '/' ? '/index.html' : urlPath;
  // Contain path traversal: resolve, then require the result stay under PUBLIC.
  const full = path.resolve(PUBLIC, '.' + rel);
  if (!full.startsWith(PUBLIC + path.sep) && full !== path.join(PUBLIC, 'index.html')) {
    res.writeHead(403).end('forbidden'); return;
  }
  fs.readFile(full, (err, buf) => {
    if (err) { res.writeHead(404, { 'content-type': 'text/plain' }).end('not found'); return; }
    res.writeHead(200, { 'content-type': MIME[path.extname(full)] || 'application/octet-stream',
                         'cache-control': path.extname(full) === '.woff2' ? 'public, max-age=604800' : 'no-cache' });
    res.end(buf);
  });
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const p = url.pathname;

  if (p === '/api/events') {
    res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache',
                         connection: 'keep-alive', 'x-accel-buffering': 'no' });
    res.write(': connected\n\n');
    clients.add(res);
    // Immediately hand the new client everything it needs to draw a full frame.
    try {
      res.write(`event: config\ndata: ${JSON.stringify({
        defaultSkin: config.defaultSkin || 'farm',
        autoRotateSkinMs: config.autoRotateSkinMs || 0,
        nightlyReloadHour: config.nightlyReloadHour,
        clockSpeed: config.clockSpeed, demo: DEMO })}\n\n`);
      res.write(`event: history\ndata: ${JSON.stringify(seriesPayload())}\n\n`);
      if (lastWorld) res.write(`event: state\ndata: ${JSON.stringify(lastWorld)}\n\n`);
    } catch {}
    req.on('close', () => { clients.delete(res); });
    return;
  }

  if (p === '/api/state') {
    res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-cache' });
    res.end(JSON.stringify(lastWorld || {}));
    return;
  }
  if (p === '/api/pod') {
    const uid = url.searchParams.get('uid') || '';
    const detail = collector.podDetail ? collector.podDetail(uid) : null;
    res.writeHead(detail ? 200 : 404, { 'content-type': 'application/json', 'cache-control': 'no-cache' });
    res.end(JSON.stringify(detail || { error: 'pod not found' }));
    return;
  }
  if (p === '/api/node') {
    const nm = url.searchParams.get('name') || '';
    const detail = collector.nodeDetail ? collector.nodeDetail(nm) : null;
    res.writeHead(detail ? 200 : 404, { 'content-type': 'application/json', 'cache-control': 'no-cache' });
    res.end(JSON.stringify(detail || { error: 'node not found' }));
    return;
  }
  if (p === '/api/history') {
    res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-cache' });
    res.end(JSON.stringify(seriesPayload()));
    return;
  }
  if (p === '/api/health') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ ok: true, demo: DEMO, clients: clients.size,
      collector: collector.stats(), rss: process.memoryUsage().rss, uptime: process.uptime() }));
    return;
  }
  serveStatic(req, res, p);
});

// SSE heartbeat: keeps proxies from closing the stream and reaps dead sockets.
const hb = setInterval(() => {
  for (const res of [...clients]) {
    try { res.write(': hb\n\n'); } catch { clients.delete(res); }
  }
}, 15000);
if (hb.unref) hb.unref();

const snapTimer = setInterval(tickSnapshot, config.snapshotMs || 2000);
const saveTimer = setInterval(() => { if (!SEEDED) history.save(); }, config.historySaveMs || 300000);
if (snapTimer.unref) snapTimer.unref();
if (saveTimer.unref) saveTimer.unref();

// Best effort, and silent on failure: not opening a browser is a small loss,
// crashing the board over it would not be.
function openBrowser(url) {
  const cmd = process.platform === 'darwin' ? 'open'
            : process.platform === 'win32' ? 'cmd' : 'xdg-open';
  const args = process.platform === 'win32' ? ['/c', 'start', '', url] : [url];
  try { spawn(cmd, args, { detached: true, stdio: 'ignore' }).unref(); } catch {}
}

function shutdown(sig) {
  console.log(`\n[afkops] ${sig}, saving history and stopping`);
  if (!SEEDED) history.save();
  try { collector.stop(); } catch {}
  clearInterval(hb); clearInterval(snapTimer); clearInterval(saveTimer);
  for (const res of clients) { try { res.end(); } catch {} }
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 1500).unref();
}
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

// Real mode only: the demo needs no cluster and no kubectl.
const checked = DEMO ? Promise.resolve() : require('./kubectl.js').preflight().then((r) => {
  if (r.version) console.log(`[afkops] kubectl ${r.version}`);
  for (const p of r.problems) console.error(`[afkops] REQUIREMENT: ${p}`);
  if (r.problems.length) {
    console.error('[afkops] see the Requirements section of the README');
    process.exit(1);
  }
}).catch(() => {});

checked.then(() => collector.start()).then(() => {
  tickSnapshot();
  server.listen(PORT, '127.0.0.1', () => {
    const url = `http://localhost:${PORT}`;
    if (DEMO) {
      // Built from the content so the box always lines up, whatever the text.
      const lines = [
        'DEMO MODE — this cluster is SYNTHETIC.',
        'Nothing here comes from a real cluster.',
        "Run with --real to watch kubectl's current-context.",
      ];
      const w = Math.max(...lines.map((l) => [...l].length)) + 4;
      console.log('');
      console.log('  ┌' + '─'.repeat(w) + '┐');
      for (const l of lines) console.log('  │  ' + l + ' '.repeat(w - [...l].length - 2) + '│');
      console.log('  └' + '─'.repeat(w) + '┘');
      console.log('');
    } else {
      console.log('[afkops] watching kubectl current-context (read-only)');
    }
    console.log(`[afkops] board on ${url}  (fullscreen with F11, ? for the legend)`);
    if (OPEN) openBrowser(url);
  });
}).catch((e) => { console.error('[afkops] failed to start collector:', e); process.exit(1); });
