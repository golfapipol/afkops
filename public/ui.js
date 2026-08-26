'use strict';
import { px, rect, text, textW, shade, rgba } from './engine.js';
import { HUD } from './world.js';

// On-screen controls. A wallboard has no one to tell you the keyboard shortcuts,
// so every toggle needs a visible, clickable affordance -- the keys stay as a
// shortcut for whoever already knows them.
const BAR_Y = 340, BAR_H = 15;

export function buttons(state) {
  const x0 = HUD.x + 2, w = HUD.w - 6;
  const specs = [
    { id: 'skin', label: state.skinName, weight: 58, title: 'change skin' },
    { id: 'view', label: state.viewShort, weight: 34, title: 'change view' },
    { id: 'tier', label: state.tierShort, weight: 44, title: 'change graphics' },
    { id: 'help', label: '?', weight: 18, title: 'what the symbols mean' },
  ];
  const total = specs.reduce((a, b) => a + b.weight, 0) + (specs.length - 1) * 2;
  const k = w / total;
  let x = x0;
  return specs.map((sp) => {
    const bw = sp.weight * k;
    const b = { ...sp, x, y: BAR_Y, w: bw, h: BAR_H };
    x += bw + 2 * k;
    return b;
  });
}

export function drawButtons(g, ctx, btns, active) {
  const { pal, q } = ctx;
  for (const b of btns) {
    const on = b.id === 'help' && active;
    const face = on ? pal.accent : shade(pal.panel, 0.16);
    px(g, b.x, b.y, b.w, b.h, face);
    // A raised edge so it reads as pressable rather than as a label.
    px(g, b.x, b.y, b.w, q.hi ? 0.5 : 1, shade(face, 0.3));
    px(g, b.x, b.y + b.h - (q.hi ? 0.5 : 1), b.w, q.hi ? 0.5 : 1, shade(face, -0.35));
    rect(g, b.x, b.y, b.w, b.h, on ? pal.accent : pal.panelEdge, q.hi ? 0.5 : 1);

    const size = b.id === 'help' ? 8 : 5;
    const label = fit(g, b.label, b.w - 4, size);
    const tw = textW(g, label, size);
    text(g, label, b.x + (b.w - tw) / 2, b.y + (b.h - size) / 2 + (size === 8 ? 0 : 1),
         on ? shade(pal.panel, -0.2) : pal.ink, size);
  }
}

function fit(g, s, maxW, size) {
  let str = String(s);
  while (str.length > 1 && textW(g, str, size) > maxW) str = str.slice(0, -1);
  return str;
}

export function hitTest(btns, dx, dy) {
  for (const b of btns) {
    if (dx >= b.x && dx <= b.x + b.w && dy >= b.y && dy <= b.y + b.h) return b.id;
  }
  return null;
}

// The legend dialog's own close box, so it can be dismissed by clicking too.
export function closeBox(panel) {
  return { x: panel.x + panel.w - 16, y: panel.y + 4, w: 12, h: 11 };
}

export function drawCloseBox(g, ctx, box) {
  const { pal, q } = ctx;
  px(g, box.x, box.y, box.w, box.h, shade(pal.panel, 0.2));
  rect(g, box.x, box.y, box.w, box.h, pal.panelEdge, q.hi ? 0.5 : 1);
  const cx = box.x + box.w / 2, cy = box.y + box.h / 2;
  for (let i = -3; i <= 3; i++) {
    px(g, cx + i, cy + i, q.hi ? 1 : 1, q.hi ? 1 : 1, pal.bad);
    px(g, cx + i, cy - i, q.hi ? 1 : 1, q.hi ? 1 : 1, pal.bad);
  }
}
