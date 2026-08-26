'use strict';
import { px, rect, meter, text, textW, fitText, dither, vgrad, shade, rgba, glow, shadowEllipse,
         wobble, hash, mixColor } from '../engine.js';
import { daylight } from '../daynight.js';
import { reqTier, TIER_SCALE, loadVisual } from '../podclass.js';
import { drawCompact, drawHotMark, drawRestartMark } from '../sprite.js';

export const id = 'farm';
export const name = 'FARM';

export const vocab = {
  node: 'PLOT', nodes: 'PLOTS', pod: 'CRITTER', pods: 'CRITTERS',
  cpu: 'LAND', mem: 'WATER', capacity: 'ACREAGE', usage: 'TILLED',
  restart: 'STUMBLE', crash: 'BLIGHT', done: 'HARVEST', gone: 'GONE',
  closed: 'CLOSED',
};

export const palettes = {
  dawn:  { sky1: '#3a2a4d', sky2: '#8f5e6b', ground: '#4a6b3a', ground2: '#3c5730',
           soil: '#6b4a32', fence: '#c9a06a', ink: '#f2e9d8', dim: '#8b8577',
           accent: '#ffcf6b', good: '#8fd67a', warn: '#ffc14d', bad: '#ff6b6b',
           panel: '#241f2e', panelEdge: '#4a3f5c', lit: '#ffe9a3', star: 0 },
  day:   { sky1: '#6bb8e8', sky2: '#a8d8f0', ground: '#5f9440', ground2: '#4d7a33',
           soil: '#7d5636', fence: '#d9b57a', ink: '#1c1a24', dim: '#6f6a5c',
           accent: '#ffb02e', good: '#3fa62e', warn: '#e08a1e', bad: '#d63b3b',
           panel: '#f0e6d0', panelEdge: '#a08b64', lit: '#fff6c9', star: 0 },
  dusk:  { sky1: '#2d3561', sky2: '#c76b62', ground: '#4a6238', ground2: '#3a4d2c',
           soil: '#5e4230', fence: '#b08a5c', ink: '#f2e9d8', dim: '#8b8577',
           accent: '#ff9a4d', good: '#7dc46a', warn: '#ffab4d', bad: '#ff5f5f',
           panel: '#2a2438', panelEdge: '#54486b', lit: '#ffd98a', star: 0.3 },
  night: { sky1: '#0a0e1f', sky2: '#141a33', ground: '#26362a', ground2: '#1d2a21',
           soil: '#3a2a1f', fence: '#6b5540', ink: '#c9d4e8', dim: '#5a6070',
           accent: '#6ba8ff', good: '#4d8f5e', warn: '#c98a3e', bad: '#e05555',
           panel: '#12131f', panelEdge: '#2a2d40', lit: '#ffe9a3', star: 1 },
};

// Materials the shared side-on renderer uses.
export const side = {
  texture: 'grass',
  prop(g, x, y, ctx, node, down) { drawBarn(g, x, y - 12, tierOf(node), ctx, down); },
};

function tierOf(node) {
  const c = node.cpu.allocatable || 1;
  return c >= 12 ? 3 : c >= 6 ? 2 : 1;
}

