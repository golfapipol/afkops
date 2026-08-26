'use strict';
import { px, rect, meter, text, textRight, textW, fitText, dither, shade, rgba } from './engine.js';
import { HUD, SCENE } from './world.js';
import { drawHudLegend } from './legend.js';
import { rankGroups, levelColor } from './triage.js';

// Icon-first: every stat is a drawn glyph with a small count beside it, so the
// board reads as a game panel rather than a table of numbers.
function glyph(g, kind, x, y, col) {
  switch (kind) {
    case 'node':                                  // a server / building
      px(g, x, y + 1, 7, 6, col); px(g, x + 1, y + 2, 5, 1, '#00000066');
      px(g, x + 1, y + 4, 5, 1, '#00000066'); px(g, x + 5, y + 5, 1, 1, '#ffffff88'); break;
    case 'pod':                                   // a running unit
      px(g, x + 1, y, 5, 5, col); px(g, x + 2, y + 5, 3, 1, '#00000055'); break;
    case 'pending':                               // hourglass
      px(g, x, y, 6, 1, col); px(g, x, y + 6, 6, 1, col);
      px(g, x + 1, y + 1, 4, 1, col); px(g, x + 2, y + 2, 2, 2, col); px(g, x + 1, y + 5, 4, 1, col); break;
    case 'skull':
      px(g, x + 1, y, 4, 4, col); px(g, x + 1, y + 4, 4, 1, col);
      px(g, x + 2, y + 1, 1, 1, '#000'); px(g, x + 4, y + 1, 1, 1, '#000'); break;
    case 'bolt':                                  // cpu
      px(g, x + 3, y, 2, 3, col); px(g, x + 2, y + 2, 2, 2, col);
      px(g, x + 1, y + 3, 3, 2, col); px(g, x + 2, y + 5, 2, 2, col); break;
    case 'drop':                                  // memory
      px(g, x + 2, y, 2, 2, col); px(g, x + 1, y + 2, 4, 2, col); px(g, x, y + 4, 6, 3, col);
      px(g, x + 1, y + 7, 4, 1, col); break;
    case 'crowd':                                 // pod count ceiling
      px(g, x, y + 2, 2, 4, col); px(g, x + 2, y, 2, 6, col); px(g, x + 4, y + 3, 2, 3, col); break;
    case 'clock':
      rect(g, x, y, 7, 7, col); px(g, x + 3, y + 2, 1, 2, col); px(g, x + 4, y + 4, 1, 1, col); break;
  }
}

// Relative luminance, so highlights can be chosen against the current panel.
function isLight(hex) {
  const r = parseInt(hex.slice(1, 3), 16), g = parseInt(hex.slice(3, 5), 16), b = parseInt(hex.slice(5, 7), 16);
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) > 140;
}

function wrapText(s, cols, maxLines) {
  const words = String(s).split(/\s+/).filter(Boolean);
  const out = [];
  let line = '';
  for (const word of words) {
    if (!line.length) line = word;
    else if (line.length + 1 + word.length <= cols) line += ' ' + word;
    else { out.push(line); line = word; if (out.length >= maxLines) break; }
  }
  if (line && out.length < maxLines) out.push(line);
  return out.slice(0, maxLines);
}

function fmtCores(v) { return v >= 100 ? Math.round(v) + '' : v >= 10 ? v.toFixed(0) : v.toFixed(1); }
function fmtGi(bytes) {
  const gi = bytes / 1024 ** 3;
  return gi >= 100 ? Math.round(gi) + '' : gi >= 10 ? gi.toFixed(0) : gi.toFixed(1);
}

// Hit boxes for the PROBLEMS rows, rebuilt each frame and read by the click
// handler in app.js.
export const problemRows = [];

