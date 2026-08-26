'use strict';
const { parseCpu, parseMem, podResources, podHoldsResources } = require('./quantity.js');
const { podKind, ownerKey, isReady, isCrashLoop } = require('./transitions.js');

// Folds the raw node/pod maps plus the metrics samples into the compact state
// the browser renders. Only fields the UI actually draws are included, which
// keeps the SSE payload small on a cluster with hundreds of pods.


// Node names on managed clusters are mostly boilerplate:
//   gke-prod-cluster--web-pool-1a2b3c4d-x7q9
// The distinguishing part is the POOL, not the trailing hash, so showing the
// last two segments (as a naive truncation does) hides the only useful bit.
// Strip the prefix every node shares, then drop the instance hash suffix.
function displayNames(names) {
  const out = new Map();
  if (!names.length) return out;

  const split = names.map((n) => n.split('-'));
  let common = 0;
  if (split.length > 1) {
    const first = split[0];
    outer: for (; common < first.length - 1; common++) {
      for (const parts of split) {
        if (parts.length <= common + 1 || parts[common] !== first[common]) break outer;
      }
    }
  }

  const bare = new Map();
  for (let i = 0; i < names.length; i++) {
    let parts = split[i].slice(common).filter(Boolean);
    // Managed node names end with "-<poolHash>-<instance>", e.g.
    // "...-mongobetween-poo-bf3f2607-bruz". The instance tag often has no digit
    // at all, so it has to be matched by shape rather than by content.
    if (parts.length > 2 && /^[a-z0-9]{4,5}$/.test(parts[parts.length - 1])) parts.pop();
    if (parts.length > 1 && /^[0-9a-f]{6,10}$/.test(parts[parts.length - 1])) parts.pop();
    // A leading cluster-version segment ("2-flash-package") carries no meaning.
    while (parts.length > 1 && /^\d+$/.test(parts[0])) parts.shift();
    if (!parts.length) parts = split[i].slice(-2);
    bare.set(names[i], parts.join('-'));
  }

  // Several nodes usually share a pool, so re-attach a short instance tag.
  const counts = new Map();
  for (const v of bare.values()) counts.set(v, (counts.get(v) || 0) + 1);
  for (const name of names) {
    const base = bare.get(name);
    if ((counts.get(base) || 0) > 1) {
      const tail = name.split('-').pop().slice(0, 4);
      out.set(name, `${base}/${tail}`);
    } else {
      out.set(name, base);
    }
  }
  return out;
}

function nodeRoles(node) {
  const labels = (node.metadata && node.metadata.labels) || {};
  const roles = [];
  for (const k of Object.keys(labels)) {
    if (k.startsWith('node-role.kubernetes.io/')) roles.push(k.slice('node-role.kubernetes.io/'.length));
  }
  if (labels['kubernetes.io/role']) roles.push(labels['kubernetes.io/role']);
  return roles;
}

function nodePressures(node) {
  const conds = (node.status && node.status.conditions) || [];
  const out = [];
  for (const c of conds) {
    if (c.status === 'True' && c.type !== 'Ready' && /Pressure|Unavailable/.test(c.type)) out.push(c.type);
  }
  return out;
}

function podPhaseOf(pod) {
  if (pod.metadata.deletionTimestamp) return 'Terminating';
  const phase = (pod.status && pod.status.phase) || 'Unknown';
  if (phase === 'Running' && isCrashLoop(pod)) return 'CrashLoop';
  if (phase === 'Pending' && isCrashLoop(pod)) return 'CrashLoop';
  return phase;
}

