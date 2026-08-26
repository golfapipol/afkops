'use strict';
import { DESIGN_W, DESIGN_H, scaleFor } from './quality.js';

// The design grid every module draws in. The backbuffer may be much larger;
// a scale transform bridges the two, so one set of drawing code serves both
// fidelity tiers.
export const W = DESIGN_W, H = DESIGN_H;

export function createEngine(canvas) {
  const ctx = canvas.getContext('2d', { alpha: false });
  const back = document.createElement('canvas');
  const g = back.getContext('2d', { alpha: false });

  let scale = 1, present = null;
  // Where the backbuffer lands on the canvas, so clicks can be mapped back
  // into design coordinates for hit-testing.
  let dest = { ox: 0, oy: 0, dw: 1, dh: 1 };

  function configure(tier) {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const cw = Math.max(1, Math.floor(window.innerWidth * dpr));
    const chh = Math.max(1, Math.floor(window.innerHeight * dpr));
    canvas.width = cw; canvas.height = chh;
    canvas.style.width = window.innerWidth + 'px';
    canvas.style.height = window.innerHeight + 'px';

    scale = scaleFor(tier, cw, chh);
    back.width = DESIGN_W * scale;
    back.height = DESIGN_H * scale;

    // Everything after this draws in design units.
    g.setTransform(scale, 0, 0, scale, 0, 0);
    g.imageSmoothingEnabled = false;

    if (tier.hi) {
      // Fill the display; the backbuffer is close to native size, so any
      // residual resampling is sub-pixel and smoothing helps rather than blurs.
      const s = Math.min(cw / back.width, chh / back.height);
      const dw = Math.round(back.width * s), dh = Math.round(back.height * s);
      const ox = Math.floor((cw - dw) / 2), oy = Math.floor((chh - dh) / 2);
      dest = { ox, oy, dw, dh };
      present = () => {
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';
        if (ox > 0 || oy > 0) { ctx.fillStyle = '#000'; ctx.fillRect(0, 0, cw, chh); }
        ctx.drawImage(back, 0, 0, back.width, back.height, ox, oy, dw, dh);
      };
    } else {
      // Integer scale only: a fractional factor would unevenly duplicate pixel
      // rows and destroy the retro look.
      const s = Math.max(1, Math.floor(Math.min(cw / back.width, chh / back.height)));
      const dw = back.width * s, dh = back.height * s;
      const ox = Math.floor((cw - dw) / 2), oy = Math.floor((chh - dh) / 2);
      dest = { ox, oy, dw, dh };
      present = () => {
        ctx.imageSmoothingEnabled = false;
        if (ox > 0 || oy > 0) { ctx.fillStyle = '#000'; ctx.fillRect(0, 0, cw, chh); }
        ctx.drawImage(back, 0, 0, back.width, back.height, ox, oy, dw, dh);
      };
    }
  }

  // Client (CSS) pixels -> design units, so on-screen controls can be hit-tested
  // in the same coordinate space they were drawn in.
  function toDesign(clientX, clientY) {
    const rect = canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return { x: -1, y: -1 };
    const devX = (clientX - rect.left) * (canvas.width / rect.width);
    const devY = (clientY - rect.top) * (canvas.height / rect.height);
    return {
      x: ((devX - dest.ox) / dest.dw) * DESIGN_W,
      y: ((devY - dest.oy) / dest.dh) * DESIGN_H,
    };
  }

  return {
    g,
    configure,
    toDesign,
    present: () => present && present(),
    get scale() { return scale; },
    // One device pixel expressed in design units: the finest detail this tier
    // can actually resolve. 1 at 8-bit, 0.5 or less at 64-bit.
    get u() { return 1 / scale; },
  };
}

// ---- pixel drawing helpers (all in design units) ---------------------------
export function px(g, x, y, w, h, color) {
  g.fillStyle = color;
  g.fillRect(x, y, w, h);
}

// Snap to the device grid so blocks never land on a half pixel and blur.
export function snap(v, u) { return Math.round(v / u) * u; }

export function rect(g, x, y, w, h, color, t = 1) {
  px(g, x, y, w, t, color); px(g, x, y + h - t, w, t, color);
  px(g, x, y, t, h, color);  px(g, x + w - t, y, t, h, color);
}

