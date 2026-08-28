'use strict';
import { px, rect, text, textRight, textW, shade, rgba } from './engine.js';
import { TIERS, TIER_SCALE } from './podclass.js';
import { drawHotMark, drawRestartMark, HOT_COL, SCAR_COL } from './sprite.js';
import { levelColor } from './triage.js';
import { HUD, SCENE } from './world.js';
import { closeBox, drawCloseBox } from './ui.js';

// The legend draws the REAL sprites by calling the skin's own drawUnit, so it
// can never fall out of step with what is on the farm. A hand-drawn legend key
// would quietly go stale the first time a sprite changed.
// Drawn the same way the scene draws it, so the key cannot drift.
function drawBadgeSample(g, x, y, s, col) {
  px(g, x, y, s, s, col);
  px(g, x + s * 0.25, y + s * 0.25, s * 0.5, s * 0.5, '#000000aa');
}

function fakeUnit(tierIdx, opts = {}) {
  const cpuReq = [0, 0.05, 0.3, 1.5][tierIdx];
  return {
    x: 0, y: 0, tx: 0, ty: 0, seed: 1234 + tierIdx * 77, slot: 0, rank: 0,
    grounded: false, fx: null, fxUntil: 0,
    pod: {
      uid: 'legend' + tierIdx, name: 'legend', ns: 'legend',
      node: 'legend', phase: 'Running', ready: true,
      restarts: opts.restarts || 0, kind: opts.kind || 'deploy',
      besteffort: tierIdx === 0,
      cpuReq, memReq: 0,
      cpuUse: opts.cpuUse !== undefined ? opts.cpuUse : cpuReq * 0.8,
      memUse: 0, dim: !!opts.dim, age: 0,
    },
  };
}

function sprite(g, skin, ctx, tierIdx, x, y, opts) {
  const u = fakeUnit(tierIdx, opts);
  u.x = u.tx = x; u.y = u.ty = y;
  skin.drawUnit(g, u, ctx);
}

// ---- compact legend, always on in the HUD ---------------------------------
export function drawHudLegend(g, ctx, skin, y) {
  const { pal, q } = ctx;
  const x = HUD.x, w = HUD.w;

  px(g, x + 1, y, w - 4, 1, pal.panelEdge);
  y += 3;
  text(g, 'WHO IS WHO', x + 3, y, pal.accent, 6);
  y += 9;
  text(g, 'SHAPE = CPU RESERVED', x + 3, y, pal.dim, 5);
  y += 8;

  // Two per row: sprite, then the threshold it stands for.
  for (let i = 0; i < 4; i += 2) {
    for (let k = 0; k < 2; k++) {
      const idx = i + k;
      const cx = x + 3 + k * 84;
      sprite(g, skin, ctx, idx, cx, y - 1);
      const t = TIERS[idx];
      text(g, (t[skin.id] || '').slice(0, 7), cx + 13, y - 1, pal.ink, 5);
      text(g, t.short, cx + 13, y + 5, pal.dim, 5);
    }
    y += 15;
  }

  // Idle vs working side by side; the full scale lives in the ? overlay.
  sprite(g, skin, ctx, 2, x + 3, y - 1, { cpuUse: 0.01 });
  text(g, 'IDLE', x + 15, y, pal.dim, 5);
  sprite(g, skin, ctx, 2, x + 56, y - 1, { cpuUse: 0.3 });
  text(g, 'BUSY', x + 68, y, pal.ink, 5);
  text(g, '= IN USE', x + 92, y, pal.dim, 5);
  y += 13;

  // Drawn with the real marker functions, so the key cannot drift from the farm.
  drawHotMark(g, x + 3, y + 3, 7, ctx.t, 3);
  text(g, 'OVER ITS OWN REQUEST', x + 14, y, HOT_COL, 5);
  y += 10;
  drawRestartMark(g, x + 3, y - 4, 7, 5);
  text(g, 'RESTARTED BEFORE', x + 14, y, SCAR_COL, 5);
  y += 10;
  // The badge on a plot corner: what someone notices first and has no way to
  // look up otherwise.
  drawBadgeSample(g, x + 3, y, 5, levelColor(5, pal));
  text(g, 'NEEDS ATTENTION', x + 14, y, levelColor(5, pal), 5);
  text(g, 'CLICK A ' + ((skin.vocab.node) || 'NODE'), x + 96, y, pal.dim, 5);
  y += 10;
  return y;
}