function buildWorld({ nodes, pods, nodeMetrics, podMetrics, config, link, context }) {
  const nsAllow = (config.namespaces && config.namespaces.include) || [];
  const nsDeny = (config.namespaces && config.namespaces.exclude) || [];
  const nsDim = new Set((config.namespaces && config.namespaces.dim) || []);

  const visible = (ns) => {
    if (nsDeny.includes(ns)) return false;
    if (nsAllow.length && !nsAllow.includes(ns)) return false;
    return true;
  };

  const outNodes = [];
  const byNode = new Map();
  const display = displayNames([...nodes.values()].map((n) => n.metadata.name));

  for (const node of nodes.values()) {
    const name = node.metadata.name;
    const alloc = (node.status && node.status.allocatable) || {};
    const cap = (node.status && node.status.capacity) || {};
    const conds = (node.status && node.status.conditions) || [];
    const rc = conds.find((c) => c.type === 'Ready');
    const entry = {
      name,
      display: display.get(name) || name,
      ready: !!(rc && rc.status === 'True'),
      unschedulable: !!(node.spec && node.spec.unschedulable),
      pressures: nodePressures(node),
      roles: nodeRoles(node),
      instance: (node.metadata.labels || {})['node.kubernetes.io/instance-type']
             || (node.metadata.labels || {})['beta.kubernetes.io/instance-type'] || '',
      createdAt: Date.parse(node.metadata.creationTimestamp || '') || 0,
      // Three distinct layers, never conflated.
      cpu: { allocatable: parseCpu(alloc.cpu), capacity: parseCpu(cap.cpu), requests: 0, limits: 0, usage: null },
      mem: { allocatable: parseMem(alloc.memory), capacity: parseMem(cap.memory), requests: 0, limits: 0, usage: null },
      pods: { count: 0, max: parseCpu(alloc.pods) || 110 },
      taints: ((node.spec && node.spec.taints) || []).length,
    };
    outNodes.push(entry);
    byNode.set(name, entry);
  }

  const outPods = [];
  const counts = { running: 0, pending: 0, succeeded: 0, failed: 0, crashloop: 0, terminating: 0, total: 0 };
  const ownerCounts = new Map();

  for (const pod of pods.values()) {
    const ns = pod.metadata.namespace;
    const shown = visible(ns);

    const nodeName = (pod.spec && pod.spec.nodeName) || null;
    const req = podResources(pod, 'requests');
    const lim = podResources(pod, 'limits');
    const phase = podPhaseOf(pod);
    const holds = podHoldsResources(pod);
    const kind = podKind(pod);

    // Only scheduled, unfinished pods consume node allocatable.
    if (nodeName && holds) {
      const n = byNode.get(nodeName);
      if (n) {
        n.cpu.requests += req.cpu; n.cpu.limits += lim.cpu;
        n.mem.requests += req.mem; n.mem.limits += lim.mem;
        n.pods.count += 1;
      }
    }

    // Hidden namespaces are hidden from the SCENE only. Their requests are
    // real and the node is genuinely that full, so the rollup above always
    // includes them -- otherwise the allocation bars would understate reality.
    if (!shown) continue;

    counts.total++;
    if (phase === 'Running') counts.running++;
    else if (phase === 'Pending') counts.pending++;
    else if (phase === 'Succeeded') counts.succeeded++;
    else if (phase === 'Failed') counts.failed++;
    else if (phase === 'CrashLoop') counts.crashloop++;
    else if (phase === 'Terminating') counts.terminating++;

    const ok = ownerKey(pod);
    ownerCounts.set(ok, (ownerCounts.get(ok) || 0) + 1);

    const m = podMetrics.get(`${ns}/${pod.metadata.name}`);
    let restarts = 0;
    for (const c of (pod.status && pod.status.containerStatuses) || []) restarts += c.restartCount || 0;

    outPods.push({
      uid: pod.metadata.uid,
      name: pod.metadata.name,
      ns,
      node: nodeName,
      phase,
      ready: isReady(pod),
      restarts,
      kind,
      owner: ok,
      // A pod with no CPU request at all is BestEffort: it burns real CPU the
      // scheduler cannot see. The renderer draws these outside the fence.
      besteffort: req.cpu === 0 && req.mem === 0,
      cpuReq: req.cpu, memReq: req.mem,
      cpuUse: m ? m.cpu : null, memUse: m ? m.mem : null,
      dim: nsDim.has(ns),
      age: Date.parse(pod.metadata.creationTimestamp || '') || 0,
    });
  }

  // Node usage comes from node metrics only. Summing pod usage would omit
  // kubelet, the container runtime and the OS, and understate every node.
  let anyUsage = false;
  for (const n of outNodes) {
    const m = nodeMetrics.get(n.name);
    if (m) { n.cpu.usage = m.cpu; n.mem.usage = m.mem; anyUsage = true; }
  }

  const totals = { cpuAlloc: 0, cpuReq: 0, cpuLim: 0, cpuUse: 0,
                   memAlloc: 0, memReq: 0, memLim: 0, memUse: 0,
                   podCount: 0, podMax: 0, nodesReady: 0 };
  for (const n of outNodes) {
    totals.cpuAlloc += n.cpu.allocatable; totals.cpuReq += n.cpu.requests; totals.cpuLim += n.cpu.limits;
    totals.memAlloc += n.mem.allocatable; totals.memReq += n.mem.requests; totals.memLim += n.mem.limits;
    totals.cpuUse += n.cpu.usage || 0;    totals.memUse += n.mem.usage || 0;
    totals.podCount += n.pods.count;      totals.podMax += n.pods.max;
    if (n.ready && !n.unschedulable) totals.nodesReady++;
  }

  outNodes.sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0);

  return {
    t: Date.now(),
    context,
    link,
    nodes: outNodes,
    pods: outPods,
    counts,
    totals,
    hasUsage: anyUsage,
    scaleGroups: [...ownerCounts.entries()].map(([k, v]) => ({ owner: k, n: v })),
  };
}


