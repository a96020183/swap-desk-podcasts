// Apple's documented iTunes Search API (performance-partners.apple.com/search-api).
// We stay under 18 calls per minute and cache results. We never open podcasts.apple.com pages.
import { cfg } from './config.js';
import { makeLimiter } from './limiter.js';
import { getCached, setCached, DAY } from './cache.js';
import { add } from './usage.js';

const limit = makeLimiter({ minGapMs: Math.ceil(60000 / cfg.itunesPerMin), concurrency: 1 });
const UA = 'SwapDesk/0.1 (podcast promo-swap helper)';

async function call(path, params) {
  const url = 'https://itunes.apple.com' + path + '?' + new URLSearchParams(params);
  const hit = getCached('itunes', url, 7 * DAY);
  if (hit) return hit;
  const data = await limit(async () => {
    add('itunes');
    const r = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(20000) });
    if (!r.ok) throw new Error('iTunes ' + r.status);
    return r.json();
  });
  return setCached('itunes', url, data);
}

export function toShow(r) {
  if (!r || !r.collectionId) return null;
  return {
    itunesId: String(r.collectionId),
    name: r.collectionName || r.trackName || '',
    artist: r.artistName || '',
    feedUrl: r.feedUrl || '',
    artwork: r.artworkUrl600 || r.artworkUrl100 || '',
    genre: r.primaryGenreName || '',
    episodes: r.trackCount || null,
    lastRelease: r.releaseDate || null,
  };
}

export async function searchShows(term, limitN = 6) {
  const d = await call('/search', { term, media: 'podcast', entity: 'podcast', country: 'US', limit: String(limitN) });
  return (d.results || []).map(toShow).filter(s => s && s.feedUrl);
}

export async function lookupShows(ids) {
  const out = new Map();
  const list = [...new Set(ids.map(String))];
  for (let i = 0; i < list.length; i += 150) {
    const d = await call('/lookup', { id: list.slice(i, i + 150).join(','), entity: 'podcast' });
    for (const r of d.results || []) { const s = toShow(r); if (s) out.set(s.itunesId, s); }
  }
  return out;
}
