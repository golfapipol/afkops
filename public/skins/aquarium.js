'use strict';
import { px, rect, meter, text, textW, fitText, dither, vgrad, shade, rgba, glow, shadowEllipse,
         wobble, hash } from '../engine.js';
import { daylight } from '../daynight.js';
import { reqTier, TIER_SCALE, loadVisual } from '../podclass.js';
import { drawCompact, drawHotMark, drawRestartMark } from '../sprite.js';

export const id = 'aquarium';
export const name = 'AQUARIUM';

// A tank is a bounded volume with an obvious capacity, and fish swim rather than
// stand — which is what the roaming machinery was already doing. Overstocked
// water reads as an overcommitted node without needing a number.
export const vocab = {
  node: 'TANK', nodes: 'TANKS', pod: 'FISH', pods: 'FISH',
  cpu: 'WATER', mem: 'OXYGEN', capacity: 'VOLUME', usage: 'FLOW',
  restart: 'GASP', crash: 'SICK', done: 'RELEASED', gone: 'NETTED',
  closed: 'QUARANTINE',
};

// Tanks are lit fixtures in a room, so the cycle is the room's light falling
// while the tanks keep glowing — the look every aquarium has after dark.
export const palettes = {
  // Mapping the shared renderers expect:
  //   ground  = tank stand / slab      ground2 = empty water (vacant)
  //   soil    = stocked water (claim)  grit    = gravel and sand
  //   lit     = bubbles and flow
  dawn:  { sky1: '#1b2233', sky2: '#2d3b52', ground: '#2a3948', ground2: '#4d7f95',
           soil: '#1d6280', grit: '#8a7d64', fence: '#8fd4e8', ink: '#e8f4fa', dim: '#6f8899',
           accent: '#ffcf6b', good: '#5fd6a8', warn: '#ffc14d', bad: '#ff6b7a',
           panel: '#182233', panelEdge: '#3a5570', lit: '#a8e8ff', star: 0.2 },
  day:   { sky1: '#7d94ab', sky2: '#a8bfd0', ground: '#4a5c6b', ground2: '#8fc4d8',
           soil: '#2b8fb5', grit: '#c2b393', fence: '#eaf8ff', ink: '#0e1a22', dim: '#5c7180',
           accent: '#e08a1e', good: '#2f9e8f', warn: '#d97d1e', bad: '#c93b4b',
           panel: '#e6eef4', panelEdge: '#8fa6b5', lit: '#ffffff', star: 0 },
  dusk:  { sky1: '#141c2b', sky2: '#3d3350', ground: '#26323d', ground2: '#4a7386',
           soil: '#1f6f8f', grit: '#7a6a52', fence: '#9fd8e8', ink: '#e4f0f7', dim: '#6b8092',
           accent: '#ff9a4d', good: '#4fc39a', warn: '#ffab4d', bad: '#ff5f7a',
           panel: '#151d2b', panelEdge: '#35506b', lit: '#bfefff', star: 0.4 },
  night: { sky1: '#05080f', sky2: '#0a1018', ground: '#141c24', ground2: '#1d4a5e',
           soil: '#12556e', grit: '#2c3a42', fence: '#6fb0c8', ink: '#bcd8e6', dim: '#456070',
           accent: '#7fd8ff', good: '#3d9e8c', warn: '#c98a3e', bad: '#e0556f',
           panel: '#070b12', panelEdge: '#1d2c3a', lit: '#8fe0ff', star: 1 },
};

export const side = {
  texture: 'gravel',
  // Fish occupy the whole water column. Standing them on the gravel in a row is
  // the difference between a tank and a shelf of ornaments.
  swims: true,
  prop(g, x, y, ctx, node, down) { drawFilter(g, x + 6, y, ctx, down); },
};

