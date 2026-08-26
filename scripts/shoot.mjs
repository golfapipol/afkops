// Regenerates the README screenshots from the DEMO cluster.
//
// Always synthetic. The board is a picture of whatever cluster it is pointed at,
// so a screenshot of a real one would publish its node pools, namespaces and
// workload names; using --demo keeps that out of the repo by construction.
//
// Driven over the DevTools Protocol rather than Chrome's --screenshot flag: the
// board runs a continuous animation loop, so it never reports "idle" and the
// flag (with --virtual-time-budget) simply hangs. CDP also lets the capture wait
// for the scene to actually settle, which matters -- shooting too early catches
// sprites still walking to their places.
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, existsSync, readdirSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const PORT = Number(process.env.PORT || 8791);
const CDP_PORT = 9333;
const OUT = 'docs';
// 1280x720 is exactly 2x the 640x360 design grid: the 8-bit tier fills the
// window at an integer scale instead of letterboxing, and the 64-bit backbuffer
// presents 1:1. Any other size either adds black bars or resamples the pixels.
const W = 1280, H = 720;

// `hour` pins the day/night palette so a rerun looks the same as the last one.
const SHOTS = [
  ['farm-topdown',    'skin=farm&view=topdown&tier=64bit&zoom=fit&hour=11'],
  ['farm-sideon',     'skin=farm&view=sideon&tier=64bit&zoom=fit&hour=11'],
  ['farm-8bit',       'skin=farm&view=topdown&tier=8bit&zoom=fit&hour=11'],
  ['factory-night',   'skin=factory&view=sideon&tier=64bit&zoom=fit&hour=22'],
  ['dungeon-topdown', 'skin=dungeon&view=topdown&tier=64bit&zoom=fit&hour=11'],
  ['truescale',       'skin=farm&view=topdown&tier=64bit&zoom=1&hour=15'],
];

function findChrome() {
  if (process.env.CHROME) return process.env.CHROME;
  const cache = join(process.env.HOME, '.cache/puppeteer/chrome-headless-shell');
  if (existsSync(cache)) {
    const versions = readdirSync(cache).sort().reverse();
    for (const v of versions) {
      const dir = join(cache, v);
      for (const sub of readdirSync(dir)) {
        const bin = join(dir, sub, 'chrome-headless-shell');
        if (existsSync(bin)) return bin;
      }
    }
  }
  for (const p of ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
                   '/Applications/Chromium.app/Contents/MacOS/Chromium']) {
    if (existsSync(p)) return p;
  }
  throw new Error('no Chrome found; set CHROME=/path/to/chrome');
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitFor(fn, what, tries = 60, gap = 500) {
  for (let i = 0; i < tries; i++) {
    try { if (await fn()) return true; } catch {}
    await sleep(gap);
  }
  throw new Error(`timed out waiting for ${what}`);
}

// ---- minimal CDP client over the built-in WebSocket ------------------------
function connect(url) {
  const ws = new WebSocket(url);
  let id = 0;
  const pending = new Map();
  ws.addEventListener('message', (e) => {
    const msg = JSON.parse(e.data);
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      msg.error ? reject(new Error(msg.error.message)) : resolve(msg.result);
    }
  });
  const ready = new Promise((res, rej) => {
    ws.addEventListener('open', res, { once: true });
    ws.addEventListener('error', rej, { once: true });
  });
  const send = (method, params = {}, sessionId) => new Promise((resolve, reject) => {
    const n = ++id;
    pending.set(n, { resolve, reject });
    ws.send(JSON.stringify({ id: n, method, params, ...(sessionId ? { sessionId } : {}) }));
  });
  return { ws, ready, send, close: () => ws.close() };
}