export function drawHud(g, world, ctx, skin, log, link, view) {
  const { pal, q, t, hours } = ctx;
  const t0 = Date.now();
  const x = HUD.x, w = HUD.w;
  px(g, x - 2, 0, w + 4, 360, pal.panel);
  px(g, x - 2, 0, 1, 360, pal.panelEdge);

  const s = world;
  const totals = s.totals;
  let y = 4;

  // ---- title + context ----
  text(g, 'K8S ' + skin.name, x + 2, y, pal.accent, 8);
  textRight(g, q.name, x + w - 4, y + 2, pal.dim, 5);
  y += 11;
  const ctxName = String(s.context || '').replace(/^gke_/, '').replace(/^arn:aws:eks:[^:]+:\d+:cluster\//, '');
  // Reserve room for the view label, then fit the cluster name in what's left.
  const viewW = textW(g, view.name, 5) + 5;
  let label = ctxName;
  while (label.length > 6 && textW(g, label, 5) > w - viewW - 6) label = label.slice(1);
  if (label !== ctxName) label = '…' + label.slice(1);
  text(g, label, x + 2, y + 1, pal.dim, 5);
  textRight(g, view.name, x + w - 4, y + 1, pal.dim, 5);
  y += 10;

  // ---- link banner ----
  if (!link.ok) {
    // The remedy is the important half of the message ("run: gcloud auth
    // login"), so it must wrap rather than be truncated away.
    const lines = wrapText(String(link.error || ''), 30, 3);
    const bh = 10 + lines.length * 7;
    px(g, x + 1, y, w - 4, bh, pal.bad);
    text(g, 'CLUSTER UNREACHABLE', x + 4, y + 2, '#ffffff', 6);
    for (let i = 0; i < lines.length; i++) text(g, lines[i], x + 4, y + 9 + i * 7, '#ffe0e0', 5);
    y += bh + 3;
  }

  // ---- icon stat rows ----
  const rows = [
    ['node',    `${totals.nodesReady}/${s.nodes.length}`, skin.vocab.nodes,  totals.nodesReady < s.nodes.length ? pal.bad : pal.good],
    ['pod',     `${s.counts.running}`,                    skin.vocab.pods,   pal.good],
    ['pending', `${s.counts.pending}`,                    'WAITING',         s.counts.pending ? pal.warn : pal.dim],
    ['skull',   `${s.counts.crashloop + s.counts.failed}`,'BROKEN',          (s.counts.crashloop + s.counts.failed) ? pal.bad : pal.dim],
  ];
  for (const [ic, val, label, col] of rows) {
    glyph(g, ic, x + 3, y + 1, col);
    text(g, val, x + 14, y, pal.ink, 8);
    textRight(g, label, x + w - 4, y + 1, pal.dim, 6);
    y += 12;
  }
  y += 3;

  // ---- the three resource layers, stacked and labelled ----
  const cpuReqF = totals.cpuAlloc ? totals.cpuReq / totals.cpuAlloc : 0;
  const cpuUseF = totals.cpuAlloc && s.hasUsage ? totals.cpuUse / totals.cpuAlloc : null;
  const memReqF = totals.memAlloc ? totals.memReq / totals.memAlloc : 0;
  const memUseF = totals.memAlloc && s.hasUsage ? totals.memUse / totals.memAlloc : null;

  glyph(g, 'bolt', x + 3, y, pal.accent);
  text(g, skin.vocab.cpu, x + 12, y, pal.ink, 6);
  textRight(g, `${Math.round(cpuReqF * 100)}%`, x + w - 4, y, cpuReqF > 0.9 ? pal.bad : pal.ink, 6);
  y += 8;
  meter(g, x + 3, y, w - 8, 6, cpuReqF, cpuReqF > 0.9 ? pal.bad : pal.good, '#00000066', cpuUseF, pal.accent, q);
  y += 8;
  text(g, `${fmtCores(totals.cpuReq)}/${fmtCores(totals.cpuAlloc)} CORES`, x + 3, y, pal.dim, 5);
  if (cpuUseF != null) textRight(g, `USE ${Math.round(cpuUseF * 100)}%`, x + w - 4, y, pal.accent, 5);
  y += 10;

  glyph(g, 'drop', x + 3, y, '#5aa9e6');
  text(g, skin.vocab.mem, x + 12, y, pal.ink, 6);
  textRight(g, `${Math.round(memReqF * 100)}%`, x + w - 4, y, memReqF > 0.9 ? pal.bad : pal.ink, 6);
  y += 8;
  meter(g, x + 3, y, w - 8, 6, memReqF, memReqF > 0.9 ? pal.bad : '#5aa9e6', '#00000066', memUseF, '#9fd8ff', q);
  y += 8;
  text(g, `${fmtGi(totals.memReq)}/${fmtGi(totals.memAlloc)} GiB`, x + 3, y, pal.dim, 5);
  if (memUseF != null) textRight(g, `USE ${Math.round(memUseF * 100)}%`, x + w - 4, y, '#9fd8ff', 5);
  y += 10;

  // Pod-count ceiling: the limit that bites while CPU still looks free.
  const podF = totals.podMax ? totals.podCount / totals.podMax : 0;
  glyph(g, 'crowd', x + 3, y, pal.warn);
  text(g, 'SLOTS', x + 12, y, pal.ink, 6);
  textRight(g, `${totals.podCount}/${totals.podMax}`, x + w - 4, y, podF > 0.9 ? pal.bad : pal.dim, 6);
  y += 8;
  meter(g, x + 3, y, w - 8, 4, podF, podF > 0.9 ? pal.bad : podF > 0.75 ? pal.warn : pal.dim, '#00000066', null, null, q);
  y += 9;

  if (!s.hasUsage) { text(g, 'NO METRICS-SERVER', x + 3, y, pal.warn, 5); y += 8; }

  // ---- what the sprites mean ----
  // Permanently on screen: a wallboard has no one to ask, and a legend behind a
  // keypress is no use to someone walking past it.
  y = drawHudLegend(g, ctx, skin, y + 2);

  // ---- problems, worst first ----
  // The board's job is to point at trouble, not to leave someone scanning nine
  // hundred sprites for a four-pixel mark. Rows are clickable.
  px(g, x + 1, y, w - 4, 1, pal.panelEdge);
  y += 3;
  const groups = rankGroups(s.pods, t0);
  const affected = groups.reduce((a, gr) => a + gr.count, 0);
  problemRows.length = 0;
  text(g, 'PROBLEMS', x + 3, y, groups.length ? pal.bad : pal.dim, 6);
  textRight(g, groups.length ? String(affected) : 'NONE',
            x + w - 4, y + 1, groups.length ? pal.bad : pal.good, 6);
  y += 10;

  const PROB_ROWS = 6;
  if (!groups.length) {
    text(g, 'NOTHING NEEDS ATTENTION', x + 6, y, pal.dim, 5);
    y += 9;
  } else {
    for (const gr of groups.slice(0, PROB_ROWS)) {
      const col = levelColor(gr.n, pal);
      px(g, x + 3, y + 1, 2, 5, col);
      text(g, gr.tag, x + 8, y, col, 5);
      const suffix = gr.count > 1 ? ` x${gr.count}` : '';
      const nameW = w - 60 - textW(g, suffix, 5);
      text(g, fitText(g, gr.label, nameW, 5), x + 48, y, pal.ink, 5);
      if (suffix) textRight(g, suffix.trim(), x + w - 5, y, col, 5);
      // Remembered so a click routes back to the first pod in the group.
      problemRows.push({ x, y: y - 1, w: w - 6, h: 8, uid: gr.pods[0].uid });
      y += 8;
    }
    const shown = groups.slice(0, PROB_ROWS).reduce((a, gr) => a + gr.count, 0);
    const rest = affected - shown;
    text(g, rest > 0 ? `+${rest} MORE — N TO STEP THROUGH` : 'N TO STEP THROUGH',
         x + 8, y, pal.dim, 5);
    y += 9;
  }

  // ---- quest log ----
  y += 2;
  px(g, x + 1, y, w - 4, 1, pal.panelEdge);
  y += 3;
  text(g, 'QUEST LOG', x + 3, y, pal.accent, 6);
  y += 10;

  const maxLines = Math.max(0, Math.floor((336 - y) / 8));
  const lines = log.slice(0, maxLines);
  for (let i = 0; i < lines.length; i++) {
    const e = lines[i];
    const age = (t - e.t) / 1000;
    const fresh = age < 1.2 && Math.floor(t / 100) % 2 === 0;
    px(g, x + 3, y + 1, 2, 5, e.col);
    const flash = isLight(pal.panel) ? '#000000' : '#ffffff';
    text(g, e.text.slice(0, 26), x + 8, y, fresh ? flash : (i < 3 ? pal.ink : pal.dim), 5);
    y += 8;
  }
}

// The 24h day ribbon: history as scenery. One column per 30s slot; height is
// cluster allocation, the brighter overlay is real usage, red ticks are
// incidents. It reads as a skyline, not a chart.
export function drawRibbon(g, hist, ctx) {
  const { pal, q, t, hours } = ctx;
  const x = 0, y = 336, w = SCENE.w, h = 22;
  px(g, x, y, w, h, '#00000088');
  px(g, x, y, w, 1, pal.panelEdge);
  if (!hist) return;

  const slots = hist.cpu.length;
  const step = slots / w;                 // ~4.5 slots per column at 2880/640
  for (let cx = 0; cx < w; cx++) {
    const i0 = Math.floor(cx * step), i1 = Math.min(slots, Math.floor((cx + 1) * step));
    let cpu = 0, use = 0, inc = 0, filled = 0, n = 0;
    for (let i = i0; i < i1; i++) {
      cpu = Math.max(cpu, hist.cpu[i]); use = Math.max(use, hist.use[i]);
      inc += hist.inc[i]; filled = Math.max(filled, hist.filled[i]); n++;
    }
    if (!filled) continue;
    // Allocation is the hill (muted), usage is the bright line running over it,
    // so the gap between "reserved" and "actually used" is the visible shape.
    const bh = Math.max(1, Math.round((cpu / 100) * (h - 5)));
    px(g, x + cx, y + h - bh - 1, 1, bh, '#00000000');
    dither(g, x + cx, y + h - bh - 1, 1, bh, pal.good, 2, q.u);
    px(g, x + cx, y + h - bh - 1, 1, 1, pal.good);
    if (use > 0) {
      const uh = Math.max(1, Math.round((use / 100) * (h - 5)));
      px(g, x + cx, y + h - uh - 1, 1, 2, pal.accent);
    }
    // Incidents hang from the top edge like tally marks.
    if (inc > 0) px(g, x + cx, y + 2, 1, Math.min(5, 1 + inc), pal.bad);
  }
  // "now" marker sits at the right edge; time runs left (24h ago) to right.
  px(g, x + w - 1, y + 1, 1, h - 2, pal.ink);
  text(g, '-24H', x + 2, y + h - 8, pal.dim, 5);
  const hh = String(Math.floor(hours)).padStart(2, '0');
  const mm = String(Math.floor((hours % 1) * 60)).padStart(2, '0');
  textRight(g, `${hh}:${mm}`, x + w - 3, y + h - 8, pal.ink, 5);
}