// The filter box: bubbling when the node is healthy, still when it is not.
function drawFilter(g, x, y, ctx, down) {
  const { pal, q, t } = ctx;
  px(g, x, y - 15, 5, 14, down ? shade(pal.soil, -0.4) : shade(pal.fence, -0.3));
  px(g, x, y - 15, 5, 2, down ? shade(pal.soil, -0.2) : pal.fence);
  if (down) return;
  for (let i = 0; i < 3; i++) {
    const by = y - 3 - ((t * 0.06 + i * 7) % 13);
    px(g, x + 1.5 + Math.sin(by * 0.5), by, 1.5, 1.5, rgba('#ffffff', 0.6));
  }
  if (q.glow) glow(g, x + 2.5, y - 8, 9, pal.lit, 0.18);
}

export function drawBackground(g, ctx) {
  const { pal, q, t, hours, W, H } = ctx;
  const dl = daylight(hours);

  // The room the tanks stand in. Kept dark so the tanks are the bright thing on
  // the wall, which is what you want someone to notice from across an office.
  if (q.hi) {
    const grd = g.createLinearGradient(0, 0, 0, H);
    grd.addColorStop(0, shade(pal.sky1, -0.25));
    grd.addColorStop(0.6, pal.sky1);
    grd.addColorStop(1, pal.sky2);
    g.fillStyle = grd; g.fillRect(0, 0, W, H);
  } else {
    vgrad(g, 0, 0, W, H, shade(pal.sky1, -0.2), pal.sky2, q);
  }

  // Caustics: the wobbling light a tank throws on the wall behind it. Only worth
  // drawing at the high tier; at 8-bit it would just be noise.
  if (q.hi) {
    for (let i = 0; i < 26; i++) {
      const y = 20 + (hash('c' + i) % (H - 40));
      const w = 40 + (hash('cw' + i) % 90);
      const x = ((hash('cx' + i) % W) + Math.sin(t * 0.0006 + i) * 16 + W) % W;
      g.fillStyle = rgba(pal.lit, 0.022 + (1 - dl) * 0.03);
      g.fillRect(x, y + Math.sin(t * 0.0012 + i * 2) * 3, w, 1.5);
    }
  }

  // Faint shelf lines, so the tanks read as standing on something.
  for (let y = 84; y < H; y += 74) {
    px(g, 0, y, W, 1, rgba('#000000', 0.22));
    px(g, 0, y + 1, W, 1, rgba(pal.lit, 0.05));
  }
}

