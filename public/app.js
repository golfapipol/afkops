'use strict';
import { createEngine, W, H, px, rect, text, textW, rgba } from './engine.js';
import { TIERS, TIER_ORDER } from './quality.js';
import { createWorldModel, SCENE, HUD } from './world.js';
import { createCamera } from './camera.js';
import { drawHud, drawRibbon, problemRows } from './hud.js';
import { drawFullLegend } from './legend.js';
import { buttons, drawButtons, hitTest, closeBox } from './ui.js';
import { pickUnit, drawPodPanel, drawSelection } from './podinfo.js';
import { pickNode, drawNodePanel, drawNodeSelection } from './nodeinfo.js';
import { rank, rankGroups, byNode, levelColor, PROBLEM_LEVEL } from './triage.js';
import { clockHours, phaseBlend, blendPalette } from './daynight.js';
import * as topdown from './views/topdown.js';
import * as sideon from './views/sideon.js';
import * as farm from './skins/farm.js';
import * as factory from './skins/factory.js';
import * as dungeon from './skins/dungeon.js';
import * as aquarium from './skins/aquarium.js';

const SKINS = { farm, factory, dungeon, aquarium };
const SKIN_ORDER = ['farm', 'factory', 'dungeon', 'aquarium'];
const VIEWS = { topdown, sideon };
const VIEW_ORDER = ['topdown', 'sideon'];

const canvas = document.getElementById('stage');
const engine = createEngine(canvas);
const g = engine.g;
const model = createWorldModel();
const cam = createCamera();

// Capabilities the active skin needs the view to know about — whether its units
// stand on the floor or swim through the column, for instance.
const skinOpts = () => {
  const sk = SKINS[skinId];
  return { swims: !!(sk && sk.side && sk.side.swims) };
};

let cfg = { defaultSkin: 'farm', autoRotateSkinMs: 0, nightlyReloadHour: 4, clockSpeed: 1, demo: false };
let world = null, hist = null;
let link = { ok: false, error: 'connecting' };
let booted = false;
let legendOpen = false;
let legendOpenedAt = 0;

// Pod selection. `selected` is the sprite that was clicked; `podDetail` is the
// server's answer, which arrives a moment later.
let selectedUid = null;
let podDetail = null;
let podPanel = null;
let podFetchSeq = 0;

// Node selection, the same shape as pod selection.
let selectedNode = null;
let nodeDetail = null;
let nodePanel = null;
let nodeFetchSeq = 0;

function selectNode(name) {
  clearSelection();
  selectedNode = name;
  nodeDetail = { loading: true };
  const seq = ++nodeFetchSeq;
  fetch(`/api/node?name=${encodeURIComponent(name)}`)
    .then((r) => (r.ok ? r.json() : Promise.reject(new Error('gone'))))
    .then((d) => { if (seq === nodeFetchSeq) { nodeDetail = d; renderNow(); } })
    .catch(() => { if (seq === nodeFetchSeq) { nodeDetail = { error: true }; renderNow(); } });
  renderNow();
}

function clearNodeSelection() {
  selectedNode = null; nodeDetail = null; nodePanel = null;
  nodeFetchSeq++;
  renderNow();
}

function selectPod(u) {
  if (nodeDetail) { selectedNode = null; nodeDetail = null; nodePanel = null; nodeFetchSeq++; }
  selectedUid = u.pod.uid;
  podDetail = { loading: true };
  const seq = ++podFetchSeq;
  fetch(`/api/pod?uid=${encodeURIComponent(selectedUid)}`)
    .then((r) => (r.ok ? r.json() : Promise.reject(new Error('gone'))))
    .then((d) => { if (seq === podFetchSeq) { podDetail = d; renderNow(); } })
    .catch(() => { if (seq === podFetchSeq) { podDetail = { error: true }; renderNow(); } });
  renderNow();
}

// Step through problems worst-first: centre the camera on one and open its
// detail. This is the whole point of ranking them -- spotting a problem and
// inspecting it should be one keypress, not a hunt.
let problemCursor = -1;

function jumpToProblem(dir = 1) {
  if (!world) return;
  // Groups, so stepping does not walk through six replicas of one bad workload.
  const list = rankGroups(world.pods, Date.now());
  if (!list.length) return;
  problemCursor = (problemCursor + dir + list.length) % list.length;
  focusPod(list[problemCursor].pods[0].uid);
}

function focusPod(uid) {
  const u = model.units.get(uid);
  if (u) {
    cam.centerOn(u.x + (u.size || 6) / 2, u.y + (u.size || 6) / 2);
    selectPod(u);
  } else {
    // Unscheduled pods have no sprite; still show what is wrong with them.
    window.__k8sfarmSelect(uid);
  }
  renderNow();
}

