'use strict';
const { createTransitions } = require('./transitions.js');
const { buildWorld, buildPodDetail, buildNodeDetail } = require('./world.js');

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

  const POOLS = ['regular-pool-1', 'spot-pool-3', 'kube-system-pool', 'gateway-pool',
                 'ingest-pool', 'qdrant-pool', 'monitoring-pool', 'batch-pool'];

  function makeNode(sizeIdx) {
    const sizes = [[4, 16], [8, 32], [16, 64], [2, 8]];
    const [c, g] = sizes[sizeIdx % sizes.length];
    // Managed-cluster shape: shared cluster prefix, a pool name, a pool hash and
    // an instance suffix. Uniform names would hide what label shortening does.
    const pool = POOLS[nodeSeq % POOLS.length];
    const hash = (nodeSeq * 2654435761 % 0xfffffff).toString(16).slice(0, 8);
    const inst = ((nodeSeq * 7919 + 104729) % 46655).toString(36).padStart(4, '0');
    nodeSeq++;
    const name = `gke-demo-cluster-${pool}-${hash}-${inst}`;
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

  // Place a pod on a node that can actually hold it, the way the scheduler
  // would. Picking a node at random overcommits the cluster and the board ends
  // up reporting 145% of CPU reserved, which is not a state Kubernetes allows.
  // When nothing has room the pod stays Pending -- also what really happens.
  function schedule(dep) {
    const want = parseCpuish(dep.cpu);
    const used = new Map();
    for (const p of pods.values()) {
      if (!p.spec.nodeName) continue;
      if (p.status.phase === 'Succeeded' || p.status.phase === 'Failed') continue;
      const r = parseCpuish((p.spec.containers[0].resources.requests || {}).cpu);
      used.set(p.spec.nodeName, (used.get(p.spec.nodeName) || 0) + r);
    }
    const room = [];
    for (const [name, n] of nodes) {
      if (n.spec.unschedulable) continue;
      const alloc = parseCpuish(n.status.allocatable.cpu);
      if ((used.get(name) || 0) + want <= alloc * 0.95) room.push(name);
    }
    return room.length ? pick(room) : null;
  }

  function parseCpuish(v) {
    if (!v) return 0;
    const str = String(v);
    return str.endsWith('m') ? parseFloat(str) / 1000 : parseFloat(str) || 0;
  }
  function livePods() { return [...pods.values()].filter(p => p.status.phase !== 'Succeeded'); }

  // A real cluster hovers around a steady pod count. Without this the demo
  // would grow without bound and stop looking like anything real.
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

  // Seed a plausible cluster. Size is configurable so the demo can stand in for
  // a small cluster or a busy one -- which is what makes it usable for
  // screenshots and for trying the density behaviour without a real cluster.
  const NODE_COUNT = Math.max(1, config.demoNodes || 6);
  const TARGET_PODS = Math.max(1, config.demoPods || 34);

  for (let i = 0; i < NODE_COUNT; i++) makeNode(i);
  {
    const base = DEPLOYS.reduce((a, d) => a + d.replicas, 0);
    const scale = Math.max(1, TARGET_PODS / base);
    for (const d of DEPLOYS) {
      const n = Math.max(1, Math.round(d.replicas * scale));
      for (let i = 0; i < n; i++) { const p = makePod(d, schedule(d)); if (p.spec.nodeName) ready(p); }
    }
  }
  setTimeout(() => { priming = false; }, 500);

  // The demo script: one action per beat, cycling through every transition the
  // renderer needs to handle.
  const script = [
    () => { const d = pick(DEPLOYS); const p = makePod(d, schedule(d));
            if (p.spec.nodeName) setTimeout(() => ready(p), 1200); },
    () => { const p = pick(livePods()); if (!p) return;
            p.status.containerStatuses[0].restartCount++; transitions.onPod('MODIFIED', p); },
    () => { const p = pick(livePods()); if (!p) return;
            p.status.containerStatuses[0].state = { waiting: { reason: 'CrashLoopBackOff' } };
            p.status.containerStatuses[0].restartCount += 2;
            transitions.onPod('MODIFIED', p);
            setTimeout(() => { if (pods.has(p.metadata.uid)) {
              delete p.status.containerStatuses[0].state; ready(p); } }, 9000); },
    () => { // a Job runs and completes -- success, not a death
            const jd = { ns: 'batch', name: 'nightly-report', cpu: '200m', mem: '256Mi', kind: 'job' };
            const p = makePod(jd, schedule(jd));
            if (!p.spec.nodeName) return;
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
              const p = makePod(d, schedule(d));
              if (p.spec.nodeName) setTimeout(() => ready(p), 400 + i * 180); } },
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
    () => { const names = nodeNames(); if (names.length <= NODE_COUNT) return;   // drain + remove
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
      const r = rnd();
      // Squared: clusters are mostly idle relative to what they reserved.
      const drift = 0.10 + 0.55 * r * r;
      nodeMetrics.set(n.metadata.name, {
        cpu: Math.min(nn.cpu.allocatable, nn.cpu.requests * drift + 0.05),
        mem: Math.min(nn.mem.allocatable, nn.mem.requests * (0.35 + 0.4 * rnd()) + 128 * 1024 ** 2),
      });
    }
    for (const p of pods.values()) {
      const req = parseFloat(((p.spec.containers[0].resources.requests || {}).cpu || '0').replace('m', '')) || 0;
      const reqCores = String((p.spec.containers[0].resources.requests || {}).cpu || '').includes('m')
        ? req / 1000 : req;
      const r = rnd();
      // Most well under their request; about one in twenty over it, which is the
      // ratio worth showing rather than half the cluster on fire.
      const ratio = r > 0.95 ? 1.05 + rnd() * 0.9 : 0.05 + 0.45 * r * r;
      const base = reqCores > 0 ? reqCores : 0.04;
      podMetrics.set(`${p.metadata.namespace}/${p.metadata.name}`,
        { cpu: base * ratio, mem: (40 + rnd() * 300) * 1024 ** 2 });
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

  function nodeDetail(name) {
    const node = nodes.get(name);
    return node ? buildNodeDetail(node, nodeMetrics, pods, [], config) : null;
  }

  return { start, stop, snapshot, podDetail, nodeDetail, isPriming: () => priming,
           stats: () => ({ nodes: nodes.size, pods: pods.size, tracked: transitions.size() }) };
}

module.exports = { createDemoCollector };
