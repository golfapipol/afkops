'use strict';
const { spawn } = require('node:child_process');
const { createJsonStream } = require('./jsonstream.js');

const KUBECTL = process.env.KUBECTL_BIN || 'kubectl';


// kubectl failures arrive as multi-kilobyte stderr dumps (klog lines, nested
// gcloud output, stack traces). A wallboard needs one short actionable line,
// not the dump -- and shipping the dump in every SSE frame would be wasteful.
function summarizeError(raw) {
  const s = String(raw || '').trim();
  if (!s) return 'kubectl failed';

  // Recognise the failures that actually happen, and say what to do about them.
  if (/gcloud auth login/i.test(s)) return 'GKE credentials expired - run: gcloud auth login';
  if (/gke-gcloud-auth-plugin/i.test(s) && /not found|no such file/i.test(s))
    return 'missing gke-gcloud-auth-plugin - install google-cloud-sdk-gke-gcloud-auth-plugin';
  if (/aws-iam-authenticator|expired token|ExpiredToken/i.test(s)) return 'AWS credentials expired - refresh your SSO login';
  if (/connection refused|was refused/i.test(s)) return 'connection refused - is the cluster running?';
  if (/no such host|Temporary failure in name resolution/i.test(s)) return 'cannot resolve API server - check VPN/DNS';
  if (/i\/o timeout|context deadline exceeded|timed out/i.test(s)) return 'API server timed out - check VPN/network';
  if (/Unauthorized/i.test(s)) return 'unauthorized - credentials rejected by the API server';
  if (/forbidden/i.test(s)) return 'forbidden - this account lacks permission to watch this resource';
  if (/current-context is not set|no configuration has been provided/i.test(s))
    return 'no kubectl context selected - run: kubectl config use-context <name>';
  if (/certificate|x509/i.test(s)) return 'TLS certificate problem reaching the API server';

  // Otherwise take the first line that is not klog noise, and cap it hard.
  const line = s.split('\n')
    .map((l) => l.trim())
    .find((l) => l && !/^[EWIF]\d{4} /.test(l) && !/^\s*at /.test(l) && !/^\$/.test(l));
  return (line || s.split('\n')[0] || 'kubectl failed').slice(0, 160);
}

// One-shot kubectl call returning parsed JSON.
function kubectlJson(args, { timeoutMs = 30000 } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(KUBECTL, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '', err = '', done = false;
    const finish = (fn, v) => { if (!done) { done = true; clearTimeout(timer); fn(v); } };
    const timer = setTimeout(() => { try { child.kill('SIGKILL'); } catch {} 
      finish(reject, new Error(`kubectl ${args[0]} timed out after ${timeoutMs}ms`)); }, timeoutMs);

    child.stdout.on('data', (d) => { out += d; if (out.length > 256 * 1024 * 1024) { try { child.kill('SIGKILL'); } catch {} } });
    child.stderr.on('data', (d) => { err = (err + d).slice(-4000); });
    child.on('error', (e) => finish(reject, e));
    child.on('close', (code) => {
      if (code !== 0) return finish(reject, new Error(summarizeError(err) || `kubectl exited ${code}`));
      try { finish(resolve, JSON.parse(out)); }
      catch (e) { finish(reject, new Error('unparseable kubectl output: ' + e.message)); }
    });
  });
}

// One-shot kubectl call returning raw text (for `top`, which has no JSON output).
function kubectlText(args, { timeoutMs = 30000 } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(KUBECTL, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '', err = '', done = false;
    const finish = (fn, v) => { if (!done) { done = true; clearTimeout(timer); fn(v); } };
    const timer = setTimeout(() => { try { child.kill('SIGKILL'); } catch {} 
      finish(reject, new Error('kubectl top timed out')); }, timeoutMs);
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { err = (err + d).slice(-4000); });
    child.on('error', (e) => finish(reject, e));
    child.on('close', (code) => code === 0 ? finish(resolve, out)
      : finish(reject, new Error(summarizeError(err))));
  });
}