async function main() {
  const chrome = findChrome();
  const profile = mkdtempSync(join(tmpdir(), 'k8sfarm-shot-'));
  mkdirSync(OUT, { recursive: true });

  console.log(`chrome:  ${chrome}`);
  console.log(`serving: demo cluster on :${PORT}`);

  const server = spawn(process.execPath,
    ['server/index.js', '--demo', '--seed-history', '--nodes=12', '--pods=250', '--beat=900', `--port=${PORT}`],
    { stdio: 'ignore' });

  const browser = spawn(chrome, [
    '--headless', '--disable-gpu', '--hide-scrollbars', '--mute-audio',
    '--no-first-run', '--no-default-browser-check',
    `--user-data-dir=${profile}`,
    `--remote-debugging-port=${CDP_PORT}`,
    `--window-size=${W},${H}`,
    '--force-device-scale-factor=1',
    'about:blank',
  ], { stdio: 'ignore' });

  const cleanup = () => {
    try { browser.kill(); } catch {}
    try { server.kill(); } catch {}
    try { rmSync(profile, { recursive: true, force: true }); } catch {}
  };
  process.on('exit', cleanup);
  process.on('SIGINT', () => { cleanup(); process.exit(1); });

  await waitFor(async () => (await fetch(`http://localhost:${PORT}/api/health`)).ok, 'the demo server');
  // Let the synthetic cluster live a little first: a board with an empty quest
  // log and no incidents on the ribbon under-sells what it actually shows.
  console.log('warming the demo cluster...');
  await sleep(12000);
  const version = await waitFor(async () => {
    const r = await fetch(`http://localhost:${CDP_PORT}/json/version`);
    return r.ok ? (globalThis.__v = await r.json()) : false;
  }, 'chrome devtools').then(() => globalThis.__v);

  const cdp = connect(version.webSocketDebuggerUrl);
  await cdp.ready;

  for (const [name, query] of SHOTS) {
    const url = `http://localhost:${PORT}/?${query}`;
    const { targetId } = await cdp.send('Target.createTarget', { url, width: W, height: H });
    const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true });
    await cdp.send('Page.enable', {}, sessionId);

    const evaluate = async (expr) => {
      const r = await cdp.send('Runtime.evaluate',
        { expression: expr, returnByValue: true, awaitPromise: true }, sessionId);
      return r.result && r.result.value;
    };

    // Wait for a world, then for every sprite to have reached its home. Shooting
    // early catches the farm mid-shuffle and looks like a bug.
    await waitFor(async () => await evaluate(
      'typeof window.__k8sfarmDebug === "function" && window.__k8sfarmDebug().layout.length > 0'),
      `${name}: first frame`);
    await waitFor(async () => await evaluate(`(() => {
      const d = window.__k8sfarmDebug();
      if (!d.units.length) return false;
      const moving = d.units.filter(u => Math.hypot(u.tx - u.x, u.ty - u.y) > 1).length;
      return moving / d.units.length < 0.25;
    })()`), `${name}: sprites to settle`, 30, 500);
    await sleep(1200);  // a beat, so animations are mid-stride not mid-spawn

    // The world can have grown while we waited (the demo adds nodes, and a real
    // cluster autoscales), which leaves an earlier fit stale.
    if (query.includes('zoom=fit')) await evaluate('window.__k8sfarmFit()');

    // Confirm the deep link actually took effect rather than trusting it.
    const got = await evaluate(
      'JSON.stringify({skin: window.__k8sfarmDebug().skin,'
      + ' view: window.__k8sfarmDebug().view, tier: window.__k8sfarmDebug().tier})');
    const want = Object.fromEntries(new URLSearchParams(query));
    const actual = JSON.parse(got);
    for (const k of ['skin', 'view', 'tier']) {
      if (want[k] && actual[k] !== want[k]) {
        throw new Error(`${name}: asked for ${k}=${want[k]} but got ${actual[k]}`);
      }
    }

    const errs = await evaluate('window.__k8sfarmDebug().drawErrors');
    if (errs) throw new Error(`${name}: ${errs} draw errors — refusing to publish a broken shot`);

    const { data } = await cdp.send('Page.captureScreenshot', { format: 'png' }, sessionId);
    writeFileSync(join(OUT, `${name}.png`), Buffer.from(data, 'base64'));
    const kb = Math.round(statSync(join(OUT, `${name}.png`)).size / 1024);
    console.log(`  ${name}.png  ${kb}KB`);

    await cdp.send('Target.closeTarget', { targetId });
  }

  cdp.close();
  cleanup();
  console.log('done');
}

main().catch((e) => { console.error('FAILED:', e.message); process.exit(1); });
