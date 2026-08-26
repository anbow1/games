#!/usr/bin/env node
/**
 * Vendor exactly the Three.js files a game imports, and nothing else.
 *
 * The Android build has no network — it holds no INTERNET permission — so every
 * module the games pull from the CDN has to be inside the APK. Copying whole
 * example directories works but drags in megabytes of unused passes; guessing
 * the dependency list by hand is how you ship an app that white-screens on a
 * missing import. This walks the actual import graph from the entry specifiers
 * instead, so the set is both minimal and complete.
 *
 *   node tools/vendor-three.mjs <three-package-dir> <out-dir> <entry> [entry...]
 *
 * `three-package-dir` is an unpacked npm tarball (the directory containing
 * build/ and examples/). Entries are import specifiers as the games write them,
 * e.g. "three" or "three/addons/postprocessing/SMAAPass.js".
 */
import fs from 'node:fs';
import path from 'node:path';

const [pkgDir, outDir, ...entries] = process.argv.slice(2);
if (!pkgDir || !outDir || !entries.length) {
  console.error('usage: vendor-three.mjs <three-pkg-dir> <out-dir> <entry> [entry...]');
  process.exit(1);
}

/** Map an import specifier onto its path inside the package. */
function resolveSpec(spec) {
  if (spec === 'three') return 'build/three.module.min.js';
  if (spec.startsWith('three/addons/')) return 'examples/jsm/' + spec.slice('three/addons/'.length);
  return null;
}

const seen = new Set();
const queue = [];

for (const e of entries) {
  const rel = resolveSpec(e);
  if (!rel) { console.error(`cannot resolve entry specifier: ${e}`); process.exit(1); }
  queue.push(rel);
}

// The minified build is a leaf — it has no imports of its own — so only the
// example modules need scanning.
const IMPORT_RE = /(?:^|\n)\s*(?:import|export)[\s\S]*?from\s*['"]([^'"]+)['"]/g;

while (queue.length) {
  const rel = queue.shift();
  if (seen.has(rel)) continue;
  seen.add(rel);

  const abs = path.join(pkgDir, rel);
  if (!fs.existsSync(abs)) { console.error(`missing in package: ${rel}`); process.exit(1); }
  if (rel.startsWith('build/')) continue;

  const src = fs.readFileSync(abs, 'utf8');
  for (const m of src.matchAll(IMPORT_RE)) {
    const spec = m[1];
    if (spec === 'three') { queue.push('build/three.module.min.js'); continue; }
    if (spec.startsWith('.')) { queue.push(path.posix.normalize(path.posix.join(path.posix.dirname(rel), spec))); continue; }
    if (spec.startsWith('three/addons/')) { queue.push(resolveSpec(spec)); continue; }
    console.error(`unhandled import "${spec}" in ${rel}`);
    process.exit(1);
  }
}

fs.rmSync(outDir, { recursive: true, force: true });
let bytes = 0;
for (const rel of [...seen].sort()) {
  const from = path.join(pkgDir, rel), to = path.join(outDir, rel);
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.copyFileSync(from, to);
  bytes += fs.statSync(to).size;
}
const licence = path.join(pkgDir, 'LICENSE');
if (fs.existsSync(licence)) fs.copyFileSync(licence, path.join(outDir, 'LICENSE'));

console.log(`${seen.size} modules, ${(bytes / 1024).toFixed(0)} KB -> ${outDir}`);
