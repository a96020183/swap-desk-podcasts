// Settings come from environment variables; a local .env file is read if present.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function loadEnvFile(file) {
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    if (line.trim().startsWith('#')) continue;
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (!m) continue;
    if (process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}
if (process.env.SWAPDESK_NO_ENV_FILE !== '1') loadEnvFile(path.join(ROOT, '.env'));

const env = process.env;
export const PRIVATE_DIR = env.SWAPDESK_PRIVATE_DIR || path.join(ROOT, '.private');
fs.mkdirSync(PRIVATE_DIR, { recursive: true });

export const cfg = {
  port: Number(env.PORT || 3000),
  qlooKey: env.QLOO_API_KEY || '',
  qlooBase: (env.QLOO_BASE_URL || 'https://hackathon.api.qloo.com').replace(/\/$/, ''),
  qlooCallCap: Number(env.QLOO_CALL_CAP || 1200),
  qlooPerSec: Number(env.QLOO_REQ_PER_SEC || 4),
  openaiKey: env.OPENAI_API_KEY || '',
  openaiModel: env.OPENAI_MODEL || 'gpt-4.1-mini',
  openaiUsdCap: Number(env.OPENAI_USD_CAP || 3),
  itunesPerMin: 18,
  warmPresets: env.WARM_PRESETS === '1',
  contactUrl: env.CONTACT_URL || '',
};

// Product rules (spec section 3.2). Tests and the evidence page read the same values.
export const RULES = {
  candidates: 50,          // Qloo podcast -> podcast candidates per show
  shortlist: 20,           // rows on the first screen
  firstFive: 5,
  pausedDays: 120,         // no new episode for this long -> "Paused"
  recentSwapDays: 365,     // swapped with you inside this window -> labelled and moved down
  similarReachGap: 0.02,   // second Qloo call: filter.popularity.max = yours + 0.02
  outOfReachGap: 0.05,     // popularity this much above yours -> "Great fit, likely out of reach"
  recentEpisodes: 40,      // only the 40 most recent episodes of a feed are read for swaps
  habitBoost: 0.5,         // rank multiplier when a show trades promos with others (only if Day-1 Test A passed)
  draftsPerSession: 5,
  draftsPerShowPerDay: 10,
};

// Day-1 Test A decides whether swap habits move rows (see research/day1). Off unless the test passed.
export const HABIT_RERANK = env.HABIT_RERANK === '1';
