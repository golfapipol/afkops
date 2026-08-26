'use strict';
// Splits a stdout byte stream into whole top-level JSON values.
//
// `kubectl --watch --output-watch-events -o json` emits a run of pretty-printed
// JSON objects back to back with no separator and no enclosing array, so we
// have to track brace depth ourselves. String and escape state must be tracked
// too, or a brace inside a pod annotation would desynchronise the parser.
function createJsonStream(onValue, onError) {
  let buf = '';
  let scanned = 0;   // chars of `buf` already examined; scanning must never restart
  let depth = 0;
  let start = -1;
  let inStr = false;
  let esc = false;

  function reset() { buf = ''; scanned = 0; depth = 0; start = -1; inStr = false; esc = false; }

  function push(chunk) {
    buf += chunk;
    let i = scanned;
    while (i < buf.length) {
      const ch = buf[i];
      if (inStr) {
        if (esc) esc = false;
        else if (ch === '\\') esc = true;
        else if (ch === '"') inStr = false;
        i++;
        continue;
      }
      if (ch === '"') { inStr = true; i++; continue; }
      if (ch === '{' || ch === '[') { if (depth === 0) start = i; depth++; i++; continue; }
      if (ch === '}' || ch === ']') {
        depth--;
        if (depth <= 0 && start >= 0) {
          const text = buf.slice(start, i + 1);
          try { onValue(JSON.parse(text)); }
          catch (e) { if (onError) onError(e); }
          buf = buf.slice(i + 1);   // drop what we consumed, so the buffer stays bounded
          i = 0; scanned = 0; depth = 0; start = -1;
          continue;
        }
        i++;
        continue;
      }
      i++;
    }
    scanned = buf.length;
    // Between values there is only whitespace; do not accumulate it.
    if (depth === 0 && start < 0) { buf = ''; scanned = 0; }
    // Runaway guard: one value larger than this is not something a wallboard
    // should hold in memory.
    if (buf.length > 64 * 1024 * 1024) reset();
  }

  return { push, reset };
}

module.exports = { createJsonStream };