export function drawBackground(g, ctx) {
  const { pal, q, t, hours, W, H } = ctx;
  const dl = daylight(hours);

  // Sky. At 8-bit this is a handful of dithered bands; at 64-bit a real
  // gradient with atmospheric haze near the horizon.
  const hz = H * 0.52;
  if (q.hi) {
    const grd = g.createLinearGradient(0, 0, 0, hz);
    grd.addColorStop(0, shade(pal.sky1, -0.1));
    grd.addColorStop(0.55, pal.sky1);
    grd.addColorStop(1, pal.sky2);
    g.fillStyle = grd; g.fillRect(0, 0, W, hz);
  } else {
    vgrad(g, 0, 0, W, hz, pal.sky1, pal.sky2, q);
  }

  if (pal.star > 0.05) {
    for (let i = 0; i < (q.hi ? 140 : 60); i++) {
      const sx = hash('star' + i) % W, sy = hash('stary' + i) % Math.floor(hz * 0.8);
      const tw = 0.5 + 0.5 * Math.sin(t * 0.002 + i);
      if (tw * pal.star > 0.45) {
        const s = q.hi ? (tw > 0.9 ? 1 : 0.5) : 1;
        px(g, sx, sy, s, s, rgba('#ffffff', q.hi ? tw * pal.star : 1));
      }
    }
  }

  // Sun or moon, tracking the real hour across the sky.
  const arc = Math.max(0, Math.min(1, (hours - 5) / 15));
  const cx = 30 + arc * (W - 120), cy = 70 - Math.sin(arc * Math.PI) * 46;
  if (dl > 0.15) {
    if (q.glow) glow(g, cx + 5, cy + 5, 46, '#fff3b0', 0.30);
    if (q.hi) { g.fillStyle = '#fff3b0'; g.beginPath(); g.arc(cx + 5, cy + 5, 7, 0, Math.PI * 2); g.fill(); }
    else { px(g, cx, cy, 10, 10, '#fff3b0'); px(g, cx + 2, cy - 2, 6, 14, '#fff3b0'); px(g, cx - 2, cy + 2, 14, 6, '#fff3b0'); }
  } else {
    const mx = W - 90 - arc * 60;
    if (q.glow) glow(g, mx + 4, 48, 34, '#cfd8f0', 0.22);
    if (q.hi) {
      g.fillStyle = '#e8eaf2'; g.beginPath(); g.arc(mx + 4, 48, 6, 0, Math.PI * 2); g.fill();
      g.fillStyle = pal.sky1; g.beginPath(); g.arc(mx + 7, 45, 4.5, 0, Math.PI * 2); g.fill();
    } else {
      px(g, mx, 44, 9, 9, '#e8eaf2'); px(g, mx + 3, 41, 4, 15, '#e8eaf2'); px(g, mx + 5, 46, 5, 5, pal.sky1);
    }
  }

  // Parallax hills, then the near ground.
  if (q.parallax) {
    for (let layer = 0; layer < 3; layer++) {
      const depth = layer / 3;
      const col = mixColor(pal.sky2, pal.ground2, 0.35 + depth * 0.45);
      const amp = 5 + layer * 4, base = hz - 16 + layer * 8;
      g.fillStyle = col;
      g.beginPath(); g.moveTo(0, H);
      for (let x = 0; x <= W; x += 4) {
        g.lineTo(x, base + Math.sin(x * (0.006 + layer * 0.004) + layer * 2) * amp);
      }
      g.lineTo(W, H); g.closePath(); g.fill();
    }
    vgrad(g, hz, 0, 0, 0, pal.ground, pal.ground, q);   // no-op guard
    g.fillStyle = pal.ground;
    g.fillRect(0, hz + 4, W, H - hz - 4);
    const grd = g.createLinearGradient(0, hz + 4, 0, H);
    grd.addColorStop(0, rgba(pal.ground2, 0.0));
    grd.addColorStop(1, rgba(pal.ground2, 0.75));
    g.fillStyle = grd; g.fillRect(0, hz + 4, W, H - hz - 4);
  } else {
    px(g, 0, hz, W, H - hz, pal.ground2);
    for (let x = 0; x < W; x++) {
      const y = hz + Math.sin(x * 0.02) * 4 + Math.sin(x * 0.007) * 6;
      px(g, x, y, 1, H - y, pal.ground);
    }
  }
}

