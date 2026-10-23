# Wave 6c: Test C, Qloo + web-search LLM merged list on held-out anchors (frozen before any model call)

Date: 2026-10-23 (Taiwan). Written and committed BEFORE any model call of this wave. [post-hoc] idea: it came from
the wave 6b observation that Qloo and the web LLM hit partly different partners (8 shared, 5 Qloo-only, 5 web-only
of 95 pairs in SUBSET24). To avoid testing on the data that suggested it, Test C uses only the 24 HELD-OUT anchors.
Never changes the frozen primary verdict (PROTOCOL.md) or the 6b verdict (PROTOCOL_web.md).

## 1. Anchors
HELD24 = `order[24:48]`, where order = sorted(anchor ids of `anchors.json`) shuffled with random.Random(20261023)
(the same order as PROTOCOL_web.md; these 24 were never sent to the web LLM). Truth pairs as in PROTOCOL.md.

## 2. Web LLM run (identical to PROTOCOL_web.md sections 1-2)
`gpt-5.5-2026-04-23`, Responses API, `tools=[{"type":"web_search","search_context_size":"low"}]`, `tool_choice="auto"`,
`include=["web_search_call.action.sources"]`, `reasoning={"effort":"low"}`, `max_output_tokens=20000`, `store=false`.
Same prompt text, same inputs, same parsing as `web_llm.py`. One request per anchor; retries only on HTTP errors (3 tries).
Runner: `testc_run.py` (self-contained; runs only under `__main__`; writes `data/web_llm_C.json`, `data/web_raw_C/`).

## 3. Budget
Cost per call as PROTOCOL_web.md section 4 (gpt-5.5: 5.00 / 0.50 / 30.00 per 1M; 0.01 per web_search_call item).
Coordinator cap 4.50 USD. Up to 3 calls in flight; no new call starts once spend >= 4.30.
If the cap stops the run early, the TEST SET = completed HELD24 anchors, flagged underpowered if < 20.

## 4. Merge rule (fixed, chosen before any data; same `interleave()` as the frozen analyze.py "QL" combo)
QW = Q1, W1, Q2, W2, Q3, W3, ... where Q = cleaned Qloo plain list (cached `qloo_lists.json`), W = cleaned web LLM list;
an item is skipped if `same()` matches an item already in QW; cut at k. For k=20 this is about Qloo top 10 + web top 10.

## 5. Metric and threshold (fixed)
recall@k per anchor = hits / |T| (same `clean()` and `same()` as analyze.py), macro average over the TEST SET.
best = the higher of mean recall@20 of Q and of W on the TEST SET (ties -> Q).
D = recall@20(QW) - recall@20(best). PASS iff D >= 5.0 percentage points AND the 95% percentile bootstrap CI of D
(10,000 resamples of anchors, seed 7, best fixed) has lower bound > 0, in (a) the TEST SET and in (b) the TEST SET minus
L1-leaked anchors (leakage rules = PROTOCOL_web.md section 6; (b) counts only if it has >= 12 anchors).
Reported, never decide: k=5 and k=10; Q vs W on HELD24 with CI; hit rates; mid+cold.

## 6. Pooled 48 table [post-hoc pooling, report only]
SUBSET24 (wave 6b) + HELD24 (this wave) pooled: Q, W, L, QW recall at k=5/10/20 with bootstrap CIs (seed 7).
QW on SUBSET24 is post-hoc (that half suggested the idea) and is labelled as such.

## 7. What gets written
- PASS: one sentence, e.g. "On 24 shows held out in advance, mixing Qloo's list with a web-search LLM's found X% of real
  partners in the top 20, vs Y% for the better of the two alone." and a division-of-labour line.
- NOT PASS: written plainly; the merged list is not claimed.
Analysis: `analyze_testC.py` -> `results_testC.json`. Key read from file, never printed or written.
