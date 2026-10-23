// Reads a show's own public RSS feed (published for podcast apps). One GET per feed per day; only parsed facts are cached.
import { XMLParser } from 'fast-xml-parser';
import { cfg, RULES } from './config.js';
import { getCached, setCached, DAY } from './cache.js';
import { add } from './usage.js';
import { stripHtml, daysBetween } from './util.js';
import prompts from './prompts.js';

const MAX_BYTES = 20 * 1024 * 1024;
const UA = 'SwapDesk/0.1 (reads public podcast feeds once a day' + (cfg.contactUrl ? '; ' + cfg.contactUrl : '') + ')';
export const PROMO_RE = new RegExp(prompts.promoTitleRegex, 'i');

const parser = new XMLParser({
  ignoreAttributes: false, attributeNamePrefix: '@_', isArray: n => n === 'item',
  processEntities: true, htmlEntities: true, trimValues: true, parseTagValue: false,
});

const text = v => {
  if (v == null) return '';
  if (Array.isArray(v)) return text(v[0]);
  if (typeof v === 'object') return text(v['#text'] ?? '');
  return String(v);
};

function isoDate(s) {
  const d = new Date(text(s));
  return isNaN(d) ? '' : d.toISOString().slice(0, 10);
}

async function download(url) {
  const r = await fetch(url, { headers: { 'User-Agent': UA, accept: 'application/rss+xml, application/xml, text/xml, */*' }, redirect: 'follow', signal: AbortSignal.timeout(20000) });
  if (!r.ok) throw new Error('feed ' + r.status);
  const reader = r.body.getReader();
  const chunks = []; let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > MAX_BYTES) { reader.cancel(); throw new Error('feed too large'); }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString('utf8');
}

export function cadenceLabel(dates) {
  const ds = dates.filter(Boolean).slice(0, 11);
  if (ds.length < 3) return null;
  const gaps = [];
  for (let i = 1; i < ds.length; i++) gaps.push(daysBetween(ds[i], ds[i - 1]));
  gaps.sort((a, b) => a - b);
  const m = gaps[Math.floor(gaps.length / 2)];
  if (m <= 2) return 'daily';
  if (m <= 4) return 'twice a week';
  if (m <= 9) return 'weekly';
  if (m <= 17) return 'every two weeks';
  if (m <= 40) return 'monthly';
  return 'occasional';
}

export function parseFeed(xml, today = new Date().toISOString().slice(0, 10)) {
  const doc = parser.parse(xml);
  const ch = doc?.rss?.channel || doc?.['rdf:RDF']?.channel;
  if (!ch) throw new Error('not an RSS feed');
  const owner = ch['itunes:owner'] || {};
  const items = (ch.item || []).map(it => ({
    title: stripHtml(text(it.title)),
    date: isoDate(it.pubDate),
    desc: stripHtml(text(it.description) || text(it['itunes:summary']) || text(it['content:encoded'])).slice(0, 600),
    link: text(it.link),
  }));
  items.sort((a, b) => (b.date || '').localeCompare(a.date || ''));
  const dated = items.filter(i => i.date);
  const last = dated[0]?.date || null;
  const first = dated.length ? dated[dated.length - 1].date : null;
  return {
    title: stripHtml(text(ch.title)),
    description: stripHtml(text(ch.description) || text(ch['itunes:summary'])).slice(0, 3000),
    author: stripHtml(text(ch['itunes:author'])),
    ownerName: stripHtml(text(owner['itunes:name'])),
    ownerEmail: text(owner['itunes:email']).trim(),
    link: text(ch.link),
    episodeCount: items.length,
    lastEpisode: last,
    daysSinceLast: last ? daysBetween(last, today) : null,
    firstYear: first ? Number(first.slice(0, 4)) : null,
    cadence: cadenceLabel(dated.map(i => i.date)),
    recent: items.slice(0, RULES.recentEpisodes),
    // promo-looking episodes across the whole feed (newest 120), used to find past swaps with your own show
    promoAll: items.filter(e => PROMO_RE.test(e.title)).slice(0, 120),
  };
}

// Promo-looking episodes among the most recent 40 (same title rule as the validation study).
export function promoEpisodes(feed) {
  return (feed.recent || []).filter(e => PROMO_RE.test(e.title));
}

export async function readFeed(url, { fresh = false } = {}) {
  if (!url) return { ok: false, error: 'no feed' };
  if (!fresh) { const hit = getCached('rss', url, DAY); if (hit) return hit; }
  let out;
  try {
    add('rss');
    out = { ok: true, ...parseFeed(await download(url)) };
  } catch (e) {
    out = { ok: false, error: String(e.message || e).slice(0, 120) };
  }
  return setCached('rss', url, out);
}
