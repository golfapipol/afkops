'use strict';
const fs = require('node:fs');
const path = require('node:path');

// 24h at one sample per 30s. Fixed-size: the arrays are allocated once and
// overwritten in place, so a 24/7 wallboard has no growth here at all.
const SLOT_MS = 30 * 1000;
const SLOTS = (24 * 60 * 60 * 1000) / SLOT_MS;   // 2880

function createHistory(file) {
  const cpu = new Uint8Array(SLOTS);      // 0-100 % of allocatable requested
  const mem = new Uint8Array(SLOTS);
  const use = new Uint8Array(SLOTS);      // 0-100 % actually used
  const inc = new Uint8Array(SLOTS);      // incident count, saturating
  const filled = new Uint8Array(SLOTS);
  let lastSlot = -1;

  function slotOf(t) { return Math.floor(t / SLOT_MS) % SLOTS; }

  function sample(t, s) {
    const i = slotOf(t);
    if (i !== lastSlot) {
      // Zero any slots skipped (clock jump, process asleep) so stale data from
      // 24h ago cannot masquerade as recent.
      if (lastSlot >= 0) {
        for (let k = (lastSlot + 1) % SLOTS; k !== i; k = (k + 1) % SLOTS) {
          cpu[k] = mem[k] = use[k] = inc[k] = filled[k] = 0;
        }
      }
      cpu[i] = mem[i] = use[i] = inc[i] = 0;
      lastSlot = i;
    }
    const pct = (v) => Math.max(0, Math.min(100, Math.round((v || 0) * 100)));
    cpu[i] = pct(s.cpuFrac); mem[i] = pct(s.memFrac); use[i] = pct(s.useFrac);
    filled[i] = 1;
  }

  function incident(t, n = 1) {
    const i = slotOf(t);
    inc[i] = Math.min(255, inc[i] + n);
    filled[i] = 1;
  }

  // Oldest-first view for rendering, so the ribbon reads left-to-right as time.
  function series(now = Date.now()) {
    const end = slotOf(now);
    const out = { cpu: new Uint8Array(SLOTS), mem: new Uint8Array(SLOTS),
                  use: new Uint8Array(SLOTS), inc: new Uint8Array(SLOTS), filled: new Uint8Array(SLOTS) };
    for (let k = 0; k < SLOTS; k++) {
      const src = (end + 1 + k) % SLOTS;
      out.cpu[k] = cpu[src]; out.mem[k] = mem[src]; out.use[k] = use[src];
      out.inc[k] = inc[src]; out.filled[k] = filled[src];
    }
    return out;
  }

  function toJSON() {
    return { v: 1, lastSlot, savedAt: Date.now(),
             cpu: Buffer.from(cpu).toString('base64'), mem: Buffer.from(mem).toString('base64'),
             use: Buffer.from(use).toString('base64'), inc: Buffer.from(inc).toString('base64'),
             filled: Buffer.from(filled).toString('base64') };
  }

  function load() {
    try {
      const j = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (j.v !== 1) return false;
      const put = (dst, b64) => { const b = Buffer.from(b64, 'base64');
        if (b.length === SLOTS) dst.set(b); };
      put(cpu, j.cpu); put(mem, j.mem); put(use, j.use); put(inc, j.inc); put(filled, j.filled);
      lastSlot = typeof j.lastSlot === 'number' ? j.lastSlot : -1;
      // Anything older than 24h is meaningless; drop slots the gap swept past.
      const gap = Date.now() - (j.savedAt || 0);
      if (gap > 24 * 60 * 60 * 1000) { cpu.fill(0); mem.fill(0); use.fill(0); inc.fill(0); filled.fill(0); lastSlot = -1; }
      return true;
    } catch { return false; }
  }

  // Atomic: write a temp file then rename, so a crash mid-write cannot leave a
  // truncated history that fails to parse on the next start.
  function save() {
    try {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      const tmp = file + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify(toJSON()));
      fs.renameSync(tmp, file);
      return true;
    } catch { return false; }
  }

  // Fills the buffer with a plausible day so the ribbon can be verified without
  // waiting 24 hours. Demo mode only -- never called against a real cluster.
  function seedSynthetic(now = Date.now()) {
    const end = slotOf(now);
    for (let k = 0; k < SLOTS; k++) {
      const i = (end + 1 + k) % SLOTS;
      const hourOfDay = ((k / SLOTS) * 24 + 24 - ((24 - new Date(now).getHours()) % 24)) % 24;
      // Workday-shaped load: quiet overnight, ramp from 08:00, peak mid-afternoon.
      const shape = 0.28 + 0.42 * Math.max(0, Math.sin(((hourOfDay - 6) / 24) * Math.PI * 2 * 0.5));
      const jitter = (Math.sin(k * 0.7) + Math.sin(k * 0.13)) * 0.04;
      cpu[i] = Math.max(0, Math.min(100, Math.round((shape + jitter) * 100)));
      mem[i] = Math.max(0, Math.min(100, Math.round((shape * 0.8 + 0.1) * 100)));
      use[i] = Math.max(0, Math.min(100, Math.round((shape * (0.55 + 0.3 * Math.sin(k * 0.21))) * 100)));
      inc[i] = (k % 313 === 0) ? 3 : (k % 97 === 0 ? 1 : 0);
      filled[i] = 1;
    }
    lastSlot = end;
  }

  return { sample, incident, series, save, load, seedSynthetic, SLOTS, SLOT_MS };
}

module.exports = { createHistory, SLOTS, SLOT_MS };
