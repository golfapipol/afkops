'use strict';
import { px, rect, meter, text, textW, fitText, dither, vgrad, shade, rgba, glow, shadowEllipse,
         wobble, hash } from '../engine.js';
import { reqTier, TIER_SCALE, loadVisual } from '../podclass.js';
import { drawCompact, drawHotMark, drawRestartMark } from '../sprite.js';

export const id = 'dungeon';
export const name = 'DUNGEON';

export const vocab = {
  node: 'ROOM', nodes: 'ROOMS', pod: 'HERO', pods: 'PARTY',
  cpu: 'HP', mem: 'MP', capacity: 'CHAMBER', usage: 'EXERTION',
  restart: 'DOWNED', crash: 'CURSED', done: 'QUEST DONE', gone: 'SLAIN',
  closed: 'SEALED',
};

// Lit by torches, not the sun, so the daily cycle is subtler here.
export const palettes = {
  dawn:  { sky1: '#171426', sky2: '#2a2340', ground: '#2e2740', ground2: '#241e33',
           soil: '#3d3352', fence: '#7a6a9c', ink: '#e8e2f5', dim: '#6a6280',
           accent: '#ffcf6b', good: '#7ad67a', warn: '#ffc14d', bad: '#ff5f7a',
           panel: '#1a1626', panelEdge: '#463c66', lit: '#ffb347', star: 0 },
  day:   { sky1: '#242033', sky2: '#3a3350', ground: '#403852', ground2: '#332c44',
           soil: '#4e4468', fence: '#9585b8', ink: '#f2ecff', dim: '#7e7599',
           accent: '#ffd98a', good: '#8fe08f', warn: '#ffcf6b', bad: '#ff6b85',
           panel: '#221d33', panelEdge: '#564a7a', lit: '#ffc266', star: 0 },
  dusk:  { sky1: '#12101f', sky2: '#241c33', ground: '#282238', ground2: '#1e1a2b',
           soil: '#372e4a', fence: '#6f6090', ink: '#e0d9f0', dim: '#5f5875',
           accent: '#ff9a4d', good: '#6cc46c', warn: '#ffab4d', bad: '#ff5f7a',
           panel: '#161222', panelEdge: '#3d3459', lit: '#ff9f4a', star: 0.3 },
  night: { sky1: '#08060f', sky2: '#100c1a', ground: '#1a1626', ground2: '#13101d',
           soil: '#282036', fence: '#4f4568', ink: '#c3bad9', dim: '#463f59',
           accent: '#c99bff', good: '#4d9e5e', warn: '#c98a3e', bad: '#e0556f',
           panel: '#0b0912', panelEdge: '#241f33', lit: '#ff8c3a', star: 1 },
};

export const side = {
  texture: 'stone',
  prop(g, x, y, ctx, node, down) { drawTorch(g, x + 6, y - 16, ctx, down); },
};

function drawTorch(g, x, y, ctx, down) {
  const { pal, q, t } = ctx;
  px(g, x, y + 4, 1.5, 9, '#6b4a32');
  if (down) return;
  const fl = 1 + Math.abs(wobble(hash(String(x)), t, 6, 2));
  if (q.glow) glow(g, x + 0.75, y + 2, 22, pal.lit, 0.32);
  px(g, x - 1, y - fl, 3.5, 4 + fl, pal.lit);
  px(g, x - 0.5, y - fl - 1, 2.5, 3, '#fff0b0');
}

export function drawBackground(g, ctx) {
  const { pal, q, t, W, H } = ctx;
  px(g, 0, 0, W, H, pal.sky1);

  // Brickwork.
  for (let y = 0; y < H; y += 10) {
    for (let x = ((y / 10) % 2) * 12; x < W; x += 24) {
      if (q.hi) {
        vgrad(g, x, y, 22, 8, shade(pal.sky2, 0.10), shade(pal.sky2, -0.14), q);
        px(g, x, y, 22, 0.5, rgba('#ffffff', 0.07));
        px(g, x, y + 7.5, 22, 0.5, rgba('#000000', 0.35));
      } else {
        px(g, x, y, 22, 8, pal.sky2);
        px(g, x, y, 22, 1, '#ffffff08');
        px(g, x, y + 7, 22, 1, '#00000030');
      }
    }
  }

  // Wall torches with real pooled light at 64-bit.
  for (let i = 0; i < 6; i++) {
    const tx = 40 + i * 104;
    px(g, tx, 14, 2, 8, '#6b4a32');
    const fl = 1 + Math.abs(wobble(i * 37, t, 6, 2));
    if (q.glow) {
      glow(g, tx + 1, 10, 46 + fl * 5, pal.lit, 0.20);
      glow(g, tx + 1, 10, 16, '#fff0b0', 0.30);
    }
    px(g, tx - 1, 10 - fl, 4, 4 + fl, pal.lit);
    px(g, tx, 9 - fl, 2, 3, '#fff0b0');
    if (!q.glow) {
      for (let k = 0; k < 16; k++) px(g, tx - k, 18 + k, 2 + k * 2, 2, `rgba(255,140,58,0.0${Math.max(1, 4 - (k / 5 | 0))})`);
    }
  }
  if (!q.hi) dither(g, 0, 0, W, H, '#00000030', 3, q.u);
}

