// Records the animated demo used at the top of the README.
//
// A still screenshot hides this project's entire premise: pods walk in, crops
// grow, sprites flash when they restart, and the palette moves through the day.
// So the hero asset has to move.
//
// Frames come from repeated Page.captureScreenshot at a fixed wall-clock cadence,
// which means playback at the same rate is real time. Actions are driven as real
// key events through Input.dispatchKeyEvent rather than by poking internals, so
// the recording exercises the same path a person would.
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, existsSync, readdirSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const PORT = Number(process.env.PORT || 8792);
const CDP_PORT = 9334;
const OUT = 'docs';
const W = 1280, H = 720;
const FPS = 12;

// The story, in order: it is alive → it has detail → it has other views → it has
// other skins. The first two seconds matter most, so they are pure motion.
const TIMELINE = [
  { at: 0.0,  do: null,        note: 'farm, fitted — the cluster living' },
  { at: 3.0,  do: ['=', '='],  note: 'zoom in: individual animals' },
  { at: 5.5,  do: ['f'],       note: 'back out' },
  { at: 7.0,  do: ['v'],       note: 'side-on view' },
  { at: 9.5,  do: ['2'],       note: 'factory skin' },
  { at: 12.0, do: ['3'],       note: 'dungeon skin' },
  { at: 14.0, do: ['1', 'v'],  note: 'home' },
  { at: 15.5, do: ['n'],       note: 'N: jump to a problem and diagnose it' },
];
const DURATION = 19.0;