// Classic meter: dark trough, the allocated fill, and an optional brighter
// "live" fill drawn inside it -- the usage-inside-allocation reading.
export function meter(g, x, y, w, h, frac, colFill, colTrough, frac2, colFill2, q) {
  px(g, x, y, w, h, colTrough);
  const f = Math.max(0, Math.min(1.2, frac || 0));
  const fw = w * Math.min(1, f);
  if (fw > 0) {
    px(g, x, y, fw, h, colFill);
    if (q && q.hi) {
      // A highlight along the top edge gives the bar volume.
      px(g, x, y, fw, h * 0.28, shade(colFill, 0.22));
      px(g, x, y + h - h * 0.2, fw, h * 0.2, shade(colFill, -0.22));
    }
  }
  if (frac2 != null && colFill2) {
    const f2 = Math.max(0, Math.min(1.2, frac2));
    const fw2 = w * Math.min(1, f2);
    const inset = h > 2 ? 1 : 0;
    if (fw2 > 0) px(g, x, y + inset, fw2, Math.max(1, h - inset * 2), colFill2);
  }
  // Over 100% is a real condition and must stay visible, not be clamped away.
  if (f > 1) px(g, x + w - 2, y, 2, h, '#ff5555');
}

export function text(g, s, x, y, color, size = 8) {
  g.font = `${size}px PixelFont, monospace`;
  g.textBaseline = 'top';
  g.fillStyle = color;
  g.fillText(String(s), x, y);
}

export function textRight(g, s, x, y, color, size = 8) {
  g.font = `${size}px PixelFont, monospace`;
  g.textBaseline = 'top';
  g.fillStyle = color;
  g.fillText(String(s), x - g.measureText(String(s)).width, y);
}

// Trim to what actually fits, so a long label can never run under the meters.
export function fitText(g, s, maxW, size = 8) {
  let str = String(s);
  if (textW(g, str, size) <= maxW) return str;
  while (str.length > 1 && textW(g, str + '…', size) > maxW) str = str.slice(0, -1);
  return str + '…';
}

export function textW(g, s, size = 8) {
  g.font = `${size}px PixelFont, monospace`;
  return g.measureText(String(s)).width;
}

// Text with a 1px drop shadow -- cheap, and it keeps light text readable over
// a busy 64-bit background.
export function textShadow(g, s, x, y, color, size, q) {
  if (q && q.hi) text(g, s, x + q.u, y + q.u, '#00000088', size);
  text(g, s, x, y, color, size);
}

