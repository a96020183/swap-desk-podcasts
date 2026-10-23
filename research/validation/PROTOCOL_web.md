# Wave 6b: web-search LLM comparison (frozen before any model call)

Date: 2026-10-23 (Taiwan). Written and committed BEFORE any call to the model below. Only call made before this
commit: GET /v1/models (to see which models exist; no generation). No Qloo calls in this wave (cached lists only).
This is a [post-hoc] comparison added after blind review R2. It never changes the frozen primary verdict of PROTOCOL.md.

## 0. Question
On the same anchors and the same truth set as PROTOCOL.md, does a strong OpenAI model WITH web search find the shows
a podcast really swapped promos with as well as Qloo's top 20 does?

## 1. Model and tool (fixed)
- Model: `gpt-5.5-2026-04-23` (pinned snapshot of gpt-5.5, the strongest general model listed by /v1/models for this key
  on 2026-10-23 with public pricing; gpt-5.5-pro excluded for cost, gpt-5.6-* excluded: no public pricing found).
  Fallback model only under the section 4 rule: `gpt-5.4-2026-03-05`.
- API: Responses API, `tools=[{"type":"web_search","search_context_size":"low"}]`, `tool_choice="auto"`,
  `include=["web_search_call.action.sources"]`, `reasoning={"effort":"low"}`, `max_output_tokens=20000`, `store=false`.
  No user location. No system prompt. One request per anchor, retries only on HTTP/network errors (up to 3 tries).
- Why low effort / low search context: cost. Two accidental calls at medium effort / default context cost 0.60 and
  0.70 USD each (72k-84k input tokens, mostly search content; section 9), which would not fit 24 anchors under the cap.

## 2. Prompt (fixed; same inputs as the frozen `llm_baseline.py`; no candidate list, no answers)
```
You help independent podcasters plan promo swaps (two shows play each other's trailer or an episode in their feeds).
Podcast: "{title}"
Publisher: {artist}
Apple genre: {genre}
Description: {desc}
Search the web as much as you need. Then list the 20 existing podcasts that would be the best promo-swap partners for this podcast, best partner first. Do not include shows from the same publisher. Use exact podcast titles.
Return JSON only, in this form: {"podcasts": ["title", ...]}
```
`title`, `artist`, `genre`, `desc` = `anchor`, `artist` (or "unknown"), `genre` (or "unknown"), `channel_desc` from `anchors.json`.

Parsing (fixed): take the concatenated `output_text`; use the last JSON object that has a "podcasts" list; if none,
take lines that look like list items (`1.`, `1)`, `-`, `*`), strip markdown, quotes and bracketed citations. Keep the
first 20 strings. An anchor whose call fails after retries, or that yields 0 titles, scores 0 (reported; a sensitivity
analysis without those anchors is also reported).

## 3. Anchors and sample
- Pool = the 48 anchors of the frozen primary test (`anchors.json`, all have Qloo and gpt-4.1-mini lists).
- Order = `sorted(anchor ids)` shuffled with `random.Random(20261023)`. SUBSET24 = first 24 in that order.

## 4. Budget rules (user cap 8 USD for the whole wave)
Cost per call = (input_tokens - cached) x Pin/1M + cached x Pcache/1M + output_tokens x Pout/1M + 0.01 per
`web_search_call` item (every item counted, conservative). Prices from developers.openai.com/api/docs/pricing:
gpt-5.5 5.00 / 0.50 / 30.00; gpt-5.4 2.50 / 0.25 / 15.00 per 1M; web search 10 per 1k calls, search content billed as tokens.
Already spent before this commit (section 9): 1.30 USD recorded + up to 0.70 USD for a possibly billed third call
= 2.00 USD assumed. NEW SPEND CAP for scored runs = 5.60 USD (wave total <= 7.60).
- Stage 0: order[0:3] with gpt-5.5. If their mean cost <= 0.22 USD, MODEL = gpt-5.5. Otherwise MODEL = gpt-5.4 and
  order[0:3] are re-run with gpt-5.4 (gpt-5.5 outputs kept as an appendix only, never scored in the main result).
- Stage 1: rest of SUBSET24 with MODEL, up to 3 calls in flight. No new call starts once new spend >= 5.60.
- Stage 2: only if new spend after SUBSET24 + 24 x (mean cost per anchor with MODEL) <= 5.60, run the other 24.
- PRIMARY SET = all 48 if Stage 2 completes; otherwise SUBSET24 (extra Stage-2 anchors go to an appendix only).
  If the cap stops SUBSET24 early, PRIMARY SET = the completed SUBSET24 anchors, flagged underpowered if < 20.