// ---- a tank, from above -----------------------------------------------------
export function drawContainer(g, node, r, ctx) {
  const { pal, q, t } = ctx;
  const alloc = node.cpu.allocatable || 1;
  const reqFrac = Math.min(1.4, node.cpu.requests / alloc);
  const useFrac = node.cpu.usage != null ? Math.min(1.4, node.cpu.usage / alloc) : null;
  const down = !node.ready;

  // The whole tank footprint is the capacity: clear, empty water.
  const clear = down ? '#3a3830' : pal.ground2;
  if (q.hi) vgrad(g, r.x, r.y, r.w, r.h, shade(clear, 0.14), shade(clear, -0.16), q);
  else px(g, r.x, r.y, r.w, r.h, clear);

  const inner = { x: r.x + 4, y: r.y + 13, w: r.w - 8, h: r.h - 20 };
  const stockedW = Math.max(3, inner.w * Math.min(1, reqFrac));

  // Stocked water: gravel, planting, darker water. This is what is reserved.
  const bed = down ? shade(pal.grit, -0.5) : pal.grit;
  if (q.hi) vgrad(g, inner.x, inner.y, stockedW, inner.h, shade(pal.soil, 0.10), shade(pal.soil, -0.20), q);
  else px(g, inner.x, inner.y, stockedW, inner.h, pal.soil);
  // Gravel along the bottom of the stocked area.
  for (let gx = inner.x; gx < inner.x + stockedW; gx += 2) {
    const h2 = 1 + (hash(node.name + 'g' + gx) % 2);
    px(g, gx, inner.y + inner.h - h2, 2, h2, bed);
  }

  // Flow: what is actually being used, as bubble columns and brighter water.
  if (useFrac != null) {
    const useW = inner.w * Math.min(1, useFrac);
    const flowW = Math.min(useW, stockedW);
    if (flowW > 0) {
      if (q.hi) {
        g.fillStyle = rgba(pal.lit, down ? 0.03 : 0.12);
        g.fillRect(inner.x, inner.y, flowW, inner.h);
      } else {
        dither(g, inner.x, inner.y, flowW, inner.h, down ? '#2a3238' : pal.lit, 3, q.u);
      }
      for (let bx = inner.x + 4; bx < inner.x + flowW - 2; bx += 11) {
        const phase = (t * 0.045 + bx * 9) % (inner.h + 8);
        for (let k = 0; k < 3; k++) {
          const by = inner.y + inner.h - ((phase + k * 10) % (inner.h + 8));
          if (by < inner.y || by > inner.y + inner.h) continue;
          px(g, bx + Math.sin(by * 0.4) * 1.2, by, 1.5, 1.5,
             rgba('#ffffff', down ? 0.12 : 0.45));
        }
      }
    }
    // Flow past the stocked line: load nobody reserved water for.
    if (useFrac > reqFrac + 0.02) {
      const oX = inner.x + stockedW;
      dither(g, oX, inner.y + 1, Math.max(1, useW - stockedW), inner.h - 2, pal.bad, 2, q.u);
    }
  }

  // Planting marks the stocked boundary, and the boundary itself is a glass
  // divider — the line the fish are supposed to stay inside.
  for (let px2 = inner.x + 5; px2 < inner.x + stockedW - 2; px2 += 17) {
    const sway = Math.sin(t * 0.0016 + px2) * 1.4;
    for (let k = 0; k < 4; k++) {
      px(g, px2 + sway * (k / 4), inner.y + inner.h - 3 - k * 3.2, 1.5, 3.4,
         down ? shade(pal.good, -0.6) : shade(pal.good, -0.1 - k * 0.06));
    }
  }
  px(g, inner.x + stockedW - 1, inner.y, 1, inner.h, rgba(pal.fence, 0.9));
  px(g, inner.x + stockedW - 2, inner.y + inner.h / 2 - 1.5, 4, 3, pal.accent);

  // Glass: rim, header, and a highlight so it reads as a tank and not a rectangle.
  px(g, r.x, r.y, r.w, 11, q.hi ? rgba(pal.panel, 0.86) : pal.panel);
  rect(g, r.x, r.y, r.w, r.h, down ? pal.bad : pal.fence);
  if (q.hi) {
    px(g, r.x + 1, r.y + 12, 1, r.h - 14, rgba('#ffffff', 0.18));
    px(g, r.x + 1, r.y + 12, r.w - 2, 1, rgba('#ffffff', 0.10));
  }
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
    const s = 'QUARANTINE', w = textW(g, s, 6) + 4;
    px(g, r.x + (r.w - w) / 2, r.y + r.h / 2 - 4, w, 9, pal.bad);
    text(g, s, r.x + (r.w - w) / 2 + 2, r.y + r.h / 2 - 3, '#ffffff', 6);
  }
  if (down) {
    // A failed tank goes cloudy and still: no bubbles, murky water, scum.
    if (q.hi) { g.fillStyle = 'rgba(90,80,60,0.42)'; g.fillRect(r.x + 1, r.y + 12, r.w - 2, r.h - 13); }
    else dither(g, r.x + 1, r.y + 12, r.w - 2, r.h - 13, '#6a6250', 2, q.u);
    for (let i = 0; i < 10; i++) {
      const sx = r.x + 4 + (hash('sc' + node.name + i) % Math.floor(r.w - 8));
      px(g, sx, r.y + 13 + (hash('scy' + node.name + i) % 4), 3, 1, rgba('#8a8060', 0.6));
    }
  }
  if (node.pressures.length) text(g, '!', r.x + r.w - 6, r.y + 12, pal.warn, 8);
}

function shortName(node) {
  return String((node && node.display) || (node && node.name) || node || '').slice(0, 24);
}

