'use strict';
const { createTransitions } = require('./transitions.js');
const { buildWorld, buildPodDetail } = require('./world.js');

// A synthetic cluster that deliberately drives every lifecycle transition on a
// loop, so all three skins and the whole animation path can be verified with no
// cluster and no credentials.
function hashish(str) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
  return h >>> 0;
}

function createDemoCollector({ config, onTransition, onLinkChange }) {
  const nodes = new Map();
  const pods = new Map();
  const nodeMetrics = new Map();
  const podMetrics = new Map();
  let uidSeq = 0, nodeSeq = 0, tick = 0;
  let priming = true;

  const link = { ok: true, error: null, since: Date.now(), streams: { demo: 'ok' }, demo: true };
  const transitions = createTransitions({ onEvent: (e) => { if (!priming) onTransition(e); } });

  const rnd = (() => { let s = 12345; return () => (s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff; })();
  const pick = (a) => a[Math.floor(rnd() * a.length) % a.length];

  const NS = ['default', 'kube-system', 'payments', 'ingest', 'web', 'batch'];
  const DEPLOYS = [
    { ns: 'web', name: 'storefront', cpu: '250m', mem: '512Mi', replicas: 6 },
    { ns: 'web', name: 'edge-cache', cpu: '100m', mem: '256Mi', replicas: 3 },
    { ns: 'payments', name: 'ledger', cpu: '500m', mem: '1Gi', replicas: 4 },
    { ns: 'payments', name: 'settle', cpu: '1', mem: '2Gi', replicas: 2 },
    { ns: 'ingest', name: 'collector', cpu: '300m', mem: '768Mi', replicas: 5 },
    { ns: 'default', name: 'scratch', cpu: null, mem: null, replicas: 2 },        // BestEffort
    { ns: 'kube-system', name: 'kube-dns', cpu: '100m', mem: '128Mi', replicas: 2 },
    { ns: 'kube-system', name: 'metrics-server', cpu: '50m', mem: '128Mi', replicas: 1 },
  ];

  function makeNode(sizeIdx) {
    const sizes = [[4, 16], [8, 32], [16, 64], [2, 8]];
    const [c, g] = sizes[sizeIdx % sizes.length];
    const name = `gke-farm-pool-${String(++nodeSeq).padStart(2, '0')}`;
    const n = {
      kind: 'Node',
      metadata: { name, labels: { 'node.kubernetes.io/instance-type': `n2-standard-${c}` },
                  creationTimestamp: new Date(Date.now() - 86400000 * (1 + sizeIdx)).toISOString() },
      spec: {},
      status: {
        allocatable: { cpu: String(c * 1000 - 320) + 'm', memory: String(g * 1024 - 1800) + 'Mi', pods: '110' },
        capacity: { cpu: String(c), memory: `${g}Gi`, pods: '110' },
        conditions: [{ type: 'Ready', status: 'True' }],
      },
    };
    nodes.set(name, n);
    transitions.onNode('ADDED', n);
    return n;
  }

  function makePod(dep, nodeName) {
    const uid = 'demo-' + (++uidSeq);
    const rs = `${dep.name}-${((uidSeq * 7919 + 104729) % 99991).toString(36)}`;
    const p = {
      kind: 'Pod',
      metadata: { uid, name: `${rs}-${(hashish(uid) % 46655).toString(36).padStart(3, '0')}`,
                  namespace: dep.ns, creationTimestamp: new Date().toISOString(),
                  ownerReferences: [{ kind: dep.kind === 'job' ? 'Job' : 'ReplicaSet', name: rs }] },
      spec: { nodeName, containers: [{ name: 'app',
              resources: { requests: dep.cpu ? { cpu: dep.cpu, memory: dep.mem } : {},
                           limits: dep.cpu ? { cpu: dep.cpu, memory: dep.mem } : {} } }] },
      status: { phase: 'Pending', conditions: [{ type: 'Ready', status: 'False' }],
                containerStatuses: [{ name: 'app', restartCount: 0 }] },
    };
    pods.set(uid, p);
    transitions.onPod('ADDED', p);
    return p;
  }

  function nodeNames() { return [...nodes.keys()]; }
  function livePods() { return [...pods.values()].filter(p => p.status.phase !== 'Succeeded'); }

  // A real cluster hovers around a steady pod count. Without this the demo
  // would grow without bound and stop looking like anything real.
  const TARGET_PODS = 34;
  function trimToTarget() {
    const live = livePods();
    let excess = live.length - TARGET_PODS;
    if (excess <= 0) return;
    // Retire the oldest non-system pods first.
    const candidates = live
      .filter(p => p.metadata.namespace !== 'kube-system')
      .sort((a, b) => Date.parse(a.metadata.creationTimestamp) - Date.parse(b.metadata.creationTimestamp));
    for (const p of candidates) {
      if (excess-- <= 0) break;
      if (!pods.has(p.metadata.uid)) continue;
      pods.delete(p.metadata.uid);
      transitions.onPod('DELETED', p);
    }
  }

  function ready(p) {
    p.status.phase = 'Running';
    p.status.conditions = [{ type: 'Ready', status: 'True' }];
    transitions.onPod('MODIFIED', p);
  }

  // Seed a plausible cluster.
  for (let i = 0; i < 6; i++) makeNode(i);
  for (const d of DEPLOYS) {
    for (let i = 0; i < d.replicas; i++) { const p = makePod(d, pick(nodeNames())); ready(p); }
  }
  setTimeout(() => { priming = false; }, 500);

  // The demo script: one action per beat, cycling through every transition the
  // renderer needs to handle.
  const script = [
    () => { const d = pick(DEPLOYS); const p = makePod(d, pick(nodeNames())); setTimeout(() => ready(p), 1200); },
    () => { const p = pick(livePods()); if (!p) return;
            p.status.containerStatuses[0].restartCount++; transitions.onPod('MODIFIED', p); },
    () => { const p = pick(livePods()); if (!p) return;
            p.status.containerStatuses[0].state = { waiting: { reason: 'CrashLoopBackOff' } };
            p.status.containerStatuses[0].restartCount += 2;
            transitions.onPod('MODIFIED', p);
            setTimeout(() => { if (pods.has(p.metadata.uid)) {
              delete p.status.containerStatuses[0].state; ready(p); } }, 9000); },
    () => { // a Job runs and completes -- success, not a death
            const p = makePod({ ns: 'batch', name: 'nightly-report', cpu: '200m', mem: '256Mi', kind: 'job' }, pick(nodeNames()));
            ready(p);
            setTimeout(() => { p.status.phase = 'Succeeded'; transitions.onPod('MODIFIED', p);
              setTimeout(() => { pods.delete(p.metadata.uid); transitions.onPod('DELETED', p); }, 6000); }, 5000); },
    () => { const p = pick(livePods()); if (!p) return;
            p.metadata.deletionTimestamp = new Date().toISOString();
            transitions.onPod('MODIFIED', p);
            setTimeout(() => { pods.delete(p.metadata.uid); transitions.onPod('DELETED', p); }, 3000); },
    () => { const p = pick(livePods()); if (!p) return;               // reschedule
            const to = pick(nodeNames().filter(n => n !== p.spec.nodeName));
            if (!to) return; p.spec.nodeName = to; transitions.onPod('MODIFIED', p); },
    () => { const d = pick(DEPLOYS); const n = 4 + Math.floor(rnd() * 8);   // scale-up burst
            transitions.onK8sEvent('ADDED', { metadata: { uid: 'ev' + (++uidSeq), namespace: d.ns },
              reason: 'ScalingReplicaSet', count: 1,
              message: `Scaled up replica set ${d.name} to ${n}`,
              involvedObject: { kind: 'Deployment', name: d.name, namespace: d.ns } });
            for (let i = 0; i < n; i++) {
              const p = makePod(d, pick(nodeNames())); setTimeout(() => ready(p), 400 + i * 180); } },
    () => { const victims = livePods().slice(0, 3 + Math.floor(rnd() * 5));   // scale-down
            transitions.onK8sEvent('ADDED', { metadata: { uid: 'ev' + (++uidSeq), namespace: 'web' },
              reason: 'ScalingReplicaSet', count: 1, message: `Scaled down replica set storefront to 2`,
              involvedObject: { kind: 'Deployment', name: 'storefront', namespace: 'web' } });
            victims.forEach((p, i) => setTimeout(() => {
              if (!pods.has(p.metadata.uid)) return;
              pods.delete(p.metadata.uid); transitions.onPod('DELETED', p); }, i * 250)); },
    () => { const n = makeNode(Math.floor(rnd() * 4));                        // cluster scale-up
            transitions.onK8sEvent('ADDED', { metadata: { uid: 'ev' + (++uidSeq), namespace: 'default' },
              reason: 'TriggeredScaleUp', count: 1, message: 'pod triggered scale-up: 1 node added',
              involvedObject: { kind: 'Pod', name: 'pending-pod', namespace: 'default' } }); },
    () => { const names = nodeNames(); if (names.length <= 4) return;         // drain + remove
            const victim = names[names.length - 1]; const n = nodes.get(victim);
            n.spec.unschedulable = true; transitions.onNode('MODIFIED', n);
            const residents = [...pods.values()].filter(p => p.spec.nodeName === victim);
            residents.forEach((p, i) => setTimeout(() => {
              const to = pick(nodeNames().filter(x => x !== victim));
              if (to && pods.has(p.metadata.uid)) { p.spec.nodeName = to; transitions.onPod('MODIFIED', p); }
            }, i * 300));
            setTimeout(() => { nodes.delete(victim); transitions.onNode('DELETED', n); },
                       2000 + residents.length * 300); },
    () => { const p = pick(livePods()); if (!p) return;                       // eviction
            transitions.onK8sEvent('ADDED', { metadata: { uid: 'ev' + (++uidSeq), namespace: p.metadata.namespace },
              reason: 'Evicted', count: 1, message: 'The node was low on resource: memory',
              involvedObject: { kind: 'Pod', name: p.metadata.name, namespace: p.metadata.namespace } });
            pods.delete(p.metadata.uid); transitions.onPod('DELETED', p); },
    () => { const n = nodes.get(pick(nodeNames()));                            // node goes NotReady
            n.status.conditions = [{ type: 'Ready', status: 'False' }];
            transitions.onNode('MODIFIED', n);
            setTimeout(() => { if (nodes.has(n.metadata.name)) {
              n.status.conditions = [{ type: 'Ready', status: 'True' }]; transitions.onNode('MODIFIED', n); } }, 12000); },
    () => { const p = pick(livePods()); if (!p) return;                        // unschedulable
            transitions.onK8sEvent('ADDED', { metadata: { uid: 'ev' + (++uidSeq), namespace: 'batch' },
              reason: 'FailedScheduling', count: 1,
              message: '0/6 nodes are available: insufficient cpu',
              involvedObject: { kind: 'Pod', name: 'huge-job-xyz', namespace: 'batch' } }); },
  ];

  function refreshMetrics() {
    // Usage wanders around requests, sometimes above (throttling territory),
    // sometimes far below (overcommitted requests) -- both are worth seeing.
    for (const n of nodes.values()) {
      const w = buildWorld({ nodes: new Map([[n.metadata.name, n]]), pods,
        nodeMetrics: new Map(), podMetrics: new Map(), config, link, context: 'demo' });
      const nn = w.nodes[0];
      const drift = 0.45 + 0.75 * rnd();
      nodeMetrics.set(n.metadata.name, {
        cpu: Math.min(nn.cpu.allocatable, nn.cpu.requests * drift + 0.2),
        mem: Math.min(nn.mem.allocatable, nn.mem.requests * (0.5 + 0.6 * rnd()) + 256 * 1024 ** 2),
      });
    }
    for (const p of pods.values()) {
      podMetrics.set(`${p.metadata.namespace}/${p.metadata.name}`,
        { cpu: 0.02 + rnd() * 0.4, mem: (40 + rnd() * 300) * 1024 ** 2 });
    }
  }
  refreshMetrics();

  let timers = [];
  function start() {
    const beat = config.demoBeatMs || 2600;
    const t1 = setInterval(() => {
      try { script[tick++ % script.length](); } catch {}
      try { trimToTarget(); } catch {}
    }, beat);
    const t2 = setInterval(refreshMetrics, 4000);
    timers = [t1, t2];
    for (const t of timers) if (t.unref) t.unref();
    return Promise.resolve();
  }
  function stop() { for (const t of timers) clearInterval(t); }

  function snapshot() {
    transitions.reconcile(new Set(pods.keys()));
    return buildWorld({ nodes, pods, nodeMetrics, podMetrics, config,
                        link: { ...link }, context: 'demo-cluster (synthetic)' });
  }

  function podDetail(uid) {
    const pod = pods.get(uid);
    return pod ? buildPodDetail(pod, podMetrics, []) : null;
  }

  return { start, stop, snapshot, podDetail, isPriming: () => priming,
           stats: () => ({ nodes: nodes.size, pods: pods.size, tracked: transitions.size() }) };
}

module.exports = { createDemoCollector };