// ---- pod detail -----------------------------------------------------------
// Everything a viewer needs to answer "what is this thing and why is it like
// that", assembled from the pod object already in memory.
function containerDetail(c, statuses, field) {
  const st = (statuses || []).find((x) => x.name === c.name) || {};
  const req = (c.resources && c.resources.requests) || {};
  const lim = (c.resources && c.resources.limits) || {};

  // The state machine is where a crashloop explains itself: the CURRENT state
  // says "waiting/CrashLoopBackOff", but the reason it died is in lastState.
  let state = 'unknown', reason = '', detailMsg = '', exitCode = null, since = null;
  const s = st.state || {};
  if (s.running) { state = 'running'; since = s.running.startedAt || null; }
  else if (s.waiting) { state = 'waiting'; reason = s.waiting.reason || ''; detailMsg = s.waiting.message || ''; }
  else if (s.terminated) {
    state = 'terminated'; reason = s.terminated.reason || '';
    exitCode = s.terminated.exitCode; detailMsg = s.terminated.message || '';
  }
  const last = (st.lastState && st.lastState.terminated) || null;

  return {
    name: c.name,
    image: String(c.image || '').slice(0, 120),
    ready: !!st.ready,
    restarts: st.restartCount || 0,
    state, reason, since,
    exitCode,
    message: String(detailMsg || '').slice(0, 200),
    lastExit: last ? { reason: last.reason || '', exitCode: last.exitCode,
                       at: last.finishedAt || null,
                       signal: last.signal || null } : null,
    cpuReq: parseCpu(req.cpu), memReq: parseMem(req.memory),
    cpuLim: parseCpu(lim.cpu), memLim: parseMem(lim.memory),
  };
}

// QoS follows from the requests/limits, and is why a pod gets evicted first.
function qosClass(pod) {
  const all = [].concat(pod.spec.containers || [], pod.spec.initContainers || []);
  if (!all.length) return 'BestEffort';
  let anyReq = false, allGuaranteed = true;
  for (const c of all) {
    const r = (c.resources && c.resources.requests) || {};
    const l = (c.resources && c.resources.limits) || {};
    const rc = parseCpu(r.cpu), rm = parseMem(r.memory);
    const lc = parseCpu(l.cpu), lm = parseMem(l.memory);
    if (rc > 0 || rm > 0 || lc > 0 || lm > 0) anyReq = true;
    if (!(lc > 0 && lm > 0 && lc === rc && lm === rm)) allGuaranteed = false;
  }
  if (!anyReq) return 'BestEffort';
  return allGuaranteed ? 'Guaranteed' : 'Burstable';
}

function buildPodDetail(pod, podMetrics, recentEvents) {
  const m = pod.metadata || {};
  const spec = pod.spec || {};
  const status = pod.status || {};
  const ns = m.namespace;
  const name = m.name;

  const req = podResources(pod, 'requests');
  const lim = podResources(pod, 'limits');
  const use = (podMetrics && podMetrics.get(`${ns}/${name}`)) || null;

  const events = (recentEvents || [])
    .filter((e) => e.ns === ns && e.name === name)
    .slice(-8)
    .reverse();

  const owner = (m.ownerReferences || [])[0];

  return {
    uid: m.uid,
    name, ns,
    node: spec.nodeName || null,
    phase: podPhaseOf(pod),
    rawPhase: status.phase || 'Unknown',
    ready: isReady(pod),
    qos: status.qosClass || qosClass(pod),
    kind: podKind(pod),
    owner: owner ? `${owner.kind}/${owner.name}` : null,
    created: Date.parse(m.creationTimestamp || '') || 0,
    startedAt: Date.parse(status.startTime || '') || 0,
    terminating: !!m.deletionTimestamp,
    nominatedNode: status.nominatedNodeName || null,
    podIP: status.podIP || null,
    reason: status.reason || '',
    message: String(status.message || '').slice(0, 240),
    // The effective totals, computed the same way the node rollup does -- so a
    // pod's numbers here always agree with the plot it is standing on.
    cpuReq: req.cpu, memReq: req.mem,
    cpuLim: lim.cpu, memLim: lim.mem,
    cpuUse: use ? use.cpu : null,
    memUse: use ? use.mem : null,
    containers: (spec.containers || []).map((c) => containerDetail(c, status.containerStatuses)),
    initContainers: (spec.initContainers || []).map((c) => ({
      ...containerDetail(c, status.initContainerStatuses),
      sidecar: c.restartPolicy === 'Always',
    })),
    conditions: (status.conditions || []).map((c) => ({
      type: c.type, status: c.status, reason: c.reason || '',
      message: String(c.message || '').slice(0, 160),
    })),
    events,
  };
}

// `kubectl top` output -> maps. Tolerates the header line and missing columns.
function parseTopNodes(text) {
  const out = new Map();
  const lines = String(text).trim().split('\n');
  for (const line of lines.slice(1)) {
    const p = line.trim().split(/\s+/);
    if (p.length < 4) continue;
    out.set(p[0], { cpu: parseCpu(p[1]), mem: parseMem(p[3]) });
  }
  return out;
}

function parseTopPods(text) {
  const out = new Map();
  const lines = String(text).trim().split('\n');
  for (const line of lines.slice(1)) {
    const p = line.trim().split(/\s+/);
    if (p.length < 4) continue;
    out.set(`${p[0]}/${p[1]}`, { cpu: parseCpu(p[2]), mem: parseMem(p[3]) });
  }
  return out;
}

module.exports = { buildWorld, parseTopNodes, parseTopPods, buildPodDetail, qosClass };