export function drawContainer(g, node, r, ctx) {
  const { pal, q, t } = ctx;
  const cpuAlloc = node.cpu.allocatable || 1;
  const reqFrac = Math.min(1.4, node.cpu.requests / cpuAlloc);
  const useFrac = node.cpu.usage != null ? Math.min(1.4, node.cpu.usage / cpuAlloc) : null;
  const down = !node.ready;

  const floor = down ? '#1a1414' : pal.ground;
  if (q.hi) vgrad(g, r.x, r.y, r.w, r.h, shade(floor, 0.08), shade(floor, -0.16), q);
  else px(g, r.x, r.y, r.w, r.h, floor);
  for (let yy = r.y + 12; yy < r.y + r.h - 1; yy += 6)
    for (let xx = r.x + 2; xx < r.x + r.w - 2; xx += 8)
      px(g, xx, yy, 7, 5, q.hi ? rgba(pal.ground2, 0.6) : pal.ground2);

  const inner = { x: r.x + 3, y: r.y + 12, w: r.w - 6, h: r.h - 16 };
  const claimW = Math.max(2, inner.w * Math.min(1, reqFrac));

  const ritual = down ? '#241c1c' : pal.soil;
  if (q.hi) vgrad(g, inner.x, inner.y, claimW, inner.h, shade(ritual, 0.12), shade(ritual, -0.18), q);
  else px(g, inner.x, inner.y, claimW, inner.h, ritual);
  for (let i = 0; i < inner.h; i += 3) px(g, inner.x + claimW - 1, inner.y + i, 1, 2, pal.fence);

  if (useFrac != null) {
    const useW = inner.w * Math.min(1, useFrac);
    const litW = Math.min(useW, claimW);
    if (litW > 0) {
      px(g, inner.x, inner.y + 1, litW, inner.h - 2, down ? '#241c1c' : '#5a4a68');
      if (q.hi) {
        const flick = 0.16 + 0.05 * Math.sin(t * 0.012);
        g.fillStyle = rgba(pal.lit, flick);
        g.fillRect(inner.x, inner.y + 1, litW, inner.h - 2);
        if (q.glow) glow(g, inner.x + litW / 2, inner.y + inner.h / 2, Math.max(litW, inner.h) * 0.6, pal.lit, 0.12);
      } else {
        dither(g, inner.x, inner.y + 1, litW, inner.h - 2,
               down ? '#1c1616' : (Math.floor(t / 120) % 2 ? '#ffb347' : '#ff9f4a'), 3, q.u);
      }
    }
    if (useFrac > reqFrac + 0.02) {
      const oX = inner.x + claimW, oW = Math.max(1, useW - claimW);
      dither(g, oX, inner.y + 1, oW, inner.h - 2, pal.bad, 2, q.u);
    }
  }

  px(g, r.x, r.y, r.w, 11, q.hi ? rgba(pal.panel, 0.85) : pal.panel);
  rect(g, r.x, r.y, r.w, r.h, down ? pal.bad : pal.panelEdge);
  text(g, fitText(g, shortName(node), r.w - 30, 6), r.x + 2, r.y + 2, down ? pal.bad : pal.ink, 6);

  const mx = r.x + r.w - 26;
  meter(g, mx, r.y + 2, 22, 3, reqFrac, reqFrac > 0.9 ? pal.bad : pal.good, '#00000066', useFrac, pal.accent, q);
  meter(g, mx, r.y + 6, 22, 2, node.mem.requests / (node.mem.allocatable || 1),
        node.mem.requests / (node.mem.allocatable || 1) > 0.9 ? pal.bad : '#7a9aff', '#00000066',
        node.mem.usage != null ? node.mem.usage / (node.mem.allocatable || 1) : null, '#b0c4ff', q);

  const podFrac = node.pods.count / (node.pods.max || 110);
  const lit = Math.round(podFrac * 10);
  for (let i = 0; i < 10; i++)
    px(g, r.x + 2 + i * 3, r.y + 8, 2, 2,
       i < lit ? (podFrac > 0.9 ? pal.bad : podFrac > 0.75 ? pal.warn : pal.dim) : '#00000055');

  if (node.unschedulable) {
    const s = 'SEALED', w = textW(g, s, 6) + 4;
    px(g, r.x + (r.w - w) / 2, r.y + r.h / 2 - 4, w, 9, pal.bad);
    text(g, s, r.x + (r.w - w) / 2 + 2, r.y + r.h / 2 - 3, '#fff', 6);
  }
  if (down) {
    if (q.hi) { g.fillStyle = 'rgba(0,0,0,0.55)'; g.fillRect(r.x, r.y + 11, r.w, r.h - 11); }
    else dither(g, r.x, r.y + 11, r.w, r.h - 11, '#000000', 2, q.u);
    for (let i = 0; i < 8; i++) {
      const bx = r.x + 4 + (hash('rb' + node.name + i) % Math.floor(r.w - 10));
      px(g, bx, r.y + r.h - 6 - (hash('rby' + node.name + i) % 5), 3, 2, '#4a4050');
    }
  }
}

