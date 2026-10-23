# Day-1 tests: protocol (frozen before any candidate feed is fetched)

Written 2026-10-24 (Taiwan) and committed **before**: any iTunes Lookup for candidates, any candidate RSS fetch,
any LLM call on candidate episodes, any LLM or Qloo call for Test B. The git commit that adds this file is the freeze point.

The two tests decide only what the AI layer of Swap Desk may claim. The product ships either way.

## 0. Inputs (from the frozen validation study, commit `81b319e`; copies in `research/validation/`)

- `anchors.json`: 48 anchors that resolve in Qloo, 185 truth pairs (real promo-swap partners taken from each anchor's own RSS).
- `truth.json`: partners per show, each with `date` = latest promo episode date for that pair in the anchor's feed.
- `anchors_notresolved.json`: 40 shows with >= 2 truth partners that Qloo /search did not resolve.
- `qloo_lists.json`: the cached Qloo podcast -> podcast top 50 (`Q`) per anchor. **Test A makes no new Qloo calls.**
- Matching: `normalize`, `base`, `same` from `common.py`. Recall: `recall()` from `analyze.py`. Anchor cleaning: `clean()` from `analyze.py`.
- Promo title regex: `PROMO_RE` from `discover.py`. Extraction prompt: `extract.py`. LLM-only prompt: `llm_baseline.py`.
  Both prompts are copied verbatim into `src/prompts.json` (checked by script).
- Models: `gpt-4.1-mini`, temperature 0, JSON output.

## 1. Test A: can reading a candidate's feed for swap habits move real partners up?

**Sample.** 48 anchors, 185 pairs, unchanged.

**Candidates.** For each anchor, its cached `Q` list (up to 50) after `clean()`. Original rank r = 1..n in that order.

**Feeds.** Candidate iTunes id from the cached raw Qloo response behind that list (`qloo/Q_<anchor>.json`, entity `external.itunes[0].id`, joined by entity id; the `itunes` field in `qloo_lists.json` is empty because the collector read the wrong path). iTunes Lookup (`/lookup?id=<ids>`, batches of <= 150,
<= 18 calls per minute) gives `feedUrl` and `collectionName`. Each distinct feed is fetched once (GET, 20 s timeout,
25 MB cap). A candidate with no iTunes id, no feed, a failed fetch or unparsable XML has both signals = 0 (counts reported).

**Episode text.** title + " " + description (`description`, else `itunes:summary`; HTML stripped; first 300 characters, as in `extract.py`).

**Episode pools** (per anchor x candidate):
- (a) the candidate's 40 most recent items by pubDate (items without a parseable date sort last).
- (b) the candidate's 40 most recent items dated strictly before cutoff(anchor) = the earliest `date` among the anchor's
  truth partners. Undated items are excluded from (b). (Guards against using information from after the swaps.)

Promo episodes of a pool = items in the pool whose title matches `PROMO_RE`.

**Signals.**
- `H_rule` = 1 if at least one promo episode in the pool whose text does not contain the anchor's main name.
  Main name = `base(anchor)` if it has >= 4 characters, else `normalize(anchor)`; "contains" = substring of `normalize(text)`.
- `H_agent` = 1 if at least one promo episode in the pool has an extracted name X such that
  (i) X appears word for word in that episode's text (case- and whitespace-insensitive),
  (ii) `same(X, candidate name)` is false, and (iii) `same(X, anchor name)` and `same(X, anchor Qloo name)` are false.
- Extraction: the frozen `extract.py` prompt with podcast A = candidate (`collectionName` from Lookup, else the Qloo name).
  Run once per candidate on the union of its promo episodes that appear in pool (a) or in any anchor's pool (b),
  in date-descending chunks of <= 40 episodes, `max_tokens` 3000. Results are stored per episode and reused for every anchor.

**Rerank.** Effective rank = r x 0.5 when the signal is 1, else r. Stable sort by (effective rank, r). Top 20.

**Methods.** Q (original top 20), QH_rule, QH_agent. Macro recall@20 over anchors, frozen `recall()`.

**Placebo.** For each anchor, m = number of its candidates with `H_agent` = 1 (pool a). Pick m candidates uniformly
without replacement, apply the same x 0.5, macro recall@20. 1,000 draws; `random.Random(7)`; anchors in ascending id
order inside each draw.

**Verdict (pool a). PASS only if all three hold:**
1. QH_agent - Q >= +2.0 percentage points;
2. the 95% bootstrap interval of QH_agent - Q (10,000 anchor resamples, seed 7, same procedure as `analyze.py boot`) has lower bound > 0;
3. QH_agent recall is above the 95th percentile of the placebo recalls.

Pool (b) is reported next to (a) with the same three numbers. If (b) points the other way from (a)
(sign of QH_agent - Q differs), public text uses (b) only.

**Report only, never a threshold:** QH_agent - QH_rule with its interval; the same comparisons at k = 5;
the mid + cold subset (T2+T3, tertiles as in `analyze.py`); Qloo recall@50 ceiling; counts of feeds, promo episodes, LLM calls.

**What the product does with it.**
- PASS and the QH_agent - QH_rule interval is above 0: swap habits move rows (x 0.5); credited to reading the feed with the LLM.
- PASS but not separable from the rule: rows move by `H_rule`; the LLM's job is naming who they swapped with and drafting.
- Not PASS: swap habits are shown on the row only and never move it. No lift is claimed anywhere.

**Known bias (goes in Limitations).** The anchors were found by searching for promo-swap words, so swap-habit signals
are probably more common around them than around a typical host.

## 2. Test B: when Qloo doesn't know a show, do seed shows help?

**Sample.** The 40 shows in `anchors_notresolved.json`, truth partners from `truth.json`.

**L.** The frozen `llm_baseline.py` prompt (title, publisher, genre, first 400 characters of the channel description from
`truth.json`), one call per show, up to 20 titles.

**Seeds** (a stand-in for the host picking similar shows, likely more conservative than a real host).
Walk L in order. For each title, Qloo `/search` (`query`=title, `types`=urn:entity:podcast, `take`=5); the first result
whose `normalize(name)` equals `normalize(title)` is a seed, unless `same(title, show)`. Stop at 3 seeds or after 20 titles.

**QF.** Seed names in L order, then the names returned by `/v2/insights`
(`filter.type`=urn:entity:podcast, `signal.interests.entities`=seed ids joined by commas, `take`=50) in returned order;
de-duplicated with `same()`; `clean()` against the show; top 20. With 1 or 2 seeds, use them. With 0 seeds QF is empty (recall 0).

**Verdict. PASS only if** QF - L >= +3.0 percentage points **and** the 95% bootstrap interval (10,000, seed 7) has lower bound > 0.

**Report only:** seeds found per show (0/1/2/3), k = 5, hit counts.

**What the product does with it.** PASS: the fallback screen may show "Seeds + Qloo found X% vs gpt-4.1-mini alone Y%".
Not PASS: the fallback ships with no number: "Qloo doesn't have this show yet. Results below come from the shows you picked."

**Budget.** Test B <= 900 Qloo calls (stop and report if reached). Tests A and B together < 3 USD of OpenAI.

## 3. Extras (report only; none of them is a stop)

- **E1 Qloo re-fetch consistency.** 5 anchors drawn with `random.Random(7)` from the 48 (sorted ids). Re-run the same
  `Q` call. If any top-20 overlap with the cache is < 18/20, the evidence page says the validation is a 2026-10-23 snapshot.
- **E2 compare.** 5 pairs: anchor vs the first of its truth partners that appears in its cached `Q` list (anchors in the
  same E1 order, then onward). `/v2/analysis/compare` with the two entity ids. Record whether any tag field comes back.
  If it returns entities only, compare is not used for Why.
- **E3 `feature.explainability`.** 3 single-signal calls (the first 3 E1 anchors, the `Q` call plus `feature.explainability=true`)
  and 2 three-seed calls (seed ids = the top 3 of an anchor's cached `Q`, for E1 anchors 4 and 5). Record which fields come back.
  If nothing usable, Why uses shared Qloo tags and feed facts only.
- **E4 "Says open to swaps" sample.** 100 candidates drawn with `random.Random(7)` from the distinct Test A candidates whose
  feed parsed (sorted iTunes ids). Product pipeline: regex prefilter (`openToSwapsPrefilter` in `src/prompts.json`) then
  the `openToSwaps` prompt; a quote is kept only if it appears word for word in the description. Reviewer labels: the build
  agent reads all 100 descriptions (not an independent human; stated as such). Report reviewer count, LLM count, agreement.
  If the reviewer finds < 3 explicit statements, the "Says open to swaps" tag leaves the first screen and stays in the receipts only.

## 4. Data handling

Feed text, LLM outputs and Qloo responses stay in `.private/research/day1/` (git-ignored). Only derived numbers go to
`research/day1/results_day1.json`. No Qloo ids, scores or raw responses in the repo.
