import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rankCandidates, networksIn } from '../src/rank.js';
import { whyParts, chips, sharedTags } from '../src/why.js';
import { checkDraft, templateInvite, inviteFacts } from '../src/invite.js';
import { parseFeed, promoEpisodes, cadenceLabel } from '../src/rss.js';
import { namesAgree } from '../src/util.js';

const TODAY = '2026-10-24';
const feed = (o = {}) => ({ ok: true, episodeCount: 100, daysSinceLast: 5, cadence: 'weekly', firstYear: 2019, ownerName: '', ownerEmail: '', author: '', description: '', recent: [], ...o });
const cand = (rank, o = {}) => ({ rank, name: `Show ${rank}`, showName: `Show ${rank}`, qid: `q${rank}`, affinity: 0.9 - rank / 100, popularity: 0.6, tags: [], feed: feed(), swaps: [], inSimilar: true, ...o });
const host = { name: 'My Show', artist: 'Me', ownerName: 'Me', ownerEmail: 'me@example.com', description: '', popularity: 0.6, tags: [{ id: 't:a', name: 'History' }], swaps: [] };

test('keeps Qloo order and marks the first five', () => {
  const r = rankCandidates(host, Array.from({ length: 30 }, (_, i) => cand(i + 1)), { today: TODAY });
  assert.equal(r.shortlist.length, 20);
  assert.deepEqual(r.shortlist.slice(0, 5).map(c => c.rank), [1, 2, 3, 4, 5]);
  assert.equal(r.shortlist[0].call.column, 'firstFive');
  assert.equal(r.shortlist[5].call.column, 'shortlist');
});

test('labels only: same publisher, quiet feed and much bigger reach keep their Qloo position', () => {
  const r = rankCandidates(host, [
    cand(1, { artist: 'Me' }),
    cand(2, { feed: feed({ daysSinceLast: 200 }) }),
    cand(3, { popularity: 0.7 }),
    cand(4),
  ], { today: TODAY });
  assert.deepEqual(r.shortlist.map(c => c.rank), [1, 2, 3, 4]);
  assert.ok(chips(host, r.shortlist[0]).some(c => c.text === 'Same publisher'));
  assert.ok(chips(host, r.shortlist[1]).some(c => c.text === 'Quiet for 6+ months'));
  assert.ok(chips(host, r.shortlist[2]).some(c => c.text === 'Much bigger reach'));
  assert.deepEqual(r.shortlist[3].call.reasons, []);
});

test('same network is read from both descriptions and only labelled', () => {
  assert.ok(networksIn('A proud member of the Bleav Podcast Network.').has('bleav'));
  const h = { ...host, description: 'Part of the Bleav Podcast Network' };
  const r = rankCandidates(h, [cand(1, { feed: feed({ description: 'We are part of the Bleav Network' }) }), cand(2)], { today: TODAY });
  assert.equal(r.shortlist[0].rank, 1);
  assert.ok(r.shortlist[0].sameNetwork);
});

test('swap habits and past swaps never change the order', () => {
  const r = rankCandidates(host, [
    cand(1, { swaps: [{ show: 'My Show', date: '2026-05-02', episode: 'x' }] }), cand(2),
    cand(3, { swaps: [{ show: 'Other Show', date: '2026-01-01', episode: 'Feed drop: Other Show' }] }),
  ], { today: TODAY });
  assert.deepEqual(r.shortlist.map(c => c.rank), [1, 2, 3]);
  assert.ok(chips(host, r.shortlist[0]).some(c => c.k === 'you' && c.text.includes('May 2026')));
  assert.ok(chips(host, r.shortlist[2]).some(c => c.text === 'Swapped with 1 show'));
});