function clearSelection() {
  selectedUid = null; podDetail = null; podPanel = null;
  podFetchSeq++;                 // abandon any in-flight response
  renderNow();
}
// An unattended board must return to showing the cluster. If someone opens the
// dialog and walks away, it closes itself rather than covering the farm all day.
const LEGEND_AUTOCLOSE_MS = 90000;

// Query parameters win over stored preferences, so a specific board can be
// deep-linked -- one kiosk showing the dungeon side view, another the farm --
// and so a screenshot can be scripted without driving the UI by hand.
//   ?skin=farm&view=sideon&tier=8bit&zoom=fit&hud=0
const params = new URLSearchParams(location.search);
const stored = (k, fallback, valid, param) => {
  const q = params.get(param);
  if (q && valid[q]) return q;
  const v = localStorage.getItem(k);
  return v && valid[v] ? v : fallback;
};
const hourParam = parseFloat(params.get('hour'));
const pinnedHour = Number.isFinite(hourParam) && hourParam >= 0 && hourParam < 24 ? hourParam : null;
let skinId = stored('k8sfarm.skin', 'farm', SKINS, 'skin');
let tierId = stored('k8sfarm.tier', '64bit', TIERS, 'tier');
let viewId = stored('k8sfarm.view', 'topdown', VIEWS, 'view');

// The engine's backbuffer depends on the tier, so it is reconfigured whenever
// the tier or the window changes -- not every frame.
// Repaint immediately rather than waiting for the next animation frame.
// Setting canvas.width clears the canvas, and a backgrounded tab throttles
// requestAnimationFrame to almost nothing -- so without this the board can sit
// blank for seconds after a resize or a mode change.
function renderNow() {
  if (!world) return;
  try { drawScene(performance.now(), 16); engine.present(); }
  catch (e) { drawErrors++; console.warn('[afkops] draw error:', e); }
}

function applyTier() {
  engine.configure(TIERS[tierId]);
  model.invalidate();
  if (world) model.update(world, performance.now(), VIEWS[viewId], TIERS[tierId], skinOpts());
  renderNow();
}
applyTier();
window.addEventListener('resize', applyTier);

// ---- quest log -------------------------------------------------------------
const LOG_MAX = 40;
const log = [];

// ---- transition queue ------------------------------------------------------
// A scale-up delivers dozens of events at once. They are played staggered so it
// looks like an idle game, and collapsed past a threshold so a large rollout
// can never back the queue up for minutes.
const pending = [];
const PLAY_EVERY_MS = 80;
const BURST_THRESHOLD = 12;
let lastPlay = 0;

function enqueue(events) {
  if (events.length > BURST_THRESHOLD) {
    const byType = new Map();
    for (const e of events) byType.set(e.type, (byType.get(e.type) || 0) + 1);
    for (const e of events.slice(0, BURST_THRESHOLD)) pending.push(e);
    for (const [type, n] of byType) if (n > BURST_THRESHOLD) pushLog({ type, grouped: n, t: Date.now() });
    return;
  }
  for (const e of events) pending.push(e);
}

function drainQueue(now) {
  if (now - lastPlay < PLAY_EVERY_MS) return;
  lastPlay = now;
  let budget = 4;
  while (pending.length && budget-- > 0) applyTransition(pending.shift(), now);
  // If events arrive faster than they can be played for a sustained period,
  // drop the oldest rather than growing without bound.
  if (pending.length > 300) pending.splice(0, pending.length - 300);
}

const FX = {
  pod_restart:    { fx: 'hit',     ms: 400,  col: '#ff9f4d', verb: 'restart' },
  pod_crashloop:  { fx: 'hit',     ms: 600,  col: '#ff5f5f', verb: 'crash' },
  pod_succeeded:  { fx: 'harvest', ms: 650,  col: '#ffd166', verb: 'done' },
  pod_failed:     { fx: 'poof',    ms: 650,  col: '#ff5f5f', verb: 'failed' },
  pod_deleted:    { fx: 'poof',    ms: 650,  col: '#8a8a8a', verb: 'gone' },
  pod_terminating:{ fx: 'poof',    ms: 900,  col: '#8a8a8a', verb: 'leaving' },
  pod_scheduled:  { fx: 'spawn',   ms: 700,  col: '#8fd67a', verb: 'joined' },
  pod_ready:      { fx: null,      ms: 0,    col: '#8fd67a', verb: 'ready' },
  pod_moved:      { fx: 'walk',    ms: 1400, col: '#5aa9e6', verb: 'moved' },
  pod_evicted:    { fx: 'poof',    ms: 650,  col: '#ff5f5f', verb: 'evicted' },
  pod_preempted:  { fx: 'poof',    ms: 650,  col: '#ff5f5f', verb: 'preempted' },
  pod_oom:        { fx: 'hit',     ms: 500,  col: '#ff5f5f', verb: 'OOM' },
  pod_unschedulable:{ fx: null,    ms: 0,    col: '#ffc14d', verb: 'no room' },
  pod_pending:    { fx: null,      ms: 0,    col: '#ffc14d', verb: 'waiting' },
  node_added:     { fx: null,      ms: 0,    col: '#8fd67a', verb: 'NODE UP' },
  node_removed:   { fx: null,      ms: 0,    col: '#ff5f5f', verb: 'NODE GONE' },
  node_notready:  { fx: null,      ms: 0,    col: '#ff5f5f', verb: 'NODE DOWN' },
  node_ready:     { fx: null,      ms: 0,    col: '#8fd67a', verb: 'NODE OK' },
  node_cordoned:  { fx: null,      ms: 0,    col: '#ffc14d', verb: 'CORDONED' },
  node_uncordoned:{ fx: null,      ms: 0,    col: '#8fd67a', verb: 'OPEN' },
  scale:          { fx: null,      ms: 0,    col: '#ffd166', verb: 'SCALE' },
  hpa:            { fx: null,      ms: 0,    col: '#ffd166', verb: 'HPA' },
  cluster_scale_up:{ fx: null,     ms: 0,    col: '#8fd67a', verb: 'SCALE UP' },
  cluster_scale_down:{ fx: null,   ms: 0,    col: '#ffc14d', verb: 'SCALE DN' },
};

