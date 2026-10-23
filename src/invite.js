// Invite drafts. The LLM may only use facts from the row's receipt. Every show name and episode title it writes
// must be marked [[like this]] and must be on the fact list; anything else sends us back to the fixed template.
import { llmJson, llmAvailable } from './openai.js';
import { appearsVerbatim } from './util.js';

export function inviteFacts(host, c) {
  const recent = (c.feed?.recent || []).slice(0, 3).map(e => e.title).filter(Boolean);
  return {
    hostShow: host.name,
    hostEpisodes: host.episodes || null,
    hostCadence: host.cadence || '',
    hostSince: host.since || null,
    theirShow: c.showName || c.name,
    theirHost: c.feed?.ownerName || '',
    recentEpisodes: recent,
    swappedWith: (c.others || []).slice(0, 3).map(s => s.show),
    swapEpisodes: (c.others || []).slice(0, 3).map(s => s.episode),
    commonGround: c.sharedTags || [],
    openQuote: c.openQuote || '',
  };
}

function allowedNames(f) {
  return [f.hostShow, f.theirShow, ...f.recentEpisodes, ...f.swappedWith, ...f.swapEpisodes].filter(Boolean);
}

export function templateInvite(f) {
  const hi = f.theirHost ? `Hi ${f.theirHost.split(/[,&]| and /)[0].trim()},` : 'Hi there,';
  const about = [f.hostEpisodes ? `${f.hostEpisodes} episodes` : '', f.hostCadence, f.hostSince ? `since ${f.hostSince}` : ''].filter(Boolean).join(', ');
  const ground = f.commonGround.length ? ` Our shows cover similar ground (${f.commonGround.map(t => t.toLowerCase()).join(', ')}).` : '';
  const ep = f.recentEpisodes[0] ? ` I saw your recent episode "${f.recentEpisodes[0]}".` : '';
  return {
    subject: `Trailer swap? ${f.hostShow} x ${f.theirShow}`,
    body: [
      hi, '',
      `I host ${f.hostShow}${about ? ` (${about})` : ''}.${ground}${ep}`,
      '',
      'Would you be up for a trailer swap? We each play a 30-second trailer for the other show near the top of an upcoming episode. I can send ours and a short read script this week.',
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
    'Mention the sender show’s episode count, cadence and start year if given. Subject must name both shows.',
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
    const problem = checkDraft(subject + '\n' + body, f);
    if (problem) return { ...templateInvite(f), facts: f, fallbackReason: problem };
    return { subject: strip(subject), body: strip(body), source: 'llm', facts: f };
  } catch (e) {
    return { ...templateInvite(f), facts: f, fallbackReason: 'draft service unavailable' };
  }
}
