// Pre-publish check: no Qloo response data, Qloo entity ids or secrets in files that would be public.
// Scans every file git would publish (everything except git-ignored folders). Exit code 1 on any finding.
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { ROOT } from '../src/config.js';

const SKIP_DIRS = new Set(['.git', '.private', 'node_modules', '__pycache__']);
const SKIP_FILES = new Set(['.env', '進度.md']);
const BINARY = /\.(png|jpe?g|gif|ico|pdf|webp|woff2?)$/i;

export const RULES = [
  { name: 'Qloo entity id (UUID)', re: /\b[0-9A-F]{8}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{12}\b/ },
  { name: 'raw affinity value', re: /"affinity"\s*:\s*0?\.\d+/ },
  { name: 'raw popularity value', re: /"popularity"\s*:\s*0?\.\d+/ },
  { name: 'raw Qloo insights response', re: /"results"\s*:\s*\{\s*"entities"/ },
  { name: 'raw Qloo search response', re: /"entity_id"\s*:/ },
  { name: 'Qloo image URL', re: /images\.qloo\.com\/i\// },
  { name: 'API key assignment', re: /(QLOO_API_KEY|OPENAI_API_KEY)\s*=\s*[A-Za-z0-9_\-]{12,}/ },
  { name: 'OpenAI-style secret', re: /\bsk-[A-Za-z0-9_\-]{20,}/ },
];

// Files git would publish. Falls back to a folder walk if git is unavailable.
function publicFiles() {
  try {
    const out = execSync('git ls-files --cached --others --exclude-standard -z', { cwd: ROOT, encoding: 'utf8' });
    return out.split('\0').filter(Boolean).map(f => path.join(ROOT, f));
  } catch {
    const files = [];
    (function walk(dir) {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) { if (!SKIP_DIRS.has(e.name)) walk(p); } else files.push(p);
      }
    })(ROOT);
    return files;
  }
}

const findings = [];
const files = publicFiles().filter(f => fs.existsSync(f) && !SKIP_FILES.has(path.basename(f)) && !f.split(path.sep).some(p => SKIP_DIRS.has(p)));
const keys = [process.env.QLOO_API_KEY, process.env.OPENAI_API_KEY].filter(k => k && k.length > 8);
for (const file of files) {
  const rel = path.relative(ROOT, file);
  const buf = fs.readFileSync(file);
  for (const k of keys) if (buf.includes(k)) findings.push(`${rel}  contains a real API key`);
  if (BINARY.test(file)) continue;
  buf.toString('utf8').split(/\r?\n/).forEach((line, i) => {
    for (const r of RULES) if (r.re.test(line)) findings.push(`${rel}:${i + 1}  ${r.name}`);
  });
}
// The ignore rules themselves must stay in place.
const gi = fs.readFileSync(path.join(ROOT, '.gitignore'), 'utf8');
for (const must of ['.env', '.private/']) if (!gi.split(/\r?\n/).includes(must)) findings.push(`.gitignore is missing "${must}"`);

if (findings.length) {
  console.log('Found data that must not be public:\n' + findings.join('\n'));
  process.exit(1);
}
console.log(`Public check passed: ${files.length} files scanned; no Qloo response data, entity ids or keys outside git-ignored files.`);
