'use strict';
// Turns raw object changes into typed lifecycle events (the things you watch
// happen on screen). Two sources feed this:
//   - object diffs, authoritative for WHAT a thing is
//   - the Events API, authoritative for WHY (scaling, eviction, autoscaling)
// Events have a ~1h TTL and are best-effort, so object state is never inferred
// from them; they only add reasons.

const MAX_QUEUE = 500;

function podKind(pod) {
  const or = (pod.metadata && pod.metadata.ownerReferences) || [];
  const kind = or.length ? or[0].kind : null;
  if (kind === 'Job') return 'job';
  if (kind === 'DaemonSet') return 'daemon';
  if (kind === 'StatefulSet') return 'stateful';
  if (kind === 'ReplicaSet') return 'deploy';
  if (kind === 'Node') return 'static';
  return 'bare';
}

function ownerKey(pod) {
  const or = (pod.metadata && pod.metadata.ownerReferences) || [];
  const ns = pod.metadata.namespace;
  if (!or.length) return `${ns}/${pod.metadata.name}`;
  // Collapse a ReplicaSet's generated suffix so rolling updates group together.
  const n = or[0].kind === 'ReplicaSet' ? or[0].name.replace(/-[a-z0-9]{6,10}$/, '') : or[0].name;
  return `${ns}/${n}`;
}

function containerStates(pod) {
  const st = pod.status || {};
  return [].concat(st.containerStatuses || [], st.initContainerStatuses || []);
}

function isCrashLoop(pod) {
  return containerStates(pod).some(
    (c) => c.state && c.state.waiting && c.state.waiting.reason === 'CrashLoopBackOff');
}

function isReady(pod) {
  const conds = (pod.status && pod.status.conditions) || [];
  const r = conds.find((c) => c.type === 'Ready');
  return !!(r && r.status === 'True');
}

