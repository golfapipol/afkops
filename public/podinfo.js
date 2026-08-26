'use strict';
import { px, rect, meter, text, textRight, textW, fitText, shade, rgba } from './engine.js';
import { SCENE } from './world.js';
import { closeBox, drawCloseBox } from './ui.js';
import { reqTier, TIERS, loadVisual } from './podclass.js';

// Click target for a sprite. Sprites can be four pixels across on a busy node,
// so picking is by nearest-centre within a forgiving radius rather than by a
// strict bounding-box hit -- otherwise the dense plots are unclickable.
export function pickUnit(units, dx, dy) {
  // Two passes. The first prefers a sprite you actually landed on; the second
  // widens the net so a four-pixel critter on a crowded node is still clickable
  // without needing surgical aim.
  let near = null, nearD = Infinity;
  let far = null, farD = Infinity;
  const FAR = 16;
  for (const u of units.values()) {
    if (!u.pod || u.dying) continue;
    const s = u.size || 6;
    const cx = u.x + s / 2, cy = u.y + s / 2;
    const d = (cx - dx) * (cx - dx) + (cy - dy) * (cy - dy);
    const reach = Math.max(8, s * 1.2);
    if (d <= reach * reach) { if (d < nearD) { nearD = d; near = u; } }
    else if (d <= FAR * FAR && d < farD) { farD = d; far = u; }
  }
  return near || far;
}

export function drawSelection(g, ctx, u) {
  const { pal, q, t } = ctx;
  const s = u.size || 6;
  const pad = 2;
  const x = u.x - pad, y = u.y - pad, w = s + pad * 2, h = s + pad * 2;
  // A marching highlight, so the picked pod is findable in a crowd of ninety.
  const on = Math.floor(t / 220) % 2 === 0;
  rect(g, x, y, w, h, on ? '#ffffff' : pal.accent, q.hi ? 0.5 : 1);
  px(g, x + w / 2 - 0.5, y - 3, 1, 2, pal.accent);
}

const G = 5;   // body text size

function fmtCpu(v) {
  if (v == null) return '—';
  return v >= 1 ? v.toFixed(2) + ' cores' : Math.round(v * 1000) + 'm';
}
function fmtMem(v) {
  if (v == null) return '—';
  const mi = v / 1024 ** 2;
  return mi >= 1024 ? (mi / 1024).toFixed(2) + ' GiB' : Math.round(mi) + ' MiB';
}
function age(ms) {
  if (!ms) return '—';
  const s = Math.max(0, (Date.now() - ms) / 1000);
  if (s < 90) return Math.round(s) + 's';
  if (s < 5400) return Math.round(s / 60) + 'm';
  if (s < 172800) return Math.round(s / 3600) + 'h';
  return Math.round(s / 86400) + 'd';
}

