'use strict';
import { px, rect, meter, text, textRight, textW, fitText, shade, rgba } from './engine.js';
import { SCENE } from './world.js';
import { closeBox, drawCloseBox } from './ui.js';
import { rankGroups, levelColor } from './triage.js';

// The badge on a plot says a node needs attention. This is what is behind it.

// Clicking the header band always means "the node", even where a pod overlaps
// it; elsewhere in the plot it means the node only if no pod was hit.
export function pickNode(layout, wx, wy, headerOnly) {
  for (const l of layout) {
    const r = l.rect;
    if (wx < r.x || wx > r.x + r.w) continue;
    if (headerOnly) {
      if (wy >= r.y && wy <= r.y + 12) return l.node;
    } else if (wy >= r.y && wy <= r.y + r.h) {
      return l.node;
    }
  }
  return null;
}

export function drawNodeSelection(g, ctx, l) {
  const { pal, q, t } = ctx;
  const on = Math.floor(t / 220) % 2 === 0;
  rect(g, l.rect.x - 1, l.rect.y - 1, l.rect.w + 2, l.rect.h + 2,
       on ? '#ffffff' : pal.accent, q.hi ? 0.5 : 1);
}

const G = 5;
const fmtCpu = (v) => v == null ? '—' : v >= 1 ? v.toFixed(2) : Math.round(v * 1000) + 'm';
const fmtMem = (v) => {
  if (v == null) return '—';
  const gi = v / 1024 ** 3;
  return gi >= 1 ? gi.toFixed(1) + ' GiB' : Math.round(v / 1024 ** 2) + ' MiB';
};
function age(ms) {
  if (!ms) return '—';
  const s = Math.max(0, (Date.now() - ms) / 1000);
  if (s < 5400) return Math.round(s / 60) + 'm';
  if (s < 172800) return Math.round(s / 3600) + 'h';
  return Math.round(s / 86400) + 'd';
}

