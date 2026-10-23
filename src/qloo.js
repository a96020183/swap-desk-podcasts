// Qloo client: /search and /v2/insights for podcasts. Responses stay in the private cache (.private/), never in the repo.
import { cfg } from './config.js';
import { makeLimiter } from './limiter.js';
import { getCached, setCached, DAY } from './cache.js';
import { add, usage } from './usage.js';
import { sleep } from './util.js';

const limit = makeLimiter({ minGapMs: Math.ceil(1000 / cfg.qlooPerSec), concurrency: 2 });
export const PODCAST = 'urn:entity:podcast';
const GENERIC_TAG = 'urn:tag:genre:media:podcasts';

export class QlooError extends Error {}

async function request(path, params, { fresh = false } = {}) {
  if (!cfg.qlooKey) throw new QlooError('QLOO_API_KEY is not set');
  const url = cfg.qlooBase + path + '?' + new URLSearchParams(params);
  if (!fresh) { const hit = getCached('qloo', url, DAY); if (hit) return hit; }
  if (usage().qloo >= cfg.qlooCallCap) throw new QlooError('Qloo call cap reached for this server');
  let last;
  for (let i = 0; i < 3; i++) {
    last = await limit(async () => {
      add('qloo');
      try {
        const r = await fetch(url, { headers: { 'X-Api-Key': cfg.qlooKey, accept: 'application/json' }, signal: AbortSignal.timeout(45000) });
        const text = await r.text();
        let body; try { body = JSON.parse(text); } catch { body = null; }
        return { status: r.status, body };
      } catch (e) { return { status: 0, body: null, error: String(e.message || e) }; }
    });
    if (![0, 429, 502, 503, 504].includes(last.status)) break;
    await sleep(1500 * (i + 1));
  }
  if (last.status !== 200 || !last.body) throw new QlooError(`Qloo ${path} failed (${last.status})`);
  return setCached('qloo', url, last.body);
}

function itunesIdOf(e) {
  let x = e.external?.itunes ?? e.properties?.external?.itunes;
  if (Array.isArray(x)) x = x[0];
  return x?.id ? String(x.id) : null;
}

function tagsOf(e) {
  return (e.tags || []).map(t => ({ id: t.tag_id || t.id, name: t.name }))
    .filter(t => t.id && t.name && t.id !== GENERIC_TAG && t.id.startsWith('urn:tag:genre:'));
}

export function toEntity(e, rank) {
  return {
    qid: e.entity_id,
    name: e.name,
    itunesId: itunesIdOf(e),
    popularity: typeof e.popularity === 'number' ? e.popularity : null,
    affinity: typeof e.query?.affinity === 'number' ? e.query.affinity : null,
    explain: e.query?.explainability ?? null,
    tags: tagsOf(e),
    rank,
  };
}

// Find the host's show in Qloo. Matched by iTunes id when present; returns all podcast results for the picker.
export async function findPodcast(name, itunesId, opts) {
  const body = await request('/search', { query: name, types: PODCAST, take: '5' }, opts);
  const results = (body.results || []).map((e, i) => toEntity(e, i + 1));
  const byId = itunesId ? results.find(r => r.itunesId === String(itunesId)) : null;
  return { match: byId || null, results };
}

export async function similarPodcasts(entityIds, { take = 50, popularityMax = null, explain = false, fresh = false } = {}) {
  const params = { 'filter.type': PODCAST, 'signal.interests.entities': [].concat(entityIds).join(','), take: String(take) };
  if (popularityMax != null) params['filter.popularity.max'] = Math.min(1, Math.max(0, popularityMax)).toFixed(4);
  if (explain) params['feature.explainability'] = 'true';
  const body = await request('/v2/insights', params, { fresh });
  const ents = body.results?.entities || [];
  return { params: describe(params), list: ents.map((e, i) => toEntity(e, i + 1)) };
}

// Most popular podcasts carrying one genre tag (no taste signal): the "Big name, different crowd" column.
export async function popularInGenre(tagId, take = 10, opts) {
  try {
    const body = await request('/v2/insights', { 'filter.type': PODCAST, 'filter.tags': tagId, take: String(take) }, opts);
    return (body.results?.entities || []).map((e, i) => toEntity(e, i + 1));
  } catch { return []; }
}

// Tags two shows have in common, per /v2/analysis/compare (Day-1 check E2: it returns tags for podcasts).
// Finer tags first (keywords, themes, Qloo genres), broad Apple-style genres after, generic adjectives last.
const TAG_ORDER = ['urn:tag:keyword:qloo', 'urn:tag:theme:qloo', 'urn:tag:genre:qloo', 'urn:tag:genre:media', 'urn:tag:subgenre:qloo'];
export async function sharedTagsCompare(aId, bId, opts) {
  try {
    const body = await request('/v2/analysis/compare', { 'a.signal.interests.entities': aId, 'b.signal.interests.entities': bId }, opts);
    const tags = (body.results?.tags || []).filter(t => t.name && t.tag_id !== GENERIC_TAG && TAG_ORDER.includes(t.subtype || t.type));
    tags.sort((x, y) => TAG_ORDER.indexOf(x.subtype || x.type) - TAG_ORDER.indexOf(y.subtype || y.type));
    const names = [];
    for (const t of tags) if (!names.some(n => n.toLowerCase() === t.name.toLowerCase())) names.push(t.name);
    return names.slice(0, 3);
  } catch { return null; }
}

// Request parameters exactly as sent, so a judge can repeat the call from the receipt.
function describe(params) {
  return { ...params };
}
