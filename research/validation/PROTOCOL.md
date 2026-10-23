# Wave 6 — Podcast promo-swap stop-loss test (frozen before any answer data or Qloo method call)

Date: 2026-10-23 (Taiwan). Written and committed BEFORE: fetching any RSS feed, extracting any promo partner,
calling Qloo insights for any anchor, or calling the LLM baseline. (One Qloo /search probe for "Midnight Burger"
and one iTunes episode search for "feed drop" were run only to check field availability.)

## 0. Question
Indie podcast hosts pick promo-swap / feed-drop partners mainly by audience fit. Does Qloo podcast->podcast
affinity surface the shows a podcast ACTUALLY promoted (feed drops, trailer swaps, crossovers) better than
(a) an LLM alone and (b) popularity / genre rules, on mid-tier and cold shows?

## 1. External answer (independent of Qloo, legal)
- Discovery: Apple's documented iTunes Search API (performance-partners.apple.com/search-api, ~20 calls/min;
  we stay <= 18/min). `entity=podcastEpisode, media=podcast, country=US, limit=200` for each term:
  "feed drop", "feed swap", "promo swap", "pod swap", "podcast swap", "trailer swap", "show swap", "crossover episode".
  Candidate shows = distinct collectionId with a feedUrl.
- Answer source: each candidate show's own public RSS feed (published for podcast apps). One GET per feed, 20 s timeout.
  No podcasts.apple.com page is read (Apple site terms forbid page-scraping).
- Promo episodes: episode title matches (case-insensitive)
  `feed[\s-]*drop|feed[\s-]*swap|promo[\s-]*swap|pod(cast)?[\s-]*swap|trailer[\s-]*swap|show[\s-]*swap|cross[\s-]*over|introducing|presenting|sneak[\s-]*peek|we think you.?ll (like|love|enjoy)|check out`
  Keep at most the 40 most recent matching episodes per show.
- Extraction: gpt-4.1-mini, temperature 0, JSON, one call per show with all its promo episodes
  (title + first 300 chars of description, HTML stripped). Prompt in `extract.py` (frozen in this commit).
  It returns, per episode, the exact title of a DIFFERENT podcast being promoted/feed-dropped/crossed-over, or "".
- Resolution: each extracted name -> iTunes Search `entity=podcast, limit=5`. Accept the first result whose
  normalized collectionName equals the normalized name, or whose base title (text before ':' ' - ' ' | ' '(')
  equals the name's base title (normalization in section 4). Unresolved names are dropped.
- Exclusions for a truth pair (anchor -> partner):
  partner collectionId == anchor collectionId; same artistName (case/space-insensitive);
  normalized partner name contains normalized anchor base name or vice versa (spin-offs).
- Truth set T(anchor) = distinct resolved partners after exclusions. Each pair also stores the latest pubDate of
  its promo episode(s) (for the recency secondary analysis).

## 2. Anchors
- Eligible = |T| >= 2 AND the anchor resolves in Qloo: Qloo /search (types=urn:entity:podcast, take=5, query=
  collectionName) result whose properties.external.itunes.id == anchor collectionId; if none, accept an exact
  normalized-name match. Otherwise not eligible (reported as coverage).
- Qloo /search for anchors is run in candidate order sorted by collectionId ascending, only for candidates with
  |T| >= 2, until 70 eligible anchors or the candidate list ends.
- Popularity tiers: tertiles of Qloo `popularity` among eligible anchors (T1 = top third, T2, T3 = coldest).
  "Mid/cold" = T2+T3.

## 3. Methods (each returns a ranked list; anchor itself removed; K=20 primary)
- Q  (Qloo plain): /v2/insights filter.type=urn:entity:podcast, signal.interests.entities=<anchor id>, take=50.
- QS (Qloo size-matched, product variant, secondary): same + filter.popularity.max = min(1, anchor_pop + 0.02).
- R1 (genre popularity rule): /v2/insights filter.type=urn:entity:podcast, filter.tags=<anchor's first genre tag that
  is not urn:tag:genre:media:podcasts>, take=50, no signal (Qloo default order). If that request is rejected or empty,
  fallback: signal.interests.tags=<same tag> (genre-only taste, no anchor entity). Cached per tag.
- R2 (genre + same-size rule): R1 query + filter.popularity.min = anchor_pop - 0.03, filter.popularity.max = anchor_pop + 0.03.
  Fallback same as R1. 
- L  (LLM only): gpt-4.1-mini, temperature 0, one call per anchor, given anchor title, publisher (artistName),
  iTunes primary genre, and the first 400 chars of the RSS channel description. No candidate list. Prompt in
  `llm_baseline.py` (frozen). Returns 20 titles.
- Secondary combos: Q∪L interleaved (Q1, L1, Q2, L2, ... dedup, cut at 20).

## 4. Matching (same rule for every method)
normalize(s): NFKD strip accents; lowercase; '&' -> ' and '; non-alphanumeric -> space; drop tokens
{the, a, an, podcast, pod, show, official}; collapse spaces. base(s) = normalize(text before the first ':' or ' - '
or ' | ' or ' (' ).
A method item hits truth partner p if normalize(item) == normalize(p) or base(item) == base(p) (base length >= 4 chars).
Each truth partner can be hit once.

## 5. Metric and pre-registered thresholds
- Per anchor recall@20 = hits / |T|. Macro average over anchors.
- PRIMARY (main claim): D = recall@20(Q) - max(recall@20(L), recall@20(R1), recall@20(R2)), the best baseline chosen
  on the full sample. PASS iff D >= 5 percentage points AND the 95% bootstrap CI of D (10,000 resamples of anchors,
  seed 7, best baseline fixed) has lower bound > 0.
- Sample floor: >= 40 eligible anchors and >= 100 truth pairs. Below the floor = NOT PASS (underpowered).
- If PRIMARY fails, the main claim ("Qloo finds real promo partners better than LLM/rules") is not made and the topic
  is not submitted (SOP section 5).
- Secondary (reported, never rescue the primary): recall@50; hit rate (>=1 hit in top 20); D within T1 and within T2+T3;
  QS and Q∪L; recency split (pairs with latest promo pubDate >= 2025-01-01 vs earlier); share of truth partners that
  exist in Qloo (Qloo /search by name, only if budget allows after the primary).

## 6. Budgets and safety
Qloo <= 590 calls this wave (counter file). OpenAI < 1 USD (usage file). Keys read from files, never printed or written.
Raw responses stay in this scratchpad only (developer guide: no Qloo data in public repos).
Post-hoc analyses added after seeing results are labelled [post-hoc] and committed separately.