// ---- fish -------------------------------------------------------------------
export function drawUnit(g, u, ctx) {
  const { pal, q, t } = ctx;
  const p = u.pod;
  if (!p) return;

  const species = reqTier(p);
  const lv = loadVisual(p);
  const fx = u.fxUntil > t ? u.fx : null;
  const dim = p.dim;
  const s = (u.size || q.unitSize) * TIER_SCALE[species];

  const BASE = ['#7fc46a', '#ffb84d', '#ff8a4d', '#9fb4c4'];   // algae, guppy, koi, shark
  let col = dim ? pal.dim : BASE[species];
  if (!dim && lv.known) col = shade(col, -0.34 + lv.bright * 0.34);

  // Fish face where they are heading. Worth the two lines: a shoal all drifting
  // one way then turning together is most of what makes a tank look alive.
  const dx = u.tx - u.x;
  if (Math.abs(dx) > 0.35) u.facing = dx < 0 ? -1 : 1;
  const flip = u.facing === -1;

  let bob = wobble(u.seed, t, 1.6 * lv.activity, q.hi ? 0.7 : 1.1);
  if (p.phase === 'Pending') { col = pal.dim; bob = wobble(u.seed, t, 1, 2.2); }
  else if (p.phase === 'CrashLoop') { col = pal.bad; bob = wobble(u.seed, t, 8, 2.4); }
  else if (p.phase === 'Terminating') col = '#6a7480';
  else if (p.phase === 'Succeeded') col = pal.accent;

  const x = u.x, y = u.y + bob;

  if (fx === 'poof' || fx === 'harvest') {
    const k = 1 - (u.fxUntil - t) / 650;
    const c = fx === 'harvest' ? pal.accent : '#cfe6f0';
    // Netted or released: a puff of bubbles going up.
    for (let i = 0; i < (q.hi ? 8 : 5); i++) {
      px(g, x + s * 0.4 + Math.cos(i * 1.4) * k * 5, y + s * 0.4 - k * 9 - i,
         q.hi ? 1.5 : 1, q.hi ? 1.5 : 1, q.hi ? rgba(c, 1 - k) : c);
    }
    if (k > 0.7) return;
  }
  if (fx === 'spawn') {
    const k = 1 - (u.fxUntil - t) / 700;
    if (k < 0.35) { px(g, x + s * 0.3, y + s * 0.35, s * 0.4 * k, 1.5, col); return; }
  }
  if (fx === 'hit' && Math.floor(t / 60) % 2 === 0) col = '#ffffff';

  if (q.glow && s >= 5 && p.phase === 'CrashLoop') glow(g, x + s / 2, y + s / 2, s * 1.6, pal.bad, 0.34);

  if (s < 7) {
    drawCompact(g, x, y, s, col, 'fish', { flip });
  } else if (q.hi) {
    drawFish64(g, x, y, s, col, species, p, t, u.seed, pal, flip);
  } else {
    drawFish8(g, x, y, s, col, species, flip);
  }

  // History: pale scars under the fish, static.
  drawRestartMark(g, x, y, s, p.restarts);
  if (p.kind === 'job') px(g, x - 1.5, y + s * 0.5, 2, 2, pal.accent);
  // Live condition: a rising heat caret, animated so it reads apart from scars.
  if (lv.hot) {
    drawHotMark(g, x, y, s, t, u.seed);
    if (q.glow && s >= 5) glow(g, x + s * 0.5, y + s * 0.4, s * 1.3, '#ff7a1f', 0.26);
  }
}

function drawFish8(g, x, y, s, col, species, flip) {
  const d = flip ? -1 : 1;
  const bx = flip ? x + s : x;
  if (species === 0) {                       // algae: a frond, not a fish
    px(g, x + 2, y + 1, 1, 4, '#4d7a33');
    px(g, x + 1, y, 3, 2, col);
    return;
  }
  px(g, bx + d * 1, y + 1, d * 4, 3, col);   // body
  px(g, bx, y + 1, d * 1, 3, col);           // tail
  px(g, bx + d * 4, y + 1, d * 1, 1, '#101018');
}