export function drawNodePanel(g, ctx, d, world, skin) {
  const { pal, q, H } = ctx;
  const w = 344;

  const conds = (d.conditions || []).length;
  const taints = (d.taints || []).length;
  // Problems belonging to this node, worst first.
  const mine = world
    ? rankGroups(world.pods.filter((p) => p.node === d.name), Date.now()).slice(0, 4)
    : [];
  let h = 150 + conds * 8 + (taints ? 10 : 0) + (mine.length ? 12 + mine.length * 8 : 0);
  if (d.loading || d.error) h = 44;
  h = Math.min(h, H - 30);

  const x = Math.round((SCENE.w - w) / 2);
  const y = Math.round((H - h) / 2) - 6;
  const panel = { x, y, w, h };

  g.fillStyle = 'rgba(0,0,0,0.66)';
  g.fillRect(0, 0, SCENE.w, H);
  px(g, x, y, w, h, pal.panel);
  rect(g, x, y, w, h, pal.accent);

  if (d.loading) { text(g, 'LOADING…', x + 10, y + 12, pal.dim, 6); drawCloseBox(g, ctx, closeBox(panel)); return panel; }
  if (d.error)   { text(g, 'NODE IS GONE', x + 10, y + 12, pal.bad, 6); drawCloseBox(g, ctx, closeBox(panel)); return panel; }

  let ty = y + 6;
  const down = !d.ready;

  text(g, fitText(g, d.name, w - 40, 6), x + 6, ty, pal.accent, 6);
  ty += 10;
  const sub = [d.instance, d.zone, d.roles && d.roles.length ? d.roles.join('/') : '']
    .filter(Boolean).join('  ·  ');
  text(g, fitText(g, sub || skin.vocab.node, w - 14, G), x + 6, ty, pal.dim, G);
  ty += 9;
  px(g, x + 4, ty, w - 8, 1, pal.panelEdge);
  ty += 4;

  const state = down ? 'NOT READY' : d.unschedulable ? 'CORDONED' : 'READY';
  text(g, state, x + 6, ty, down ? pal.bad : d.unschedulable ? pal.warn : pal.good, 6);
  textRight(g, `up ${age(d.created)}${d.kubelet ? '  ·  ' + d.kubelet : ''}`, x + w - 6, ty + 1, pal.dim, G);
  ty += 12;

  // Capacity is not allocatable: the gap is what the kubelet, the runtime and
  // the eviction threshold hold back, and it is invisible on most dashboards.
  const BAR_X = 44, BAR_W = 140;
  const bar = (label, r, fmt, colFill) => {
    const scale = Math.max(r.capacity || 0, r.allocatable || 0, r.limits || 0, r.usage || 0) || 1;
    text(g, fitText(g, label, BAR_X - 8, G), x + 6, ty, pal.dim, G);
    px(g, x + BAR_X, ty, BAR_W, 6, '#00000055');
    // Allocatable is the trough that matters; the gap to capacity is what the
    // kubelet and the eviction threshold hold back, which most dashboards hide.
    px(g, x + BAR_X, ty, BAR_W * ((r.allocatable || 0) / scale), 6, rgba(pal.dim, 0.35));
    px(g, x + BAR_X, ty, BAR_W * ((r.requests || 0) / scale), 6,
       (r.requests / (r.allocatable || 1)) > 0.9 ? pal.bad : colFill);
    if (r.usage != null) px(g, x + BAR_X, ty + 1, BAR_W * (r.usage / scale), 4, pal.accent);
    if (r.limits) px(g, x + BAR_X + BAR_W * (r.limits / scale) - 0.5, ty - 1, 1, 8, pal.warn);
    text(g, `${fmt(r.requests)} of ${fmt(r.allocatable)}`, x + BAR_X + BAR_W + 8, ty, pal.ink, G);
    ty += 9;
    text(g, `cap ${fmt(r.capacity)}   use ${fmt(r.usage)}   lim ${fmt(r.limits)}`,
         x + BAR_X, ty, pal.dim, G);
    ty += 10;
  };
  text(g, 'RESERVED vs USED', x + 6, ty, pal.accent, G); ty += 8;
  bar(skin.vocab.cpu, d.cpu, fmtCpu, pal.good);
  bar(skin.vocab.mem, d.mem, fmtMem, '#5aa9e6');

  const podFrac = d.pods.count / (d.pods.max || 110);
  text(g, 'SLOTS', x + 6, ty, pal.dim, G);
  meter(g, x + BAR_X, ty, BAR_W, 5, podFrac,
        podFrac > 0.9 ? pal.bad : podFrac > 0.75 ? pal.warn : pal.dim, '#00000055', null, null, q);
  text(g, `${d.pods.count} of ${d.pods.max}`, x + BAR_X + BAR_W + 8, ty, pal.ink, G);
  ty += 11;

  for (const c of d.conditions || []) {
    text(g, fitText(g, `${c.type}: ${c.reason || c.status}${c.message ? ' — ' + c.message : ''}`, w - 14, G),
         x + 6, ty, c.type === 'Ready' ? pal.bad : pal.warn, G);
    ty += 8;
  }
  if (taints) {
    text(g, fitText(g, `TAINTS  ${d.taints.map((t2) => t2.key + ':' + t2.effect).join('  ')}`, w - 14, G),
         x + 6, ty, pal.dim, G);
    ty += 10;
  }

  if (mine.length) {
    px(g, x + 4, ty, w - 8, 1, pal.panelEdge); ty += 4;
    text(g, 'PROBLEMS ON THIS NODE', x + 6, ty, pal.accent, G); ty += 8;
    for (const gr of mine) {
      const col = levelColor(gr.n, pal);
      px(g, x + 6, ty + 1, 2, 5, col);
      text(g, gr.tag, x + 11, ty, col, G);
      text(g, fitText(g, gr.label, w - 80, G), x + 52, ty, pal.ink, G);
      if (gr.count > 1) textRight(g, `x${gr.count}`, x + w - 6, ty, col, G);
      ty += 8;
    }
  }

  drawCloseBox(g, ctx, closeBox(panel));
  return panel;
}
