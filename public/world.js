'use strict';
import { hash } from './engine.js';

// Turns server state into a stable, renderable scene and owns all animation
// state. Layout is delegated to the active view module, so switching between
// top-down and side-on changes where things are without changing what they mean.

export const SCENE = { x: 0, y: 26, w: 462, h: 300 };
export const HUD = { x: 466, y: 26, w: 172, h: 300 };

// Every pod gets a sprite. The old per-node cap turned most of a busy node into
// a "+47" badge, which hides the very thing the board exists to show. Sprite
// SIZE absorbs the density instead (see each view's spriteMetrics).
//
// These remain only as a runaway guard: far above any real cluster this board is
// meant for, and if either is ever hit the overflow is still counted on screen
// rather than silently dropped.
const MAX_UNITS_PER_NODE = 400;
const MAX_UNITS_TOTAL = 3000;

function clamp(v, lo, hi) {
  if (lo == null || hi == null || hi < lo) return v;
  return v < lo ? lo : v > hi ? hi : v;
}

export function createWorldModel() {
  const units = new Map();     // uid  -> animation state
  const plots = new Map();     // node -> animation state
  let state = null;
  let layout = [];
  let layoutKey = '';
  let worldSize = { w: SCENE.w, h: SCENE.h };

  // Stable slot assignment: a pod keeps its position for its whole life, so the
  // scene does not reshuffle every update.
  function slotFor(nodeName, uid, taken) {
    const base = hash(nodeName + '/' + uid) % MAX_UNITS_PER_NODE;
    for (let i = 0; i < MAX_UNITS_PER_NODE; i++) {
      const s = (base + i) % MAX_UNITS_PER_NODE;
      if (!taken.has(s)) { taken.add(s); return s; }
    }
    return base;
  }

  function update(next, now, view, q, opts) {
    state = next;
    const dense = next.pods.length;

    // Recompute layout when the node set or the view changes; otherwise reuse
    // it so positions stay put between frames.
    const key = view.id + '|' + q.id + '|' + (opts && opts.swims ? 'swim' : 'stand')
              + '|' + next.nodes.map((n) => n.name).join(',');
    // A view or tier change is a different camera, not motion: sprites should
    // appear in the new arrangement rather than gliding across the screen from
    // wherever they stood in the old one.
    const relayout = key !== layoutKey;
    if (relayout) {
      // Views now return { items, world }: the scene can be bigger than the
      // viewport, and the camera needs to know how big.
      const built = view.computeLayout(next.nodes, SCENE);
      layout = built.items;
      worldSize = built.world;
      layoutKey = key;
    } else {
      for (let i = 0; i < layout.length; i++) if (next.nodes[i]) layout[i].node = next.nodes[i];
    }

    const byName = new Map(layout.map((l) => [l.node.name, l]));

    // Recomputed each update: pod counts change, and sprite size follows them.
    for (const l of layout) {
      l.metrics = view.spriteMetrics ? view.spriteMetrics(l.rect, l.node, q, opts) : { size: q.unitSize, cols: 6, rows: 4, detailed: true };
      if (!plots.has(l.node.name)) plots.set(l.node.name, { born: now, seed: hash(l.node.name), fx: null });
    }
    for (const k of [...plots.keys()]) if (!byName.has(k)) plots.delete(k);

    // Cap sprites per plot and overall so a large cluster still renders at full
    // frame rate. Overflow is counted and shown, never silently dropped.
    const taken = new Map();
    let total = 0;
    const seen = new Set();

    // Workload pods claim slots before dimmed system pods.
    const sorted = [...next.pods].sort((a, b) => (a.dim ? 1 : 0) - (b.dim ? 1 : 0));

    for (const pod of sorted) {
      const l = pod.node ? byName.get(pod.node) : null;
      if (!l) { seen.add(pod.uid); continue; }       // unscheduled: the queue cloud
      if (!taken.has(pod.node)) taken.set(pod.node, new Set());
      const t = taken.get(pod.node);
      if (t.size >= MAX_UNITS_PER_NODE || total >= MAX_UNITS_TOTAL) continue;
      seen.add(pod.uid);
      total++;

      let u = units.get(pod.uid);
      if (!u) {
        const slot = slotFor(pod.node, pod.uid, t);
        const p = view.slotPos(l.rect, slot, l.node, pod, q, l.metrics, opts);
        u = { slot, seed: hash(pod.uid), born: now, x: p.x, y: p.y, tx: p.x, ty: p.y,
              hx: p.x, hy: p.y, roamX: p.roamX || 0, roamY: p.roamY || 0,
              minX: p.minX, maxX: p.maxX, minY: p.minY, maxY: p.maxY,
              nextRoam: now + 400 + (hash(pod.uid) % 3000), size: p.size || q.unitSize,
              grounded: p.grounded, rank: p.rank || 0, node: pod.node,
              fx: 'spawn', fxUntil: now + 700 };
        units.set(pod.uid, u);
      } else {
        t.add(u.slot);
        if (u.node !== pod.node) {         // rescheduled: walk to the new plot
          u.node = pod.node;
          u.slot = slotFor(pod.node, pod.uid, t);
          u.fx = 'walk'; u.fxUntil = now + 1400;
        }
        const p = view.slotPos(l.rect, u.slot, l.node, pod, q, l.metrics, opts);
        // Home cell, not the target: the target is where it is currently wandering.
        const homeMoved = Math.abs((u.hx || 0) - p.x) > 0.5 || Math.abs((u.hy || 0) - p.y) > 0.5;
        u.hx = p.x; u.hy = p.y;
        u.roamX = p.roamX || 0; u.roamY = p.roamY || 0;
        u.minX = p.minX; u.maxX = p.maxX; u.minY = p.minY; u.maxY = p.maxY;
        u.size = p.size || q.unitSize;
        u.grounded = p.grounded; u.rank = p.rank || 0;

        if (relayout) {
          // New camera: place, do not travel.
          u.x = u.tx = p.x; u.y = u.ty = p.y;
          u.nextRoam = now + 300 + (u.seed % 1200);
        } else if (homeMoved) {
          // The plot resized or the pod count shifted the grid: retarget now
          // rather than continuing toward a position that no longer exists.
          u.tx = p.x; u.ty = p.y;
          u.nextRoam = now + 200 + (u.seed % 900);
        } else {
          // Keep the current stroll, but never outside the new bounds.
          u.tx = clamp(u.tx, u.minX, u.maxX);
          u.ty = clamp(u.ty, u.minY, u.maxY);
        }
      }
      u.pod = pod;
    }

    // Retire units whose pods are gone, once the death animation has played.
    for (const [uid, u] of units) {
      if (seen.has(uid)) continue;
      if (!u.dying) { u.dying = now; u.fx = u.fx === 'harvest' ? 'harvest' : 'poof'; u.fxUntil = now + 650; }
      if (now - u.dying > 700) units.delete(uid);
    }

    return layout;
  }

  // Roam and ease. Each pod wanders inside its own cell around a home point, so
  // the crowd is visibly alive without drifting into a heap -- and busier pods
  // (higher usage) move about more, which is the same fact the brightness shows.
  function animate(dt, now) {
    const k = Math.min(1, dt / 120);
    for (const u of units.values()) {
      if (now >= u.nextRoam) {
        const load = u.pod && u.pod.cpuUse != null && u.pod.cpuReq > 0
          ? Math.min(2, u.pod.cpuUse / u.pod.cpuReq) : 0.35;
        const reach = 0.35 + load * 0.65;
        // Deterministic per-unit wander: no Math.random, so nothing drifts
        // differently after a reload or between frames.
        const n1 = ((u.seed * 1103515245 + (u.roamSeq |= 0) * 12345) >>> 8) % 1000 / 1000;
        const n2 = ((u.seed * 69069 + (u.roamSeq + 7) * 5) >>> 8) % 1000 / 1000;
        u.roamSeq = (u.roamSeq + 1) & 0xffff;
        // Clamped to the pod's band, so wandering never carries anyone off the
        // plot or across the fence that says what it reserved.
        u.tx = clamp(u.hx + (n1 * 2 - 1) * u.roamX * reach, u.minX, u.maxX);
        u.ty = clamp(u.hy + (n2 * 2 - 1) * u.roamY * reach, u.minY, u.maxY);
        // Idle pods rest longer between strolls.
        u.nextRoam = now + 900 + (1 - Math.min(1, load)) * 3500 + (n1 * 1600);
      }
      u.x += (u.tx - u.x) * k * 0.22;
      u.y += (u.ty - u.y) * k * 0.22;
    }
  }

  function markFx(uid, fx, ms, now) {
    const u = units.get(uid);
    if (u) { u.fx = fx; u.fxUntil = now + ms; }
  }
  function markPlotFx(node, fx, ms, now) {
    const p = plots.get(node);
    if (p) { p.fx = fx; p.fxUntil = now + ms; }
  }
  // Layout must be rebuilt when the view or tier changes.
  function invalidate() { layoutKey = ''; }

  return { update, animate, units, plots, markFx, markPlotFx, invalidate,
           get layout() { return layout; }, get world() { return worldSize; },
           get state() { return state; },
           MAX_UNITS_PER_NODE };
}
