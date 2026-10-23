// One run: your show -> Qloo podcast neighbours -> their feeds -> ranked shortlist with receipts.
import { RULES } from './config.js';
import { lookupShows, searchShows } from './itunes.js';
import * as qloo from './qloo.js';
import { readFeed, promoEpisodes } from './rss.js';
import { extractSwaps, openToSwaps, llmOnlyList } from './extract.js';
import { rankCandidates } from './rank.js';
import { whyParts, chips, sharedTags, explainedBy as whyExplained } from './why.js';
import { usage } from './usage.js';
import { sameShow, normalize, namesAgree } from './util.js';

const median = xs => { const v = xs.filter(x => typeof x === 'number').sort((a, b) => a - b); return v.length ? v[Math.floor((v.length - 1) / 2)] : null; };

async function pool(items, n, fn) {
  const out = new Array(items.length); let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (i < items.length) { const k = i++; out[k] = await fn(items[k], k); }
  }));
  return out;
}

const diff = (a, b) => ({
  qloo: b.qloo - a.qloo, feeds: b.rss - a.rss, itunes: b.itunes - a.itunes,
  llmCalls: b.openaiCalls - a.openaiCalls, llmUsd: Math.round((b.openaiUsd - a.openaiUsd) * 10000) / 10000,
});

export async function loadHost(itunesId, { fresh = false } = {}) {
  const shows = await lookupShows([itunesId]);
  const show = shows.get(String(itunesId));
  if (!show) throw new Error('We could not find that show in the iTunes directory.');
  const feed = await readFeed(show.feedUrl, { fresh });
  return { show, feed };
}

// Seed suggestions when Qloo doesn't know the show: the LLM-only list, each checked in Qloo.
export async function seedSuggestions(show, feed) {
  let names = [];
  try { names = await llmOnlyList(show, feed?.description); } catch { names = []; }
  const out = [];
  for (const name of names) {
    if (out.length >= 5) break;
    if (sameShow(name, show.name)) continue;
    let hit = null;
    try { hit = (await qloo.findPodcast(name)).results.find(r => normalize(r.name) === normalize(name)) || null; } catch { hit = null; }
    out.push(hit ? { name: hit.name, inQloo: true, qid: hit.qid, popularity: hit.popularity } : { name, inQloo: false });
  }
  return out;
}

