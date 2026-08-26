'use strict';
import { px, rect, meter, text, textW, fitText, dither, vgrad, shade, rgba, glow, shadowEllipse,
         wobble, hash, mixColor } from '../engine.js';
import { daylight } from '../daynight.js';
import { reqTier, TIER_SCALE, loadVisual } from '../podclass.js';
import { drawCompact, drawHotMark, drawRestartMark } from '../sprite.js';

export const id = 'factory';
export const name = 'FACTORY';

export const vocab = {
  node: 'FLOOR', nodes: 'FLOORS', pod: 'MACHINE', pods: 'MACHINES',
  cpu: 'POWER', mem: 'STORAGE', capacity: 'FLOORSPACE', usage: 'DRAW',
  restart: 'JAM', crash: 'FIRE', done: 'SHIPPED', gone: 'SCRAPPED',
  closed: 'NO INTAKE',
};

export const palettes = {
  dawn:  { sky1: '#241d33', sky2: '#5c4a63', ground: '#33313d', ground2: '#282730',
           soil: '#3f4450', fence: '#8f97a8', ink: '#e8ecf5', dim: '#6f7585',
           accent: '#ffc857', good: '#4ec9b0', warn: '#ffab4d', bad: '#ff5f5f',
           panel: '#1c1a26', panelEdge: '#454055', lit: '#ffe08a', star: 0.4 },
  day:   { sky1: '#8a9bb0', sky2: '#b9c6d4', ground: '#5a5f6b', ground2: '#494d57',
           soil: '#6c7280', fence: '#c2c9d6', ink: '#14161c', dim: '#7a7f8c',
           accent: '#e08a1e', good: '#2f9e8f', warn: '#d97d1e', bad: '#c93b3b',
           panel: '#dfe4ec', panelEdge: '#8b93a3', lit: '#fff2c0', star: 0 },
  dusk:  { sky1: '#1f2438', sky2: '#8a5a52', ground: '#3a3742', ground2: '#2d2b34',
           soil: '#474d5b', fence: '#9aa2b3', ink: '#e8ecf5', dim: '#767c8c',
           accent: '#ff9a4d', good: '#45b8a4', warn: '#ffab4d', bad: '#ff6b6b',
           panel: '#211f2c', panelEdge: '#4d4760', lit: '#ffd98a', star: 0.5 },
  night: { sky1: '#070910', sky2: '#0f131f', ground: '#22242c', ground2: '#1a1c22',
           soil: '#2d323c', fence: '#5d6472', ink: '#c6cfdd', dim: '#4f5563',
           accent: '#ffd166', good: '#3d9e8c', warn: '#d98f3e', bad: '#e05555',
           panel: '#0d0f16', panelEdge: '#262a36', lit: '#ffe08a', star: 1 },
};

export const side = {
  texture: 'plate',
  prop(g, x, y, ctx, node, down) { drawCrane(g, x, y, ctx, down); },
};

function drawCrane(g, x, y, ctx, down) {
  const { pal, q, t } = ctx;
  const col = down ? '#4a4038' : pal.fence;
  px(g, x + 4, y - 20, 1.5, 20, col);                                  // mast
  px(g, x - 4, y - 20, 14, 1.5, col);                                  // jib
  const sway = wobble(hash(String(x)), t, 0.6, 2);
  px(g, x - 2 + sway, y - 19, 0.5, 7, col);                            // cable
  px(g, x - 3.5 + sway, y - 12, 3, 3, down ? '#5a4a4a' : pal.accent);  // load
  if (q.glow && !down) glow(g, x + 4.5, y - 20, 6, pal.warn, 0.3);
  px(g, x + 4, y - 21, 1.5, 1.5, down ? '#5a4a4a' : pal.bad);          // beacon
}