// The server already reduced the node name to its meaningful pool part.
function shortName(node) {
  return String((node && node.display) || (node && node.name) || node || '').slice(0, 24);
}

export function drawUnit(g, u, ctx) {
  const { pal, q, t } = ctx;
  const p = u.pod;
  if (!p) return;

  // Class is the pod's CPU REQUEST tier; how briskly it moves and how brightly
  // it is lit is its ACTUAL usage.
  const cls = reqTier(p);
  const lv = loadVisual(p);
  const fx = u.fxUntil > t ? u.fx : null;
  const dim = p.dim;
  const s = (u.size || q.unitSize) * TIER_SCALE[cls];

  const BASE = ['#99e550', '#5fcde4', '#e6c84f', '#d95763'];
  let col = dim ? pal.dim : BASE[cls];
  if (!dim && lv.known) col = shade(col, -0.34 + lv.bright * 0.34);
  let bob = wobble(u.seed, t, 1.8 * lv.activity, q.hi ? 0.8 : 1.2);

  if (p.phase === 'Pending') { col = pal.dim; bob = wobble(u.seed, t, 1, 2.5); }
  else if (p.phase === 'CrashLoop') { col = '#9b59b6'; bob = Math.abs(wobble(u.seed, t, 6, 2)); }
  else if (p.phase === 'Terminating') col = '#5a5a5a';
  else if (p.phase === 'Succeeded') col = pal.accent;

  const x = u.x, y = u.y;

  if (fx === 'poof' || fx === 'harvest') {
    const k = 1 - (u.fxUntil - t) / 650;
    if (fx === 'harvest') {
      px(g, x + s * 0.2, y + k * s * 0.6, s * 0.35, s * 0.35, pal.accent);
      if (q.glow) glow(g, x + s * 0.37, y + k * s * 0.6 + s * 0.17, s, pal.accent, 0.5 * (1 - k));
    } else {
      for (let i = 0; i < (q.hi ? 8 : 5); i++) {
        px(g, x + s / 2 + Math.cos(i * 1.3) * k * 6, y + s / 2 + Math.sin(i * 1.3) * k * 6, 1, 1,
           q.hi ? rgba('#9585b8', 1 - k) : '#7a6a9c');
      }
    }
    if (k > 0.7) return;
  }
  if (fx === 'spawn') {
    const k = 1 - (u.fxUntil - t) / 700;
    if (k < 0.4) { px(g, x + s * 0.3, y - s * 0.4 + k * s, s * 0.2, s * 0.7, pal.accent); return; }
  }
  if (fx === 'hit') { if (Math.floor(t / 60) % 2 === 0) col = '#ffffff'; bob -= 2; }

  const yy = y + bob;

  if (q.shadows && s >= 7) shadowEllipse(g, x + s * 0.42, u.grounded ? y + s : yy + s - 0.5, s * 0.38, s * 0.12, 0.36);
  if (q.glow && s >= 5 && p.phase === 'CrashLoop') glow(g, x + s / 2, yy + s / 2, s * 1.6, '#9b59b6', 0.4);

  if (s < 7) {
    drawCompact(g, x, yy, s, col, 'figure');
  } else if (q.hi) {
    const line = shade(col, -0.6), lit = shade(col, 0.25), dark = shade(col, -0.3);
    const step = Math.sin(t * 0.005 + u.seed) > 0 ? 0.5 : 0;
    px(g, x + s * 0.22, y0(yy, s, 0.0), s * 0.36, s * 0.26, '#c9a07a');           // head
    px(g, x + s * 0.22, y0(yy, s, 0.0), s * 0.36, s * 0.07, '#e0bb92');
    px(g, x + s * 0.30, y0(yy, s, 0.10), s * 0.05, s * 0.05, '#1a1a1a');          // eyes
    px(g, x + s * 0.44, y0(yy, s, 0.10), s * 0.05, s * 0.05, '#1a1a1a');
    px(g, x + s * 0.16, y0(yy, s, 0.26), s * 0.48, s * 0.38, line);               // torso
    px(g, x + s * 0.19, y0(yy, s, 0.29), s * 0.42, s * 0.32, col);
    px(g, x + s * 0.19, y0(yy, s, 0.29), s * 0.42, s * 0.09, lit);
    px(g, x + s * 0.19, y0(yy, s, 0.53), s * 0.42, s * 0.08, dark);
    px(g, x + s * 0.20, y0(yy, s, 0.64) + step, s * 0.16, s * 0.30, '#3a3a4a');   // legs
    px(g, x + s * 0.46, y0(yy, s, 0.64) - step, s * 0.16, s * 0.30, '#3a3a4a');
    // Class weapon
    if (cls === 0) { px(g, x + s * 0.68, y0(yy, s, 0.12), s * 0.07, s * 0.50, '#d8d8e0');
                     px(g, x + s * 0.62, y0(yy, s, 0.46), s * 0.20, s * 0.06, '#8a7a5a'); }
    else if (cls === 1) { px(g, x + s * 0.70, y0(yy, s, 0.10), s * 0.07, s * 0.62, '#8a5a2a');
                          px(g, x + s * 0.66, y0(yy, s, 0.04), s * 0.16, s * 0.14, '#7fd8ff');
                          if (q.glow) glow(g, x + s * 0.74, y0(yy, s, 0.11), s * 0.8, '#7fd8ff', 0.55); }
    else if (cls === 2) { px(g, x + s * 0.04, y0(yy, s, 0.20), s * 0.06, s * 0.44, '#8a6a3a');
                          px(g, x + s * 0.10, y0(yy, s, 0.28), s * 0.04, s * 0.28, '#d8d0b0'); }
    else { px(g, x + s * 0.66, y0(yy, s, 0.28), s * 0.24, s * 0.30, '#a0a0c0');
           px(g, x + s * 0.70, y0(yy, s, 0.34), s * 0.16, s * 0.18, '#7a7a9a'); }
  } else {
    px(g, x + 1, yy, 3, 2, '#f0c8a0');
    px(g, x + 1, yy + 2, 3, 3, col);
    px(g, x + 1, yy + 5, 1, 1, '#3a3a3a'); px(g, x + 3, yy + 5, 1, 1, '#3a3a3a');
    if (cls === 0) px(g, x + 4, yy + 1, 1, 4, '#c0c0c0');
    else if (cls === 1) px(g, x + 4, yy + 2, 1, 3, '#8a5a2a');
    else if (cls === 2) px(g, x, yy + 2, 1, 3, '#6a4a2a');
    else px(g, x + 4, yy + 2, 2, 2, '#a0a0c0');
  }

  drawRestartMark(g, x, yy, s, p.restarts);
  if (p.kind === 'job') px(g, x - 1, yy + s * 0.5, 2, 2, pal.accent);
  // Live condition: a rising heat caret above the head, animated so it reads
  // differently from the static restart scars underneath.
  if (lv.hot) {
    drawHotMark(g, x, yy, s, t, u.seed);
    if (q.glow && s >= 5) glow(g, x + s * 0.5, yy + s * 0.4, s * 1.3, '#ff7a1f', 0.26);
  }
}

function y0(yy, s, f) { return yy + s * f; }

export function drawOverlay(g, world, ctx) {
  const { q, W, H } = ctx;
  // The dungeon is always dark at the edges.
  if (q.hi) {
    const grd = g.createRadialGradient(W * 0.42, H * 0.5, H * 0.20, W * 0.42, H * 0.5, H * 0.85);
    grd.addColorStop(0, 'rgba(0,0,0,0)');
    grd.addColorStop(1, 'rgba(0,0,0,0.62)');
    g.fillStyle = grd; g.fillRect(0, 0, W, H);
    return;
  }
  for (let i = 0; i < 20; i++) {
    const a = (20 - i) / 320;
    g.fillStyle = `rgba(0,0,0,${a.toFixed(3)})`;
    g.fillRect(i, i, W - i * 2, 1);
    g.fillRect(i, H - i - 1, W - i * 2, 1);
    g.fillRect(i, i, 1, H - i * 2);
    g.fillRect(W - i - 1, i, 1, H - i * 2);
  }
}
