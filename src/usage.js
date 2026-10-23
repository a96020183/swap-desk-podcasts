// Counts paid or rate-limited calls so the app stops before going over budget. Stored in .private/usage.json.
import fs from 'node:fs';
import path from 'node:path';
import { PRIVATE_DIR } from './config.js';

const FILE = path.join(PRIVATE_DIR, 'usage.json');
let u = { qloo: 0, openaiUsd: 0, openaiCalls: 0, itunes: 0, rss: 0 };
try { u = { ...u, ...JSON.parse(fs.readFileSync(FILE, 'utf8')) }; } catch { /* first run */ }

let pending = null;
function save() {
  if (pending) return;
  pending = setTimeout(() => { pending = null; write(); }, 200);
  pending.unref?.();
}
function write() { try { fs.writeFileSync(FILE, JSON.stringify(u, null, 1)); } catch { /* disk may be read-only */ } }
export function add(field, n = 1) { u[field] = (u[field] || 0) + n; save(); }
export function usage() { return { ...u }; }
export function flushUsage() { if (pending) { clearTimeout(pending); pending = null; } write(); }
