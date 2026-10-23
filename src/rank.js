// Labels for each row (spec 3.2, revised: labels only, Qloo's order kept). Pure functions.
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
  // Any time: a past swap found in either feed is labelled, whatever its age.
  const known = dates.filter(Boolean).sort().reverse();
  return known[0] || null;
}

export function swapsWithOthers(host, c) {
  const seen = [];
  for (const s of c.swaps || []) {
    if (sameShow(s.show, host.name) || sameShow(s.show, c.name) || sameShow(s.show, c.showName || '')) continue;
    if (!seen.some(x => sameShow(x.show, s.show))) seen.push(s);
  }
  return seen;
}

// Size label from Qloo popularity (a percentile, not downloads): difference between their value and yours.
export function reachOf(mine, theirs) {
  if (mine == null || theirs == null) return null;
  const d = theirs - mine;
  if (d >= RULES.outOfReachGap) return 'much';
  if (d > RULES.similarReachGap) return 'bigger';
  if (d >= -RULES.outOfReachGap) return 'similar';
  return 'smaller';
}

// The shortlist is Qloo's top 20 in Qloo's order: the same list the evidence page scores (24.3% at k = 20).
// Nothing is moved or dropped. Size, quiet feeds, same publisher or network, and past swaps become labels only.
export function rankCandidates(host, cands, { today = new Date().toISOString().slice(0, 10), bigNames = [] } = {}) {
  const ordered = [...cands].sort((a, b) => a.rank - b.rank);
  for (const c of ordered) {
    const flags = [];
    c.others = swapsWithOthers(host, c);
    c.swappedWithYou = swappedWith(host, c, today);
    c.reach = reachOf(host.popularity, c.popularity);
    c.samePublisher = samePublisher(host, c);
    c.sameNetwork = !c.samePublisher && Boolean(sharedNetwork(host, c));
    c.quietMonths = c.feed?.ok && c.feed.daysSinceLast != null && c.feed.daysSinceLast > RULES.pausedDays ? Math.floor(c.feed.daysSinceLast / 30) : 0;
    if (c.samePublisher) flags.push('Same publisher or feed owner as your show');
    if (c.sameNetwork) flags.push('Same network: both feeds name it in their description');
    if (c.quietMonths) flags.push(`No new episode for ${c.feed.daysSinceLast} days`);
    if (c.reach === 'much') flags.push('Qloo popularity is well above yours');
    if (c.swappedWithYou) flags.push(`You already swapped (${c.swappedWithYou.slice(0, 7)}), found in a feed`);
    c.call = { reasons: flags };
  }
  const shortlist = ordered.slice(0, RULES.shortlist);
  shortlist.forEach((c, i) => { c.position = i + 1; c.call.column = i < RULES.firstFive ? 'firstFive' : 'shortlist'; });
  const more = ordered.slice(RULES.shortlist);
  more.forEach(c => { c.call.column = 'below'; });
  const inQloo = cands.map(c => c.name);
  const big = bigNames.filter(b => !sameShow(b.name, host.name) && !inQloo.some(n => sameShow(n, b.name))).slice(0, 5);
  return { shortlist, more, bigNames: big };
}