## 5. Scoring (identical to analyze.py / posthoc_k.py)
Same `clean()` (drop the anchor's own name / Qloo name), same `same()` matching (PROTOCOL.md section 4), same truth
partners, recall@k = hits / |T| per anchor, macro average. k = 5, 10, 20 (20 = primary).
Methods compared on the PRIMARY SET: Q (Qloo plain, cached `qloo_lists.json`), W (this wave), L (gpt-4.1-mini without
web search, cached `llm_lists.json`). Bootstrap: 10,000 resamples of anchors, seed 7, percentile 95% CI of Q - W and W - L.
Also hit rate (>= 1 real partner in top k).

## 6. Leakage (answer pages), fixed rules
For each anchor A, URLs come from (i) `url_citation` annotations (url + title) and (ii) web_search_call sources /
opened pages (url only). Each URL is classed:
- Answer-episode URLs of A: from A's cached RSS, items whose title matches the frozen PROMO_RE AND (pubDate equals a truth
  pair's date OR title+description contains a truth partner's base name); their `<link>` (only if it differs from the
  channel link and has a non-empty path), `<guid>` if it is a URL, and enclosure URL. Plus A's feed URL itself.
- url_norm: lowercase, drop scheme, "www.", fragment, trailing "/", and the query (except Apple `i=` episode ids).
- text(u, title) = normalize(url-decoded host+path with - _ / . turned into spaces) + " " + normalize(title).
- about_A(u, title): "id"+A's collectionId in the URL, or host == host of A's channel `<link>`, or text contains base(A)
  (or base of A's Qloo name) as whole tokens, length >= 4.
- L1 ANSWER PAGE: url_norm(u) equals an answer-episode URL or A's feed URL; OR about_A and text contains a truth partner's
  base name (>= 4 chars); OR text contains a truth partner's base name and A's base name (partner-side page about A).
- L2 BROAD: about_A (any page about the show itself, e.g. its directory page that lists episodes) or L1.
An anchor is "leaked" if any cited OR consulted URL is L1. Limitation: we only read URLs and citation titles, never the
pages, so L1 misses answer text that sits inside a page body; L2 is reported as the broader bound.

Reported side by side: (a) PRIMARY SET; (b) PRIMARY SET minus leaked (L1) anchors; (c) minus L2 anchors (report only).
Also: share of anchors citing podcasts.apple.com, rephonic.com, matchmaker.fm, podchaser.com, listennotes.com.

## 7. Decision rule (fixed)
- QLOO STILL WINS iff the 95% CI of Q - W at k=20 has lower bound > 0 in (a) AND in (b). (b) counts only if it has
  >= 12 anchors; otherwise (a) alone decides and this is stated.
- Otherwise WEB LLM NOT WORSE: Swap Desk narrows its public claims: no "one in sixteen" style LLM line in the pitch;
  the evidence page shows the web-search row next to Qloo; claims are limited to what still holds (ranking checked
  against real swaps, provenance on every row, subsets where Qloo's lower bound stays > 0). Written plainly in v3.
- If QLOO STILL WINS, one sentence for the evidence page: "With web search, <MODEL> found W% of real partners in its
  top 20. Qloo found Q% on the same shows."
- k=5 and k=10 are reported, never decide.

## 8. Files
`web_llm.py` (runner, writes data/web_llm.json and data/web_raw/), `analyze_web.py` (scoring + leakage, writes
results_web.json). Key read from file, never printed or written. Raw responses stay in this scratchpad.

## 9. Incident before this commit (recorded, not hidden)
While dry-running the leakage helpers, `import web_llm` was executed by mistake, which started the runner before this
protocol was committed. It was stopped within about 2 minutes. Two Stage-0 calls completed (anchors 1161867961 and
1744365897, gpt-5.5, effort medium, default search context; 0.597 + 0.702 USD); a third call may have been in flight
and billed. Only the console line (title count, number of searches, cost) and token usage were seen; the titles were
not read and nothing was scored. Their files were moved to `data/web_precommit_discarded/` and are never scored or
used. The prompt, parsing, scoring and leakage rules above are the same as in that accidental run; sections 1 and 4
were changed only for cost (effort, search context size, cap, fallback model), based on token counts, not on results.
The runner now only runs under `if __name__ == "__main__"`.
