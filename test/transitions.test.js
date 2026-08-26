'use strict';
const assert = require('node:assert');
const { test } = require('node:test');
const { createTransitions } = require('../server/transitions.js');

function mk(uid, over = {}) {
  return {
    metadata: { uid, name: over.name || 'p1', namespace: 'default', ...(over.meta || {}) },
    spec: { nodeName: over.node === undefined ? 'n1' : over.node },
    status: {
      phase: over.phase || 'Running',
      conditions: [{ type: 'Ready', status: over.ready === false ? 'False' : 'True' }],
      containerStatuses: over.cs || [{ name: 'app', restartCount: over.restarts || 0 }],
    },
  };
}
function collect() { const out = []; return { out, t: createTransitions({ onEvent: (e) => out.push(e) }) }; }

test('restart detected only on increase, within one uid', () => {
  const { out, t } = collect();
  t.onPod('ADDED', mk('u1', { restarts: 3 }));
  t.onPod('MODIFIED', mk('u1', { restarts: 3 }));      // no change
  assert.equal(out.filter(e => e.type === 'pod_restart').length, 0);
  t.onPod('MODIFIED', mk('u1', { restarts: 5 }));      // +2
  const r = out.filter(e => e.type === 'pod_restart');
  assert.equal(r.length, 1);
  assert.equal(r[0].delta, 2);
  assert.equal(r[0].restarts, 5);
});

test('a recreated pod with a fresh uid does not invent a restart', () => {
  const { out, t } = collect();
  t.onPod('ADDED', mk('u1', { restarts: 7 }));
  t.onPod('DELETED', mk('u1', { restarts: 7 }));
  t.onPod('ADDED', mk('u2', { restarts: 0 }));         // counter reset, new pod
  t.onPod('MODIFIED', mk('u2', { restarts: 0 }));
  assert.equal(out.filter(e => e.type === 'pod_restart').length, 0);
});

test('delete frees the tracking entry', () => {
  const { t } = collect();
  t.onPod('ADDED', mk('u1'));
  assert.equal(t.size(), 1);
  t.onPod('DELETED', mk('u1'));
  assert.equal(t.size(), 0);
});

test('scheduling, readiness and completion', () => {
  const { out, t } = collect();
  t.onPod('ADDED', mk('u1', { node: null, ready: false, phase: 'Pending' }));
  t.onPod('MODIFIED', mk('u1', { ready: false, phase: 'Pending' }));   // gains a node
  t.onPod('MODIFIED', mk('u1', { phase: 'Running' }));                  // becomes ready
  t.onPod('MODIFIED', mk('u1', { phase: 'Succeeded' }));
  const types = out.map(e => e.type);
  assert.ok(types.includes('pod_pending'));
  assert.ok(types.includes('pod_scheduled'));
  assert.ok(types.includes('pod_ready'));
  assert.ok(types.includes('pod_succeeded'));
});

test('crashloop fires once, not on every poll', () => {
  const { out, t } = collect();
  const cl = { cs: [{ name: 'app', restartCount: 1, state: { waiting: { reason: 'CrashLoopBackOff' } } }] };
  t.onPod('ADDED', mk('u1'));
  t.onPod('MODIFIED', mk('u1', cl));
  t.onPod('MODIFIED', mk('u1', cl));
  t.onPod('MODIFIED', mk('u1', cl));
  assert.equal(out.filter(e => e.type === 'pod_crashloop').length, 1);
});

test('pod moving node emits a move, not a delete+add', () => {
  const { out, t } = collect();
  t.onPod('ADDED', mk('u1', { node: 'n1' }));
  t.onPod('MODIFIED', mk('u1', { node: 'n2' }));
  const mv = out.find(e => e.type === 'pod_moved');
  assert.ok(mv); assert.equal(mv.from, 'n1'); assert.equal(mv.to, 'n2');
});

test('node cordon and readiness transitions', () => {
  const { out, t } = collect();
  const node = (ready, unsched) => ({
    metadata: { name: 'n1' }, spec: { unschedulable: unsched },
    status: { conditions: [{ type: 'Ready', status: ready ? 'True' : 'False' }] },
  });
  t.onNode('ADDED', node(true, false));
  t.onNode('MODIFIED', node(true, true));
  t.onNode('MODIFIED', node(false, true));
  t.onNode('DELETED', node(false, true));
  const types = out.map(e => e.type);
  assert.deepEqual(types, ['node_added', 'node_cordoned', 'node_notready', 'node_removed']);
});

test('k8s events: only interesting reasons, deduped by uid+count', () => {
  const { out, t } = collect();
  const ev = (uid, reason, count) => ({
    metadata: { uid, namespace: 'default' }, reason, count,
    message: 'Scaled up replica set web-abc to 6', involvedObject: { kind: 'Deployment', name: 'web', namespace: 'default' },
  });
  t.onK8sEvent('ADDED', ev('e1', 'Pulling', 1));            // noise, dropped
  t.onK8sEvent('ADDED', ev('e2', 'ScalingReplicaSet', 1));
  t.onK8sEvent('ADDED', ev('e2', 'ScalingReplicaSet', 1));  // watch replay, deduped
  t.onK8sEvent('ADDED', ev('e2', 'ScalingReplicaSet', 2));  // genuinely happened again
  assert.equal(out.filter(e => e.type === 'scale').length, 2);
});

test('reconcile drops tracking for pods that are no longer live', () => {
  const { t } = collect();
  t.onPod('ADDED', mk('u1'));
  t.onPod('ADDED', mk('u2'));
  t.onPod('ADDED', mk('u3'));
  assert.equal(t.size(), 3);
  // u2 vanished without a DELETED event (the watch-reconnect case).
  const dropped = t.reconcile(new Set(['u1', 'u3']));
  assert.equal(dropped, 1);
  assert.equal(t.size(), 2);
});

test('reconcile is a no-op when everything is still live', () => {
  const { t } = collect();
  t.onPod('ADDED', mk('u1'));
  assert.equal(t.reconcile(new Set(['u1'])), 0);
  assert.equal(t.size(), 1);
});

test('reconcile tolerates a bad argument rather than throwing', () => {
  const { t } = collect();
  t.onPod('ADDED', mk('u1'));
  assert.equal(t.reconcile(null), 0);
  assert.equal(t.reconcile(undefined), 0);
  assert.equal(t.size(), 1);
});

test('a pod removed by reconcile is treated as new if it comes back', () => {
  const { out, t } = collect();
  t.onPod('ADDED', mk('u1', { restarts: 4 }));
  t.reconcile(new Set());
  // Fresh tracking: the old restartCount must not be compared against.
  t.onPod('MODIFIED', mk('u1', { restarts: 4 }));
  assert.equal(out.filter(e => e.type === 'pod_restart').length, 0);
});
