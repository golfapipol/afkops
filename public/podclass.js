'use strict';
// Shared classification for pod sprites.
//
// This is the single source of truth for what a sprite means: the legend and
// the renderer both read it, so they cannot drift apart and start telling the
// viewer two different things.
//
// Species encodes the pod's CPU REQUEST -- what it reserved from the node.
// Thresholds are fixed round numbers, not percentiles of the current cluster,
// so "chicken" means the same thing tomorrow and on a different cluster.
export const TIERS = [
  { id: 'none',  farm: 'CROP',    factory: 'BELT',    dungeon: 'IMP',    label: 'NO REQUEST', short: 'NONE' },
  { id: 'small', farm: 'CHICKEN', factory: 'PRESS',   dungeon: 'ROGUE',  label: 'up to 100m', short: '≤100m' },
  { id: 'mid',   farm: 'SHEEP',   factory: 'FURNACE', dungeon: 'KNIGHT', label: 'up to 500m', short: '≤500m' },
  { id: 'large', farm: 'COW',     factory: 'REACTOR', dungeon: 'GIANT',  label: 'over 500m',  short: '>500m' },
];

const T_SMALL = 0.1;    // cores
const T_MID = 0.5;

// 0..3. A pod with no CPU request at all is its own category: the scheduler
// reserved nothing for it, so it is wild growth rather than livestock.
export function reqTier(pod) {
  const r = pod.cpuReq || 0;
  if (r <= 0) return 0;
  if (r <= T_SMALL) return 1;
  if (r <= T_MID) return 2;
  return 3;
}

// Sprites scale a little with their tier so size reads as size, independently
// of which animal it is.
export const TIER_SCALE = [0.78, 0.86, 1.0, 1.18];

// How hard this pod is actually working, as a fraction of its own request.
// Returns null when there are no metrics, so "unknown" never renders as "idle".
//
// A pod with no request has nothing to be a fraction OF, so it is measured
// against a nominal 100m instead -- enough to animate honestly without
// implying a reservation that does not exist.
const NOMINAL = 0.1;
export function podLoad(pod) {
  if (pod.cpuUse == null) return null;
  const base = pod.cpuReq > 0 ? pod.cpuReq : NOMINAL;
  return pod.cpuUse / base;
}

// Renderers want these bounded and cheap.
export function loadVisual(pod) {
  const load = podLoad(pod);
  if (load == null) return { known: false, activity: 0.45, bright: 0, hot: false, load: null };
  return {
    known: true,
    // Working animation speed: idle pods barely stir, busy ones bustle.
    activity: Math.max(0.12, Math.min(2.2, load * 1.4)),
    // Brightness lift, saturating well before the request is exhausted so the
    // common case (median pod uses ~20% of its request) is still readable.
    bright: Math.max(0, Math.min(1, load * 1.6)),
    // Past its own request: throttling / eviction territory, worth calling out.
    hot: load > 1,
    load,
  };
}

export function speciesName(pod, skinId) {
  const t = TIERS[reqTier(pod)];
  return t[skinId] || t.id.toUpperCase();
}