function applyTransition(e, now) {
  const spec = FX[e.type];
  if (!spec) return;
  if (spec.fx && e.uid) model.markFx(e.uid, spec.fx, spec.ms, now);
  if (e.node && e.type.startsWith('node_')) model.markPlotFx(e.node, e.type, 2000, now);
  pushLog(e);
}

const short = (s, n) => String(s || '').length > n ? String(s).slice(0, n - 1) + '…' : String(s || '');

function pushLog(e) {
  const spec = FX[e.type] || { col: '#8a8a8a', verb: e.type };
  const skin = SKINS[skinId];
  let txt;
  if (e.grouped) txt = `x${e.grouped} ${spec.verb}`;
  else if (e.type === 'scale' || e.type === 'hpa') {
    const m = /to (\d+)/.exec(e.message || '');
    txt = `${short(e.name, 12)} ${m ? '→ x' + m[1] : 'scaled'}`;
  } else if (e.type.startsWith('node_') || e.type.startsWith('cluster_')) {
    txt = `${spec.verb} ${short((e.node || e.name || '').split('-').slice(-1)[0], 10)}`;
  } else if (e.type === 'pod_succeeded') {
    txt = `${skin.vocab.done}: ${short(e.name, 14)}`;
  } else {
    txt = `${short(e.name, 14)} ${spec.verb}`;
  }
  log.unshift({ t: e.t || Date.now(), text: txt.toUpperCase(), col: spec.col });
  if (log.length > LOG_MAX) log.length = LOG_MAX;   // bounded: no growth over 24h
}

// ---- SSE -------------------------------------------------------------------
let es = null, reconnectDelay = 1000;
const decode = (b64) => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
function setHistory(h) {
  hist = { cpu: decode(h.cpu), mem: decode(h.mem), use: decode(h.use),
           inc: decode(h.inc), filled: decode(h.filled) };
}

function connect() {
  if (es) { try { es.close(); } catch {} }
  es = new EventSource('/api/events');

  es.addEventListener('config', (m) => {
    try {
      cfg = { ...cfg, ...JSON.parse(m.data) };
      // Only fall back to the server default when the viewer has expressed no
      // preference at all -- neither a URL parameter nor a stored one.
      if (!params.get('skin') && !localStorage.getItem('k8sfarm.skin') && cfg.defaultSkin) {
        skinId = cfg.defaultSkin;
      }
    } catch {}
  });
  es.addEventListener('state', (m) => {
    try {
      const s = JSON.parse(m.data);
      world = s; link = s.link || link;
      model.update(s, performance.now(), VIEWS[viewId], TIERS[tierId], skinOpts());
      if (selectedUid && podDetail && !podDetail.loading && !podDetail.error
          && !s.pods.some((pd) => pd.uid === selectedUid)) {
        podDetail = { error: true };
      }
      if (!booted) {
        booted = true;
        document.getElementById('boot').classList.add('gone');
        // The camera has to be told the world size before it can fit to it;
        // drawScene normally does that, and has not run yet on the first frame.
        const z = params.get('zoom');
        if (z) {
          cam.setWorld(model.world.w, model.world.h);
          if (z === 'fit') cam.fit();
          else if (Number.isFinite(parseFloat(z))) cam.zoomTo(parseFloat(z));
        }
        // Paint as soon as there is something to show. A tab that is opened in
        // the background gets no animation frames, so without this the board
        // stays black until it is looked at.
        renderNow();
      }
      reconnectDelay = 1000;
    } catch (err) { console.warn('bad state frame', err); }
  });
  es.addEventListener('tx', (m) => { try { enqueue(JSON.parse(m.data)); } catch {} });
  es.addEventListener('link', (m) => { try { link = JSON.parse(m.data); } catch {} });
  es.addEventListener('history', (m) => { try { setHistory(JSON.parse(m.data)); } catch {} });

  es.onerror = () => {
    // Streams drop for ordinary reasons; reconnect with backoff and keep
    // rendering the last known world in the meantime.
    link = { ...link, ok: false, error: 'lost connection to the afkops server' };
    try { es.close(); } catch {}
    es = null;
    setTimeout(connect, reconnectDelay);
    reconnectDelay = Math.min(reconnectDelay * 2, 30000);
  };
}
connect();

