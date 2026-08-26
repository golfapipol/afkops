'use strict';
import { px, shade, rgba } from './engine.js';

// Compact sprite renderer for dense clusters.
//
// When a node holds 40+ pods its plot only affords each one a few pixels, and at
// that size the detailed art is invisible anyway -- so this is the correct
// picture, not merely a cheaper one. It also keeps the frame cost linear: a
// handful of fillRects per pod instead of twenty-odd.
//
// The same three facts survive the simplification:
//   size       -> CPU request tier
//   brightness -> actual usage
//   colour     -> phase / health
export function drawCompact(g, x, y, s, col, shape, opts) {
  const o = opts || {};
  const line = shade(col, -0.55);
  const lit = shade(col, 0.3);

  if (s < 3) { px(g, x, y, s, s, col); return; }

  if (shape === 'blob') {                    // farm: livestock
    px(g, x, y + s * 0.28, s, s * 0.62, line);
    px(g, x + s * 0.14, y + s * 0.38, s * 0.72, s * 0.42, col);
    px(g, x + s * 0.14, y + s * 0.38, s * 0.72, s * 0.16, lit);
    px(g, x + s * 0.64, y + s * 0.1, s * 0.34, s * 0.32, col);   // head
  } else if (shape === 'box') {              // factory: machines
    px(g, x, y + s * 0.22, s, s * 0.66, line);
    px(g, x + s * 0.14, y + s * 0.32, s * 0.72, s * 0.46, col);
    px(g, x + s * 0.14, y + s * 0.32, s * 0.72, s * 0.14, lit);
    if (o.lamp) px(g, x + s * 0.66, y + s * 0.4, s * 0.24, s * 0.2, o.lamp);
  } else {                                   // dungeon: figures
    px(g, x + s * 0.24, y, s * 0.5, s * 0.3, '#c9a07a');         // head
    px(g, x + s * 0.14, y + s * 0.3, s * 0.7, s * 0.48, line);
    px(g, x + s * 0.22, y + s * 0.34, s * 0.56, s * 0.4, col);
    px(g, x + s * 0.22, y + s * 0.34, s * 0.56, s * 0.14, lit);
    px(g, x + s * 0.26, y + s * 0.76, s * 0.16, s * 0.24, '#3a3a4a');
    px(g, x + s * 0.58, y + s * 0.76, s * 0.16, s * 0.24, '#3a3a4a');
  }

  // Status markers are NOT drawn here: the skin draws them for every size, so
  // there is one code path for them and no chance of the compact and detailed
  // forms disagreeing.
}

// ---- status markers -------------------------------------------------------
// Restarts and over-request used to be two small red marks above the sprite,
// which at four pixels is the same mark twice. They are different kinds of fact
// and now differ on three independent channels at once -- position, colour and
// motion -- so they stay apart even at the smallest size.
//
//   over request : ABOVE the head, hot orange, animated       -> happening now
//   restarts     : UNDER the feet, pale bone, static          -> already happened

export const HOT_COL = '#ff7a1f';
export const SCAR_COL = '#f2e4c4';

// A caret of rising heat. The bob is what the eye catches first in a crowd.
export function drawHotMark(g, x, y, s, t, seed) {
  const lift = Math.sin(t * 0.008 + (seed % 100) / 16) * (s * 0.12);
  const cx = x + s / 2;
  const top = y - s * 0.42 + lift;
  const w = Math.max(1, s * 0.16);
  g.fillStyle = HOT_COL;
  // Chevron: wide at the base, narrow at the tip.
  g.fillRect(cx - w, top + w, w, w);
  g.fillRect(cx, top + w, w, w);
  g.fillRect(cx - w / 2, top, w, w);
  if (s >= 7) {
    g.fillStyle = '#ffd08a';
    g.fillRect(cx - w / 2, top, w, w * 0.6);
  }
}

// Tally scars under the feet. Length grows with the count rather than trying to
// draw 751 pips; static, so it never competes with the heat caret for attention.
export function drawRestartMark(g, x, y, s, restarts) {
  if (!restarts) return;
  const frac = restarts >= 10 ? 1 : restarts >= 4 ? 0.72 : restarts / 4 + 0.18;
  const w = Math.max(1, s * frac);
  const h = Math.max(1, s * 0.14);
  g.fillStyle = SCAR_COL;
  g.fillRect(x + (s - w) / 2, y + s + h * 0.3, w, h);
  // Past ten, a second stroke: "this has been going on".
  if (restarts >= 10) g.fillRect(x + (s - w) / 2, y + s + h * 1.9, w, h);
}

// How big a pod can be drawn on this container, given how many share it.
// Returns the size in design units plus the grid that fits it.
export function fitSprites(availW, availH, count, maxSize, ranks) {
  const n = Math.max(1, count);
  let best = { size: 2.5, cols: n, rows: 1 };
  // Try each plausible row count and keep the arrangement that affords the
  // largest sprite; this is what lets one plot hold 5 pods or 90.
  const maxRows = ranks || Math.max(1, Math.floor(availH / 3));
  for (let rows = 1; rows <= maxRows; rows++) {
    const cols = Math.ceil(n / rows);
    const cw = availW / cols;
    const ch = availH / rows;
    const size = Math.min(cw, ch);
    if (size > best.size) best = { size, cols, rows };
  }
  // Deliberately under-fill the cell: the leftover is the room each pod has
  // to wander in. Packing to 100% produces a static grid, not a farm.
  best.size = Math.max(2.5, Math.min(maxSize, best.size * 0.8));
  return best;
}
