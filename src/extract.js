// What the LLM is allowed to do: pull facts out of feed text. Every name or sentence it returns must appear
// word for word in the text it was given, or we drop it. The LLM never writes the "Why".
import prompts, { fill } from './prompts.js';
import { llmJson, llmAvailable } from './openai.js';
import { promoEpisodes } from './rss.js';
import { appearsVerbatim, sameShow } from './util.js';

const OPEN_PRE = new RegExp(prompts.openToSwapsPrefilter, 'i');
const episodeText = e => `${e.title} ${String(e.desc || '').slice(0, 300)}`.trim();

// Swaps a show ran in its own feed (its 40 most recent episodes): which other show each promo episode was for.
export async function extractSwaps(showName, feed, { allTime = false } = {}) {
  const eps = allTime ? (feed.promoAll || promoEpisodes(feed)) : promoEpisodes(feed);
  if (!eps.length || !llmAvailable()) return { checked: eps.length, swaps: [], dropped: 0, llm: false };
  const swaps = []; let dropped = 0;
  for (let s = 0; s < eps.length; s += 40) {
    const chunk = eps.slice(s, s + 40);
    const list = chunk.map((e, n) => `${n + 1}. TITLE: ${e.title} | TEXT: ${String(e.desc || '').slice(0, 300)}`).join('\n');
    let r = {};
    try { r = await llmJson(fill(prompts.extract, { anchor: showName, eps: list }), { maxTokens: 3000 }); } catch { r = {}; }
    for (const x of r.episodes || []) {
      const n = Number(x.n) - 1;
      const name = String(x.other_podcast || '').trim();
      if (!name || !(n >= 0 && n < chunk.length)) continue;
      const ep = chunk[n];
      if (!appearsVerbatim(name, episodeText(ep)) || sameShow(name, showName)) { dropped++; continue; }
      swaps.push({ show: name, episode: ep.title, date: ep.date, link: ep.link || '' });
    }
  }
  return { checked: eps.length, swaps, dropped, llm: true };
}

// "Says open to swaps": only a sentence the show itself wrote in its channel description, quoted exactly.
export async function openToSwaps(showName, description) {
  const desc = String(description || '');
  if (!desc || !OPEN_PRE.test(desc) || !llmAvailable()) return null;
  try {
    const r = await llmJson(fill(prompts.openToSwaps, { title: showName, desc }), { maxTokens: 300 });
    const q = String(r.quote || '').trim();
    return q && appearsVerbatim(q, desc) ? q : null;
  } catch { return null; }
}

// LLM-only comparison list (same prompt as the validation study's baseline). No web search.
export async function llmOnlyList(show, description) {
  if (!llmAvailable()) return [];
  const r = await llmJson(fill(prompts.llmOnly, {
    title: show.name, artist: show.artist || 'unknown', genre: show.genre || 'unknown', desc: String(description || '').slice(0, 400),
  }), { maxTokens: 800 });
  return (r.podcasts || []).map(String).filter(Boolean).slice(0, 20);
}