setInterval(() => {
  fetch('/api/history').then((r) => r.json()).then(setHistory).catch(() => {});
}, 30000);

// ---- input -----------------------------------------------------------------
function setSkin(i) {
  const next = SKIN_ORDER[i] || 'farm';
  const wasSwim = skinOpts().swims;
  skinId = next;
  localStorage.setItem('k8sfarm.skin', skinId);
  // Skins can change how units are placed (standing vs swimming), so a switch
  // that crosses that boundary has to re-place them rather than wait for the
  // next state frame.
  if (world && skinOpts().swims !== wasSwim) {
    model.invalidate();
    model.update(world, performance.now(), VIEWS[viewId], TIERS[tierId], skinOpts());
  }
  renderNow();
}
function setTier(id) {
  if (!TIERS[id] || id === tierId) return;
  tierId = id; localStorage.setItem('k8sfarm.tier', tierId);
  applyTier();
}
function setView(id) {
  if (!VIEWS[id] || id === viewId) return;
  viewId = id; localStorage.setItem('k8sfarm.view', viewId);
  model.invalidate();
  // Re-place sprites immediately so the switch reads as a camera move, not a jump.
  if (world) model.update(world, performance.now(), VIEWS[viewId], TIERS[tierId], skinOpts());
  renderNow();
}

// Buttons are rebuilt each frame from current state and stashed for hit-testing.
let uiButtons = [];
let legendPanel = null;

function cycleSkin() { setSkin((SKIN_ORDER.indexOf(skinId) + 1) % SKIN_ORDER.length); }
function cycleView() { setView(viewId === 'topdown' ? 'sideon' : 'topdown'); }
function cycleTier() { setTier(tierId === '8bit' ? '64bit' : '8bit'); }

window.addEventListener('keydown', (e) => {
  const k = e.key.toLowerCase();
  // Number keys map onto the skin list, however long it is.
  if (/^[1-9]$/.test(k) && Number(k) <= SKIN_ORDER.length) setSkin(Number(k) - 1);
  else if (k === 'v') setView(viewId === 'topdown' ? 'sideon' : 'topdown');
  else if (k === 'g') setTier(tierId === '8bit' ? '64bit' : '8bit');
  else if (k === 'l') { legendOpen = !legendOpen; legendOpenedAt = performance.now(); }
  else if (k === 'f') { cam.fit(); renderNow(); }
  else if (k === 'n') jumpToProblem(e.shiftKey ? -1 : 1);
  else if (k === '=' || k === '+') { cam.zoomIn(); renderNow(); }
  else if (k === '-' || k === '_') { cam.zoomOut(); renderNow(); }
  else if (k === 'r') location.reload();
  else if (e.key === 'Escape') {
    if (nodeDetail) clearNodeSelection();
    else if (podDetail) clearSelection();
    else legendOpen = false;
  }
  else if (e.key === 'Tab') { e.preventDefault(); cycleSkin(); }
});
canvas.addEventListener('click', (e) => {
  const p = engine.toDesign(e.clientX, e.clientY);

  // The node panel owns clicks while it is open.
  if (nodeDetail && nodePanel) {
    const cb = closeBox(nodePanel);
    if (p.x >= cb.x && p.x <= cb.x + cb.w && p.y >= cb.y && p.y <= cb.y + cb.h) { clearNodeSelection(); return; }
    const inPanel = p.x >= nodePanel.x && p.x <= nodePanel.x + nodePanel.w
                 && p.y >= nodePanel.y && p.y <= nodePanel.y + nodePanel.h;
    if (!inPanel) clearNodeSelection();
    return;
  }

  // The pod panel owns clicks while it is open.
  if (podDetail && podPanel) {
    const cb = closeBox(podPanel);
    if (p.x >= cb.x && p.x <= cb.x + cb.w && p.y >= cb.y && p.y <= cb.y + cb.h) { clearSelection(); return; }
    const inPanel = p.x >= podPanel.x && p.x <= podPanel.x + podPanel.w
                 && p.y >= podPanel.y && p.y <= podPanel.y + podPanel.h;
    if (!inPanel) {
      // Clicking straight onto another pod swaps the panel rather than making
      // you close it first.
      const wp = cam.toWorld(p.x, p.y);
      const next = pickUnit(model.units, wp.x, wp.y);
      if (next) { selectPod(next); return; }
      clearSelection();
    }
    return;
  }

  // While the dialog is open it owns the clicks: its close box, then anywhere
  // outside the panel to dismiss.
  if (legendOpen && legendPanel) {
    const cb = closeBox(legendPanel);
    if (p.x >= cb.x && p.x <= cb.x + cb.w && p.y >= cb.y && p.y <= cb.y + cb.h) { legendOpen = false; return; }
    const inPanel = p.x >= legendPanel.x && p.x <= legendPanel.x + legendPanel.w
                 && p.y >= legendPanel.y && p.y <= legendPanel.y + legendPanel.h;
    if (!inPanel) { legendOpen = false; return; }
    return;
  }

  // A problem row is a shortcut to the pod it names.
  for (const r of problemRows) {
    if (p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h) { focusPod(r.uid); return; }
  }

  switch (hitTest(uiButtons, p.x, p.y)) {
    case 'skin': cycleSkin(); break;
    case 'view': cycleView(); break;
    case 'tier': cycleTier(); break;
    case 'help': legendOpen = true; legendOpenedAt = performance.now(); break;
    default: {
      // Not a control. In the scene, the header band of a plot always means
      // the node — that is where the badge lives — and elsewhere a pod wins if
      // one was hit, otherwise the node it was standing on.
      if (p.x < SCENE.x || p.x > SCENE.x + SCENE.w || p.y < SCENE.y || p.y > SCENE.y + SCENE.h) break;
      const wp = cam.toWorld(p.x, p.y);
      const header = pickNode(model.layout, wp.x, wp.y, true);
      if (header) { selectNode(header.name); break; }
      const u = pickUnit(model.units, wp.x, wp.y);
      if (u) { selectPod(u); break; }
      const inside = pickNode(model.layout, wp.x, wp.y, false);
      if (inside) selectNode(inside.name);
      break;
    }
  }
});

