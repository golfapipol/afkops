'use strict';
// Two fidelity tiers over ONE design space.
//
// All layout and drawing code is written in "design units" (a 640x360 grid).
// The renderer applies a scale transform, so the same code produces either
// chunky 8-bit pixels or a fine, high-resolution image -- and `u`, the size of
// one device pixel in design units, is what lets 64-bit mode draw detail that
// simply does not exist at 8-bit.
export const DESIGN_W = 640, DESIGN_H = 360;

export const TIERS = {
  '8bit': {
    id: '8bit',
    name: '8-BIT',
    // Fixed small backbuffer, integer-upscaled: deliberately chunky.
    fixedScale: 1,
    hi: false,
    skyBands: 7,        // dithered colour bands instead of a real gradient
    shadows: false,
    glow: false,
    parallax: false,
    unitSize: 6,        // design units
    textScale: 1,
  },
  '64bit': {
    id: '64bit',
    name: '64-BIT',
    // Backbuffer sized to the display, so detail is limited by the screen and
    // not by an artificial retro grid.
    fixedScale: null,
    hi: true,
    skyBands: 48,       // enough steps to read as a smooth gradient
    shadows: true,
    glow: true,
    parallax: true,
    unitSize: 9,
    textScale: 1,
  },
};

export const TIER_ORDER = ['8bit', '64bit'];

// Chooses the backbuffer scale for a tier given the canvas size.
export function scaleFor(tier, cw, ch) {
  if (tier.fixedScale) return tier.fixedScale;
  const fit = Math.min(cw / DESIGN_W, ch / DESIGN_H);
  // At least 2x so 64-bit always has sub-pixel room for detail, capped so a
  // very large display does not allocate an absurd backbuffer.
  return Math.max(2, Math.min(4, Math.round(fit)));
}
