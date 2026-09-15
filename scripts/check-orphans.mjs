import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const sourceRoots = ['app', 'components', 'lib'];
const sourceExt = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs']);
const files = [];

function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === '.next' || entry.name === '.git') continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full);
    else if (sourceExt.has(path.extname(entry.name))) files.push(path.relative(root, full).replaceAll('\\', '/'));
  }
}

for (const dir of sourceRoots) if (fs.existsSync(dir)) walk(dir);
const known = new Set(files);

function resolveImport(fromFile, spec) {
  if (!spec.startsWith('.')) return null;
  const base = path.resolve(root, path.dirname(fromFile), spec);
  const candidates = [
    base,
    ...[...sourceExt].map(ext => base + ext),
    ...[...sourceExt].map(ext => path.join(base, 'index' + ext)),
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
      const rel = path.relative(root, candidate).replaceAll('\\', '/');
      if (known.has(rel)) return rel;
    }
  }
  return null;
}

const graph = new Map();
const importPattern = /(?:import|export)\s+(?:[^'";]*?\s+from\s+)?['"]([^'"]+)['"]|import\(\s*['"]([^'"]+)['"]\s*\)/g;
for (const file of files) {
  const text = fs.readFileSync(file, 'utf8');
  const deps = new Set();
  for (const match of text.matchAll(importPattern)) {
    const dep = resolveImport(file, match[1] || match[2]);
    if (dep) deps.add(dep);
  }
  graph.set(file, deps);
}

const nextEntry = /(^|\/)(page|layout|template|head|loading|error|not-found|route)\.(ts|tsx|js|jsx)$/;
const roots = files.filter(file => nextEntry.test(file) || file === 'middleware.ts');
const reachable = new Set();
const stack = [...roots];
while (stack.length) {
  const file = stack.pop();
  if (!file || reachable.has(file)) continue;
  reachable.add(file);
  for (const dep of graph.get(file) || []) stack.push(dep);
}

const candidates = files.filter(file => {
  if (reachable.has(file)) return false;
  if (file.startsWith('app/api/')) return false;
  return file.startsWith('components/') || file.startsWith('lib/') || file.startsWith('app/route-weather-lab/') || file.startsWith('app/wx-routing/');
});

if (candidates.length) {
  console.error('Unreferenced source candidates:');
  for (const file of candidates) console.error(`  ${file}`);
  process.exit(1);
}
console.log(`Orphan check passed across ${files.length} source files.`);