test('Why uses only Qloo tags and feed facts, and says nothing without material', () => {
  const c = cand(1, { tags: [{ id: 't:a', name: 'History' }], feed: feed({ daysSinceLast: 3 }), openQuote: 'We love promo swaps.' });
  c.others = [{ show: 'NPE Stories', date: '2026-03-01' }];
  const w = whyParts(host, c).map(p => p.text);
  // the open-to-swaps quote stays in the receipt only (Day-1 check E4)
  assert.deepEqual(w, ['Qloo tags you share: History', 'Swapped with NPE Stories on Mar 1, 2026', 'New episode 3 days ago']);
  c.compareTags = ['Genealogy', 'Family'];
  assert.equal(whyParts(host, c)[0].text, 'Qloo finds in common: Genealogy, Family');
  c.explain = { 'signal.interests.entities': [{ entity_id: 's1', score: 0.2 }, { entity_id: 's2', score: 0.7 }] };
  assert.equal(whyParts(host, c, { seeds: [{ qid: 's1', name: 'Seed One' }, { qid: 's2', name: 'Seed Two' }] })[0].text, 'Closest to your pick: Seed Two');
  const bare = cand(2, { feed: feed({ daysSinceLast: 90 }) }); bare.others = [];
  assert.deepEqual(whyParts(host, bare), []);
  assert.deepEqual(sharedTags(host, bare), []);
});

test('draft check rejects names that are not in the facts', () => {
  const c = cand(1, { showName: 'NPE Stories', feed: feed({ ownerName: 'Lily', recent: [{ title: 'Ep 9: Found' }] }) });
  c.others = []; c.sharedTags = [];
  const f = inviteFacts({ name: 'My Show' }, c);
  assert.equal(checkDraft('Hi! I loved [[Ep 9: Found]] on [[NPE Stories]].', f), null);
  assert.match(checkDraft('Hi! I loved [[Ep 10: Lost]].', f), /not in the facts/);
  assert.match(checkDraft('We have 20k listeners.', f), /audience numbers/);
  assert.match(checkDraft('Loved "Some Invented Title".', f), /not in the facts/);
  const t = templateInvite(f);
  assert.equal(checkDraft(t.subject + '\n' + t.body, f), null);
});

test('RSS parsing: facts, cadence, promo episodes', () => {
  const xml = `<?xml version="1.0"?><rss xmlns:itunes="http://www.itunes.com/dtds/podcast-1.0.dtd"><channel>
    <title>Test &amp; Show</title><description><![CDATA[<p>We are open to promo swaps!</p>]]></description>
    <itunes:owner><itunes:name>Ann</itunes:name><itunes:email>ann@example.com</itunes:email></itunes:owner>
    <item><title>Feed Drop: NPE Stories</title><pubDate>Tue, 20 Oct 2026 10:00:00 GMT</pubDate><description>Meet NPE Stories</description></item>
    <item><title>Episode 2</title><pubDate>Tue, 13 Oct 2026 10:00:00 GMT</pubDate></item>
    <item><title>Episode 1</title><pubDate>Tue, 06 Oct 2026 10:00:00 GMT</pubDate></item>
    <item><title>Trailer</title><pubDate>Tue, 29 Sep 2020 10:00:00 GMT</pubDate></item>
  </channel></rss>`;
  const f = parseFeed(xml, '2026-10-24');
  assert.equal(f.title, 'Test & Show');
  assert.equal(f.description, 'We are open to promo swaps!');
  assert.equal(f.ownerEmail, 'ann@example.com');
  assert.equal(f.episodeCount, 4);
  assert.equal(f.daysSinceLast, 4);
  assert.equal(f.firstYear, 2020);
  assert.deepEqual(promoEpisodes(f).map(e => e.title), ['Feed Drop: NPE Stories']);
  assert.equal(cadenceLabel(['2026-10-20', '2026-10-13', '2026-10-06', '2026-09-29']), 'weekly');
});

test('Qloo rows join a feed only when the names agree', () => {
  assert.ok(namesAgree('NPE Stories', 'NPE Stories Podcast'));
  assert.ok(namesAgree('Locked On Hawks - Daily Podcast On The Atlanta Hawks', 'Locked On Hawks'));
  assert.ok(!namesAgree('Missing Pieces - NPE Life', 'LA Calling'));
});
