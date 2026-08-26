import assert from 'node:assert';
import { test } from 'node:test';
import { reqTier, podLoad, loadVisual, TIERS, TIER_SCALE } from '../public/podclass.js';

const pod = (cpuReq, cpuUse) => ({ cpuReq, cpuUse });

test('request tiers use fixed thresholds, not percentiles', () => {
  // Fixed boundaries mean "chicken" means the same thing tomorrow and on a
  // different cluster; percentile-relative tiers would drift constantly.
  assert.equal(reqTier(pod(0, 0)), 0);        // no request at all
  assert.equal(reqTier(pod(0.003, 0)), 1);    // 3m
  assert.equal(reqTier(pod(0.025, 0)), 1);    // 25m, the median on a real cluster
  assert.equal(reqTier(pod(0.1, 0)), 1);      // exactly 100m stays small
  assert.equal(reqTier(pod(0.101, 0)), 2);
  assert.equal(reqTier(pod(0.5, 0)), 2);      // exactly 500m stays mid
  assert.equal(reqTier(pod(0.501, 0)), 3);
  assert.equal(reqTier(pod(8, 0)), 3);
});

test('a missing or negative request is treated as no request', () => {
  assert.equal(reqTier({}), 0);
  assert.equal(reqTier(pod(undefined, 0)), 0);
  assert.equal(reqTier(pod(-1, 0)), 0);
});

test('there is exactly one label per tier, per skin', () => {
  assert.equal(TIERS.length, 4);
  assert.equal(TIER_SCALE.length, 4);
  for (const t of TIERS) {
    for (const skin of ['farm', 'factory', 'dungeon']) {
      assert.ok(t[skin] && t[skin].length, `${t.id} missing ${skin} name`);
    }
    assert.ok(t.label && t.short);
  }
});

test('sprites grow with their tier', () => {
  for (let i = 1; i < TIER_SCALE.length; i++) assert.ok(TIER_SCALE[i] > TIER_SCALE[i - 1]);
});

test('load is usage as a fraction of the pod own request', () => {
  assert.equal(podLoad(pod(0.5, 0.25)), 0.5);
  assert.equal(podLoad(pod(0.1, 0.2)), 2);
});

test('a pod with no request is measured against a nominal 100m', () => {
  // It has no reservation to be a fraction of, but it is still burning real CPU
  // and must not render as idle.
  assert.equal(podLoad(pod(0, 0.05)), 0.5);
  assert.equal(podLoad(pod(0, 0.1)), 1);
});

test('missing metrics read as unknown, never as idle', () => {
  assert.equal(podLoad(pod(0.5, null)), null);
  assert.equal(podLoad(pod(0.5, undefined)), null);
  const v = loadVisual(pod(0.5, null));
  assert.equal(v.known, false);
  assert.equal(v.load, null);
  assert.equal(v.hot, false);
  assert.ok(v.activity > 0, 'unknown still animates rather than freezing');
});

test('hot means past its own request', () => {
  assert.equal(loadVisual(pod(0.5, 0.49)).hot, false);
  assert.equal(loadVisual(pod(0.5, 0.5)).hot, false);
  assert.equal(loadVisual(pod(0.5, 0.51)).hot, true);
  // A no-request pod using real CPU crosses the nominal line and is flagged.
  assert.equal(loadVisual(pod(0, 0.4)).hot, true);
});

test('visual channels stay bounded whatever the input', () => {
  for (const p of [pod(0.001, 100), pod(1000, 0), pod(0, 0), pod(0.5, 0.5)]) {
    const v = loadVisual(p);
    assert.ok(v.activity >= 0.12 && v.activity <= 2.2, `activity ${v.activity}`);
    assert.ok(v.bright >= 0 && v.bright <= 1, `bright ${v.bright}`);
  }
});

test('brightness rises with usage and saturates', () => {
  const a = loadVisual(pod(1, 0.05)).bright;
  const b = loadVisual(pod(1, 0.3)).bright;
  const c = loadVisual(pod(1, 0.9)).bright;
  assert.ok(a < b && b < c);
  assert.equal(loadVisual(pod(1, 5)).bright, 1);
});