// Returns the panel rect so the caller can hit-test its close box.
export function drawPodPanel(g, ctx, d, skin) {
  const { pal, q, H } = ctx;
  const w = 322;

  // Height follows the content: a one-container pod with no events should not
  // sit in a half-empty box.
  const nContainers = d.containers
    ? d.containers.length + (d.initContainers || []).filter((c) => c.sidecar).length : 0;
  const nEvents = d.events ? Math.min(d.events.length, 4) : 0;
  const evBlock = nEvents ? 12 + nEvents * 8 : 0;
  let h = 128
        + (d.podIP ? 8 : 0) + (d.reason ? 8 : 0)
        + Math.min(nContainers, 6) * 8 + (nContainers > 6 ? 8 : 0)
        + evBlock;
  if (d.loading || d.error) h = 44;
  h = Math.min(h, H - 30);

  const x = Math.round((SCENE.w - w) / 2);
  const y = Math.round((H - h) / 2) - 6;
  const panel = { x, y, w, h };

  g.fillStyle = 'rgba(0,0,0,0.66)';
  g.fillRect(0, 0, SCENE.w, H);
  px(g, x, y, w, h, pal.panel);
  rect(g, x, y, w, h, pal.accent);

  if (d.loading) {
    text(g, 'LOADING…', x + 10, y + 12, pal.dim, 6);
    drawCloseBox(g, ctx, closeBox(panel));
    return panel;
  }
  if (d.error) {
    text(g, 'POD IS GONE', x + 10, y + 12, pal.bad, 6);
    text(g, 'it was deleted while you were reading', x + 10, y + 24, pal.dim, G);
    drawCloseBox(g, ctx, closeBox(panel));
    return panel;
  }

  let ty = y + 6;
  const tier = TIERS[reqTier(d)];
  const lv = loadVisual(d);

  // ---- header ----
  text(g, fitText(g, d.name, w - 40, 6), x + 6, ty, pal.accent, 6);
  ty += 10;
  text(g, fitText(g, `${d.ns}  ·  ${tier[skin.id] || tier.id}`, w - 14, G), x + 6, ty, pal.dim, G);
  ty += 9;
  px(g, x + 4, ty, w - 8, 1, pal.panelEdge);
  ty += 4;

  // ---- status line ----
  const phaseCol = d.phase === 'Running' && d.ready ? pal.good
    : d.phase === 'CrashLoop' || d.phase === 'Failed' ? pal.bad
    : d.phase === 'Succeeded' ? pal.accent : pal.warn;
  text(g, d.terminating ? 'TERMINATING' : d.phase.toUpperCase(), x + 6, ty, phaseCol, 6);
  textRight(g, `${d.qos}  ·  up ${age(d.startedAt || d.created)}`, x + w - 6, ty + 1, pal.dim, G);
  ty += 11;

  const kv = (k, v, col) => {
    text(g, k, x + 6, ty, pal.dim, G);
    text(g, fitText(g, String(v), w - 92, G), x + 74, ty, col || pal.ink, G);
    ty += 8;
  };
  kv('NODE', d.node || 'not scheduled', d.node ? pal.ink : pal.warn);
  kv('OWNER', d.owner || '(bare pod)');
  if (d.podIP) kv('POD IP', d.podIP);
  if (d.reason) kv('REASON', d.reason, pal.bad);
  if (!d.node && d.nominatedNode) kv('NOMINATED', d.nominatedNode, pal.warn);

  ty += 2;
  px(g, x + 4, ty, w - 8, 1, pal.panelEdge);
  ty += 4;

  // ---- resources: request, limit, and what it is really using --------------
  text(g, 'RESERVED vs USED', x + 6, ty, pal.accent, G);
  ty += 8;
  const bar = (label, req, lim, use, col, fmt) => {
    text(g, label, x + 6, ty, pal.dim, G);
    // The bar is scaled to the limit when there is one, else to the request, so
    // "using more than reserved" is visible rather than clipped away.
    // Headroom, so a request with no limit does not render as a maxed-out bar.
    const scale = (Math.max(lim || 0, req || 0, use || 0) || 1) * 1.18;
    meter(g, x + 30, ty, 120, 5, (req || 0) / scale,
          pal.good, '#00000055', use != null ? use / scale : null, pal.accent, q);
    if (lim) px(g, x + 30 + 120 * (lim / scale) - 0.5, ty - 1, 1, 7, pal.warn);
    const parts = `req ${fmt(req)}  use ${fmt(use)}` + (lim ? `  lim ${fmt(lim)}` : '  lim —');
    text(g, parts, x + 156, ty, pal.ink, G);
    ty += 9;
  };
  bar('CPU', d.cpuReq, d.cpuLim, d.cpuUse, pal.good, fmtCpu);
  bar('MEM', d.memReq, d.memLim, d.memUse, '#5aa9e6', fmtMem);

  if (lv.known && lv.hot) {
    text(g, `USING MORE CPU THAN IT RESERVED (${Math.round(lv.load * 100)}%)`, x + 6, ty, pal.bad, G);
    ty += 9;
  } else if (lv.known && d.cpuReq > 0) {
    text(g, `USING ${Math.round(lv.load * 100)}% OF ITS CPU REQUEST`, x + 6, ty, pal.dim, G);
    ty += 9;
  } else if (d.cpuReq === 0) {
    text(g, 'NO CPU REQUEST — SCHEDULER CANNOT SEE THIS LOAD', x + 6, ty, pal.warn, G);
    ty += 9;
  }

  ty += 1;
  px(g, x + 4, ty, w - 8, 1, pal.panelEdge);
  ty += 4;

  // ---- containers ---------------------------------------------------------
  const all = [].concat(
    d.initContainers.filter((c) => c.sidecar).map((c) => ({ ...c, tag: 'sidecar' })),
    d.containers.map((c) => ({ ...c, tag: '' })),
  );
  text(g, `CONTAINERS (${all.length})`, x + 6, ty, pal.accent, G);
  ty += 8;

  const room = Math.max(1, Math.floor((y + h - 5 - evBlock - ty) / 8));
  for (const c of all.slice(0, room)) {
    const bad = c.state === 'waiting' || (c.state === 'terminated' && c.exitCode);
    const dot = c.ready ? pal.good : bad ? pal.bad : pal.warn;
    px(g, x + 6, ty + 1, 3, 3, dot);
    text(g, fitText(g, c.name + (c.tag ? ' (sidecar)' : ''), 100, G), x + 12, ty, pal.ink, G);
    let note = c.reason || c.state;
    // The reason it died last time is the useful bit for a restart loop -- but
    // not worth repeating when it is the same word as the current state.
    if (c.lastExit && c.lastExit.reason && c.lastExit.reason !== note) {
      note += ` · last ${c.lastExit.reason}`;
      if (c.lastExit.exitCode != null) note += `(${c.lastExit.exitCode})`;
    } else if (c.lastExit && c.lastExit.exitCode != null) {
      note += `(${c.lastExit.exitCode})`;
    }
    if (c.restarts) note += ` · ${c.restarts}x restart`;
    text(g, fitText(g, note, w - 130, G), x + 118, ty, bad || c.restarts ? pal.bad : pal.dim, G);
    ty += 8;
  }
  if (all.length > room) { text(g, `+${all.length - room} more`, x + 12, ty, pal.dim, G); ty += 8; }

  // ---- recent events, where the real explanation usually is ---------------
  if (d.events && d.events.length && y + h - ty > 18) {
    px(g, x + 4, ty, w - 8, 1, pal.panelEdge);
    ty += 4;
    text(g, 'RECENT EVENTS', x + 6, ty, pal.accent, G);
    ty += 8;
    const evRoom = Math.max(0, Math.floor((y + h - 6 - ty) / 8));
    for (const e of d.events.slice(0, evRoom)) {
      const col = e.type === 'Warning' ? pal.warn : pal.dim;
      text(g, fitText(g, `${e.reason}: ${e.message}`, w - 14, G), x + 6, ty, col, G);
      ty += 8;
    }
  }

  drawCloseBox(g, ctx, closeBox(panel));
  return panel;
}
