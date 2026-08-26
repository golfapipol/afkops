import assert from 'node:assert';
import { test } from 'node:test';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';

// The browser modules are plain ES modules loaded straight by the page, so a
// helper used without importing it is only discovered when that exact code path
// runs -- which for a rarely-drawn panel can be much later. Three real bugs
// shipped that way (`s`, `rect`, `fitText`), each blanking the board until the
// render loop guard caught it. This check makes the whole class impossible.

const ROOT = 'public';

function listModules(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...listModules(p));
    else if (name.endsWith('.js')) out.push(p);
  }
  return out;
}

// Comments and string literals must not be mistaken for code.
function strip(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1 ')
    .replace(/'(?:[^'\\\n]|\\.)*'/g, "''")
    .replace(/"(?:[^"\\\n]|\\.)*"/g, '""')
    .replace(/`(?:[^`\\]|\\.)*`/g, '``');
}

function parseExports(src) {
  const names = new Set();
  for (const m of src.matchAll(/export\s+(?:async\s+)?(?:function|class)\s+([A-Za-z_$][\w$]*)/g)) {
    names.add(m[1]);
  }
  // One statement can declare several: `export const W = 640, H = 360;`
  for (const m of src.matchAll(/export\s+(?:const|let|var)\s+([^;\n]*(?:\n(?![\s]*(?:export|import|\/\/))[^;\n]*)*)/g)) {
    let depth = 0, buf = '';
    const parts = [];
    for (const ch of m[1]) {
      if ('([{'.includes(ch)) depth++;
      else if (')]}'.includes(ch)) depth--;
      if (ch === ',' && depth === 0) { parts.push(buf); buf = ''; continue; }
      buf += ch;
    }
    parts.push(buf);
    for (const part of parts) {
      const id = /^\s*([A-Za-z_$][\w$]*)/.exec(part);
      if (id) names.add(id[1]);
    }
  }
  for (const m of src.matchAll(/export\s*\{([^}]*)\}/g)) {
    for (const part of m[1].split(',')) {
      const n = part.trim().split(/\s+as\s+/).pop().trim();
      if (n) names.add(n);
    }
  }
  return names;
}

function parseImports(file, src) {
  const imported = new Set();
  const links = [];
  for (const m of src.matchAll(/import\s*\{([^}]*)\}\s*from\s*['"]([^'"]+)['"]/g)) {
    const from = m[2];
    const target = resolve(dirname(file), from);
    for (const part of m[1].split(',')) {
      const n = part.trim().split(/\s+as\s+/).pop().trim();
      if (!n) continue;
      imported.add(n);
      links.push({ name: n, target });
    }
  }
  for (const m of src.matchAll(/import\s*\*\s*as\s+([\w$]+)\s+from/g)) imported.add(m[1]);
  return { imported, links };
}

function parseLocals(stripped) {
  const names = new Set();
  for (const m of stripped.matchAll(/(?:function|class)\s+([A-Za-z_$][\w$]*)/g)) names.add(m[1]);
  for (const m of stripped.matchAll(/(?:const|let|var)\s+([A-Za-z_$][\w$]*)/g)) names.add(m[1]);
  // Destructuring: const { pal, q, t } = ctx
  for (const m of stripped.matchAll(/(?:const|let|var)\s*\{([^}]*)\}\s*=/g)) {
    for (const part of m[1].split(',')) {
      const n = part.trim().split(':').pop().trim();
      if (n) names.add(n);
    }
  }
  // Function parameters.
  for (const m of stripped.matchAll(/function\s*[\w$]*\s*\(([^)]*)\)/g)) {
    for (const part of m[1].split(',')) {
      const n = part.trim().split('=')[0].trim().replace(/[{}\[\]]/g, '');
      if (n && /^[A-Za-z_$][\w$]*$/.test(n)) names.add(n);
    }
  }
  for (const m of stripped.matchAll(/\(([^)]*)\)\s*=>/g)) {
    for (const part of m[1].split(',')) {
      const n = part.trim().split('=')[0].trim().replace(/[{}\[\]]/g, '');
      if (n && /^[A-Za-z_$][\w$]*$/.test(n)) names.add(n);
    }
  }
  for (const m of stripped.matchAll(/([A-Za-z_$][\w$]*)\s*=>/g)) names.add(m[1]);
  return names;
}

const modules = listModules(ROOT);
const exportsByFile = new Map();
for (const f of modules) exportsByFile.set(resolve(f), parseExports(readFileSync(f, 'utf8')));

// Every name any module exports: the project's shared vocabulary.
const shared = new Set();
for (const names of exportsByFile.values()) for (const n of names) shared.add(n);

test('the browser modules are more than a couple of files', () => {
  assert.ok(modules.length >= 10, `found only ${modules.length} modules`);
  assert.ok(shared.size >= 30, `found only ${shared.size} shared names`);
});

test('every imported name is actually exported by the module it comes from', () => {
  const bad = [];
  for (const f of modules) {
    const src = readFileSync(f, 'utf8');
    for (const { name, target } of parseImports(f, src).links) {
      const names = exportsByFile.get(target);
      if (names && !names.has(name)) bad.push(`${f}: '${name}' is not exported by ${target}`);
    }
  }
  assert.deepEqual(bad, [], 'broken imports:\n' + bad.join('\n'));
});

test('no module uses a shared helper it forgot to import', () => {
  const bad = [];
  for (const f of modules) {
    const src = readFileSync(f, 'utf8');
    const { imported } = parseImports(f, src);
    const stripped = strip(src).replace(/^\s*import[^\n]*$/gm, '');
    const locals = parseLocals(stripped);
    const own = exportsByFile.get(resolve(f));

    for (const name of shared) {
      if (imported.has(name) || locals.has(name) || own.has(name)) continue;
      // Used as a call or a bare reference, not as a property or an object key.
      const used = new RegExp(`(?<![\\w$.])${name}(?![\\w$])(?!\\s*:)`).test(stripped);
      if (used) bad.push(`${f}: uses '${name}' without importing it`);
    }
  }
  assert.deepEqual(bad, [], 'missing imports:\n' + bad.join('\n'));
});
