'use strict';
const assert = require('node:assert');
const { test } = require('node:test');
const { parseCpu, parseMem, podResources } = require('../server/quantity.js');

test('cpu quantities', () => {
  assert.equal(parseCpu('1'), 1);
  assert.equal(parseCpu('2500m'), 2.5);
  assert.equal(parseCpu('100m'), 0.1);
  assert.equal(parseCpu('0'), 0);
  assert.equal(parseCpu('1500u'), 0.0015);
  assert.equal(parseCpu('0.5'), 0.5);
  assert.equal(parseCpu(undefined), 0);
  assert.equal(parseCpu('garbage'), 0);
});

test('memory binary suffixes', () => {
  assert.equal(parseMem('128Mi'), 128 * 1024 ** 2);
  assert.equal(parseMem('1Gi'), 1024 ** 3);
  assert.equal(parseMem('1000000Ki'), 1000000 * 1024);
  assert.equal(parseMem('2Ti'), 2 * 1024 ** 4);
});

test('memory decimal suffixes and bare bytes', () => {
  assert.equal(parseMem('1M'), 1e6);
  assert.equal(parseMem('1G'), 1e9);
  assert.equal(parseMem('1k'), 1e3);
  assert.equal(parseMem('134217728'), 134217728);
  assert.equal(parseMem('1e3'), 1000);
});

test('binary and decimal are not the same', () => {
  assert.notEqual(parseMem('1Mi'), parseMem('1M'));
});

// The trap the plan calls out: init containers must not be summed.
test('effective request: regular containers sum', () => {
  const pod = { spec: { containers: [
    { resources: { requests: { cpu: '100m', memory: '128Mi' } } },
    { resources: { requests: { cpu: '200m', memory: '256Mi' } } },
  ] } };
  const r = podResources(pod, 'requests');
  assert.ok(Math.abs(r.cpu - 0.3) < 1e-9);
  assert.equal(r.mem, 384 * 1024 ** 2);
});

test('effective request: init container takes max, not sum', () => {
  const pod = { spec: {
    containers: [{ resources: { requests: { cpu: '100m' } } }],
    initContainers: [{ resources: { requests: { cpu: '2' } } }],
  } };
  // max(sum regular = 0.1, max init = 2) === 2, NOT 2.1
  assert.equal(podResources(pod, 'requests').cpu, 2);
});

test('effective request: smaller init container does not raise the total', () => {
  const pod = { spec: {
    containers: [{ resources: { requests: { cpu: '1' } } }],
    initContainers: [{ resources: { requests: { cpu: '100m' } } }],
  } };
  assert.equal(podResources(pod, 'requests').cpu, 1);
});

test('effective request: native sidecar is additive', () => {
  const pod = { spec: {
    containers: [{ resources: { requests: { cpu: '1' } } }],
    initContainers: [{ restartPolicy: 'Always', resources: { requests: { cpu: '500m' } } }],
  } };
  assert.equal(podResources(pod, 'requests').cpu, 1.5);
});

test('effective request: sidecar stacks with a plain init container', () => {
  const pod = { spec: {
    containers: [{ resources: { requests: { cpu: '1' } } }],
    initContainers: [
      { restartPolicy: 'Always', resources: { requests: { cpu: '500m' } } },
      { resources: { requests: { cpu: '3' } } },
    ],
  } };
  // max(1 + 0.5, 3 + 0.5) === 3.5
  assert.equal(podResources(pod, 'requests').cpu, 3.5);
});

test('effective request: pod overhead is added', () => {
  const pod = { spec: {
    containers: [{ resources: { requests: { cpu: '1', memory: '1Gi' } } }],
    overhead: { cpu: '250m', memory: '128Mi' },
  } };
  const r = podResources(pod, 'requests');
  assert.equal(r.cpu, 1.25);
  assert.equal(r.mem, 1024 ** 3 + 128 * 1024 ** 2);
});

test('BestEffort pod requests nothing', () => {
  const pod = { spec: { containers: [{ name: 'a' }, { name: 'b' }] } };
  const r = podResources(pod, 'requests');
  assert.equal(r.cpu, 0);
  assert.equal(r.mem, 0);
});

test('limits are read from the limits field', () => {
  const pod = { spec: { containers: [
    { resources: { requests: { cpu: '100m' }, limits: { cpu: '2' } } },
  ] } };
  assert.equal(podResources(pod, 'requests').cpu, 0.1);
  assert.equal(podResources(pod, 'limits').cpu, 2);
});
