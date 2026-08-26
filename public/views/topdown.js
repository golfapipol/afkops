'use strict';
import { W, H } from '../engine.js';
import { fitSprites } from '../sprite.js';
import { PX_PER_CORE, MIN_NODE_W } from '../camera.js';

// Top-down: nodes are plots of land laid out on a grid, seen from above.
// Capacity is the plot's area, requests are the fenced-off portion, usage is
// what is actually growing inside the fence.
export const id = 'topdown';
export const name = '2D TOP';

export const SCENE = { x: 0, y: 26, w: 462, h: 300 };

// True scale: a plot's WIDTH is its allocatable CPU at a fixed units-per-core,
// identical on every node. The fence inside is a fraction of that width, so the
// fence's width IS the reserved cores -- directly comparable between a 1-core
// node and an 8-core one, which a fit-to-cell grid makes impossible (it renders
// an 8x capacity difference as about 1.3x).
//
// Returns { items, world }: the result may be larger than the viewport, and the
// camera handles the rest.
const ROW_H = 74;
const GAP = 6;

export function computeLayout(nodes, bounds) {
  const n = nodes.length;
  if (!n) return { items: [], world: { w: bounds.w, h: bounds.h } };

  // Row width is chosen from the content, not fixed to the viewport. A single
  // 16-core node is ~500 units wide -- wider than the viewport -- so a fixed row
  // gives every large node a row of its own and the world becomes a tall ribbon
  // that fits badly at any zoom. Aim instead for a world with roughly the
  // viewport's proportions, and never narrower than the widest node.
  let widest = 0, totalW = 0;
  for (const node of nodes) {
    const w = Math.max(MIN_NODE_W, (node.cpu.allocatable || 0) * PX_PER_CORE);
    widest = Math.max(widest, w);
    totalW += w + GAP;
  }
  const aspect = bounds.w / Math.max(1, bounds.h);
  const rowWidth = Math.max(
    bounds.w,
    widest + GAP * 2,
    Math.sqrt(totalW * (ROW_H + GAP) * aspect),
  );

  const items = [];
  let x = GAP, y = GAP, rowMax = 0, worldW = 0;

  for (const node of nodes) {
    const w = Math.max(MIN_NODE_W, (node.cpu.allocatable || 0) * PX_PER_CORE);
    // Shelf packing, in the cluster's own node order, so a node keeps its place
    // for as long as the node set does not change.
    if (x > GAP && x + w > rowWidth - GAP) { x = GAP; y += rowMax + GAP; rowMax = 0; }
    items.push({ node, rect: { x, y, w, h: ROW_H } });
    x += w + GAP;
    rowMax = Math.max(rowMax, ROW_H);
    worldW = Math.max(worldW, x);
  }

  return { items, world: { w: Math.max(rowWidth, worldW), h: y + rowMax + GAP } };
}

// Where a pod stands is itself information: pods holding a request stand on the
// claimed (fenced) ground, while BestEffort pods -- which the scheduler
// reserved nothing for -- stand outside it.
// Sprite size and grid are derived from how many pods actually share the plot,
// so every pod gets a place. A fixed cap plus a "+47" badge hides most of a busy
// node, which is exactly the information you opened the board to see.
export function spriteMetrics(rect, node, q, _opts) {
  const s0 = q.unitSize;
  const availW = Math.max(8, rect.w - 8);
  const availH = Math.max(8, rect.h - 20);
  const count = Math.max(1, (node && node.pods.count) || 1);
  const m = fitSprites(availW, availH, count, s0, Math.max(1, Math.floor(availH / 3.2)));
  return { size: m.size, cols: m.cols, rows: m.rows, detailed: m.size >= 7 };
}

// Where a pod stands is itself information: pods holding a request stand on the
// claimed (fenced) ground, while BestEffort pods -- which the scheduler reserved
// nothing for -- stand outside it.
//
// The returned point is the pod's HOME cell. Roaming happens around it, so the
// crowd stays evenly spread instead of clumping while still looking alive.
export function slotPos(rect, slot, node, pod, q, m, _opts) {
  const met = m || spriteMetrics(rect, node, q);
  const s = met.size;
  const ix = rect.x + 4, iy = rect.y + 13;
  const iw = Math.max(s + 2, rect.w - 8);
  const ih = Math.max(s + 2, rect.h - 18);

  const alloc = (node && node.cpu.allocatable) || 1;
  const reqFrac = Math.min(1, ((node && node.cpu.requests) || 0) / alloc);
  const claimedW = Math.min(iw, Math.max(iw * reqFrac, s * 2));

  let bx = ix, bw = claimedW;
  if (pod && pod.besteffort) {
    const wildW = iw - claimedW;
    if (wildW >= s * 2) { bx = ix + claimedW; bw = wildW; }
  }
  if (bx + bw > ix + iw) bw = ix + iw - bx;

  const cols = Math.max(1, met.cols), rows = Math.max(1, met.rows);
  const c = slot % cols, r = Math.floor(slot / cols) % rows;
  // Spans are measured for sprite ORIGINS, so the whole sprite lands inside.
  const spanW = Math.max(0, bw - s), spanH = Math.max(0, ih - s);
  const cellW = bw / cols, cellH = ih / rows;
  return {
    x: bx + (cols === 1 ? spanW / 2 : (c / (cols - 1)) * spanW),
    y: iy + (rows === 1 ? spanH / 2 : (r / (rows - 1)) * spanH),
    size: s,
    // Wander a little beyond the home cell so the crowd mingles instead of
    // sitting on a grid; the band bounds keep them inside the plot.
    roamX: cellW * 0.8,
    roamY: cellH * 0.8,
    minX: bx, maxX: bx + Math.max(0, bw - s),
    minY: iy, maxY: iy + Math.max(0, ih - s),
    grounded: false,
  };
}