setInterval(() => {
  if (cfg.autoRotateSkinMs > 0) cycleSkin();
}, Math.max(10000, cfg.autoRotateSkinMs || 600000));

document.addEventListener('visibilitychange', () => {
  if (document.hidden) return;
  fetch('/api/state').then((r) => r.json()).then((s) => {
    if (s && s.nodes) {
      world = s; link = s.link || link;
      model.update(s, performance.now(), VIEWS[viewId], TIERS[tierId], skinOpts());
    }
  }).catch(() => {});
});

// Belt-and-braces leak reset for an unattended board: one reload in the quiet hour.
setInterval(() => {
  const d = new Date();
  if (d.getHours() === (cfg.nightlyReloadHour ?? 4) && d.getMinutes() === 0 && d.getSeconds() < 40) location.reload();
}, 30000);

// ---- navigation -----------------------------------------------------------
// At true scale a real cluster does not fit on screen, so the scene pans.
const keys = { up: false, down: false, left: false, right: false };
const PAN_KEYS = {
  w: 'up', a: 'left', s: 'down', d: 'right',
  arrowup: 'up', arrowleft: 'left', arrowdown: 'down', arrowright: 'right',
};

window.addEventListener('keydown', (e) => {
  const dir = PAN_KEYS[e.key.toLowerCase()];
  if (dir) { keys[dir] = true; e.preventDefault(); }
});
window.addEventListener('keyup', (e) => {
  const dir = PAN_KEYS[e.key.toLowerCase()];
  if (dir) { keys[dir] = false; e.preventDefault(); }
});
// A lost keyup (tab switch, alt-tab) would otherwise leave the scene sliding.
window.addEventListener('blur', () => { for (const k in keys) keys[k] = false; });

canvas.addEventListener('wheel', (e) => {
  e.preventDefault();
  if (e.deltaY < 0) cam.zoomIn(); else cam.zoomOut();
  renderNow();
}, { passive: false });

// ---- cursor ---------------------------------------------------------------
// Visible whenever someone is actually using the board, hidden again once the
// mouse has been still -- a wallboard should not display a stray pointer all
// day, but it still has to be clickable.
let idleTimer = null;
const CURSOR_IDLE_MS = 4000;
function wakeCursor() {
  document.body.classList.remove('idle');
  clearTimeout(idleTimer);
  idleTimer = setTimeout(() => document.body.classList.add('idle'), CURSOR_IDLE_MS);
}
window.addEventListener('mousemove', wakeCursor, { passive: true });
window.addEventListener('mousedown', wakeCursor, { passive: true });
wakeCursor();

