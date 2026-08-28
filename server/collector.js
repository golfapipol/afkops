'use strict';
const { kubectlJson, kubectlText, createWatch, currentContext } = require('./kubectl.js');
const { createTransitions } = require('./transitions.js');
const { buildWorld, parseTopNodes, parseTopPods, buildPodDetail, buildNodeDetail } = require('./world.js');

// Owns the live picture of the cluster: watch streams keep the object maps
// current, a periodic resync heals anything a dropped watch missed, and
// `kubectl top` polls the usage layer (the metrics API has no watch).
function createCollector({ config, onTransition, onLinkChange }) {
  const nodes = new Map();
  const pods = new Map();
  let nodeMetrics = new Map();
  let podMetrics = new Map();
  let context = 'unknown';

  // During the initial burst every existing object arrives as ADDED. Those are
  // not births, so transitions are suppressed until the priming window closes.
  let priming = true;
  let primingTimer = null;

  // A small bounded ring of raw cluster events. The transitions layer only keeps
  // the handful of reasons worth animating; a pod detail view wants the noisy
  // ones too ("Pulling", "BackOff", "FailedScheduling: insufficient cpu"), which
  // is usually where the actual explanation lives.
  const EVENT_RING = 800;
  const recentEvents = [];
  function rememberEvent(ev) {
    const obj = ev.involvedObject || {};
    recentEvents.push({
      t: Date.parse(ev.lastTimestamp || ev.eventTime || ev.firstTimestamp || '') || Date.now(),
      ns: obj.namespace || (ev.metadata && ev.metadata.namespace) || '',
      name: obj.name || '',
      kind: obj.kind || '',
      reason: ev.reason || '',
      type: ev.type || '',
      count: ev.count || 1,
      message: String(ev.message || '').slice(0, 300),
    });
    if (recentEvents.length > EVENT_RING) recentEvents.splice(0, recentEvents.length - EVENT_RING);
  }

  const link = { ok: false, error: 'starting', since: Date.now(), streams: {} };
  const transitions = createTransitions({
    onEvent: (ev) => { if (!priming) onTransition(ev); },
  });

  function setLink(patch) {
    const wasOk = link.ok;
    Object.assign(link, patch);
    if (patch.ok !== undefined && patch.ok !== wasOk) {
      link.since = Date.now();
      onLinkChange && onLinkChange({ ...link });
    }
  }

  function streamStatus(s) {
    link.streams[s.name] = s.ok ? 'ok' : (s.error || 'down');
    const anyOk = Object.values(link.streams).some((v) => v === 'ok');
    if (anyOk && !link.ok) setLink({ ok: true, error: null });
    if (!anyOk && link.ok) setLink({ ok: false, error: s.error || 'watch closed' });
    if (!anyOk && s.error) link.error = s.error;
  }

  const watches = [];

  function startWatches() {
    watches.push(createWatch({
      name: 'nodes',
      args: ['get', 'nodes', '--watch', '--output-watch-events', '-o', 'json'],
      onStatus: streamStatus,
      onEvent: (type, obj) => {
        if (!obj || obj.kind !== 'Node' || !obj.metadata) return;
        if (type === 'DELETED') nodes.delete(obj.metadata.name);
        else nodes.set(obj.metadata.name, obj);
        transitions.onNode(type, obj);
      },
    }));

    watches.push(createWatch({
      name: 'pods',
      args: ['get', 'pods', '--all-namespaces', '--watch', '--output-watch-events', '-o', 'json'],
      onStatus: streamStatus,
      onEvent: (type, obj) => {
        if (!obj || obj.kind !== 'Pod' || !obj.metadata) return;
        if (type === 'DELETED') pods.delete(obj.metadata.uid);
        else pods.set(obj.metadata.uid, obj);
        transitions.onPod(type, obj);
      },
    }));

    watches.push(createWatch({
      name: 'events',
      args: ['get', 'events', '--all-namespaces', '--watch', '--output-watch-events', '-o', 'json'],
      onStatus: streamStatus,
      onEvent: (type, obj) => {
        if (!obj || obj.kind !== 'Event') return;
        if (type !== 'DELETED') rememberEvent(obj);
        transitions.onK8sEvent(type, obj);
      },
    }));

    for (const w of watches) w.start();
  }

  // Reconcile against a full list. A watch can miss deletes across a
  // reconnect, which would otherwise leave ghost pods on the farm forever.
  async function resync() {
    try {
      const [nl, pl] = await Promise.all([
        kubectlJson(['get', 'nodes', '-o', 'json'], { timeoutMs: 45000 }),
        kubectlJson(['get', 'pods', '--all-namespaces', '-o', 'json'], { timeoutMs: 60000 }),
      ]);
      const seenN = new Set();
      for (const n of nl.items || []) { nodes.set(n.metadata.name, n); seenN.add(n.metadata.name); }
      for (const k of [...nodes.keys()]) if (!seenN.has(k)) nodes.delete(k);

      const seenP = new Set();
      for (const p of pl.items || []) { pods.set(p.metadata.uid, p); seenP.add(p.metadata.uid); }
      const gone = [];
      for (const k of [...pods.keys()]) if (!seenP.has(k)) { pods.delete(k); gone.push(k); }
      transitions.forget(gone);

      setLink({ ok: true, error: null, lastSync: Date.now() });
    } catch (e) {
      setLink({ ok: false, error: String(e.message || e).split('\n')[0].slice(0, 300) });
    }
  }

  async function pollMetrics() {
    try {
      const txt = await kubectlText(['top', 'nodes', '--no-headers=false'], { timeoutMs: 20000 });
      nodeMetrics = parseTopNodes(txt);
    } catch { nodeMetrics = new Map(); }     // metrics-server absent: usage goes dark, nothing breaks
    try {
      const txt = await kubectlText(['top', 'pods', '--all-namespaces', '--no-headers=false'], { timeoutMs: 30000 });
      podMetrics = parseTopPods(txt);
    } catch { podMetrics = new Map(); }
  }

  let timers = [];
  async function start() {
    context = await currentContext();
    startWatches();
    primingTimer = setTimeout(() => { priming = false; }, config.primingMs || 4000);

    // Deliberately not awaited: the wallboard must come up and render its
    // offline state immediately even when the cluster is unreachable (expired
    // credentials, VPN down), rather than hanging on a 60s kubectl timeout.
    resync();
    pollMetrics();

    const t1 = setInterval(resync, config.resyncMs || 300000);
    const t2 = setInterval(pollMetrics, config.metricsMs || 30000);
    // Follow kubectl's current-context, per the design.
    const t3 = setInterval(async () => {
      const c = await currentContext();
      if (c !== context) { context = c; nodes.clear(); pods.clear(); resync(); }
    }, 30000);
    timers = [t1, t2, t3];
    for (const t of timers) if (t.unref) t.unref();
  }

  function stop() {
    for (const w of watches) w.stop();
    for (const t of timers) clearInterval(t);
    clearTimeout(primingTimer);
  }

  function snapshot() {
    // Keep the transition map pinned to reality on every snapshot.
    transitions.reconcile(new Set(pods.keys()));
    return buildWorld({ nodes, pods, nodeMetrics, podMetrics, config, link: { ...link }, context });
  }

  // Full detail for one pod, straight from the object already held in memory --
  // no extra cluster call, so clicking a pod costs nothing.
  function podDetail(uid) {
    const pod = pods.get(uid);
    if (!pod) return null;
    return buildPodDetail(pod, podMetrics, recentEvents);
  }

  function nodeDetail(name) {
    const node = nodes.get(name);
    return node ? buildNodeDetail(node, nodeMetrics, pods, recentEvents, config) : null;
  }

  return { start, stop, snapshot, podDetail, nodeDetail, isPriming: () => priming,
           stats: () => ({ nodes: nodes.size, pods: pods.size, tracked: transitions.size(),
                           events: recentEvents.length }) };
}

module.exports = { createCollector };
