// The "Why" line is assembled by code from fixed sentence patterns. Material comes only from the Qloo response
// or from facts in the feeds. No material, no sentence. The LLM never writes here.
import { sameShow } from './util.js';

// Day-1 check E4: 0 of 100 sampled channel descriptions say outright they are open to swaps, so the tag
// stays off the first screen and the quote appears only in the receipt.
export const SHOW_OPEN_TAG = false;

const fmtDate = iso => {
  const d = new Date(iso);
  return isNaN(d) ? '' : d.toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
};

export function sharedTags(host, c) {
  const mine = new Map((host.tags || []).map(t => [t.id, t.name]));
  return (c.tags || []).filter(t => mine.has(t.id)).map(t => t.name).slice(0, 2);
}

// Qloo explainability (feature.explainability=true; Day-1 check E3): query.explainability["signal.interests.entities"]
// lists each input show with a score. With several picks, we name the one that scores highest for this row.
export function explainedBy(c, inputs = []) {
  const list = c.explain?.['signal.interests.entities'];
  if (!Array.isArray(list) || inputs.length < 2) return [];
  const best = list.filter(x => x && x.entity_id).sort((a, b) => (b.score ?? 0) - (a.score ?? 0))[0];
  const hit = best && inputs.find(s => s.qid === best.entity_id);
  return hit ? [hit.name] : [];
}

export function whyParts(host, c, { seeds = [] } = {}) {
  const parts = [];
  if (c.feedMismatch) parts.push({ src: 'feed', text: 'No matching RSS feed found, so this row shows Qloo’s data only' });
  const by = explainedBy(c, seeds);
  if (by.length) parts.push({ src: 'qloo', text: `Closest to your pick: ${by[0]}` });
  if (c.compareTags?.length) parts.push({ src: 'qloo', text: `Qloo finds in common: ${c.compareTags.join(', ')}` });
  else {
    const tags = sharedTags(host, c);
    if (tags.length) parts.push({ src: 'qloo', text: `Qloo tags you share: ${tags.join(', ')}` });
  }
  const last = (c.others || [])[0];
  if (last && last.date) parts.push({ src: 'feed', text: `Swapped with ${last.show} on ${fmtDate(last.date)}` });
  if (c.feed?.ok && c.feed.daysSinceLast != null && c.feed.daysSinceLast <= 30) {
    const n = c.feed.daysSinceLast;
    parts.push({ src: 'feed', text: n <= 0 ? 'New episode today' : `New episode ${n} day${n === 1 ? '' : 's'} ago` });
  }
  if (c.openQuote && SHOW_OPEN_TAG) parts.push({ src: 'feed', text: `Says open to swaps: "${c.openQuote}"` });
  return parts;
}

// Short chips shown on each row.
export function chips(host, c) {
  const out = [];
  if (c.seed) out.push({ k: 'taste', text: 'Your pick' });
  if (c.affinity != null) out.push({ k: 'taste', text: `Taste match ${c.affinity.toFixed(2)}` });
  const vs = host.sizeBase === 'your picks' ? ' to your picks' : '';
  if (c.reach === 'similar') out.push({ k: 'reach', text: vs ? 'Similar to your picks' : 'Similar reach' });
  else if (c.reach === 'bigger') out.push({ k: 'reach', text: vs ? 'Bigger than your picks' : 'Bigger reach' });
  else if (c.reach === 'much') out.push({ k: 'much', text: vs ? 'Much bigger than your picks' : 'Much bigger reach' });
  else if (c.reach === 'smaller') out.push({ k: 'reach', text: vs ? 'Smaller than your picks' : 'Smaller reach' });
  if (c.feedMismatch) out.push({ k: 'same', text: 'Feed not matched' });
  if (c.quietMonths) out.push({ k: 'quiet', text: c.quietMonths >= 24 ? `Quiet for ${Math.floor(c.quietMonths / 12)}+ years` : `Quiet for ${c.quietMonths}+ months` });
  if (c.samePublisher) out.push({ k: 'same', text: 'Same publisher' });
  if (c.sameNetwork) out.push({ k: 'same', text: 'Same network' });
  const f = c.feed;
  if (f?.ok) {
    const bits = [`${f.episodeCount} episode${f.episodeCount === 1 ? '' : 's'}`];
    if (f.cadence) bits.push(f.cadence);
    if (f.firstYear) bits.push(`since ${f.firstYear}`);
    out.push({ k: 'feed', text: bits.join(' · ') });
    if (f.daysSinceLast != null) out.push({ k: 'fresh', text: f.daysSinceLast <= 0 ? 'New episode today' : `New episode ${f.daysSinceLast} day${f.daysSinceLast === 1 ? '' : 's'} ago` });
  }
  const n = (c.others || []).length;
  if (n) out.push({ k: 'swaps', text: `Swapped with ${n} show${n === 1 ? '' : 's'}` });
  if (c.swappedWithYou) out.push({ k: 'you', text: `Swapped with you in ${new Date(c.swappedWithYou).toLocaleString('en-US', { month: 'short', year: 'numeric', timeZone: 'UTC' })}` });
  if (c.openQuote && SHOW_OPEN_TAG) out.push({ k: 'open', text: 'Says open to swaps' });
  out.push(f?.ownerEmail ? { k: 'contact', text: 'Email in feed' } : f?.link ? { k: 'contact', text: 'Website in feed' } : { k: 'nocontact', text: 'No public contact' });
  return out;
}

export { sameShow };
