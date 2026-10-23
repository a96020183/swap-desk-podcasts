import crypto from 'node:crypto';

const STOP = new Set(['the', 'a', 'an', 'podcast', 'pod', 'show', 'official']);

// Same name matching as the validation study (normalize + base title).
export function normalize(s) {
  return String(s || '').normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, ' ')
    .split(' ').filter(t => t && !STOP.has(t)).join(' ');
}

export function base(s) {
  s = String(s || '');
  let cut = s.length;
  for (const sep of [':', ' - ', ' | ', ' (', ' – ', ' — ']) {
    const i = s.indexOf(sep);
    if (i > 0) cut = Math.min(cut, i);
  }
  return normalize(s.slice(0, cut));
}

export function sameShow(a, b) {
  const na = normalize(a), nb = normalize(b);
  if (na && na === nb) return true;
  const ba = base(a), bb = base(b);
  return ba.length >= 4 && ba === bb;
}

const ENTITIES = { nbsp: ' ', amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", rsquo: '’', lsquo: '‘', ldquo: '“', rdquo: '”', hellip: '…', mdash: '—', ndash: '–' };

export function decodeEntities(s) {
  return String(s || '')
    .replace(/&#(\d+);/g, (_, n) => safeCp(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => safeCp(parseInt(n, 16)))
    .replace(/&([a-z]+);/gi, (m, n) => ENTITIES[n.toLowerCase()] ?? m);
}
function safeCp(n) { try { return String.fromCodePoint(n); } catch { return ' '; } }

export function stripHtml(s) {
  // decode first so escaped tags (&lt;p&gt;) are removed too
  return decodeEntities(decodeEntities(String(s || '')).replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
}

const squash = t => String(t || '').toLowerCase()
  .replace(/[‘’ʼ]/g, "'").replace(/[“”]/g, '"').replace(/[–—]/g, '-')
  .replace(/\s+/g, ' ').trim();

// Case- and whitespace-insensitive "appears word for word in". Every LLM output we keep must pass this.
export function appearsVerbatim(needle, haystack) {
  const n = squash(needle);
  return n.length >= 2 && squash(haystack).includes(n);
}

export const sha1 = s => crypto.createHash('sha1').update(String(s)).digest('hex');
export const sleep = ms => new Promise(r => setTimeout(r, ms));

export function daysBetween(a, b) {
  return Math.floor((new Date(b) - new Date(a)) / 86400000);
}

export function monthYear(iso) {
  const d = new Date(iso);
  if (isNaN(d)) return '';
  return d.toLocaleString('en-US', { month: 'short', year: 'numeric', timeZone: 'UTC' });
}

// Apple Podcasts link or bare number -> iTunes collection id. We read the id from the text; we never open the page.
export function parseItunesId(text) {
  const s = String(text || '').trim();
  const m = s.match(/(?:^|[^0-9a-z])id(\d{6,12})(?:[^0-9]|$)/i) || s.match(/^(\d{6,12})$/);
  return m ? m[1] : null;
}
