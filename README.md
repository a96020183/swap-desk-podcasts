# Swap Desk for podcasts

Swap Desk finds podcasts whose audiences overlap with yours, reads their feeds to see who trades promos, and drafts the invite. You press send.

Indie hosts grow by trading promos with shows like theirs, and the hard part is picking whom to ask. Today they ask around on Discord, scroll similar-show lists, or pay for research tools. Swap Desk is meant to be free for hosts; the business would be hosting platforms that add it to their growth tab. Qloo ranks the shows, and every reason on screen comes from Qloo or from the other show's own feed.

## What it does

1. You type your show's name or paste its Apple Podcasts link. Swap Desk finds it with the iTunes Search API.
2. Qloo returns the 50 podcasts closest to yours (`/v2/insights`, podcast to podcast, `feature.explainability=true`),
   with an affinity score and popularity. These are aggregate taste affinities, not listener-level data.
   A second call with `filter.popularity.max` = your popularity + 0.02 (the size-capped list from our test) is shown in each receipt.
3. Swap Desk reads each candidate's own public RSS feed: last episode, how often it publishes, episode count, first year,
   public contact, and its recent promo episodes. gpt-4.1-mini names the show each promo episode was for; a name is kept
   only if it appears word for word in that episode's text.
4. The shortlist is **Qloo's top 20, in Qloo's order**, the same list the evidence page scores. The top 5 are
   **Your first five**. Nothing is moved or dropped. Size labels compare Qloo popularity with yours
   (Smaller, Similar within 0.05, Bigger, **Much bigger reach** at +0.05 or more); feeds with no episode in 120 days get
   **Quiet for N+ months**; shows from your own publisher or network, or that you swapped with in the last 12 months,
   are labelled too. A checkbox hides quiet shows and shows with no contact; it never reorders.
5. Every row has a **Why** line built by code from fixed sentences. The material comes only from Qloo
   (shared tags from `/v2/analysis/compare`, or tags on both entities) or from facts in the feeds. The LLM never writes it.
6. **Receipt** opens three panels: *Qloo says* (entity, rank, affinity, popularity, shared tags, query), *Their feed says*
   (episodes, swaps with the episode each came from), *Our call* (the labels we added and why).
7. **Draft invite** writes a short trailer-swap email from the row's facts (what the shows have in common per Qloo's
   compare call, your episode count and cadence, one of their recent episode titles). With no email in their feed,
   the row links their website instead. Every show and episode name in the draft is checked
   against the facts; if one fails, you get a fixed template instead. You edit it, tick "I've read this", and open it in your own
   email app. Swap Desk never sends email. Five drafts per session, ten per show per day.
8. **Qloo doesn't have this show yet.** When Qloo can't find your show, you pick shows with a similar audience
   and Swap Desk searches from those. Your picks are listed above the results, not inside them. In our Test B this path
   found almost no real partners (0.2% vs 0.0% for an LLM alone), so the screen shows no accuracy number.

A second tab shows what gpt-4.1-mini suggests on its own (no web search, no Qloo), for comparison.

## Evidence

The `/evidence` page shows how the ranking was checked: 48 real podcasts and 185 shows they actually traded promos with,
taken from their own feeds, with the test committed before any feed was fetched.

- The 48 shows were found because they write about swaps, so they are easier cases than a typical host.
- In its top 20 (the cutoff fixed in advance), Qloo found 24.3% of the real partners; gpt-4.1-mini without web search found 6.1%; the most popular shows in the genre 3.7%.
- gpt-5.5 with web search found 19.0% on the same 48 shows. That gap is too small to call, so we treat it as a tie.
- Day-one checks on the agent layer (protocol committed before any candidate feed was fetched): reading feeds for swap
  habits did **not** move real partners up enough to pass (Test A), so swap habits are shown on each row and never change
  the order. Swap Desk makes no claim that its AI layer improves the ranking. Seed shows for unknown podcasts did not beat the LLM alone (Test B), so the fallback screen shows no accuracy number.

Protocols, scripts and derived results are in `research/validation/` (the original study; commit ids listed in
`COMMITS.txt` refer to the study's own repository) and `research/day1/`. Raw Qloo responses, feed text and LLM outputs
are not published.

## Run it locally

Requirements: Node.js 20 or newer, a Qloo API key, an OpenAI API key.

```bash
git clone <this repo> swap-desk-podcasts
cd swap-desk-podcasts
npm ci
cp .env.example .env        # then put your two keys in .env
npm start                   # http://localhost:3000
```

Other commands:

```bash
npm test                    # unit tests (no network)
npm run check:public        # fails if Qloo response data, Qloo ids or keys sit in any file git would publish
```

The judge examples on the home page run live the first time and are then served from the private cache
(**Recorded** mode). Switch to **Live** in the top bar to refetch Qloo and the feeds.

### Settings (`.env`)

| Name | Default | What it does |
|---|---|---|
| `QLOO_API_KEY` | | required |
| `QLOO_BASE_URL` | `https://hackathon.api.qloo.com` | |
| `OPENAI_API_KEY` | | required for feed reading and drafts; without it rows show Qloo and feed facts only |
| `OPENAI_MODEL` | `gpt-4.1-mini` | |
| `QLOO_CALL_CAP` | `1200` | the server stops calling Qloo after this many calls (counter in `.private/`) |
| `OPENAI_USD_CAP` | `3` | the server stops calling OpenAI after this spend |
| `WARM_PRESETS` | off | `1` prepares the judge examples in the background at start |
| `PORT` | `3000` | |

### Deploy (Render free plan)

`render.yaml` describes one Node web service. Set `QLOO_API_KEY` and `OPENAI_API_KEY` in the dashboard.
The free plan's disk is temporary and the service sleeps when idle: the cache and the usage counters start over after a
restart, and the first request after sleeping takes longer.

## Data sources and limits

- **iTunes Search API** (Apple's documented API) to find shows and their feed URLs, kept under 18 calls per minute and cached.
  Swap Desk does not open podcasts.apple.com pages.
- **Each show's public RSS feed**, fetched at most once a day per feed; only parsed facts are cached. Email and website
  shown on a row are the ones the show itself publishes in its feed.
- **Qloo** `/search`, `/v2/insights` (twice per show, plus one genre list), `/v2/analysis/compare` for the first five.
  Responses stay in a git-ignored server cache.
- **OpenAI** gets show names, episode titles and episode descriptions. It never gets email addresses.

What it can't see or doesn't claim:

- A feed only shows swaps that hosts wrote into episode titles or notes. A promo read out loud and never written down is invisible.
- Qloo knows about 55% of the indie shows in our test that trade promos.
- Qloo popularity is a percentile, not downloads.
- About 3% of Qloo's iTunes links point at a differently named show; Swap Desk checks names before reading a feed and
  otherwise searches iTunes by name.
- "Says open to swaps" is shown only as a quote in the receipt, and only when the show's own channel description says so.
  In a sample of 100 descriptions, none did.
- We measured which shows hosts chose, not how well a swap worked. We did not compare against Apple's lists or Rephonic.

## License

MIT. See `LICENSE`.
