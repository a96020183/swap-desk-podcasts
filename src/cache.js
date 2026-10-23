// Small disk cache under .private/cache (git-ignored). On Render the disk is temporary; the cache refills itself.
import fs from 'node:fs';
import path from 'node:path';
import { PRIVATE_DIR } from './config.js';
import { sha1 } from './util.js';

const DIR = path.join(PRIVATE_DIR, 'cache');
const mem = new Map();
const MEM_MAX = 2000;

function file(ns, key) {
  return path.join(DIR, ns, sha1(key) + '.json');
}

export function getCached(ns, key, ttlMs = Infinity) {
  const k = ns + '|' + key;
  let hit = mem.get(k);
  if (!hit) {
    const f = file(ns, key);
    if (fs.existsSync(f)) {
      try { hit = JSON.parse(fs.readFileSync(f, 'utf8')); remember(k, hit); } catch { hit = null; }
    }
  }
  if (!hit) return undefined;
  if (Date.now() - hit.t > ttlMs) return undefined;
  return hit.v;
}

export function setCached(ns, key, value) {
  const hit = { t: Date.now(), v: value };
  remember(ns + '|' + key, hit);
  const f = file(ns, key);
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, JSON.stringify(hit));
  return value;
}

function remember(k, hit) {
  if (mem.size >= MEM_MAX) mem.delete(mem.keys().next().value);
  mem.set(k, hit);
}

export const HOUR = 3600 * 1000;
export const DAY = 24 * HOUR;
