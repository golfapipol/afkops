'use strict';
import { px, rect, meter, text, textRight, textW, fitText, dither, vgrad, shade, rgba, glow,
         shadowEllipse, hash, wobble } from '../engine.js';
import { fitSprites } from '../sprite.js';
import { PX_PER_CORE, MIN_NODE_W } from '../camera.js';

// Side-on: the classic idle-game arrangement. Each node is a floor seen from
// the side, and pods are characters standing and working along it.
//
// The three resource layers survive the change of viewpoint intact:
//   floor WIDTH      = capacity (allocatable)
//   decked portion   = requests  (the claimed part of the floor)
//   lit portion      = usage     (what is actually running)
// so a wide floor that is decked end to end but unlit still reads as
// overcommitted, exactly as it does from above.
export const id = 'sideon';
export const name = '2D SIDE';

export const SCENE = { x: 0, y: 26, w: 462, h: 300 };

const FLOOR_T = 4;          // floor slab thickness, design units
const BAND_GAP = 5;

// True scale: a floor's WIDTH is its allocatable CPU at a fixed units-per-core.
// Stacked as a tower, so the floors are directly comparable down the building
// and the decked portion of each is the cores it reserved.
const BAND_H = 46;

export function computeLayout(nodes, bounds) {
  const n = nodes.length;
  if (!n) return { items: [], world: { w: bounds.w, h: bounds.h } };

  const items = [];
  let widest = 0;
  for (let i = 0; i < n; i++) {
    const node = nodes[i];
    const w = Math.max(MIN_NODE_W, (node.cpu.allocatable || 0) * PX_PER_CORE);
    widest = Math.max(widest, w);
    items.push({ node, rect: { x: 4, y: 4 + i * BAND_H, w, h: BAND_H - BAND_GAP } });
  }
  // Headers and meters sit on a common right edge so they can be read as a
  // column, independent of how wide each floor is.
  const fullW = Math.max(bounds.w - 8, widest);
  for (const it of items) it.rect.fullW = fullW;

  return { items, world: { w: fullW + 8, h: 8 + n * BAND_H } };
}

function floorTop(r) { return r.y + r.h - FLOOR_T; }

// Ranks give a flat side view its depth: the back rank sits higher and reads as
// further away. How many ranks there are depends on how crowded the floor is --
// a busy node stacks more of them rather than hiding pods behind a badge.
export function spriteMetrics(rect, node, q) {
  const availW = Math.max(8, rect.w - 4);
  const availH = Math.max(6, rect.h - FLOOR_T - 12);
  const count = Math.max(1, (node && node.pods.count) || 1);
  const maxRanks = Math.max(1, Math.min(5, Math.floor(availH / 4)));
  const m = fitSprites(availW, availH, count, q.unitSize, maxRanks);
  return { size: m.size, cols: m.cols, rows: m.rows, detailed: m.size >= 7 };
}

export function slotPos(rect, slot, node, pod, q, m) {
  const met = m || spriteMetrics(rect, node, q);
  const s = met.size;
  const alloc = (node && node.cpu.allocatable) || 1;
  const reqFrac = Math.min(1, ((node && node.cpu.requests) || 0) / alloc);
  const claimedW = Math.min(rect.w, Math.max(rect.w * reqFrac, s * 2));

  let bx = rect.x, bw = claimedW;
  if (pod && pod.besteffort) {
    // Pods the scheduler reserved nothing for stand past the gate.
    const wildW = rect.w - claimedW;
    if (wildW >= s * 2) { bx = rect.x + claimedW; bw = wildW; }
  }
  if (bx + bw > rect.x + rect.w) bw = rect.x + rect.w - bx;

  const cols = Math.max(1, met.cols), ranks = Math.max(1, met.rows);
  const c = slot % cols, rk = Math.floor(slot / cols) % ranks;
  const spanW = Math.max(0, bw - s);
  const homeY = floorTop(rect) - s - rk * (s * 0.62);
  return {
    x: bx + (cols === 1 ? spanW / 2 : (c / (cols - 1)) * spanW),
    y: homeY,
    size: s,
    roamX: (bw / cols) * 0.9,
    roamY: 0,                 // they walk along the floor, not up the wall
    minX: bx, maxX: bx + Math.max(0, bw - s),
    minY: homeY, maxY: homeY,
    grounded: true,
    rank: rk,
  };
}