// ---- top-down plot ---------------------------------------------------------
export function drawContainer(g, node, r, ctx) {
  const { pal, q, t } = ctx;
  const cpuAlloc = node.cpu.allocatable || 1;
  const reqFrac = Math.min(1.4, node.cpu.requests / cpuAlloc);
  const useFrac = node.cpu.usage != null ? Math.min(1.4, node.cpu.usage / cpuAlloc) : null;
  const down = !node.ready;

  // Grass base: the whole plot is the land you own.
  const grass = down ? '#2b2b2b' : pal.ground;
  if (q.hi) {
    vgrad(g, r.x, r.y, r.w, r.h, shade(grass, 0.10), shade(grass, -0.12), q);
    for (let i = 0; i < r.w * r.h / 42; i++) {
      const gx = r.x + (hash(node.name + 'g' + i) % Math.floor(r.w));
      const gy = r.y + 10 + (hash(node.name + 'gy' + i) % Math.floor(Math.max(1, r.h - 12)));
      px(g, gx, gy, 0.5, 1, rgba(down ? '#1c1c1c' : pal.ground2, 0.8));
    }
  } else {
    px(g, r.x, r.y, r.w, r.h, grass);
    dither(g, r.x, r.y, r.w, r.h, down ? '#232323' : pal.ground2, 3, q.u);
  }

  const inner = { x: r.x + 4, y: r.y + 13, w: r.w - 8, h: r.h - 21 };
  const fenceW = Math.max(3, inner.w * Math.min(1, reqFrac));

  // Bare tilled soil inside the fence: claimed ground.
  const soil = down ? '#2a2018' : pal.soil;
  if (q.hi) vgrad(g, inner.x, inner.y, fenceW, inner.h, shade(soil, 0.12), shade(soil, -0.18), q);
  else px(g, inner.x, inner.y, fenceW, inner.h, soil);

  // Growing rows = actual usage, drawn inside the fence.
  if (useFrac != null) {
    const useW = inner.w * Math.min(1, useFrac);
    const growW = Math.min(useW, fenceW);
    const rowGap = q.hi ? 4 : 5;
    for (let ry = inner.y + 2; ry < inner.y + inner.h - 1; ry += rowGap) {
      if (growW <= 0) break;
      if (q.hi) {
        px(g, inner.x + 1, ry, growW - 1, 2, down ? '#33301f' : '#5c7a2e');
        px(g, inner.x + 1, ry, growW - 1, 0.5, down ? '#3a3626' : '#9ac257');
        px(g, inner.x + 1, ry + 2, growW - 1, 0.5, rgba('#000000', 0.28));
      } else {
        px(g, inner.x + 1, ry, growW - 1, 2, down ? '#33301f' : '#6d8c3a');
        px(g, inner.x + 1, ry, growW - 1, 1, down ? '#3a3626' : '#8fb04a');
      }
    }
    // Usage past the fence: real CPU nobody reserved.
    if (useFrac > reqFrac + 0.02) {
      const oX = inner.x + fenceW, oW = Math.max(1, useW - fenceW);
      for (let ry = inner.y + 3; ry < inner.y + inner.h - 1; ry += 5) {
        dither(g, oX, ry, oW, 2, pal.bad, 2, q.u);
      }
    }
  }

  // The fence: posts along the top and bottom rails, verticals only at the ends.
  const fx0 = inner.x - 1, fx1 = inner.x + fenceW;
  const fy0 = inner.y - 2, fy1 = inner.y + inner.h;
  const rail = down ? '#4a4038' : pal.fence;
  px(g, fx0, fy0, fenceW + 2, 1, rail);
  px(g, fx0, fy1, fenceW + 2, 1, rail);
  for (let fx = fx0; fx <= fx1; fx += 7) {
    px(g, fx, fy0 - 1, 1, 3, rail);
    px(g, fx, fy1 - 1, 1, 3, rail);
  }
  px(g, fx0, fy0 - 1, 1, fy1 - fy0 + 3, rail);
  px(g, fx1, fy0 - 1, 1, fy1 - fy0 + 3, rail);
  px(g, fx1 - 1, fy0 + (fy1 - fy0) / 2 - 1, 3, 3, pal.accent);

  drawBarn(g, r.x + r.w - 13, r.y + r.h - 10, tierOf(node), ctx, down);

  // Signpost: name, the two allocation meters, and the crowding pips.
  px(g, r.x, r.y, r.w, 10, q.hi ? rgba(pal.panel, 0.85) : pal.panel);
  rect(g, r.x, r.y, r.w, r.h, down ? pal.bad : pal.panelEdge);
  text(g, fitText(g, shortName(node), r.w - 30, 6), r.x + 2, r.y + 2, down ? pal.bad : pal.ink, 6);

  const mx = r.x + r.w - 26;
  meter(g, mx, r.y + 2, 22, 3, reqFrac, reqFrac > 0.9 ? pal.bad : pal.good, '#00000055', useFrac, pal.accent, q);
  meter(g, mx, r.y + 6, 22, 2, node.mem.requests / (node.mem.allocatable || 1),
        node.mem.requests / (node.mem.allocatable || 1) > 0.9 ? pal.bad : '#5aa9e6', '#00000055',
        node.mem.usage != null ? node.mem.usage / (node.mem.allocatable || 1) : null, '#9fd8ff', q);

  const podFrac = node.pods.count / (node.pods.max || 110);
  const lit = Math.round(podFrac * 10);
  for (let i = 0; i < 10; i++) {
    px(g, r.x + 2 + i * 3, r.y + 7, 2, 2,
       i < lit ? (podFrac > 0.9 ? pal.bad : podFrac > 0.75 ? pal.warn : pal.dim) : '#00000044');
  }

  if (node.unschedulable) {
    const s = 'CLOSED', w = textW(g, s, 6) + 4;
    px(g, r.x + (r.w - w) / 2, r.y + r.h / 2 - 4, w, 9, pal.bad);
    text(g, s, r.x + (r.w - w) / 2 + 2, r.y + r.h / 2 - 3, '#ffffff', 6);
  }
  if (down) {
    for (let i = 0; i < 14; i++) {
      const sx = r.x + ((hash('rain' + node.name + i) + Math.floor(t * 0.05)) % Math.floor(r.w));
      const sy = r.y + ((hash('rainy' + node.name + i) + Math.floor(t * 0.18)) % Math.floor(r.h));
      px(g, sx, sy, q.hi ? 0.5 : 1, 3, '#7fa8d8');
    }
  }
  if (node.pressures.length) text(g, '!', r.x + r.w - 6, r.y + 12, pal.warn, 8);
}

