'use strict';
const assert = require('node:assert');
const { test } = require('node:test');
const { buildWorld, parseTopNodes, parseTopPods } = require('../server/world.js');

const cfg = { namespaces: { include: [], exclude: [], dim: ['kube-system'] } };

function node(name, cpu, mem, pods = '110') {
  return { metadata: { name, labels: {}, creationTimestamp: '2024-01-01T00:00:00Z' }, spec: {},
    status: { allocatable: { cpu, memory: mem, pods }, capacity: { cpu, memory: mem, pods },
              conditions: [{ type: 'Ready', status: 'True' }] } };
}
function pod(uid, ns, nodeName, reqCpu, reqMem, phase = 'Running') {
  return { metadata: { uid, name: 'pod-' + uid, namespace: ns, creationTimestamp: '2024-01-01T00:00:00Z' },
    spec: { nodeName, containers: [{ resources: { requests: reqCpu ? { cpu: reqCpu, memory: reqMem } : {} } }] },
    status: { phase, conditions: [{ type: 'Ready', status: 'True' }], containerStatuses: [{ name: 'app', restartCount: 0 }] } };
}
const build = (nodes, pods, nm = new Map(), pm = new Map()) => buildWorld({
  nodes: new Map(nodes.map(n => [n.metadata.name, n])),
  pods: new Map(pods.map(p => [p.metadata.uid, p])),
  nodeMetrics: nm, podMetrics: pm, config: cfg, link: { ok: true }, context: 'test' });

test('requests roll up to the node they are scheduled on', () => {
  const w = build([node('n1', '4', '8Gi'), node('n2', '4', '8Gi')],
                  [pod('a', 'default', 'n1', '500m', '1Gi'), pod('b', 'default', 'n1', '1', '2Gi'),
                   pod('c', 'default', 'n2', '250m', '512Mi')]);
  const n1 = w.nodes.find(n => n.name === 'n1');
  assert.equal(n1.cpu.requests, 1.5);
  assert.equal(n1.mem.requests, 3 * 1024 ** 3);
  assert.equal(n1.pods.count, 2);
  assert.equal(w.nodes.find(n => n.name === 'n2').cpu.requests, 0.25);
});

test('finished pods hold no resources but still exist', () => {
  const w = build([node('n1', '4', '8Gi')],
                  [pod('a', 'default', 'n1', '1', '1Gi', 'Succeeded'),
                   pod('b', 'default', 'n1', '1', '1Gi', 'Failed'),
                   pod('c', 'default', 'n1', '1', '1Gi', 'Running')]);
  const n1 = w.nodes[0];
  assert.equal(n1.cpu.requests, 1);   // only the Running pod
  assert.equal(n1.pods.count, 1);
  assert.equal(w.counts.total, 3);    // all three are still visible
  assert.equal(w.counts.succeeded, 1);
  assert.equal(w.counts.failed, 1);
});

test('unscheduled pods consume nothing', () => {
  const w = build([node('n1', '4', '8Gi')], [pod('a', 'default', null, '2', '2Gi', 'Pending')]);
  assert.equal(w.nodes[0].cpu.requests, 0);
  assert.equal(w.counts.pending, 1);
});

test('BestEffort pods are flagged', () => {
  const w = build([node('n1', '4', '8Gi')],
                  [pod('a', 'default', 'n1', null, null), pod('b', 'default', 'n1', '1', '1Gi')]);
  assert.equal(w.pods.find(p => p.uid === 'a').besteffort, true);
  assert.equal(w.pods.find(p => p.uid === 'b').besteffort, false);
});

test('node usage comes from node metrics, never from summing pods', () => {
  const nm = new Map([['n1', { cpu: 3.2, mem: 5 * 1024 ** 3 }]]);
  const pm = new Map([['default/pod-a', { cpu: 0.4, mem: 1024 ** 3 }]]);
  const w = build([node('n1', '4', '8Gi')], [pod('a', 'default', 'n1', '500m', '1Gi')], nm, pm);
  assert.equal(w.nodes[0].cpu.usage, 3.2);      // node metric, not the pod's 0.4
  assert.equal(w.hasUsage, true);
});

test('usage is null (not zero) when metrics-server is absent', () => {
  const w = build([node('n1', '4', '8Gi')], [pod('a', 'default', 'n1', '1', '1Gi')]);
  assert.equal(w.nodes[0].cpu.usage, null);
  assert.equal(w.hasUsage, false);
});

test('pod ceiling is tracked from allocatable.pods', () => {
  const w = build([node('n1', '4', '8Gi', '110')], [pod('a', 'default', 'n1', '1', '1Gi')]);
  assert.equal(w.nodes[0].pods.max, 110);
  assert.equal(w.totals.podMax, 110);
});

test('namespace exclude hides, dim only marks', () => {
  const w = buildWorld({
    nodes: new Map([['n1', node('n1', '4', '8Gi')]]),
    pods: new Map([['a', pod('a', 'kube-system', 'n1', '1', '1Gi')],
                   ['b', pod('b', 'secret-ns', 'n1', '1', '1Gi')]]),
    nodeMetrics: new Map(), podMetrics: new Map(),
    config: { namespaces: { include: [], exclude: ['secret-ns'], dim: ['kube-system'] } },
    link: { ok: true }, context: 'test' });
  assert.equal(w.pods.length, 1);
  assert.equal(w.pods[0].ns, 'kube-system');
  assert.equal(w.pods[0].dim, true);
});

test('excluded pods still count against the node they occupy', () => {
  // A hidden pod is invisible, but its requests are real and the node is still full.
  const w = buildWorld({
    nodes: new Map([['n1', node('n1', '4', '8Gi')]]),
    pods: new Map([['a', pod('a', 'secret-ns', 'n1', '3', '1Gi')]]),
    nodeMetrics: new Map(), podMetrics: new Map(),
    config: { namespaces: { include: [], exclude: ['secret-ns'], dim: [] } },
    link: { ok: true }, context: 'test' });
  assert.equal(w.pods.length, 0);
  assert.equal(w.nodes[0].cpu.requests, 3);
});

test('kubectl top output parses', () => {
  const nm = parseTopNodes('NAME    CPU(cores)   CPU%   MEMORY(bytes)   MEMORY%\nn1      1230m        30%    4096Mi          50%\n');
  assert.equal(nm.get('n1').cpu, 1.23);
  assert.equal(nm.get('n1').mem, 4096 * 1024 ** 2);
  const pm = parseTopPods('NAMESPACE   NAME    CPU(cores)   MEMORY(bytes)\ndefault     web-1   250m         512Mi\n');
  assert.equal(pm.get('default/web-1').cpu, 0.25);
});