export async function runShortlist({ itunesId, seeds = null, fresh = false, step = () => {} }) {
  const u0 = usage();
  const today = new Date().toISOString().slice(0, 10);
  step('show', 'Finding your show');
  const { show, feed: hostFeed } = await loadHost(itunesId, { fresh });

  let hostEntity = null, seedEntities = [];
  step('qloo', 'Asking Qloo which podcasts share your audience');
  if (seeds && seeds.length) {
    seedEntities = seeds.slice(0, 5);
  } else {
    const found = await qloo.findPodcast(show.name, show.itunesId, { fresh });
    hostEntity = found.match;
    if (!hostEntity) {
      step('fallback', 'Qloo does not have this show yet');
      return {
        status: 'notInQloo', host: hostView(show, hostFeed, null),
        suggestions: await seedSuggestions(show, hostFeed), usage: diff(u0, usage()),
      };
    }
  }

  const signal = hostEntity ? [hostEntity.qid] : seedEntities.map(s => s.qid);
  const main = await qloo.similarPodcasts(signal, { take: RULES.candidates, explain: true, fresh });
  const genreTag = (hostEntity?.tags || seedEntities[0]?.tags || [])[0];
  const bigNamesRaw = genreTag ? await qloo.popularInGenre(genreTag.id, 10, { fresh }) : [];

  // Candidate list: seeds first (fallback only), then Qloo's ranking; your own show removed.
  let list = main.list.filter(e => !(hostEntity && e.qid === hostEntity.qid) && !(e.itunesId && e.itunesId === show.itunesId) && !sameShow(e.name, show.name));
  // Fallback: your picks are shown above the list, not inside it; the list is what Qloo finds from them.
  if (seedEntities.length) list = list.filter(e => !seedEntities.some(s => s.qid === e.qid || sameShow(s.name, e.name)));
  list = list.slice(0, RULES.candidates).map((e, i) => ({ ...e, rank: i + 1 }));

  step('feeds', `Reading ${list.length} feeds`, { done: 0, total: list.length });
  const meta = await lookupShows(list.map(e => e.itunesId).filter(Boolean));
  // Qloo's iTunes id sometimes points at a different show. Only join a feed when the names agree;
  // otherwise try a few iTunes searches by the Qloo name.
  let searches = 0;
  for (const e of list) {
    const m = e.itunesId ? meta.get(e.itunesId) : null;
    if (m && namesAgree(m.name, e.name)) { e.meta = m; continue; }
    e.idMismatch = Boolean(m);
    if (searches < 6) {
      searches++;
      try { e.meta = (await searchShows(e.name, 3)).find(s => namesAgree(s.name, e.name)) || null; } catch { e.meta = null; }
    }
  }
  let done = 0;
  const cands = await pool(list, 10, async e => {
    const m = e.meta || null;
    const feed = m?.feedUrl ? await readFeed(m.feedUrl, { fresh })
      : { ok: false, error: e.idMismatch ? `Qloo's iTunes link (id ${e.itunesId}) points to a show with a different name, and an iTunes search for "${e.name}" found no match, so we did not read a feed` : e.itunesId ? 'no public feed found' : 'no iTunes id from Qloo' };
    done++; step('feeds', `Reading ${list.length} feeds`, { done, total: list.length });
    const { meta: _m, ...rest } = e;
    return {
      ...rest, showName: m?.name || e.name, artist: m?.artist || '', artwork: m?.artwork || e.image || '', genre: m?.genre || '',
      feedUrl: m?.feedUrl || '', feed, feedMismatch: Boolean(e.idMismatch && !m),
    };
  });

  step('swaps', 'Reading promo episodes');
  const host = {
    name: show.name, artist: show.artist, author: hostFeed.author, ownerName: hostFeed.ownerName, ownerEmail: hostFeed.ownerEmail,
    description: hostFeed.description, popularity: hostEntity?.popularity ?? median(seedEntities.map(s => s.popularity)),
    sizeBase: hostEntity ? 'yours' : 'your picks', tags: hostEntity?.tags || [],
    swaps: hostFeed.ok ? (await extractSwaps(show.name, hostFeed, { allTime: true })).swaps : [],
  };
  await pool(cands, 6, async c => {
    if (!c.feed?.ok) { c.swaps = []; c.swapCheck = { checked: 0 }; return; }
    const ex = await extractSwaps(c.showName, c.feed);
    c.swaps = ex.swaps; c.swapCheck = { checked: ex.checked, dropped: ex.dropped };
    c.openQuote = await openToSwaps(c.showName, c.feed.description);
  });

  step('rank', 'Putting your first five on top');
  const ranked = rankCandidates(host, cands, { today, bigNames: bigNamesRaw });
  // What two shows have in common, per Qloo's compare endpoint: first five only (one call each, cached a day).
  const anchorId = hostEntity?.qid || seedEntities[0]?.qid;
  if (anchorId) {
    await pool(ranked.shortlist.slice(0, RULES.firstFive).filter(c => c.qid && c.qid !== anchorId), 5, async c => {
      c.compareTags = await qloo.sharedTagsCompare(anchorId, c.qid, { fresh });
    });
  }
  const hostFacts = { link: `https://podcasts.apple.com/us/podcast/id${show.itunesId}`, name: show.name, episodes: hostFeed.ok ? hostFeed.episodeCount : null, cadence: hostFeed.ok ? hostFeed.cadence : null, since: hostFeed.ok ? hostFeed.firstYear : null };
  const row = c => rowView(host, c, { hostFacts, seeds: seedEntities, qlooParams: main.params, compareWith: hostEntity ? 'your show' : seedEntities[0]?.name });

  let llmOnly = [];
  try { llmOnly = await llmOnlyList(show, hostFeed.description); } catch { llmOnly = []; }

  return {
    status: 'ok', ranAt: new Date().toISOString(), host: hostView(show, hostFeed, hostEntity),
    seeds: seedEntities.map(s => s.name),
    shortlist: ranked.shortlist.map(row),
    more: ranked.more.map(row),
    bigNames: ranked.bigNames.map(b => ({ name: b.name, popularity: b.popularity })),
    llmOnly: llmOnly.map(name => ({ name, inShortlist: ranked.shortlist.some(r => sameShow(r.showName, name) || sameShow(r.name, name)) })),
    usage: diff(u0, usage()),
  };
}