export function drawBackground(g, ctx) {
  const { pal, q, t, hours, W, H } = ctx;
  const hz = H * 0.48;
  const dl = daylight(hours);

  if (q.hi) {
    const grd = g.createLinearGradient(0, 0, 0, hz);
    grd.addColorStop(0, shade(pal.sky1, -0.15));
    grd.addColorStop(1, pal.sky2);
    g.fillStyle = grd; g.fillRect(0, 0, W, hz);
  } else {
    vgrad(g, 0, 0, W, hz, pal.sky1, pal.sky2, q);
  }

  if (pal.star > 0.05) {
    for (let i = 0; i < (q.hi ? 90 : 40); i++) {
      const sx = hash('fs' + i) % W, sy = hash('fsy' + i) % 90;
      const tw = 0.5 + 0.5 * Math.sin(t * 0.002 + i);
      if (tw * pal.star > 0.5) px(g, sx, sy, q.hi ? 0.5 : 1, q.hi ? 0.5 : 1, '#ffffff');
    }
  }

  // Industrial skyline. Depth layers at 64-bit, one flat row at 8-bit.
  const layers = q.parallax ? 2 : 1;
  for (let L = layers - 1; L >= 0; L--) {
    const depth = L / Math.max(1, layers);
    const tint = q.hi ? mixColor(pal.ground2, pal.sky2, depth * 0.5) : pal.ground2;
    for (let i = 0; i < 9; i++) {
      const seed = i + L * 31;
      const bw = 26 + (hash('bld' + seed) % 34);
      const bh = (20 + (hash('bldh' + seed) % 46)) * (1 - depth * 0.3);
      const bx = ((i * 74 + 10 + L * 37) % (W + 40)) - 20;
      px(g, bx, hz - bh, bw, bh, tint);
      if (q.hi) px(g, bx, hz - bh, bw, 0.5, shade(tint, 0.2));
      if (L > 0) continue;
      for (let wy = hz - bh + 4; wy < hz - 4; wy += 6) {
        for (let wx = bx + 3; wx < bx + bw - 3; wx += 5) {
          if ((hash(`w${i}${wx}${wy}`) % 100) / 100 <= (0.35 + dl * 0.5)) continue;
          px(g, wx, wy, 2, 3, pal.lit);
          if (q.glow) glow(g, wx + 1, wy + 1.5, 4, pal.lit, 0.16);
        }
      }
      const sx = bx + bw / 2;
      for (let s = 0; s < 5; s++) {
        const sy = hz - bh - 4 - s * 5 - ((t * 0.01 + i * 7) % 6);
        px(g, sx + wobble(i * 13 + s, t, 0.6, 3), sy, 2 + s, 2, rgba('#ffffff', q.hi ? 0.06 : 0.08));
      }
    }
  }

  px(g, 0, hz, W, H - hz, pal.ground);
  if (q.hi) {
    const grd = g.createLinearGradient(0, hz, 0, H);
    grd.addColorStop(0, rgba(pal.ground2, 0.1));
    grd.addColorStop(1, rgba(pal.ground2, 0.8));
    g.fillStyle = grd; g.fillRect(0, hz, W, H - hz);
  } else {
    dither(g, 0, hz, W, H - hz, pal.ground2, 4, q.u);
  }
}

