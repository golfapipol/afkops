'use strict';
const assert = require('node:assert');
const { test } = require('node:test');
const { unwrapWatchValue } = require('../server/kubectl.js');

// kubectl sends the initial snapshot as ONE event wrapping a List, not as one
// event per object. Getting this wrong drops the entire starting state.
test('initial List snapshot is unwrapped into one event per item', () => {
  const v = { type: 'ADDED', object: { apiVersion: 'v1', kind: 'List', items: [
    { kind: 'Pod', metadata: { uid: 'a' } },
    { kind: 'Pod', metadata: { uid: 'b' } },
    { kind: 'Pod', metadata: { uid: 'c' } },
  ] } };
  const out = unwrapWatchValue(v);
  assert.equal(out.length, 3);
  assert.deepEqual(out.map(([t]) => t), ['ADDED', 'ADDED', 'ADDED']);
  assert.deepEqual(out.map(([, o]) => o.metadata.uid), ['a', 'b', 'c']);
});

test('a normal single-object watch event passes straight through', () => {
  const v = { type: 'MODIFIED', object: { kind: 'Pod', metadata: { uid: 'x' } } };
  const out = unwrapWatchValue(v);
  assert.equal(out.length, 1);
  assert.equal(out[0][0], 'MODIFIED');
  assert.equal(out[0][1].metadata.uid, 'x');
});

test('DELETED is preserved when unwrapping', () => {
  const out = unwrapWatchValue({ type: 'DELETED', object: { kind: 'Pod', metadata: { uid: 'x' } } });
  assert.deepEqual(out, [['DELETED', { kind: 'Pod', metadata: { uid: 'x' } }]]);
});

test('a bare object without a watch-event wrapper is tolerated', () => {
  const out = unwrapWatchValue({ kind: 'Pod', metadata: { uid: 'z' } });
  assert.equal(out.length, 1);
  assert.equal(out[0][0], 'ADDED');
});

test('a bare List without a wrapper is also unwrapped', () => {
  const out = unwrapWatchValue({ kind: 'PodList', items: [{ kind: 'Pod', metadata: { uid: 'q' } }] });
  assert.equal(out.length, 1);
  assert.equal(out[0][1].metadata.uid, 'q');
});

test('empty and malformed values yield nothing rather than throwing', () => {
  assert.deepEqual(unwrapWatchValue(null), []);
  assert.deepEqual(unwrapWatchValue(undefined), []);
  assert.deepEqual(unwrapWatchValue({}), []);
  assert.deepEqual(unwrapWatchValue({ type: 'ADDED' }), []);
  assert.deepEqual(unwrapWatchValue({ type: 'ADDED', object: { kind: 'List', items: [] } }), []);
});