// ---- colour ----------------------------------------------------------------
function parseHex(c) {
  return [parseInt(c.slice(1, 3), 16), parseInt(c.slice(3, 5), 16), parseInt(c.slice(5, 7), 16)];
}
const hex2 = (v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0');

export function lerp(a, b, k) { return a + (b - a) * k; }

export function mixColor(c1, c2, k) {
  const [r1, g1, b1] = parseHex(c1), [r2, g2, b2] = parseHex(c2);
  return '#' + hex2(lerp(r1, r2, k)) + hex2(lerp(g1, g2, k)) + hex2(lerp(b1, b2, k));
}

// Lighten (k>0) or darken (k<0). The 64-bit tier leans on this heavily for
// shading, which is exactly what an 8-bit palette could not afford.
export function shade(c, k) {
  const [r, gg, b] = parseHex(c);
  return k >= 0
    ? '#' + hex2(lerp(r, 255, k)) + hex2(lerp(gg, 255, k)) + hex2(lerp(b, 255, k))
    : '#' + hex2(lerp(r, 0, -k)) + hex2(lerp(gg, 0, -k)) + hex2(lerp(b, 0, -k));
}

export function rgba(c, a) {
  const [r, gg, b] = parseHex(c);
  return `rgba(${r},${gg},${b},${a})`;
}

// ---- texture ---------------------------------------------------------------
// Dither: shading without extra colours, the genuine 8-bit trick.
//
// Drawn a pixel at a time this is the single most expensive thing on the board:
// a full-screen 8-bit dither is ~77,000 fillRects, which on its own costs more
// than every sprite combined. Large areas therefore use a cached repeating
// tile; small ones keep the direct loop, which avoids churning the cache for
// every sprite and meter.
const PATTERN_AREA = 1500;      // design units squared
const patternCache = new Map();
const patternOrder = [];

function ditherPattern(g, color, density, u) {
  const scale = Math.max(1, Math.round(1 / u));
  const key = `${color}|${density}|${scale}`;
  let pat = patternCache.get(key);
  if (pat !== undefined) return pat;

  try {
    const tile = document.createElement('canvas');
    tile.width = density * scale;
    tile.height = density * scale;
    const tg = tile.getContext('2d');
    tg.fillStyle = color;
    // One pixel per row, stepping across: the classic diagonal dither.
    for (let row = 0; row < density; row++) {
      tg.fillRect(row * scale, row * scale, scale, scale);
    }
    pat = g.createPattern(tile, 'repeat');
    // The context is scaled to design units, so undo it or the tile would be
    // drawn `scale` times too large.
    if (pat && pat.setTransform && typeof DOMMatrix === 'function') {
      pat.setTransform(new DOMMatrix([1 / scale, 0, 0, 1 / scale, 0, 0]));
    } else {
      pat = null;   // without setTransform the tile would be the wrong size
    }
  } catch { pat = null; }

  patternCache.set(key, pat);
  patternOrder.push(key);
  // Blended palettes produce a stream of distinct colours; keep this bounded.
  if (patternOrder.length > 96) patternCache.delete(patternOrder.shift());
  return pat;
}

export function dither(g, x, y, w, h, color, density = 2, u = 1) {
  if (w * h >= PATTERN_AREA) {
    const pat = ditherPattern(g, color, density, u);
    if (pat) {
      g.save();
      g.fillStyle = pat;
      // Align the tile to the fill origin so the texture does not crawl when
      // the rectangle moves.
      g.translate(x, y);
      g.fillRect(0, 0, w, h);
      g.restore();
      return;
    }
  }
  g.fillStyle = color;
  const step = density * u;
  for (let yy = 0; yy < h; yy += u) {
    const off = (Math.round(yy / u) % density) * u;
    for (let xx = off; xx < w; xx += step) g.fillRect(x + xx, y + yy, u, u);
  }
}

// A vertical gradient. At 8-bit this collapses to a few dithered bands; at
// 64-bit it is a real gradient.
export function vgrad(g, x, y, w, h, top, bottom, q) {
  if (q && q.hi) {
    const grd = g.createLinearGradient(x, y, x, y + h);
    grd.addColorStop(0, top); grd.addColorStop(1, bottom);
    g.fillStyle = grd;
    g.fillRect(x, y, w, h);
    return;
  }
  const bands = 6;
  for (let i = 0; i < bands; i++) {
    px(g, x, y + (i * h) / bands, w, h / bands + 1, mixColor(top, bottom, i / (bands - 1)));
    if (i > 0 && i < bands - 1) dither(g, x, y + (i * h) / bands, w, 3, mixColor(top, bottom, (i + 1) / (bands - 1)), 2, 1);
  }
}

// Soft radial light. 64-bit only; at 8-bit it would just be a grey blob.
export function glow(g, cx, cy, r, color, strength = 0.5) {
  const grd = g.createRadialGradient(cx, cy, 0, cx, cy, r);
  grd.addColorStop(0, rgba(color, strength));
  grd.addColorStop(0.5, rgba(color, strength * 0.35));
  grd.addColorStop(1, rgba(color, 0));
  g.fillStyle = grd;
  g.fillRect(cx - r, cy - r, r * 2, r * 2);
}

// Contact shadow under a sprite.
export function shadowEllipse(g, cx, cy, rx, ry, a = 0.3) {
  g.fillStyle = `rgba(0,0,0,${a})`;
  g.beginPath();
  g.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
  g.fill();
}

// ---- determinism -----------------------------------------------------------
export function hash(str) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
  return h >>> 0;
}
export function hashFloat(str) { return hash(str) / 4294967296; }

// Motion as a pure function of (seed, t): never drifts or accumulates over 24h.
export function wobble(seed, t, speed = 1, amp = 1) {
  return Math.sin(t * 0.001 * speed + (seed % 628) / 100) * amp;
}