export function drawContainer(g, node, r, ctx) {
  const { pal, q, t } = ctx;
  const cpuAlloc = node.cpu.allocatable || 1;
  const reqFrac = Math.min(1.4, node.cpu.requests / cpuAlloc);
  const useFrac = node.cpu.usage != null ? Math.min(1.4, node.cpu.usage / cpuAlloc) : null;
  const down = !node.ready;

  const floorCol = down ? '#2a2222' : pal.ground;
  if (q.hi) vgrad(g, r.x, r.y, r.w, r.h, shade(floorCol, 0.08), shade(floorCol, -0.14), q);
  else px(g, r.x, r.y, r.w, r.h, floorCol);
  for (let yy = r.y + 12; yy < r.y + r.h; yy += 4)
    for (let xx = r.x + 2; xx < r.x + r.w - 2; xx += 4)
      px(g, xx, yy, 2, 2, q.hi ? rgba(pal.ground2, 0.55) : pal.ground2);

  const inner = { x: r.x + 3, y: r.y + 12, w: r.w - 6, h: r.h - 16 };
  const leaseW = Math.max(2, inner.w * Math.min(1, reqFrac));

  const bay = down ? '#332a2a' : pal.soil;
  if (q.hi) vgrad(g, inner.x, inner.y, leaseW, inner.h, shade(bay, 0.12), shade(bay, -0.16), q);
  else px(g, inner.x, inner.y, leaseW, inner.h, bay);
  for (let i = 0; i < inner.h; i += 2) px(g, inner.x + leaseW - 1, inner.y + i, 1, 1, pal.accent);

  if (useFrac != null) {
    const useW = inner.w * Math.min(1, useFrac);
    const runW = Math.min(useW, leaseW);
    if (runW > 0) {
      px(g, inner.x, inner.y + 1, runW, inner.h - 2, down ? '#332a2a' : '#4a5563');
      for (let by = inner.y + 3; by < inner.y + inner.h - 2; by += 5) {
        const off = (t * 0.03) % 4;
        for (let bx = inner.x; bx < inner.x + runW; bx += 4) {
          px(g, bx + off, by, 2, 1, down ? '#3a3030' : pal.lit);
        }
      }
    }
    if (useFrac > reqFrac + 0.02) {
      const oX = inner.x + leaseW, oW = Math.max(1, useW - leaseW);
      dither(g, oX, inner.y + 1, oW, inner.h - 2, pal.bad, 2, q.u);
    }
  }

  px(g, r.x, r.y, r.w, 11, q.hi ? rgba(pal.panel, 0.85) : pal.panel);
  rect(g, r.x, r.y, r.w, r.h, down ? pal.bad : pal.panelEdge);
  text(g, fitText(g, shortName(node), r.w - 30, 6), r.x + 2, r.y + 2, down ? pal.bad : pal.ink, 6);

  const mx = r.x + r.w - 26;
  meter(g, mx, r.y + 2, 22, 3, reqFrac, reqFrac > 0.9 ? pal.bad : pal.good, '#00000055', useFrac, pal.accent, q);
  meter(g, mx, r.y + 6, 22, 2, node.mem.requests / (node.mem.allocatable || 1),
        node.mem.requests / (node.mem.allocatable || 1) > 0.9 ? pal.bad : '#5aa9e6', '#00000055',
        node.mem.usage != null ? node.mem.usage / (node.mem.allocatable || 1) : null, '#9fd8ff', q);

  const podFrac = node.pods.count / (node.pods.max || 110);
  const lit = Math.round(podFrac * 10);
  for (let i = 0; i < 10; i++)
    px(g, r.x + 2 + i * 3, r.y + 8, 2, 2,
       i < lit ? (podFrac > 0.9 ? pal.bad : podFrac > 0.75 ? pal.warn : pal.dim) : '#00000044');

  if (node.unschedulable) {
    const s = 'NO INTAKE', w = textW(g, s, 6) + 4;
    px(g, r.x + (r.w - w) / 2, r.y + r.h / 2 - 4, w, 9, pal.bad);
    text(g, s, r.x + (r.w - w) / 2 + 2, r.y + r.h / 2 - 3, '#fff', 6);
  }
  if (down) {
    if (Math.floor(t / 220) % 2 === 0) {
      if (q.hi) { g.fillStyle = 'rgba(0,0,0,0.5)'; g.fillRect(r.x, r.y, r.w, r.h); }
      else dither(g, r.x, r.y, r.w, r.h, '#000000', 2, q.u);
    }
    for (let i = 0; i < 6; i++) {
      const sx = r.x + (hash('sp' + node.name + i) + Math.floor(t * 0.09)) % Math.floor(r.w);
      px(g, sx, r.y + 12 + (hash('spy' + node.name + i) % Math.floor(r.h - 14)), 1, 1, pal.warn);
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

  // Machine class is the pod's CPU REQUEST tier; how fast the piston runs and
  // how brightly it is lit is its ACTUAL usage.
  const kind = reqTier(p);
  const lv = loadVisual(p);
  const fx = u.fxUntil > t ? u.fx : null;
  const dim = p.dim;
  const s = (u.size || q.unitSize) * TIER_SCALE[kind];

  const BASE = ['#8ad6a0', '#5aa9e6', '#e6b45a', '#c98ae6'];
  let col = dim ? pal.dim : BASE[kind];
  if (!dim && lv.known) col = shade(col, -0.34 + lv.bright * 0.34);
  // An idle machine barely moves; one at its request hammers away.
  let piston = Math.abs(wobble(u.seed, t, 3.2 * lv.activity, q.hi ? 1.6 : 2));

  if (p.phase === 'Pending') { col = pal.dim; piston = 0; }
  else if (p.phase === 'CrashLoop') col = pal.bad;
  else if (p.phase === 'Terminating') col = '#6a6a6a';
  else if (p.phase === 'Succeeded') col = pal.accent;

  const x = u.x, y = u.y;

  if (fx === 'poof' || fx === 'harvest') {
    const k = 1 - (u.fxUntil - t) / 650;
    const c = fx === 'harvest' ? pal.accent : '#8a8a8a';
    for (let i = 0; i < (q.hi ? 8 : 5); i++) {
      px(g, x + s / 2 + Math.cos(i) * k * 6, y + s / 2 - k * 6 + i, 1, 1, q.hi ? rgba(c, 1 - k) : c);
    }
    if (k > 0.7) return;
  }
  if (fx === 'spawn') {
    const k = 1 - (u.fxUntil - t) / 700;
    if (k < 0.4) { px(g, x, y + s * 0.55, k * s * 1.6, 1, pal.accent); return; }
  }
  if (fx === 'hit' && Math.floor(t / 60) % 2 === 0) col = '#ffffff';

  if (q.shadows && s >= 7) shadowEllipse(g, x + s * 0.45, u.grounded ? y + s : y + s - 0.5, s * 0.4, s * 0.12, 0.32);
  if (q.glow && s >= 5 && p.phase === 'CrashLoop') glow(g, x + s / 2, y + s / 2, s * 1.5, pal.bad, 0.35);

  const lamp = p.phase === 'CrashLoop' ? pal.bad
    : p.phase === 'Pending' ? pal.warn
    : p.ready ? pal.good : pal.warn;
  const lampOn = p.phase !== 'CrashLoop' || Math.floor(t / 200) % 2 === 0;

  if (s < 7) {
    // Below ~7 units the detailed chassis is smaller than its own outline.
    drawCompact(g, x, y, s, col, 'box',
      { lamp: lampOn ? lamp : null });
  } else if (q.hi) {
    const line = shade(col, -0.6);
    px(g, x + s * 0.05, y + s * 0.22, s * 0.82, s * 0.58, line);
    vgrad(g, x + s * 0.09, y + s * 0.26, s * 0.74, s * 0.50, shade(col, 0.22), shade(col, -0.22), q);
    px(g, x + s * 0.09, y + s * 0.26, s * 0.74, s * 0.10, shade(col, 0.4));
    px(g, x + s * 0.14, y + s * 0.44, s * 0.30, s * 0.18, shade(col, -0.45));   // vent
    for (let i = 0; i < 3; i++) px(g, x + s * (0.16 + i * 0.09), y + s * 0.46, s * 0.04, s * 0.14, shade(col, 0.1));
    px(g, x + s * 0.30, y + s * 0.10 - piston, s * 0.22, s * 0.16, dim ? pal.dim : '#c6cfdd');   // piston
    px(g, x + s * 0.30, y + s * 0.10 - piston, s * 0.22, s * 0.05, '#e8eef7');
    px(g, x + s * 0.05, y + s * 0.80, s * 0.82, s * 0.10, shade(col, -0.55));   // base
    if (lampOn) {
      px(g, x + s * 0.68, y + s * 0.34, s * 0.14, s * 0.14, lamp);
      if (q.glow) glow(g, x + s * 0.75, y + s * 0.41, s * 0.7, lamp, 0.5);
    }
  } else {
    px(g, x, y + 1, 6, 4, col);
    px(g, x + 1, y + 5, 4, 1, '#00000055');
    px(g, x + 2, y - piston, 2, 2, dim ? pal.dim : '#c6cfdd');
    if (lampOn) px(g, x + 5, y + 1, 1, 1, lamp);
  }

  drawRestartMark(g, x, y, s, p.restarts);
  if (p.kind === 'job') px(g, x + s * 0.9, y + s * 0.55, 2, 2, pal.accent);
  // Live condition: a rising heat caret above the head, animated so it reads
  // differently from the static restart scars underneath.
  if (lv.hot) {
    drawHotMark(g, x, y, s, t, u.seed);
    if (q.glow && s >= 5) glow(g, x + s * 0.5, y + s * 0.4, s * 1.3, '#ff7a1f', 0.26);
  }
}

export function drawOverlay(g, world, ctx) {
  const { q, t, hours } = ctx;
  const dl = daylight(hours);
  if (dl >= 0.5) return;
  const strength = (1 - dl) * (q.hi ? 0.09 : 0.05);
  for (let i = 0; i < 3; i++) {
    const lx = 70 + i * 150;
    if (q.glow) {
      const grd = g.createLinearGradient(lx, 24, lx + 22, 24 + 110);
      grd.addColorStop(0, `rgba(255,224,138,${strength})`);
      grd.addColorStop(1, 'rgba(255,224,138,0)');
      g.fillStyle = grd;
      g.beginPath();
      g.moveTo(lx, 24); g.lineTo(lx + 6, 24); g.lineTo(lx + 40, 140); g.lineTo(lx - 34, 140);
      g.closePath(); g.fill();
    } else {
      for (let k = 0; k < 22; k++) {
        const a = strength * (1 - k / 22);
        if (a <= 0.002) continue;
        g.fillStyle = `rgba(255,224,138,${a.toFixed(3)})`;
        g.fillRect(lx - k, 24 + k * 5, 2 + k * 2, 5);
      }
    }
  }
}