// Normalises one raw watch value into individual (type, object) pairs.
//
// kubectl does NOT emit one event per object for the initial snapshot: it emits
// a SINGLE event whose object is a List wrapping every existing item. Treating
// that as one object silently drops the entire starting state, which only shows
// up on a cluster that already has objects in it.
function unwrapWatchValue(v) {
  const out = [];
  if (!v) return out;

  const push = (type, obj) => {
    if (!obj) return;
    if (Array.isArray(obj.items)) {
      for (const item of obj.items) if (item) out.push([type, item]);
      return;
    }
    out.push([type, obj]);
  };

  if (v.type && v.object) push(v.type, v.object);
  else if (v.kind || v.items) push('ADDED', v);
  return out;
}

// A self-healing `kubectl get --watch` stream.
//
// Watches end for perfectly ordinary reasons (idle timeouts, apiserver
// rollover, token refresh), so exit is not an error condition -- it is the
// normal case, and the only correct response is to restart with backoff.
function createWatch({ args, onEvent, onStatus, name }) {
  let child = null;
  let stopped = false;
  let backoff = 1000;
  let restartTimer = null;

  function start() {
    if (stopped) return;
    const stream = createJsonStream(
      (v) => {
        // First successful event proves the stream is healthy; reset backoff.
        backoff = 1000;
        onStatus && onStatus({ ok: true, name });
        for (const [type, obj] of unwrapWatchValue(v)) onEvent(type, obj);
      },
      () => {}
    );

    let err = '';
    try {
      child = spawn(KUBECTL, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (e) {
      onStatus && onStatus({ ok: false, name, error: e.message });
      return schedule();
    }

    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (d) => stream.push(d));
    child.stderr.on('data', (d) => { err = (err + d).slice(-4000); });
    child.on('error', (e) => { err = e.message; });
    child.on('close', () => {
      child = null;
      if (stopped) return;
      if (err.trim()) onStatus && onStatus({ ok: false, name, error: summarizeError(err) });
      schedule();
    });
  }

  function schedule() {
    if (stopped) return;
    clearTimeout(restartTimer);
    restartTimer = setTimeout(start, backoff);
    if (restartTimer.unref) restartTimer.unref();
    backoff = Math.min(backoff * 2, 60000);   // 1s -> 60s
  }

  function stop() {
    stopped = true;
    clearTimeout(restartTimer);
    if (child) { try { child.kill('SIGTERM'); } catch {} child = null; }
  }

  return { start, stop };
}

// The whole design rests on `kubectl get --watch --output-watch-events`, which
// older kubectl does not have. Without this check the symptom is a board that
// simply never populates, with nothing saying why -- so check once at startup
// and say exactly what is wrong.
async function preflight() {
  const problems = [];
  let version = '';
  try {
    version = (await kubectlText(['version', '--client', '-o', 'json'], { timeoutMs: 10000 }));
    const j = JSON.parse(version);
    version = (j.clientVersion && j.clientVersion.gitVersion) || '';
  } catch { version = 'unknown'; }

  try {
    const help = await kubectlText(['get', '--help'], { timeoutMs: 10000 });
    if (!help.includes('--output-watch-events')) {
      problems.push(`kubectl ${version} has no --output-watch-events; afkops needs kubectl 1.20 or newer`);
    }
  } catch (e) {
    problems.push(`could not run kubectl: ${summarizeError(String(e.message || e))}`);
  }

  return { version, problems };
}

function currentContext() {
  return kubectlText(['config', 'current-context'], { timeoutMs: 5000 })
    .then((s) => s.trim())
    .catch(() => 'unknown');
}

module.exports = { kubectlJson, kubectlText, createWatch, currentContext, summarizeError,
                   unwrapWatchValue, preflight, KUBECTL };