// ---- render loop -----------------------------------------------------------
let lastT = performance.now();
let lastRaw = performance.now();

// Hoisted and mutated in place. At 60fps a fresh context object per frame is
// ~5M allocations a day; on a board that never reloads, that is pure GC churn
// for no benefit.
const q = { u: 1 };
const ctx = { pal: null, q, t: 0, hours: 0, skin: null, view: null, W, H };
const drawList = [];

// Frame timing, so density can be verified rather than assumed.
let fps = 0, frameCount = 0, fpsSince = 0, rawDt = 0, worstDt = 0;
let drawErrors = 0, lastDrawErrorLog = 0;

function frame(now) {
  const dt = Math.min(100, now - lastT);
  lastT = now;
  rawDt = now - lastRaw; lastRaw = now;
  worstDt = Math.max(worstDt * 0.95, rawDt);
  frameCount++;
  if (now - fpsSince >= 1000) { fps = frameCount * 1000 / (now - fpsSince); frameCount = 0; fpsSince = now; }

  // A wallboard must not be one bad frame away from a black screen. Anything
  // thrown in the draw path is logged (rate-limited, since this runs for days)
  // and the loop keeps going, exactly as the server keeps serving through a
  // failed collection.
  try {
    drainQueue(now);
    cam.step(dt, keys);
    model.animate(dt, now);
    drawScene(now, dt);
    engine.present();
  } catch (e) {
    drawErrors++;
    if (now - lastDrawErrorLog > 5000) {
      lastDrawErrorLog = now;
      console.error(`[afkops] draw error (${drawErrors} so far):`, e);
    }
  }
  requestAnimationFrame(frame);
}

// The whole visual frame, in one place, so it can be both rendered and timed.
function drawScene(now, dt) {
  const skin = SKINS[skinId];
  const view = VIEWS[viewId];
  const tier = TIERS[tierId];
  const hours = pinnedHour != null ? pinnedHour : clockHours(Date.now(), cfg.clockSpeed);

  Object.assign(q, tier);
  q.u = engine.u;
  ctx.pal = blendPalette(skin.palettes, phaseBlend(hours));
  ctx.t = now; ctx.hours = hours; ctx.skin = skin; ctx.view = view;
  const pal = ctx.pal;

  // Background stays put: it is the sky, not part of the world being panned.
  skin.drawBackground(g, ctx);

  if (world) {
    cam.setWorld(model.world.w, model.world.h);

    // Everything below is in WORLD coordinates, clipped to the scene so it
    // cannot spill over the HUD or the day ribbon.
    g.save();
    g.beginPath();
    g.rect(SCENE.x, SCENE.y, SCENE.w, SCENE.h);
    g.clip();
    g.translate(SCENE.x - cam.x * cam.zoom, SCENE.y - cam.y * cam.zoom);
    g.scale(cam.zoom, cam.zoom);

    for (const l of model.layout) {
      if (view.drawContainer) view.drawContainer(g, l.node, l.rect, ctx);
      else skin.drawContainer(g, l.node, l.rect, ctx);
    }
    // Back rank first, so the front rank overlaps it correctly in side view.
    drawList.length = 0;
    for (const u of model.units.values()) if (u.pod && u.pod.node) drawList.push(u);
    drawList.sort((a, b) => (b.rank || 0) - (a.rank || 0) || a.y - b.y);
    for (let i = 0; i < drawList.length; i++) skin.drawUnit(g, drawList[i], ctx);

    if (selectedUid) {
      const sel = model.units.get(selectedUid);
      if (sel) drawSelection(g, ctx, sel);
    }
    if (selectedNode) {
      const l = model.layout.find((x) => x.node.name === selectedNode);
      if (l) drawNodeSelection(g, ctx, l);
    }

    drawOverflow(g, ctx);
    drawNodeBadges(g, ctx);
    g.restore();          // back to viewport coordinates

    skin.drawOverlay(g, world, ctx);
    drawQueueCloud(g, world, ctx);
    drawNavHint(g, ctx);
    drawRibbon(g, hist, ctx);
    drawHud(g, world, ctx, skin, log, link, view);

    uiButtons = buttons({
      skinName: skin.name,
      viewShort: view.id === 'sideon' ? 'SIDE' : 'TOP',
      tierShort: tier.name,
    });
    drawButtons(g, ctx, uiButtons, legendOpen);

    if (legendOpen && now - legendOpenedAt > LEGEND_AUTOCLOSE_MS) legendOpen = false;
    legendPanel = legendOpen ? drawFullLegend(g, ctx, skin, view) : null;
    podPanel = podDetail ? drawPodPanel(g, ctx, podDetail, skin) : null;
    nodePanel = nodeDetail ? drawNodePanel(g, ctx, nodeDetail, world, skin) : null;
  } else {
    const s = 'CONNECTING…';
    text(g, s, (W - textW(g, s, 8)) / 2, H / 2, '#7f849c', 8);
  }

  // Offline scrim: the last known world stays on screen, visibly stale.
  if (!link.ok && world) {
    for (let y = 0; y < H; y += 3) px(g, 0, y, SCENE.w, 1, 'rgba(0,0,0,0.33)');
    const msg = 'CLUSTER UNREACHABLE — SHOWING LAST KNOWN';
    const w = textW(g, msg, 6) + 8;
    px(g, (SCENE.w - w) / 2, 8, w, 12, 'rgba(0,0,0,0.8)');
    text(g, msg, (SCENE.w - w) / 2 + 4, 11, '#ff8080', 6);
  }
}