// ---- full overlay, on demand ---------------------------------------------
export function drawFullLegend(g, ctx, skin, view) {
  const { pal, q, W, H } = ctx;
  const w = 436, h = 352;
  const x = Math.round((SCENE.w - w) / 2), y = Math.round((H - h) / 2) - 4;
  const panel = { x, y, w, h };

  g.fillStyle = 'rgba(0,0,0,0.72)';
  g.fillRect(0, 0, SCENE.w, H);
  px(g, x, y, w, h, pal.panel);
  rect(g, x, y, w, h, pal.accent);

  let ty = y + 7;
  text(g, `LEGEND — ${skin.name} / ${view.name}`, x + 8, ty, pal.accent, 8);
  ty += 15;

  text(g, 'EACH CREATURE IS ONE POD.', x + 8, ty, pal.ink, 6); ty += 10;
  text(g, 'ITS SHAPE IS WHAT IT RESERVED, NOT WHAT IT USES.', x + 8, ty, pal.dim, 5);
  ty += 13;

  for (let i = 0; i < 4; i++) {
    const t = TIERS[i];
    sprite(g, skin, ctx, i, x + 12, ty - 1);
    text(g, t[skin.id] || t.id, x + 30, ty, pal.ink, 6);
    text(g, t.label, x + 108, ty, pal.dim, 5);
    if (i === 0) text(g, 'BESTEFFORT — THE SCHEDULER SEES NOTHING', x + 190, ty, pal.warn, 5);
    ty += 14;
  }
  ty += 4;

  text(g, 'HOW HARD IT IS WORKING = ITS REAL USAGE', x + 8, ty, pal.ink, 6); ty += 12;
  const stops = [
    ['IDLE', 0.005, 'dull, still'],
    ['HALF', 0.15, 'half lit'],
    ['FULL', 0.3, 'lit, busy'],
    ['OVER', 0.6, 'heat above'],
  ];
  const colW = (w - 24) / stops.length;
  for (let i = 0; i < stops.length; i++) {
    const [label, use, note] = stops[i];
    const cx = x + 12 + i * colW;
    sprite(g, skin, ctx, 2, cx, ty - 1, { cpuUse: use });
    text(g, label, cx + 15, ty, i === 3 ? pal.bad : pal.ink, 5);
    text(g, note, cx, ty + 10, pal.dim, 5);
  }
  ty += 25;

  text(g, 'THE GROUND SHOWS THE NODE', x + 8, ty, pal.ink, 6); ty += 12;
  const rows = [
    ['WHOLE AREA', 'capacity — allocatable CPU'],
    ['FENCED / DECKED', 'requests — reserved by pods'],
    ['GROWING / LIT', 'usage — actually consumed now'],
    ['BARE INSIDE FENCE', 'reserved but unused: overcommit'],
    ['PAST THE FENCE', 'used without being reserved'],
    ['PIP ROW', 'pod count vs the node pod ceiling'],
  ];
  for (const [k, v] of rows) {
    text(g, k, x + 12, ty, pal.accent, 5);
    text(g, v, x + 136, ty, pal.dim, 5);
    ty += 9;
  }
  ty += 5;

  text(g, `THE BANNER AT THE TOP`, x + 8, ty, pal.ink, 6); ty += 11;
  text(g, `PODS THAT EXIST BUT HAVE NO ${view.id === 'sideon' ? 'FLOOR' : (skin.vocab.node || 'NODE')} YET —`,
       x + 12, ty, pal.dim, 5); ty += 9;
  text(g, 'STILL BEING SCHEDULED, OR NOTHING HAS ROOM FOR THEM.', x + 12, ty, pal.dim, 5);
  ty += 9;

  ty += 5;
  text(g, 'TWO MARKS THAT MEAN DIFFERENT THINGS', x + 8, ty, pal.ink, 6);
  ty += 11;
  drawHotMark(g, x + 14, ty + 4, 9, ctx.t, 1);
  text(g, 'HEAT ABOVE THE HEAD', x + 32, ty, HOT_COL, 5);
  text(g, 'happening NOW — using more CPU than it reserved', x + 150, ty, pal.dim, 5);
  ty += 12;
  drawRestartMark(g, x + 14, ty - 6, 9, 5);
  text(g, 'SCARS UNDER THE FEET', x + 32, ty, SCAR_COL, 5);
  text(g, 'already happened — it has restarted before', x + 150, ty, pal.dim, 5);
  ty += 14;

  text(g, `THE BADGE ON A ${(skin.vocab.node || 'NODE')}`, x + 8, ty, pal.ink, 6);
  ty += 11;
  drawBadgeSample(g, x + 14, ty, 7, levelColor(5, pal));
  text(g, 'NEEDS ATTENTION', x + 32, ty, levelColor(5, pal), 5);
  text(g, 'at least one pod here is in trouble; it blinks for the worst', x + 150, ty, pal.dim, 5);
  ty += 11;
  text(g, `CLICK a ${(skin.vocab.pod || 'POD').toLowerCase()} for its detail, or a `
        + `${(skin.vocab.node || 'NODE').toLowerCase()} for capacity and what is wrong on it.`,
       x + 14, ty, pal.dim, 5);

  const box = closeBox(panel);
  drawCloseBox(g, ctx, box);
  return panel;
}