// 64-bit: outline, three shades, fins and a tail that beats.
function drawFish64(g, x, y, s, col, species, p, t, seed, pal, flip) {
  const line = shade(col, -0.58), lit = shade(col, 0.28), dark = shade(col, -0.26);
  const d = flip ? -1 : 1;
  const bx = flip ? x + s : x;
  const box = (ox, oy, ow, oh, c) => px(g, bx + d * ox, y + oy, d * ow, oh, c);
  const beat = Math.sin(t * 0.012 + seed) * s * 0.07;

  if (species === 0) {                                    // algae / plant
    const sway = Math.sin(t * 0.0018 + seed) * s * 0.10;
    box(s * 0.42, s * 0.30, s * 0.14, s * 0.66, '#3f6a28');
    for (let k = 0; k < 3; k++) {
      box(s * (0.22 + k * 0.12) + sway * (k / 3), s * (0.24 - k * 0.06), s * 0.3, s * 0.12, col);
    }
    return;
  }

  // Forked tail, drawn first so the body overlaps its root. Splayed top and
  // bottom rather than one block: that fork is what says "fish" at this size.
  box(0, s * 0.18 + beat, s * 0.13, s * 0.26, line);
  box(0, s * 0.56 + beat, s * 0.13, s * 0.26, line);
  box(s * 0.09, s * 0.34 + beat, s * 0.14, s * 0.32, dark);

  const long = species === 2 ? 0.1 : 0;                   // koi are longer
  // Body tapers toward the tail, so the silhouette is a wedge not a box.
  box(s * 0.18, s * 0.34, s * 0.16, s * 0.30, line);
  box(s * 0.30, s * 0.26, s * (0.52 + long), s * 0.46, line);
  box(s * 0.21, s * 0.37, s * 0.14, s * 0.24, dark);
  box(s * 0.33, s * 0.30, s * (0.46 + long), s * 0.38, col);
  box(s * 0.33, s * 0.30, s * (0.46 + long), s * 0.12, lit);
  box(s * 0.33, s * 0.58, s * (0.46 + long), s * 0.10, dark);

  // Dorsal and pectoral fins.
  box(s * 0.44, s * 0.17, s * 0.24, s * 0.11, dark);
  box(s * 0.48, s * 0.63 - beat * 0.5, s * 0.16, s * 0.13, dark);

  if (species === 2) {                                    // koi markings
    box(s * 0.46, s * 0.34, s * 0.13, s * 0.13, shade(col, -0.45));
    box(s * 0.64, s * 0.45, s * 0.11, s * 0.11, shade(col, -0.45));
  }
  if (species === 3) {                                    // shark: a bigger dorsal
    box(s * 0.48, s * 0.08, s * 0.20, s * 0.18, dark);
  }

  const eye = s * 0.80 + long * s;
  box(eye, s * 0.38, Math.max(1, s * 0.11), Math.max(1, s * 0.11), '#0d1218');
  box(eye + s * 0.02, s * 0.40, Math.max(0.5, s * 0.04), Math.max(0.5, s * 0.04), '#ffffff');
}

export function drawOverlay(g, world, ctx) {
  const { pal, q, t, hours, W, H } = ctx;
  // Stray bubbles drifting up the room, and a soft vignette so the tanks are the
  // brightest thing on screen.
  const n = q.hi ? 26 : 12;
  for (let i = 0; i < n; i++) {
    const bx = hash('rb' + i) % W;
    const span = H + 30;
    const by = H - ((t * 0.02 + hash('rby' + i) % span) % span);
    const r = q.hi ? 0.8 + (i % 3) * 0.5 : 1;
    px(g, bx + Math.sin(by * 0.05 + i) * 3, by, r * 2, r * 2, rgba('#ffffff', q.hi ? 0.10 : 0.07));
  }
  if (q.hi) {
    const grd = g.createRadialGradient(W * 0.42, H * 0.5, H * 0.30, W * 0.42, H * 0.5, H * 0.95);
    grd.addColorStop(0, 'rgba(0,0,0,0)');
    grd.addColorStop(1, 'rgba(0,0,0,0.45)');
    g.fillStyle = grd; g.fillRect(0, 0, W, H);
  }
}