// Times the real draw path, independent of requestAnimationFrame. Needed because
// a backgrounded tab throttles rAF to nothing, which makes fps meaningless while
// saying nothing about whether a frame is affordable.
window.__k8sfarmBench = (iterations = 30) => {
  if (!world) return { error: 'no world yet' };
  const t0 = performance.now();
  for (let i = 0; i < iterations; i++) drawScene(performance.now(), 16);
  const total = performance.now() - t0;
  return {
    iterations,
    msPerFrame: +(total / iterations).toFixed(2),
    impliedFps: Math.round(1000 / (total / iterations)),
    sprites: model.units.size,
    tier: tierId, skin: skinId, view: viewId,
  };
};

// Selects a pod by uid without having to click a four-pixel sprite. Used to
// verify the detail panel against specific pods (a crashlooper, a BestEffort).
window.__k8sfarmSelect = (uid) => {
  const u = model.units.get(uid);
  if (u) { selectPod(u); return { selected: u.pod.name }; }
  // Not on screen (unscheduled, or retired): still fetch its detail.
  selectedUid = uid; podDetail = { loading: true };
  const seq = ++podFetchSeq;
  fetch(`/api/pod?uid=${encodeURIComponent(uid)}`)
    .then((r) => (r.ok ? r.json() : Promise.reject(new Error('gone'))))
    .then((d) => { if (seq === podFetchSeq) { podDetail = d; renderNow(); } })
    .catch(() => { if (seq === podFetchSeq) { podDetail = { error: true }; renderNow(); } });
  return { selected: uid, note: 'not on screen' };
};

// Advances the animation by a simulated span, so roaming can be verified in a
// backgrounded tab where requestAnimationFrame is throttled to nothing.
window.__k8sfarmFit = () => {
  cam.setWorld(model.world.w, model.world.h);
  cam.fit();
  renderNow();
  return { zoom: +cam.zoom.toFixed(3), world: cam.world, canScroll: cam.canScroll() };
};

window.__k8sfarmPan = (dir, ms = 600) => {
  keys[dir] = true;
  for (let t = 0; t < ms; t += 16) cam.step(16, keys);
  keys[dir] = false;
  for (let t = 0; t < 600; t += 16) cam.step(16, keys);   // let it glide to a stop
  renderNow();
  return { x: +cam.x.toFixed(1), y: +cam.y.toFixed(1) };
};

window.__k8sfarmStep = (durationMs = 5000, dt = 16) => {
  const t0 = performance.now();
  for (let t = 0; t <= durationMs; t += dt) model.animate(dt, t0 + t);
  return { steppedMs: durationMs, units: model.units.size };
};

// A severity badge per node. Sprite markers vanish at low zoom, but a plot in
// trouble has to stay visible from across the room -- so the badge is drawn at a
// minimum on-screen size regardless of how far out you are zoomed.
let badgeCache = { t: 0, map: new Map() };
function drawNodeBadges(g, ctx) {
  const { pal, t } = ctx;
  if (!world) return;
  // Ranking 900 pods every frame would be wasteful; it changes slowly.
  if (t - badgeCache.t > 1000) {
    badgeCache = { t, map: byNode(rank(world.pods, Date.now())) };
  }
  const z = cam.zoom;
  for (const l of model.layout) {
    const info = badgeCache.map.get(l.node.name);
    if (!info || info.worst < PROBLEM_LEVEL) continue;
    const col = levelColor(info.worst, pal);
    // Constant screen size: divide out the camera zoom.
    const r = 4 / z;
    const bx = l.rect.x + l.rect.w - r * 1.6;
    const by = l.rect.y + r * 0.4;
    const pulse = info.worst >= 4 ? (Math.sin(t * 0.006) * 0.5 + 0.5) : 1;
    if (info.worst >= 4 && pulse < 0.35) continue;      // blink for the worst
    px(g, bx, by, r * 1.4, r * 1.4, col);
    px(g, bx + r * 0.35, by + r * 0.35, r * 0.7, r * 0.7, '#000000aa');
  }
}

