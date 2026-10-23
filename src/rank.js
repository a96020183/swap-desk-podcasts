// Ordering and labels (spec 3.2). Pure functions: same input, same output. Qloo's rank is the base order.
import { RULES } from './config.js';
import { normalize, sameShow, daysBetween } from './util.js';

const NETWORK_RE = /\b(?:[Pp]art of|[Mm]ember of|[Aa] production of|[Pp]roduced by|[Bb]rought to you by|[Ff]rom)\s+(?:[Tt]he\s+)?([A-Z][A-Za-z0-9&'.\- ]{1,40}?)\s+(?:[Pp]odcast\s+)?(?:[Nn]etwork|[Mm]edia|[Ss]tudios|[Cc]ollective)\b/g;

export function networksIn(text) {
  const out = new Set();
  for (const m of String(text || '').matchAll(NETWORK_RE)) {
    const n = normalize(m[1]);
    if (n.length >= 3) out.add(n);
  }
  return out;
}

function samePublisher(host, c) {
  const pairs = [
    [host.artist, c.artist], [host.ownerName, c.feed?.ownerName], [host.author, c.feed?.author],
  ];
  if (pairs.some(([a, b]) => normalize(a) && normalize(a) === normalize(b))) return true;
  const he = String(host.ownerEmail || '').toLowerCase(), ce = String(c.feed?.ownerEmail || '').toLowerCase();
  return Boolean(he && he === ce);
}

function sharedNetwork(host, c) {
  const h = networksIn(host.description);
  if (!h.size) return null;
  for (const n of networksIn(c.feed?.description)) if (h.has(n)) return n;
  return null;
}

// Has either side's feed run a swap with the other inside the window? Returns the most recent date.
export function swappedWith(host, c, today) {
  const names = [c.name, c.showName].filter(Boolean);
  const dates = [];
  for (const s of c.swaps || []) if (sameShow(s.show, host.name)) dates.push(s.date);
  for (const s of host.swaps || []) if (names.some(n => sameShow(s.show, n))) dates.push(s.date);
  const recent = dates.filter(d => d && daysBetween(d, today) <= RULES.recentSwapDays).sort().reverse();
  return recent[0] || null;
}

export function swapsWithOthers(host, c) {
  const seen = [];
  for (const s of c.swaps || []) {
    if (sameShow(s.show, host.name) || sameShow(s.show, c.name) || sameShow(s.show, c.showName || '')) continue;
    if (!seen.some(x => sameShow(x.show, s.show))) seen.push(s);
  }
  return seen;
}

export function rankCandidates(host, cands, { habitRerank = false, today = new Date().toISOString().slice(0, 10), bigNames = [] } = {}) {
  const removed = [], paused = [], outOfReach = [], active = [];
  for (const c of cands) {
    const call = { reasons: [] };
    c.call = call;
    c.others = swapsWithOthers(host, c);
    c.swappedWithYou = swappedWith(host, c, today);
    c.reach = host.popularity == null || c.popularity == null ? null : (c.inSimilar ? 'similar' : 'bigger');
    if (samePublisher(host, c)) { call.column = 'removed'; call.reasons.push('Same publisher or feed owner as your show'); removed.push(c); continue; }
    const net = sharedNetwork(host, c);
    if (net) { call.column = 'removed'; call.sameNetwork = true; call.reasons.push('Same network (both feeds name it in their description)'); removed.push(c); continue; }
    if (c.feed?.ok && c.feed.daysSinceLast != null && c.feed.daysSinceLast > RULES.pausedDays) {
      call.column = 'paused'; call.reasons.push(`No new episode for ${c.feed.daysSinceLast} days`); paused.push(c); continue;
    }
    if (host.popularity != null && c.popularity != null && c.popularity - host.popularity >= RULES.outOfReachGap) {
      call.column = 'outOfReach'; call.reasons.push('Qloo popularity is well above yours'); outOfReach.push(c); continue;
    }
    let eff = c.rank;
    if (habitRerank && c.others.length) { eff *= RULES.habitBoost; call.reasons.push('Moved up: trades promos with other shows'); }
    if (c.swappedWithYou) { eff += 1000; call.reasons.push('Moved down: you already swapped in the last 12 months'); }
    c.eff = eff;
    active.push(c);
  }
  active.sort((a, b) => a.eff - b.eff || a.rank - b.rank);
  const shortlist = active.slice(0, RULES.shortlist);
  shortlist.forEach((c, i) => { c.position = i + 1; c.call.column = i < RULES.firstFive ? 'firstFive' : 'shortlist'; });
  active.slice(RULES.shortlist).forEach(c => { c.call.column = 'below'; });
  const inQloo = cands.map(c => c.name);
  const big = bigNames.filter(b => !sameShow(b.name, host.name) && !inQloo.some(n => sameShow(n, b.name))).slice(0, 5);
  return { shortlist, outOfReach: outOfReach.slice(0, 5), bigNames: big, paused, removed, more: active.slice(RULES.shortlist) };
}
