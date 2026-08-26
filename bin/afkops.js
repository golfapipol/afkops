#!/usr/bin/env node
'use strict';
// Zero-install entry point.
//
// `npx afkops` must show something within seconds with no cluster, no config and
// no flags — otherwise "try it out" isn't true. So the demo is the default and
// pointing it at a real cluster is one flag.
const { spawn } = require('node:child_process');
const path = require('node:path');
const pkg = require('../package.json');

const args = process.argv.slice(2);
const has = (...f) => f.some((x) => args.includes(x));
const strip = (...f) => args.filter((a) => !f.includes(a));

if (has('--help', '-h')) {
  console.log(`
  afkops ${pkg.version} — your Kubernetes cluster as an idle game

  Usage
    npx afkops                    a synthetic cluster, no credentials needed
    npx afkops --real             watch kubectl's current-context
    npx afkops --wall             --real, plus keep the display awake (24/7 board)

  Options
    --real, --watch               read the live cluster instead of the demo
    --wall                        wallboard mode: --real, no sleep, fullscreen hint
    --no-open                     do not launch a browser
    --port=N                      default 8787
    --nodes=N --pods=N            size the synthetic cluster (demo only)
    --seed-history                pre-fill the 24h ribbon (demo only)
    --clock-speed=N               compress the day/night cycle (demo only)
    -h, --help                    this
    -v, --version                 print the version

  In the browser
    1 2 3  skin      V  view      G  graphics      N  next problem
    WASD   move      +/-  zoom    F  fit           L  legend
    click a pod for its containers, exit reasons and recent events

  Needs kubectl 1.20+ on PATH for --real. Read-only: it never changes anything.
`);
  process.exit(0);
}

if (has('--version', '-v')) { console.log(pkg.version); process.exit(0); }

const real = has('--real', '--watch', '--wall');
const wall = has('--wall');
const forwarded = strip('--real', '--watch', '--wall', '--no-open');

if (!real && !forwarded.includes('--demo')) forwarded.push('--demo');
if (!has('--no-open')) forwarded.push('--open');

const server = path.join(__dirname, '..', 'server', 'index.js');

// Wallboard mode asks the OS not to sleep the display. Both helpers are
// optional: if neither exists the board still runs, it just won't stop a
// screensaver.
function keepAwakeWrapper() {
  if (!wall) return null;
  if (process.platform === 'darwin') return { cmd: 'caffeinate', pre: ['-d'] };
  if (process.platform === 'linux') return { cmd: 'systemd-inhibit', pre: ['--what=idle'] };
  return null;
}

const wrap = keepAwakeWrapper();
const cmd = wrap ? wrap.cmd : process.execPath;
const argv = wrap
  ? [...wrap.pre, process.execPath, server, ...forwarded]
  : [server, ...forwarded];

const child = spawn(cmd, argv, { stdio: 'inherit' });

child.on('error', (e) => {
  // A missing caffeinate/systemd-inhibit should degrade, not fail.
  if (wrap && (e.code === 'ENOENT')) {
    console.warn(`[afkops] ${wrap.cmd} not available; running without sleep inhibition`);
    spawn(process.execPath, [server, ...forwarded], { stdio: 'inherit' })
      .on('exit', (c) => process.exit(c ?? 0));
    return;
  }
  console.error('[afkops] failed to start:', e.message);
  process.exit(1);
});
child.on('exit', (c, sig) => process.exit(sig ? 1 : (c ?? 0)));
for (const s of ['SIGINT', 'SIGTERM']) process.on(s, () => { try { child.kill(s); } catch {} });