// Shared platform renderer. Skins supply palette and a signature prop, so one
// implementation serves all three rather than being written out three times.
export function drawContainer(g, node, r, ctx) {
  const { pal, q, t, skin } = ctx;
  const alloc = node.cpu.allocatable || 1;
  const reqFrac = Math.min(1.4, node.cpu.requests / alloc);
  const useFrac = node.cpu.usage != null ? Math.min(1.4, node.cpu.usage / alloc) : null;
  const down = !node.ready;
  const style = (skin.side && skin.side.texture) || 'grass';

  const fy = floorTop(r);
  const deckH = r.h - FLOOR_T - 10;
  const deckY = r.y + 10;
  const claimW = Math.max(2, r.w * Math.min(1, reqFrac));

  // ---- interior backdrop across the whole floor ---------------------------
  // Without this the background shows through the unclaimed stretch, so vacant
  // floor space reads as a hole in the building rather than as empty capacity.
  const vacant = down ? shade(pal.ground2, -0.5) : shade(pal.ground2, -0.18);
  if (q.hi) vgrad(g, r.x, deckY, r.w, deckH, shade(vacant, 0.06), shade(vacant, -0.16), q);
  else px(g, r.x, deckY, r.w, deckH, vacant);
  // A faint grid so the empty stretch still reads as floor, not as flat colour.
  for (let gx = r.x + 8; gx < r.x + r.w; gx += 16) px(g, gx, deckY, q.hi ? 0.5 : 1, deckH, rgba('#000000', 0.16));

  // ---- the claimed deck: a back wall standing over the fenced portion ------
  const wallBase = down ? shade(pal.soil, -0.55) : pal.soil;
  if (q.hi) {
    vgrad(g, r.x, deckY, claimW, deckH, shade(wallBase, 0.12), shade(wallBase, -0.25), q);
  } else {
    px(g, r.x, deckY, claimW, deckH, wallBase);
    dither(g, r.x, deckY, claimW, deckH, shade(wallBase, -0.2), 3, q.u);
  }

  // ---- usage: the lit, actually-running portion of the deck ---------------
  if (useFrac != null) {
    const useW = r.w * Math.min(1, useFrac);
    const litW = Math.min(useW, claimW);
    if (litW > 0) {
      const lit = down ? shade(pal.lit, -0.6) : pal.lit;
      if (!q.hi) {
        for (let wy = deckY + 2; wy < deckY + deckH - 2; wy += 5) dither(g, r.x, wy, litW, 2, lit, 2, q.u);
      } else if (style === 'grass') {
        // Terraced crop rows climbing the deck: growth, not office windows.
        vgrad(g, r.x, deckY, litW, deckH, rgba('#6d8c3a', 0.42), rgba('#3f6a28', 0.30), q);
        for (let ry = deckY + 3; ry < deckY + deckH - 2; ry += 5) {
          px(g, r.x + 1, ry, litW - 2, 2, down ? '#33301f' : '#5c7a2e');
          px(g, r.x + 1, ry, litW - 2, 0.5, down ? '#3a3626' : '#9ac257');
        }
      } else if (style === 'stone') {
        // Torch-lit chambers: pooled light rather than regular glazing.
        vgrad(g, r.x, deckY, litW, deckH, rgba(lit, 0.22), rgba(lit, 0.04), q);
        for (let tx = r.x + 8; tx < r.x + litW - 4; tx += 22) {
          const fl = 1 + Math.abs(Math.sin(t * 0.006 + tx));
          px(g, tx, deckY + deckH * 0.4 - fl, 2, 3 + fl, lit);
          if (q.glow) glow(g, tx + 1, deckY + deckH * 0.4, 14, lit, 0.20);
        }
      } else {
        // Factory: lit windows along the working stretch.
        vgrad(g, r.x, deckY, litW, deckH, rgba(lit, 0.30), rgba(lit, 0.06), q);
        for (let wy = deckY + 3; wy < deckY + deckH - 3; wy += 6) {
          for (let wx = r.x + 2; wx < r.x + litW - 3; wx += 7) {
            if (((hash(`${node.name}${wx}${wy}`) % 100) / 100) <= 0.32) continue;
            px(g, wx, wy, 3, 3, down ? shade(lit, -0.5) : lit);
            if (q.glow) glow(g, wx + 1.5, wy + 1.5, 5, lit, 0.10);
          }
        }
      }
    }
    // Usage past the claim: real load nobody reserved for.
    if (useFrac > reqFrac + 0.02) {
      const oX = r.x + claimW;
      const oW = Math.max(1, useW - claimW);
      dither(g, oX, deckY + 2, oW, deckH - 4, pal.bad, 2, q.u);
    }
  }

  // ---- the claim boundary: a wall the workers cannot build past ------------
  const post = down ? shade(pal.fence, -0.5) : pal.fence;
  px(g, r.x + claimW - 1, deckY - 2, 1.5, deckH + 4, post);
  px(g, r.x + claimW - 2.5, deckY - 3, 4.5, 2, post);
  if (q.hi) px(g, r.x + claimW + 0.5, deckY - 2, 0.5, deckH + 4, shade(post, -0.4));
  // Gate marker at standing height, so the boundary is unmistakable.
  px(g, r.x + claimW - 2, fy - 7, 5, 2.5, pal.accent);

  // ---- the floor slab: its width is the node's capacity --------------------
  const floorCol = down ? shade(pal.ground, -0.5) : pal.ground;
  px(g, r.x, fy, r.w, FLOOR_T, floorCol);
  px(g, r.x, fy, r.w, q.hi ? 1 : 1, shade(floorCol, 0.3));           // top highlight
  px(g, r.x, fy + FLOOR_T - 1, r.w, 1, shade(floorCol, -0.4));       // underside

  if (style === 'grass') {
    const grass = down ? shade(pal.ground2, -0.4) : '#6d8c3a';
    for (let gx = r.x; gx < r.x + r.w; gx += 3) {
      const hgt = 1 + (hash(node.name + gx) % 2);
      px(g, gx, fy - hgt, 1, hgt, grass);
    }
  } else if (style === 'plate') {
    for (let gx = r.x + 4; gx < r.x + r.w - 2; gx += 8) px(g, gx, fy + 1, 1, FLOOR_T - 2, shade(floorCol, -0.35));
  } else {
    for (let gx = r.x + 6; gx < r.x + r.w - 2; gx += 12) px(g, gx, fy, 1, FLOOR_T, shade(floorCol, -0.35));
  }

  // The outer wall marks where this node's capacity ends.
  px(g, r.x + r.w - (q.hi ? 0.5 : 1), deckY, q.hi ? 0.5 : 1, deckH + FLOOR_T, shade(pal.ground, -0.45));

  // Support pillars under the floor make the stack read as a building.
  if (q.hi) {
    for (let sx = r.x + 6; sx < r.x + r.w - 6; sx += 26) {
      px(g, sx, fy + FLOOR_T, 2, BAND_GAP, rgba('#000000', 0.35));
    }
  }

  // ---- header: name, meters, crowding pips --------------------------------
  const hdrH = 9;
  px(g, r.x, r.y, r.fullW, hdrH, rgba(pal.panel, q.hi ? 0.82 : 1));
  // Meters and pips own the right of the header; the name gets what is left.
  const nameW = r.fullW - 24 - 34 - 8;
  text(g, fitText(g, shortName(node), nameW, 6), r.x + 2, r.y + 1.5, down ? pal.bad : pal.ink, 6);

  const mw = 22, mx = r.x + r.fullW - mw - 2;
  meter(g, mx, r.y + 1.5, mw, 3, reqFrac, reqFrac > 0.9 ? pal.bad : pal.good, '#00000066',
        useFrac, pal.accent, q);
  meter(g, mx, r.y + 5.5, mw, 2, node.mem.requests / (node.mem.allocatable || 1),
        node.mem.requests / (node.mem.allocatable || 1) > 0.9 ? pal.bad : '#5aa9e6', '#00000066',
        node.mem.usage != null ? node.mem.usage / (node.mem.allocatable || 1) : null, '#9fd8ff', q);

  const podFrac = node.pods.count / (node.pods.max || 110);
  const lit = Math.round(podFrac * 10);
  for (let i = 0; i < 10; i++) {
    px(g, mx - 34 + i * 3, r.y + 3, 2, 3,
       i < lit ? (podFrac > 0.9 ? pal.bad : podFrac > 0.75 ? pal.warn : pal.dim) : '#00000044');
  }

  // ---- the skin's signature prop, standing at the far end of the floor -----
  if (skin.side && skin.side.prop) {
    try { skin.side.prop(g, r.x + r.w - 14, fy, ctx, node, down); } catch {}
  }

  // ---- states -------------------------------------------------------------
  if (node.unschedulable) {
    const s = (skin.vocab.closed || 'CLOSED');
    const w = textW(g, s, 6) + 4;
    px(g, r.x + r.w / 2 - w / 2, r.y + r.h / 2 - 5, w, 9, pal.bad);
    text(g, s, r.x + r.w / 2 - w / 2 + 2, r.y + r.h / 2 - 4, '#ffffff', 6);
  }
  if (down) {
    if (q.hi) { g.fillStyle = 'rgba(0,0,0,0.45)'; g.fillRect(r.x, r.y, r.fullW, r.h); }
    else dither(g, r.x, r.y, r.fullW, r.h, '#000000', 2, q.u);
    const s = 'OFFLINE';
    const w = textW(g, s, 6) + 4;
    px(g, r.x + 4, fy - 12, w, 9, pal.bad);
    text(g, s, r.x + 6, fy - 11, '#ffffff', 6);
  }
}

function shortName(node) {
  return String((node && node.display) || (node && node.name) || '').slice(0, 17);
}
