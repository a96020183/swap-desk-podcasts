// Invite drafts. The LLM may only use facts from the row's receipt. Every show name and episode title it writes
// must be marked [[like this]] and must be on the fact list; anything else sends us back to the fixed template.
import { llmJson, llmAvailable } from './openai.js';
import { appearsVerbatim } from './util.js';

export function inviteFacts(host, c) {
  const recent = (c.feed?.recent || []).slice(0, 3).map(e => e.title).filter(Boolean);
  return {
    hostShow: host.name,
    theirShow: c.showName || c.name,
    theirHost: c.feed?.ownerName || '',
    recentEpisodes: recent,
    swappedWith: (c.others || []).slice(0, 3).map(s => s.show),
    swapEpisodes: (c.others || []).slice(0, 3).map(s => s.episode),
    sharedTags: c.sharedTags || [],
    openQuote: c.openQuote || '',
  };
}

function allowedNames(f) {
  return [f.hostShow, f.theirShow, ...f.recentEpisodes, ...f.swappedWith, ...f.swapEpisodes].filter(Boolean);
}

export function templateInvite(f) {
  const hi = f.theirHost ? `Hi ${f.theirHost.split(/[,&]| and /)[0].trim()},` : 'Hi there,';
  const ep = f.recentEpisodes[0] ? ` I came across your episode "${f.recentEpisodes[0]}".` : '';
  const habit = f.swappedWith.length ? ` I saw you've done a swap with ${f.swappedWith[0]} before, so I hope this is a welcome note.` : '';
  return {
    subject: `Promo swap? ${f.hostShow} x ${f.theirShow}`,
    body: [
      hi, '',
      `I host ${f.hostShow}.${ep} Our audiences look like they overlap, so I wanted to ask if you'd be up for a promo swap: we each play a short trailer for the other show.${habit}`,
      '',
      'If that sounds good, I can send our trailer and a short script. Happy to work around your schedule.',
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
  return null;
}

const strip = t => String(t).replace(/\[\[(.+?)\]\]/g, '$1');

export async function draftInvite(host, c, { note = '' } = {}) {
  const f = inviteFacts(host, c);
  if (!llmAvailable()) return { ...templateInvite(f), facts: f };
  const prompt = [
    'Write a short, friendly email from one independent podcast host to another, proposing a promo swap',
    '(each show plays a short trailer for the other). Under 120 words. Plain words, no hype, no em dashes.',
    'Use ONLY the facts below. Do not invent episodes, numbers, guests, or praise. Do not claim the sender has listened to anything.',
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
