'use strict';
import { loadVisual } from './podclass.js';

// Severity, so the board can point at problems instead of leaving you to hunt
// small marks across nine hundred sprites.
//
// The key judgement is that a restart COUNT is not a problem. A pod that
// restarted twice in thirty days is fine; one restarting every hour is not. On a
// real cluster that distinction turns 203 "pods with restarts" into 3 that
// actually need looking at, so severity uses the restart RATE.
export const LEVELS = {
  CRASHLOOP:   { n: 5, tag: 'CRASH',   why: 'restarting in a loop right now' },
  FAILED:      { n: 4, tag: 'FAILED',  why: 'pod failed' },
  UNSCHEDULED: { n: 4, tag: 'NO NODE', why: 'nothing has room for it' },
  CHURN:       { n: 4, tag: 'CHURN',   why: 'restarting repeatedly' },
  STARVED:     { n: 3, tag: 'STARVED', why: 'over its CPU request and restarting' },
  NOTREADY:    { n: 3, tag: 'NOREADY', why: 'running but failing its probe' },
  HOT:         { n: 2, tag: 'OVER',    why: 'using more CPU than it reserved' },
  SLOW:        { n: 1, tag: 'RESTART', why: 'restarting occasionally' },
  OK:          { n: 0, tag: '', why: '' },
};

// A pod at this level or worse is worth someone's attention.
export const PROBLEM_LEVEL = 2;

const HOUR = 3600000;

export function restartRate(pod, now) {
  if (!pod.restarts) return 0;
  const hours = Math.max(0.25, ((now || Date.now()) - (pod.age || now || Date.now())) / HOUR);
  return pod.restarts / hours;
}

export function classify(pod, now) {
  const rate = restartRate(pod, now);
  const lv = loadVisual(pod);

  if (pod.phase === 'CrashLoop') return { ...LEVELS.CRASHLOOP, rate, pod };
  if (pod.phase === 'Failed') return { ...LEVELS.FAILED, rate, pod };
  // A finished Job holds nothing and is not a problem.
  if (pod.phase === 'Succeeded') return { ...LEVELS.OK, rate, pod };
  if (!pod.node) return { ...LEVELS.UNSCHEDULED, rate, pod };
  if (rate >= 1) return { ...LEVELS.CHURN, rate, pod };
  if (lv.hot && pod.restarts > 0) return { ...LEVELS.STARVED, rate, pod };
  if (pod.phase === 'Running' && !pod.ready) return { ...LEVELS.NOTREADY, rate, pod };
  if (lv.hot) return { ...LEVELS.HOT, rate, pod };
  if (rate >= 0.1) return { ...LEVELS.SLOW, rate, pod };
  return { ...LEVELS.OK, rate, pod };
}

// Worst first. Ties break on restart rate, then on name so the order is stable
// between frames rather than shuffling as the map iterates.
export function rank(pods, now) {
  const out = [];
  for (const pod of pods) {
    const c = classify(pod, now);
    if (c.n >= PROBLEM_LEVEL) out.push(c);
  }
  out.sort((a, b) => b.n - a.n || b.rate - a.rate
                  || (a.pod.name < b.pod.name ? -1 : a.pod.name > b.pod.name ? 1 : 0));
  return out;
}

// Group by what owns the pods. Four pods of one failing CronJob is ONE problem,
// not four, and collapsing them stops a single bad workload from filling the
// list and hiding everything else.
export function rankGroups(pods, now) {
  const groups = new Map();
  for (const c of rank(pods, now)) {
    // Owner where there is one, so a whole ReplicaSet collapses to a line.
    const key = `${c.n}|${c.tag}|${c.pod.owner || c.pod.ns + '/' + c.pod.name}`;
    const g = groups.get(key);
    if (g) {
      g.count++;
      if (c.rate > g.rate) g.rate = c.rate;
      g.pods.push(c.pod);
    } else {
      groups.set(key, {
        n: c.n, tag: c.tag, why: c.why, rate: c.rate, count: 1,
        // Strip the generated ReplicaSet suffix so the label is the workload.
        label: c.pod.owner ? c.pod.owner.replace(/^[A-Za-z]+\//, '') : c.pod.name,
        pods: [c.pod],
      });
    }
  }
  return [...groups.values()].sort(
    (a, b) => b.n - a.n || b.rate - a.rate || b.count - a.count
           || (a.label < b.label ? -1 : a.label > b.label ? 1 : 0));
}

// Worst level per node, so a plot can show trouble even when its sprites are two
// pixels across and the individual markers are invisible.
export function byNode(problems) {
  const m = new Map();
  for (const c of problems) {
    if (!c.pod.node) continue;
    const cur = m.get(c.pod.node);
    if (!cur || c.n > cur.worst) m.set(c.pod.node, { worst: c.n, count: (cur ? cur.count : 0) + 1 });
    else cur.count++;
  }
  return m;
}

export function levelColor(n, pal) {
  if (n >= 5) return pal.bad;
  if (n >= 4) return '#ff7a1f';
  if (n >= 3) return pal.warn;
  return '#c9a227';
}