function createTransitions({ onEvent }) {
  // Per-pod memory of the last observed shape. Bounded by live pod count:
  // entries are deleted on DELETED, so this cannot grow across 24h.
  const prev = new Map();       // uid -> { phase, ready, crash, node, restarts: Map<container,count> }
  const prevNode = new Map();   // name -> { ready, unschedulable }
  let seq = 0;

  function emit(type, payload) {
    onEvent({ id: ++seq, t: Date.now(), type, ...payload });
  }

  function podLabel(pod) {
    return { uid: pod.metadata.uid, name: pod.metadata.name, ns: pod.metadata.namespace,
             node: pod.spec && pod.spec.nodeName, kind: podKind(pod) };
  }

  function onPod(evType, pod) {
    if (!pod || !pod.metadata || !pod.metadata.uid) return;
    const uid = pod.metadata.uid;

    if (evType === 'DELETED') {
      prev.delete(uid);                       // keep the map bounded
      emit('pod_deleted', podLabel(pod));
      return;
    }

    const phase = (pod.status && pod.status.phase) || 'Unknown';
    const ready = isReady(pod);
    const crash = isCrashLoop(pod);
    const node = (pod.spec && pod.spec.nodeName) || null;
    const terminating = !!(pod.metadata.deletionTimestamp);

    // restartCount is cumulative per container and RESETS when a pod is
    // recreated under a new uid, so it is only ever compared within one uid.
    const restarts = new Map();
    for (const c of containerStates(pod)) restarts.set(c.name, c.restartCount || 0);

    const before = prev.get(uid);
    prev.set(uid, { phase, ready, crash, node, restarts, terminating });

    if (!before) {
      if (evType === 'ADDED') {
        // On startup the initial list arrives as a burst of ADDED events for
        // pods that already existed; those are not births. The server marks
        // the priming window so they are absorbed silently.
        emit(node ? 'pod_scheduled' : 'pod_pending', podLabel(pod));
      }
      return;
    }

    if (!before.node && node) emit('pod_scheduled', podLabel(pod));
    else if (before.node && node && before.node !== node)
      emit('pod_moved', { ...podLabel(pod), from: before.node, to: node });

    for (const [cname, count] of restarts) {
      const was = before.restarts.get(cname);
      if (was !== undefined && count > was)
        emit('pod_restart', { ...podLabel(pod), container: cname, restarts: count, delta: count - was });
    }

    if (!before.ready && ready) emit('pod_ready', podLabel(pod));
    if (!before.crash && crash) emit('pod_crashloop', podLabel(pod));
    if (!before.terminating && terminating) emit('pod_terminating', podLabel(pod));

    if (before.phase !== phase) {
      if (phase === 'Succeeded') emit('pod_succeeded', podLabel(pod));
      else if (phase === 'Failed') emit('pod_failed', { ...podLabel(pod),
        reason: (pod.status && pod.status.reason) || '' });
      else if (phase === 'Running' && before.phase === 'Pending') { /* covered by pod_ready */ }
    }
  }

  function onNode(evType, node) {
    if (!node || !node.metadata) return;
    const name = node.metadata.name;
    if (evType === 'DELETED') {
      prevNode.delete(name);
      emit('node_removed', { node: name });
      return;
    }
    const conds = (node.status && node.status.conditions) || [];
    const rc = conds.find((c) => c.type === 'Ready');
    const ready = !!(rc && rc.status === 'True');
    const unschedulable = !!(node.spec && node.spec.unschedulable);

    const before = prevNode.get(name);
    prevNode.set(name, { ready, unschedulable });
    if (!before) { if (evType === 'ADDED') emit('node_added', { node: name }); return; }

    if (before.ready !== ready) emit(ready ? 'node_ready' : 'node_notready', { node: name });
    if (before.unschedulable !== unschedulable)
      emit(unschedulable ? 'node_cordoned' : 'node_uncordoned', { node: name });
  }

  // Reasons worth surfacing. Everything else from the Events API is noise on a
  // wallboard (Pulling, Created, Started fire constantly).
  const EVENT_REASONS = new Map([
    ['ScalingReplicaSet', 'scale'],
    ['SuccessfulRescale', 'hpa'],
    ['TriggeredScaleUp', 'cluster_scale_up'],
    ['ScaleDown', 'cluster_scale_down'],
    ['NodeNotReady', 'node_notready'],
    ['Evicted', 'pod_evicted'],
    ['Preempted', 'pod_preempted'],
    ['FailedScheduling', 'pod_unschedulable'],
    ['OOMKilling', 'pod_oom'],
    ['NodeHasSufficientMemory', null],
  ]);

  const seenEvents = new Set();   // dedupe: watch replays events on reconnect
  const seenOrder = [];

  function onK8sEvent(evType, ev) {
    if (evType === 'DELETED' || !ev || !ev.metadata) return;
    const reason = ev.reason;
    const mapped = EVENT_REASONS.get(reason);
    if (!mapped) return;

    // Dedupe on uid+count so a repeated (count-incrementing) event still fires
    // once per occurrence, but a watch replay does not.
    const key = `${ev.metadata.uid}:${ev.count || 1}`;
    if (seenEvents.has(key)) return;
    seenEvents.add(key); seenOrder.push(key);
    if (seenOrder.length > 2000) seenEvents.delete(seenOrder.shift());   // bounded

    const obj = ev.involvedObject || {};
    emit(mapped, {
      reason,
      message: String(ev.message || '').slice(0, 200),
      ns: obj.namespace || ev.metadata.namespace,
      name: obj.name,
      objKind: obj.kind,
      node: obj.kind === 'Node' ? obj.name : undefined,
      fromEvents: true,
    });
  }

  function forget(uids) { for (const u of uids) prev.delete(u); }

  // Drop tracking for anything no longer live. A watch can miss a DELETE
  // across a reconnect, and relying on every delete path being perfect would
  // leave entries pinned for the life of the process. Called from the snapshot
  // path, so the map is bounded by the live pod count no matter what.
  function reconcile(liveUids) {
    if (!liveUids || typeof liveUids.has !== 'function') return 0;
    let dropped = 0;
    for (const uid of prev.keys()) {
      if (!liveUids.has(uid)) { prev.delete(uid); dropped++; }
    }
    return dropped;
  }

  return { onPod, onNode, onK8sEvent, forget, reconcile, podKind, ownerKey, isReady, isCrashLoop,
           size: () => prev.size };
}

module.exports = { createTransitions, podKind, ownerKey, isReady, isCrashLoop, MAX_QUEUE };