function drawBarn(g, x, y, tier, ctx, down) {
  const { pal, q } = ctx;
  const w = 6 + tier * 3, h = 5 + tier * 2;
  const body = down ? '#4a3b3b' : '#a4442f';
  if (q.shadows) shadowEllipse(g, x + w / 2, y + h + 1, w * 0.6, 1.6, 0.28);
  if (q.hi) {
    vgrad(g, x, y + 2, w, h, shade(body, 0.16), shade(body, -0.20), q);
    px(g, x, y + 2, w, 0.5, shade(body, 0.35));
  } else {
    px(g, x, y + 2, w, h, body);
  }
  for (let i = 0; i < w; i++) px(g, x + i, y + 1 - Math.abs(i - w / 2) / 2, 1, 2, '#e8d9b8');
  px(g, x + w / 2 - 1, y + h - 1, 3, 3, '#5c3020');
  if (q.hi) px(g, x + 1.5, y + 4, 1.5, 1.5, rgba('#ffe9a3', 0.8));   // lit window
}

// The server already reduced the node name to its meaningful pool part.
function shortName(node) {
  return String((node && node.display) || (node && node.name) || node || '').slice(0, 15);
}

// ---- critters --------------------------------------------------------------
export function drawUnit(g, u, ctx) {
  const { pal, q, t } = ctx;
  const p = u.pod;
  if (!p) return;

  // Species is the pod's CPU REQUEST tier; how fast and how bright it works is
  // its ACTUAL usage. Reservation and consumption are different facts, so they
  // get different visual channels.
  const species = reqTier(p);
  const lv = loadVisual(p);
  const fx = u.fxUntil > t ? u.fx : null;
  const dim = p.dim;
  const s = (u.size || q.unitSize) * TIER_SCALE[species];

  const BASE = ['#81b29a', '#f2c14e', '#e8e0d0', '#e07a5f'];
  let col = dim ? pal.dim : BASE[species];
  // Idle pods sit dull; a pod near its request is fully lit.
  if (!dim && lv.known) col = shade(col, -0.34 + lv.bright * 0.34);
  let bob = wobble(u.seed, t, 2.2 * lv.activity, q.hi ? 0.9 : 1.4);

  if (p.phase === 'Pending') { col = pal.dim; bob = wobble(u.seed, t, 1.1, 2.5); }
  else if (p.phase === 'CrashLoop') { col = pal.bad; bob = Math.abs(wobble(u.seed, t, 7, 2.2)); }
  else if (p.phase === 'Terminating') col = '#7a7a7a';
  else if (p.phase === 'Succeeded') col = pal.accent;

  const x = u.x, y = u.y;

  // Death / harvest burst.
  if (fx === 'poof' || fx === 'harvest') {
    const k = 1 - (u.fxUntil - t) / 650;
    const c = fx === 'harvest' ? pal.accent : '#cfcfcf';
    for (let i = 0; i < (q.hi ? 10 : 6); i++) {
      const a = (i / (q.hi ? 10 : 6)) * Math.PI * 2;
      const d = k * (q.hi ? 9 : 7);
      px(g, x + s / 2 + Math.cos(a) * d, y + s / 2 + Math.sin(a) * d,
         q.hi ? 1 : 1, q.hi ? 1 : 1, q.hi ? rgba(c, 1 - k) : c);
    }
    if (k > 0.7) return;
  }
  if (fx === 'spawn') {
    const k = 1 - (u.fxUntil - t) / 700;
    if (k < 0.35) { px(g, x + 1, y + s * 0.6 - k * s * 0.6, 3, 2, col); return; }
  }
  if (fx === 'hit') {
    if (Math.floor(t / 60) % 2 === 0) col = '#ffffff';
    bob += ((u.fxUntil - t) / 400) * 3;
  }

  const yy = y + bob;

  if (q.shadows) {
    const gr = u.grounded ? y + s : yy + s - 0.5;
    shadowEllipse(g, x + s * 0.45, gr, s * 0.42, s * 0.13, 0.3);
  }
  if (q.glow && s >= 5 && p.phase === 'CrashLoop') glow(g, x + s / 2, yy + s / 2, s * 1.6, pal.bad, 0.35);

  // Below ~7 units the detailed art is smaller than its own outline, so the
  // compact form is the honest picture as well as the cheap one.
  if (s < 7) {
    drawCompact(g, x, yy, s, col, 'blob');
  } else if (q.hi) drawCritter64(g, x, yy, s, col, species, p, t, u.seed, pal);
  else drawCritter8(g, x, yy, col, species, p, pal);

  // History: pale scars under the feet, static.
  drawRestartMark(g, x, yy, s, p.restarts);
  if (p.kind === 'job') px(g, x - 1, yy + s * 0.5, 2, 2, pal.accent);
  // Live condition: a rising heat caret above the head, animated so it reads
  // differently from the static restart scars underneath.
  if (lv.hot) {
    drawHotMark(g, x, yy, s, t, u.seed);
    if (q.glow && s >= 5) glow(g, x + s * 0.5, yy + s * 0.4, s * 1.3, '#ff7a1f', 0.26);
  }
}

