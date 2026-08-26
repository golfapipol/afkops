'use strict';
// Parsers for Kubernetes resource.Quantity strings.
// Ref: k8s.io/apimachinery/pkg/api/resource

const BIN = { Ki: 1024, Mi: 1024 ** 2, Gi: 1024 ** 3, Ti: 1024 ** 4, Pi: 1024 ** 5, Ei: 1024 ** 6 };
const DEC = { n: 1e-9, u: 1e-6, m: 1e-3, '': 1, k: 1e3, K: 1e3, M: 1e6, G: 1e9, T: 1e12, P: 1e15, E: 1e18 };

// Returns a Number, or 0 for anything unparseable. Never throws: this runs on
// live cluster data and a weird value must not take the wallboard down.
function parseQuantity(q) {
  if (q == null) return 0;
  if (typeof q === 'number') return Number.isFinite(q) ? q : 0;
  const s = String(q).trim();
  if (!s) return 0;

  // Scientific / exponent form, e.g. "1e3", "1.5E6"
  const exp = /^([+-]?[0-9.]+)[eE]([+-]?[0-9]+)$/.exec(s);
  if (exp) {
    const v = Number(exp[1]) * Math.pow(10, Number(exp[2]));
    return Number.isFinite(v) ? v : 0;
  }

  const m = /^([+-]?[0-9]*\.?[0-9]+)\s*([A-Za-z]{0,2})$/.exec(s);
  if (!m) return 0;
  const num = Number(m[1]);
  if (!Number.isFinite(num)) return 0;
  const suffix = m[2] || '';

  if (Object.prototype.hasOwnProperty.call(BIN, suffix)) return num * BIN[suffix];
  if (Object.prototype.hasOwnProperty.call(DEC, suffix)) return num * DEC[suffix];
  return 0;
}

// CPU in cores (millicores resolve to fractions).
const parseCpu = parseQuantity;
// Memory in bytes.
const parseMem = parseQuantity;

// Effective resource request/limit for a pod.
//
// This is NOT a plain sum over containers. Per the Kubernetes scheduler:
//   max( sum(regular containers), max(init containers) )
//   + sum(restartable init containers / native sidecars)
//   + pod.spec.overhead
// Regular init containers run to completion before the app starts, so they
// overlap with nothing; sidecars (restartPolicy: Always on an initContainer)
// run for the pod's whole life and therefore stack on top.
function podResources(pod, field /* 'requests' | 'limits' */) {
  const spec = (pod && pod.spec) || {};
  const get = (c) => {
    const r = (c.resources && c.resources[field]) || {};
    return { cpu: parseCpu(r.cpu), mem: parseMem(r.memory) };
  };

  let cpu = 0, mem = 0;                 // sum over regular containers
  for (const c of spec.containers || []) { const v = get(c); cpu += v.cpu; mem += v.mem; }

  let sideCpu = 0, sideMem = 0;         // native sidecars, additive
  let initCpu = 0, initMem = 0;         // plain init containers, max only
  for (const c of spec.initContainers || []) {
    const v = get(c);
    if (c.restartPolicy === 'Always') { sideCpu += v.cpu; sideMem += v.mem; }
    else { initCpu = Math.max(initCpu, v.cpu); initMem = Math.max(initMem, v.mem); }
  }

  // Sidecars are already running while init containers execute.
  cpu = Math.max(cpu + sideCpu, initCpu + sideCpu);
  mem = Math.max(mem + sideMem, initMem + sideMem);

  const ov = spec.overhead || {};
  cpu += parseCpu(ov.cpu);
  mem += parseMem(ov.memory);

  return { cpu, mem };
}

// A pod only counts against a node's allocatable while it is scheduled and not
// finished. Succeeded/Failed pods still exist in the API but hold no resources.
function podHoldsResources(pod) {
  const phase = pod && pod.status && pod.status.phase;
  return phase !== 'Succeeded' && phase !== 'Failed';
}

module.exports = { parseQuantity, parseCpu, parseMem, podResources, podHoldsResources };