// Tells you there is more world than viewport, and where you are looking. A
// board that silently crops half the cluster is worse than one that scrolls.
function drawNavHint(g, ctx) {
  const { pal, q } = ctx;
  if (!cam.canScroll()) return;

  const w = 44, h = 30;
  const x = SCENE.x + SCENE.w - w - 4, y = SCENE.y + SCENE.h - h - 26;
  px(g, x, y, w, h, 'rgba(0,0,0,0.55)');

  // Minimap: the whole world, with the viewport rectangle inside it.
  const sx = (w - 6) / cam.world.w, sy = (h - 12) / cam.world.h;
  const k = Math.min(sx, sy);
  const mw = cam.world.w * k, mh = cam.world.h * k;
  const mx = x + (w - mw) / 2, my = y + 3;
  px(g, mx, my, mw, mh, 'rgba(255,255,255,0.14)');
  const vw = Math.min(cam.world.w, SCENE.w / cam.zoom) * k;
  const vh = Math.min(cam.world.h, SCENE.h / cam.zoom) * k;
  rect(g, mx + cam.x * k, my + cam.y * k, Math.max(2, vw), Math.max(2, vh), pal.accent, q.hi ? 0.5 : 1);

  text(g, `WASD  ${cam.zoomLabel}`, x + 3, y + h - 8, pal.dim, 5);
}

// Pods with no node yet hover above the scene waiting for somewhere to go.
function drawQueueCloud(g, world, ctx) {
  const { pal, q, t, skin } = ctx;
  let waiting = 0;
  for (let i = 0; i < world.pods.length; i++) if (!world.pods[i].node) waiting++;
  if (!waiting) return;

  // Say what they are waiting FOR. "2 CRITTERS WAITING" on its own is a riddle.
  const label = `${waiting} ${skin.vocab.pods} WAITING FOR A ${skin.vocab.node}`;
  const n = Math.min(waiting, 14);
  const lw = textW(g, label, 5);
  const dots = n * 8;
  const bw = Math.max(lw, dots) + 12;
  const bx = Math.round((SCENE.w - bw) / 2);

  px(g, bx, 3, bw, 18, 'rgba(0,0,0,0.55)');
  text(g, label, bx + (bw - lw) / 2, 5, pal.warn, 5);
  for (let i = 0; i < n; i++) {
    px(g, bx + (bw - dots) / 2 + i * 8, 13 + Math.sin(t * 0.003 + i) * 2, 4, 4, pal.dim);
  }
}

// Every pod now gets a sprite, so this should normally draw nothing. It stays as
// a safety valve: if the runaway guard in world.js is ever hit, the board says so
// instead of quietly showing a partial cluster.
const shown = new Map();
function drawOverflow(g, ctx) {
  const { pal } = ctx;
  shown.clear();
  for (const u of model.units.values()) {
    if (u.pod && u.pod.node) shown.set(u.pod.node, (shown.get(u.pod.node) || 0) + 1);
  }
  for (const l of model.layout) {
    const extra = l.node.pods.count - (shown.get(l.node.name) || 0);
    if (extra <= 0) continue;
    const s = `+${extra}`;
    const w = textW(g, s, 6);
    px(g, l.rect.x + l.rect.w - w - 4, l.rect.y + l.rect.h - 9, w + 3, 8, 'rgba(0,0,0,0.67)');
    text(g, s, l.rect.x + l.rect.w - w - 2, l.rect.y + l.rect.h - 8, pal.warn, 6);
  }
}

// Debug hook: lets the layout and sprite positions be inspected from the console.
window.__k8sfarmDebug = () => ({
  view: viewId, tier: tierId, skin: skinId,
  fps: Math.round(fps), rawDt: Math.round(rawDt), worstDt: Math.round(worstDt), drawErrors,
  cam: { x: +cam.x.toFixed(1), y: +cam.y.toFixed(1), zoom: cam.zoom,
         world: { w: Math.round(cam.world.w), h: Math.round(cam.world.h) }, canScroll: cam.canScroll() },
  layout: model.layout.map((l) => ({ name: l.node.name, rect: l.rect, pods: l.node.pods.count,
                                     spriteSize: l.metrics && +l.metrics.size.toFixed(2),
                                     cols: l.metrics && l.metrics.cols, rows: l.metrics && l.metrics.rows,
                                     rh: +l.rect.h.toFixed(1), rw: +l.rect.w.toFixed(1) })),
  units: [...model.units.entries()].map(([uid, u]) => ({
    uid, node: u.node, slot: u.slot, x: u.x, y: u.y, tx: u.tx, ty: u.ty, dying: !!u.dying,
  })),
});

// Wait for the pixel font so the first frame is not drawn in a fallback face.
if (document.fonts && document.fonts.load) {
  document.fonts.load('8px PixelFont').catch(() => {}).finally(() => requestAnimationFrame(frame));
} else {
  requestAnimationFrame(frame);
}