function drawCritter8(g, x, y, col, species, p, pal) {
  if (species === 1) {              // chicken  (<=100m)
    px(g, x + 1, y + 1, 3, 3, col); px(g, x + 3, y, 2, 2, col);
    px(g, x + 4, y + 1, 1, 1, '#e04b2a');
    px(g, x + 1, y + 4, 1, 1, '#c98a3e'); px(g, x + 3, y + 4, 1, 1, '#c98a3e');
  } else if (species === 3) {       // cow      (>500m)
    px(g, x, y + 1, 5, 3, col); px(g, x + 4, y, 2, 2, col);
    px(g, x, y + 4, 1, 1, '#5a4030'); px(g, x + 4, y + 4, 1, 1, '#5a4030');
    px(g, x + 1, y + 2, 1, 1, '#ffffff44');
  } else if (species === 2) {       // sheep    (<=500m)
    px(g, x + 1, y, 4, 4, col); px(g, x, y + 1, 1, 2, col);
    px(g, x + 4, y + 1, 2, 2, '#3a3a3a');
    px(g, x + 1, y + 4, 1, 1, '#3a3a3a'); px(g, x + 3, y + 4, 1, 1, '#3a3a3a');
  } else {                          // crop     (no request)
    px(g, x + 2, y + 1, 1, 4, '#4d7a33'); px(g, x + 1, y, 3, 2, col);
  }
}

