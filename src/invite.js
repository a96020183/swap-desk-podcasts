// Invite drafts. The LLM may only use facts from the row's receipt. Every show name and episode title it writes
// must be marked [[like this]] and must be on the fact list; anything else sends us back to the fixed template.
import { llmJson, llmAvailable } from './openai.js';
import { appearsVerbatim } from './util.js';

// Apple-style categories read like labels in a letter; only finer topics go into the draft.
const BROAD = new Set(['society & culture', 'comedy', 'news', 'arts', 'education', 'business', 'health & fitness', 'tv & film',
  'music', 'sports', 'technology', 'leisure', 'religion & spirituality', 'kids & family', 'science', 'history', 'fiction',
  'true crime', 'government', 'personal journals', 'podcasts']);

export function inviteFacts(host, c) {
  const recent = (c.feed?.recent || []).slice(0, 3).map(e => e.title).filter(Boolean);
  return {
    hostShow: host.name,
    hostLink: host.link || '',
    swappedBefore: c.pastSwap ? c.pastSwap.slice(0, 4) : null,
    hostEpisodes: host.episodes || null,
    hostCadence: host.cadence || '',
    hostSince: host.since || null,
    theirShow: c.showName || c.name,
    theirHost: c.feed?.ownerName || '',
    theirRecentEpisodes: recent,
    swappedWith: (c.others || []).slice(0, 3).map(s => s.show),
    swapEpisodes: (c.others || []).slice(0, 3).map(s => s.episode),
    commonGround: (c.sharedTags || []).filter(t => !BROAD.has(t.toLowerCase())),
    openQuote: c.openQuote || '',
  };
}

function allowedNames(f) {
  return [f.hostShow, f.theirShow, ...f.theirRecentEpisodes, ...f.swappedWith, ...f.swapEpisodes].filter(Boolean);
}

export function templateInvite(f) {
  const hi = f.theirHost ? `Hi ${f.theirHost.split(/[,&]| and /)[0].trim()},` : 'Hi there,';
  const about = [f.hostEpisodes ? `${f.hostEpisodes} episodes` : '', f.hostCadence, f.hostSince ? `since ${f.hostSince}` : ''].filter(Boolean).join(', ');
  const ground = f.commonGround.length ? ` Our shows cover similar ground (${f.commonGround.map(t => t.toLowerCase()).join(', ')}).` : '';
  const ep = f.theirRecentEpisodes[0] ? ` I saw your recent episode "${f.theirRecentEpisodes[0]}".` : '';
  return {
    subject: `Trailer swap with ${f.hostShow}?`,
    body: [
      hi, '',
      `I host ${f.hostShow}${about ? ` (${about})` : ''}: ${f.hostLink || '[link to your show]'}.${f.swappedBefore ? ` We swapped promos back in ${f.swappedBefore}, and I'd love to do it again.` : ''}${ep}${ground}`,
      '',
      'Would you be up for a trailer swap? We each play a 30-second trailer for the other show near the top of an upcoming episode. We get about [downloads per episode] downloads an episode. I can send our trailer and a short read script this week.',
      '', 'Thanks,', '[Your name]',
    ].join('\n'),
    source: 'template',
  };
}

// Returns null when the draft passes; otherwise the reason it failed.
export function checkDraft(text, f) {
  const allowed = allowedNames(f);
  for (const m of String(text).matchAll(/\[\[(.+?)\]\]/g)) {
    if (!allowed.some(a => appearsVerbatim(m[1], a) && appearsVerbatim(a, m[1]))) return `"${m[1]}" is not in the facts`;
  }
  const plain = String(text).replace(/\[\[(.+?)\]\]/g, '$1');
  for (const m of plain.matchAll(/["“]([^"”]{3,})["”]/g)) {
    if (!allowed.some(a => appearsVerbatim(m[1], a) && appearsVerbatim(a, m[1])) && !appearsVerbatim(m[1], f.openQuote)) return `quoted "${m[1]}" is not in the facts`;
  }
  if (/\b\d[\d,.]*\s*(k\b|listeners|downloads|subscribers)/i.test(plain)) return 'mentions audience numbers';
  if (/\btags?\b|\bqloo\b/i.test(plain)) return 'mentions tags or Qloo';
  return null;
}

const strip = t => String(t).replace(/\[\[(.+?)\]\]/g, '$1');

export async function draftInvite(host, c, { note = '' } = {}) {
  const f = inviteFacts(host, c);
  if (!llmAvailable()) return { ...templateInvite(f), facts: f };
  const prompt = [
    'Write a short, friendly email from one independent podcast host to another, proposing a trailer swap:',
    'each show plays a 30-second trailer for the other near the top of an upcoming episode. Under 120 words. Plain words, no hype, no em dashes.',
    'Use ONLY the facts below. Do not invent episodes, numbers, guests, or praise. Do not claim the sender has listened to anything.',
    'Say in one line what the shows have in common using commonGround in plain words; never use the word "tag" or "Qloo".',
    'Mention the sender show’s episode count, cadence and start year if given, and hostLink exactly as written.',
    'If swappedBefore is a year, say the two shows swapped promos before (in that year) and propose doing it again; otherwise write it as a first contact.',
    'theirRecentEpisodes are episodes of the RECIPIENT’s show, not the sender’s. If it is not empty, mention the first one by its exact title as their episode, in the first two sentences.',
    'Include the sentence "We get about [downloads per episode] downloads an episode." exactly, for the sender to fill in.',
    'Subject: short and casual, like "Trailer swap with <sender show>?".',
    'Wrap every podcast name and every episode title you mention in double square brackets, like [[Name]].',
    'Sign off with "[Your name]".',
    `Facts (JSON): ${JSON.stringify(f)}`,
    note ? `The sender adds: ${String(note).slice(0, 300)}` : '',
    'Return JSON only: {"subject": "...", "body": "..."}',
  ].filter(Boolean).join('\n');
  try {
    const r = await llmJson(prompt, { maxTokens: 500, temperature: 0.4, cacheTtl: 0 });
    const subject = String(r.subject || '').trim(), body = String(r.body || '').trim();
    if (!subject || !body) throw new Error('empty');
    let problem = checkDraft(subject + '\n' + body, f);
    if (!problem && f.theirRecentEpisodes[0]) {
      const ep = f.theirRecentEpisodes[0];
      const sentence = strip(body).split(/(?<=[.!?])\s+/).find(x => appearsVerbatim(ep, x));
      if (!sentence) problem = 'did not name their recent episode';
      else if (/\b(my|our)\b/i.test(sentence.replace(ep, ''))) problem = 'credited their episode to the sender';
    }
    if (problem) return { ...templateInvite(f), facts: f, fallbackReason: problem };
    return { subject: strip(subject), body: strip(body), source: 'llm', facts: f };
  } catch (e) {
    return { ...templateInvite(f), facts: f, fallbackReason: 'draft service unavailable' };
  }
}