function hostView(show, feed, ent) {
  return {
    itunesId: show.itunesId, name: show.name, artist: show.artist, artwork: show.artwork, genre: show.genre,
    inQloo: Boolean(ent), popularity: ent?.popularity ?? null,
    feed: feed?.ok ? { episodeCount: feed.episodeCount, cadence: feed.cadence, firstYear: feed.firstYear, daysSinceLast: feed.daysSinceLast } : null,
  };
}

function rowView(host, c, ctx) {
  c.sharedTags = sharedTags(host, c);
  const f = c.feed || {};
  return {
    key: c.itunesId || c.qid,
    position: c.position || null,
    name: c.showName || c.name,
    artist: c.artist, artwork: c.artwork, seed: Boolean(c.seed),
    chips: chips(host, c),
    why: whyParts(host, c, { seeds: ctx.seeds }),
    tagLine: c.sharedTags.length ? `Qloo tags you share: ${c.sharedTags.join(', ')}` : 'Qloo gave a score, not a reason',
    contact: f.ownerEmail || null,
    website: /^https?:\/\//i.test(f.link || '') ? f.link : null,
    receipt: {
      qloo: {
        name: c.name, entityId: c.qid, rank: c.rank, affinity: c.affinity, popularity: c.popularity,
        tags: (c.tags || []).map(t => t.name), sharedTags: c.sharedTags, compareTags: c.compareTags || null,
        compareWith: c.compareTags ? ctx.compareWith : null,
        explainedBy: whyExplained(c, ctx.seeds),
        explainScores: ctx.seeds.length > 1 && Array.isArray(c.explain?.['signal.interests.entities'])
          ? c.explain['signal.interests.entities'].map(x => ({ name: ctx.seeds.find(s => s.qid === x.entity_id)?.name || x.entity_id, score: x.score })) : null,
        params: ctx.qlooParams, hostPopularity: host.popularity, sizeBase: host.sizeBase, seed: Boolean(c.seed),
      },
      feed: f.ok ? {
        url: c.feedUrl, lastEpisode: f.lastEpisode, daysSinceLast: f.daysSinceLast, episodeCount: f.episodeCount,
        cadence: f.cadence, firstYear: f.firstYear, promoChecked: c.swapCheck?.checked || 0,
        swaps: (c.swaps || []).map(s => ({ show: s.show, episode: s.episode, date: s.date })),
        openQuote: c.openQuote || null, recentTitles: (f.recent || []).slice(0, 3).map(e => e.title),
      } : { error: f.error || 'feed not read' },
      call: { column: c.call?.column, position: c.position || null, reasons: c.call?.reasons || [] },
    },
    _draft: { host: ctx.hostFacts || { name: host.name }, cand: { name: c.name, showName: c.showName, feed: { ownerName: f.ownerName, recent: (f.recent || []).slice(0, 3) }, others: c.others || [], pastSwap: c.swappedWithYou || null, sharedTags: c.compareTags?.length ? c.compareTags : c.sharedTags, openQuote: c.openQuote || '' } },
  };
}

export { promoEpisodes };