// 64-bit: outline, three shades, an eye, and legs that actually alternate.
function drawCritter64(g, x, y, s, col, species, p, t, seed, pal) {
  // species: 0 crop (no request), 1 chicken, 2 sheep, 3 cow
  const d = 0.5;
  const lit = shade(col, 0.26), dark = shade(col, -0.28), line = shade(col, -0.62);
  const step = Math.sin(t * 0.006 + seed) > 0 ? 1 : 0;
  const legA = step ? 0 : d, legB = step ? d : 0;

  const box = (bx, by, bw, bh, c) => px(g, x + bx, y + by, bw, bh, c);

  if (species === 1) {                                   // chicken  (<=100m)
    box(s * 0.15, s * 0.30, s * 0.55, s * 0.42, line);
    box(s * 0.18, s * 0.33, s * 0.49, s * 0.36, col);
    box(s * 0.18, s * 0.33, s * 0.49, s * 0.12, lit);
    box(s * 0.18, s * 0.58, s * 0.49, s * 0.11, dark);
    box(s * 0.52, s * 0.12, s * 0.32, s * 0.28, line);
    box(s * 0.55, s * 0.15, s * 0.26, s * 0.22, col);
    box(s * 0.58, s * 0.03, s * 0.16, s * 0.12, '#e04b2a');   // comb
    box(s * 0.82, s * 0.24, s * 0.14, s * 0.08, '#e8a33d');   // beak
    box(s * 0.66, s * 0.20, d, d, '#1a1a1a');                  // eye
    box(s * 0.26, s * 0.72 + legA, d * 1.4, s * 0.24, '#c98a3e');
    box(s * 0.52, s * 0.72 + legB, d * 1.4, s * 0.24, '#c98a3e');
  } else if (species === 3) {                            // cow      (>500m)
    box(s * 0.04, s * 0.30, s * 0.72, s * 0.40, line);
    box(s * 0.07, s * 0.33, s * 0.66, s * 0.34, col);
    box(s * 0.07, s * 0.33, s * 0.66, s * 0.11, lit);
    box(s * 0.07, s * 0.57, s * 0.66, s * 0.10, dark);
    box(s * 0.22, s * 0.40, s * 0.20, s * 0.16, shade(col, -0.5));   // patch
    box(s * 0.60, s * 0.14, s * 0.34, s * 0.28, line);
    box(s * 0.63, s * 0.17, s * 0.28, s * 0.22, col);
    box(s * 0.78, s * 0.24, d, d, '#1a1a1a');
    box(s * 0.58, s * 0.10, s * 0.08, s * 0.08, '#d8d0c0');          // horn
    box(s * 0.14, s * 0.70 + legA, d * 1.6, s * 0.26, '#5a4030');
    box(s * 0.54, s * 0.70 + legB, d * 1.6, s * 0.26, '#5a4030');
  } else if (species === 2) {                            // sheep    (<=500m)
    box(s * 0.08, s * 0.26, s * 0.66, s * 0.46, line);
    for (let i = 0; i < 5; i++) {                                   // fleece lumps
      box(s * (0.10 + i * 0.13), s * (0.26 + (i % 2) * 0.05), s * 0.17, s * 0.20, i % 2 ? col : lit);
    }
    box(s * 0.11, s * 0.46, s * 0.60, s * 0.24, col);
    box(s * 0.11, s * 0.62, s * 0.60, s * 0.09, dark);
    box(s * 0.62, s * 0.30, s * 0.28, s * 0.24, '#3a3a3a');          // face
    box(s * 0.76, s * 0.36, d, d, '#ffffff');
    box(s * 0.20, s * 0.72 + legA, d * 1.4, s * 0.24, '#3a3a3a');
    box(s * 0.52, s * 0.72 + legB, d * 1.4, s * 0.24, '#3a3a3a');
  } else {                                               // crop     (no request)
    const sway = Math.sin(t * 0.002 + seed) * s * 0.06;
    box(s * 0.44, s * 0.34, d * 1.4, s * 0.62, '#3f6a28');
    box(s * 0.44 + sway, s * 0.30, d * 1.4, s * 0.12, '#4d7a33');
    box(s * 0.18 + sway, s * 0.38, s * 0.26, d * 1.4, '#4d7a33');    // leaves
    box(s * 0.56 + sway, s * 0.46, s * 0.26, d * 1.4, '#4d7a33');
    box(s * 0.26 + sway, s * 0.06, s * 0.48, s * 0.28, line);
    box(s * 0.29 + sway, s * 0.09, s * 0.42, s * 0.22, col);
    box(s * 0.29 + sway, s * 0.09, s * 0.42, s * 0.08, lit);
  }
}

export function drawOverlay(g, world, ctx) {
  const { pal, q, t, hours } = ctx;
  const dl = daylight(hours);
  const n = q.hi ? 34 : 18;
  for (let i = 0; i < n; i++) {
    const sx = (hash('fly' + i) % 462) + wobble(i * 31, t, 0.5, 12);
    const sy = 40 + (hash('flyy' + i) % 260) + wobble(i * 17, t, 0.8, 8);
    if (dl < 0.3) {
      const b = (Math.sin(t * 0.004 + i) + 1) / 2;
      if (b > 0.6) {
        if (q.glow) glow(g, sx, sy, 3.5, '#c9f26b', (b - 0.6) * 1.2);
        px(g, sx, sy, q.hi ? 0.5 : 1, q.hi ? 0.5 : 1, '#c9f26b');
      }
    } else if (i % 3 === 0) {
      px(g, sx, sy, q.hi ? 0.5 : 1, q.hi ? 0.5 : 1, rgba('#ffffff', q.hi ? 0.28 : 0.13));
    }
  }
}