const KEYCODES = {
  '1': 49, '2': 50, '3': 51, 'v': 86, 'f': 70, 'g': 71, 'n': 78, 'l': 76,
  '=': 187, '-': 189, Escape: 27,
};
const CODES = {
  '1': 'Digit1', '2': 'Digit2', '3': 'Digit3', 'v': 'KeyV', 'f': 'KeyF',
  'g': 'KeyG', 'n': 'KeyN', 'l': 'KeyL', '=': 'Equal', '-': 'Minus',
  Escape: 'Escape',
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function findChrome() {
  if (process.env.CHROME) return process.env.CHROME;
  const cache = join(process.env.HOME, '.cache/puppeteer/chrome-headless-shell');
  if (existsSync(cache)) {
    for (const v of readdirSync(cache).sort().reverse()) {
      for (const sub of readdirSync(join(cache, v))) {
        const bin = join(cache, v, sub, 'chrome-headless-shell');
        if (existsSync(bin)) return bin;
      }
    }
  }
  const app = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
  if (existsSync(app)) return app;
  throw new Error('no Chrome found; set CHROME=/path/to/chrome');
}

async function waitFor(fn, what, tries = 60, gap = 500) {
  for (let i = 0; i < tries; i++) {
    try { if (await fn()) return true; } catch {}
    await sleep(gap);
  }
  throw new Error(`timed out waiting for ${what}`);
}

function connect(url) {
  const ws = new WebSocket(url);
  let id = 0;
  const pending = new Map();
  ws.addEventListener('message', (e) => {
    const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) {
      const { resolve, reject } = pending.get(m.id);
      pending.delete(m.id);
      m.error ? reject(new Error(m.error.message)) : resolve(m.result);
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
  return { ready, send, close: () => ws.close() };
}

async function main() {
  const chrome = findChrome();
  const profile = mkdtempSync(join(tmpdir(), 'afkops-rec-'));
  const frames = mkdtempSync(join(tmpdir(), 'afkops-frames-'));
  mkdirSync(OUT, { recursive: true });

  const server = spawn(process.execPath,
    ['server/index.js', '--demo', '--seed-history', '--nodes=10', '--pods=210',
     '--beat=650', `--port=${PORT}`],
    { stdio: 'ignore' });
  const browser = spawn(chrome, [
    '--headless', '--disable-gpu', '--hide-scrollbars', '--mute-audio',
    '--no-first-run', '--no-default-browser-check',
    `--user-data-dir=${profile}`, `--remote-debugging-port=${CDP_PORT}`,
    `--window-size=${W},${H}`, '--force-device-scale-factor=1', 'about:blank',
  ], { stdio: 'ignore' });

  const cleanup = () => {
    try { browser.kill(); } catch {}
    try { server.kill(); } catch {}
    try { rmSync(profile, { recursive: true, force: true }); } catch {}
  };
  process.on('exit', cleanup);
  process.on('SIGINT', () => { cleanup(); process.exit(1); });

  await waitFor(async () => (await fetch(`http://localhost:${PORT}/api/health`)).ok, 'demo server');
  console.log('warming the demo cluster...');
  await sleep(14000);   // so the ribbon, quest log and problem list have content

  let ver;
  await waitFor(async () => {
    const r = await fetch(`http://localhost:${CDP_PORT}/json/version`);
    if (!r.ok) return false; ver = await r.json(); return true;
  }, 'chrome devtools');

  const cdp = connect(ver.webSocketDebuggerUrl);
  await cdp.ready;

  const url = `http://localhost:${PORT}/?skin=farm&view=topdown&tier=64bit&zoom=fit&hour=10`;
  const { targetId } = await cdp.send('Target.createTarget', { url, width: W, height: H });
  const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true });
  await cdp.send('Page.enable', {}, sessionId);

  const evaluate = async (expr) => {
    const r = await cdp.send('Runtime.evaluate',
      { expression: expr, returnByValue: true, awaitPromise: true }, sessionId);
    return r.result && r.result.value;
  };

  await waitFor(async () => await evaluate(
    'typeof window.__k8sfarmDebug === "function" && window.__k8sfarmDebug().layout.length > 0'),
    'first frame');
  await waitFor(async () => await evaluate(`(() => {
    const d = window.__k8sfarmDebug();
    if (!d.units.length) return false;
    return d.units.filter(u => Math.hypot(u.tx-u.x, u.ty-u.y) > 1).length / d.units.length < 0.3;
  })()`), 'sprites to settle', 30, 500);
  await evaluate('window.__k8sfarmFit()');

  // The page needs focus for keys to land, but a click on the scene selects a
  // pod. Click the sidebar: clicks outside the scene are ignored by the picker.
  for (const type of ['mousePressed', 'mouseReleased']) {
    await cdp.send('Input.dispatchMouseEvent',
      { type, x: 1150, y: 300, button: 'left', clickCount: 1 }, sessionId);
  }
  await sleep(400);

  async function press(k) {
    const base = { key: k, code: CODES[k], windowsVirtualKeyCode: KEYCODES[k],
                   nativeVirtualKeyCode: KEYCODES[k] };
    // `text` is only valid for keys that produce a character; sending it for
    // Escape is rejected outright.
    const printable = k.length === 1;
    await cdp.send('Input.dispatchKeyEvent',
      { ...base, type: printable ? 'keyDown' : 'rawKeyDown', ...(printable ? { text: k } : {}) },
      sessionId);
    await cdp.send('Input.dispatchKeyEvent', { ...base, type: 'keyUp' }, sessionId);
  }

  console.log(`recording ${DURATION}s at ${FPS}fps...`);
  const total = Math.round(DURATION * FPS);
  const interval = 1000 / FPS;
  const t0 = Date.now();
  let cue = 0;

  for (let i = 0; i < total; i++) {
    const target = t0 + i * interval;
    const wait = target - Date.now();
    if (wait > 0) await sleep(wait);

    const elapsed = (Date.now() - t0) / 1000;
    while (cue < TIMELINE.length && TIMELINE[cue].at <= elapsed) {
      const step = TIMELINE[cue++];
      if (step.do) { for (const k of step.do) { await press(k); await sleep(60); } }
      console.log(`  ${elapsed.toFixed(1)}s  ${step.note}`);
    }

    if (i === 0) {
      // Belt and braces: start from a clean board whatever the click did.
      await press('Escape');
      const open = await evaluate('!!window.__k8sfarmDebug().layout.length');
      if (!open) throw new Error('no layout at record start');
    }

    const { data } = await cdp.send('Page.captureScreenshot',
      { format: 'png', optimizeForSpeed: true }, sessionId);
    writeFileSync(join(frames, `f${String(i).padStart(4, '0')}.png`), Buffer.from(data, 'base64'));
  }

  const errs = await evaluate('window.__k8sfarmDebug().drawErrors');
  cdp.close();
  cleanup();
  if (errs) throw new Error(`${errs} draw errors during recording — not publishing it`);

  const captured = readdirSync(frames).length;
  console.log(`captured ${captured} frames; encoding...`);

  const ff = (args) => {
    const r = spawnSync('ffmpeg', ['-y', '-loglevel', 'error', ...args], { stdio: 'inherit' });
    if (r.status !== 0) throw new Error('ffmpeg failed: ' + args.join(' '));
  };
  const pattern = join(frames, 'f%04d.png');

  // MP4 for social posts: far smaller and higher quality than a GIF.
  ff(['-framerate', String(FPS), '-i', pattern,
      '-c:v', 'libx264', '-preset', 'slow', '-crf', '20',
      '-pix_fmt', 'yuv420p', '-movflags', '+faststart',
      join(OUT, 'demo.mp4')]);

  // GIF for the README, where it is the only format that plays inline.
  // Nearest-neighbour scaling and no dithering keep the pixels crisp; dithering
  // a pixel-art source is what makes GIFs of it look muddy.
  const palette = join(frames, 'palette.png');
  ff(['-i', pattern, '-vf', `fps=${FPS},scale=800:-1:flags=neighbor,palettegen=max_colors=192:stats_mode=diff`, palette]);
  ff(['-framerate', String(FPS), '-i', pattern, '-i', palette,
      '-lavfi', `fps=${FPS},scale=800:-1:flags=neighbor[x];[x][1:v]paletteuse=dither=none:diff_mode=rectangle`,
      '-loop', '0', join(OUT, 'demo.gif')]);

  rmSync(frames, { recursive: true, force: true });
  for (const f of ['demo.mp4', 'demo.gif']) {
    console.log(`  ${f}  ${Math.round(statSync(join(OUT, f)).size / 1024)}KB`);
  }
}

main().catch((e) => { console.error('FAILED:', e.message); process.exit(1); });
