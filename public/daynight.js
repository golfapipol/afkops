'use strict';
import { mixColor, lerp } from './engine.js';

// Real-clock day/night. The phases are anchored to wall time so the wallboard
// visibly moves through the day; `clockSpeed` compresses 24h for testing.
const PHASES = [
  { at: 0,    name: 'night' },
  { at: 5,    name: 'dawn'  },
  { at: 8,    name: 'day'   },
  { at: 17,   name: 'dusk'  },
  { at: 20,   name: 'night' },
  { at: 24,   name: 'night' },
];

export function clockHours(now, clockSpeed = 1) {
  if (clockSpeed && clockSpeed !== 1) {
    // Compress the whole cycle so a 24h sweep can be checked in minutes.
    return ((now / 1000 * clockSpeed) / 3600) % 24;
  }
  const d = new Date(now);
  return d.getHours() + d.getMinutes() / 60 + d.getSeconds() / 3600;
}

// Returns { a, b, k } -- two phase names and how far between them we are, so
// palettes cross-fade gradually instead of snapping at the hour boundary.
export function phaseBlend(hours) {
  for (let i = 0; i < PHASES.length - 1; i++) {
    const p0 = PHASES[i], p1 = PHASES[i + 1];
    if (hours >= p0.at && hours < p1.at) {
      const span = p1.at - p0.at;
      const k = span > 0 ? (hours - p0.at) / span : 0;
      // Hold the phase colour for most of the window, then transition over the
      // last third, so "day" looks like day rather than a permanent crossfade.
      const eased = k < 0.66 ? 0 : (k - 0.66) / 0.34;
      return { a: p0.name, b: p1.name, k: eased };
    }
  }
  return { a: 'night', b: 'night', k: 0 };
}

// Blends every colour key of two palette entries.
//
// Memoised on the blend state: the palette only changes a few times a second,
// so rebuilding it every frame would allocate for no visible difference.
let _cacheKey = '', _cacheVal = null;

export function blendPalette(palettes, blend) {
  const A = palettes[blend.a] || palettes.day;
  const B = palettes[blend.b] || A;
  if (blend.k <= 0) return A;

  const key = `${blend.a}|${blend.b}|${Math.round(blend.k * 64)}|${A.sky1}`;
  if (key === _cacheKey && _cacheVal) return _cacheVal;

  const out = {};
  for (const key of Object.keys(A)) {
    const a = A[key], b = B[key];
    out[key] = (typeof a === 'string' && a[0] === '#' && typeof b === 'string' && b[0] === '#')
      ? mixColor(a, b, blend.k)
      : (typeof a === 'number' && typeof b === 'number' ? lerp(a, b, blend.k) : a);
  }
  _cacheKey = key; _cacheVal = out;
  return out;
}

// 0 = pitch dark, 1 = full daylight. Skins use this for lamps, stars, torches.
export function daylight(hours) {
  if (hours < 4 || hours >= 21) return 0;
  if (hours < 7) return (hours - 4) / 3;
  if (hours < 18) return 1;
  return Math.max(0, 1 - (hours - 18) / 3);
}
