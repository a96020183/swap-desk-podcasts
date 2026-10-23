// Step 3: resolve anchors in Qloo (by iTunes id), then methods Q, QS, R1, R2. Writes data/anchors.json, data/qloo_lists.json
import fs from 'node:fs';
import { q, used } from './q.mjs';
const DATA = 'C:/Users/678/AppData/Local/Temp/claude/c--2026---/135e2cdd-7648-492d-981b-527d5792a8c5/scratchpad/qloo2/wave6/data/';
const truth = JSON.parse(fs.readFileSync(DATA + 'truth.json', 'utf8'));
const norm = s => (s || '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, ' ')
  .split(' ').filter(t => t && !['the', 'a', 'an', 'podcast', 'pod', 'show', 'official'].includes(t)).join(' ');
const GENERIC = 'urn:tag:genre:media:podcasts';
const ids = Object.keys(truth).filter(k => truth[k].partners.length >= 2).sort((a, b) => Number(a) - Number(b));
const anchors = fs.existsSync(DATA + 'anchors.json') ? JSON.parse(fs.readFileSync(DATA + 'anchors.json', 'utf8')) : {};
const notres = [];
for (const cid of ids) {
  if (Object.keys(anchors).length >= 70) break;
  if (anchors[cid]) continue;
  const t = truth[cid];
  const r = await q(`a_search_${cid}`, '/search', { query: t.anchor, types: 'urn:entity:podcast', take: 5 });
  const res = r.body?.results || [];
  const hit = res.find(x => String(x.properties?.external?.itunes?.id) === String(cid)) || res.find(x => norm(x.name) === norm(t.anchor));
  if (!hit) { notres.push(cid); continue; }
  const tag = (hit.tags || []).map(x => x.tag_id).find(x => x && x.startsWith('urn:tag:genre:media:') && x !== GENERIC) || null;
  anchors[cid] = { ...t, qid: hit.entity_id, qname: hit.name, pop: hit.popularity, tag, by: String(hit.properties?.external?.itunes?.id) === String(cid) ? 'itunes' : 'name' };
  fs.writeFileSync(DATA + 'anchors.json', JSON.stringify(anchors, null, 1));
}
console.log('eligible', Object.keys(anchors).length, 'not resolved', notres.length, 'used', used());
fs.writeFileSync(DATA + 'anchors_notresolved.json', JSON.stringify(notres));

const pick = r => (r.body?.results?.entities || []).map(e => ({ name: e.name, id: e.entity_id, itunes: e.properties?.external?.itunes?.id || null, pop: e.popularity }));
const lists = fs.existsSync(DATA + 'qloo_lists.json') ? JSON.parse(fs.readFileSync(DATA + 'qloo_lists.json', 'utf8')) : {};
const fixed = n => Math.max(0, Math.min(1, n)).toFixed(4);
async function rule(cid, a, label, extra) {
  if (!a.tag) return { list: [], mode: 'no-tag' };
  const key = label === 'R1' ? 'R1_' + a.tag : `${label}_${cid}`;
  let r = await q(key, '/v2/insights', { 'filter.type': 'urn:entity:podcast', 'filter.tags': a.tag, take: 50, ...extra });
  let L = pick(r);
  if (r.status === 200 && L.length) return { list: L, mode: 'filter.tags' };
  r = await q(key + '_fb', '/v2/insights', { 'filter.type': 'urn:entity:podcast', 'signal.interests.tags': a.tag, take: 50, ...extra });
  return { list: pick(r), mode: 'signal.tags', status: r.status };
}
for (const [cid, a] of Object.entries(anchors)) {
  if (lists[cid]) continue;
  const base = { 'filter.type': 'urn:entity:podcast', 'signal.interests.entities': a.qid, take: 50 };
  const rq = await q(`Q_${cid}`, '/v2/insights', base);
  const rqs = await q(`QS_${cid}`, '/v2/insights', { ...base, 'filter.popularity.max': fixed(a.pop + 0.02) });
  const r1 = await rule(cid, a, 'R1', {});
  const r2 = await rule(cid, a, 'R2', { 'filter.popularity.min': fixed(a.pop - 0.03), 'filter.popularity.max': fixed(a.pop + 0.03) });
  lists[cid] = { Q: pick(rq), Qs: rq.status, QS: pick(rqs), QSs: rqs.status, R1: r1.list, R1m: r1.mode, R2: r2.list, R2m: r2.mode };
  fs.writeFileSync(DATA + 'qloo_lists.json', JSON.stringify(lists, null, 1));
  console.log(cid, a.anchor.slice(0, 30), 'Q', lists[cid].Q.length, 'QS', lists[cid].QS.length, 'R1', r1.list.length, r1.mode, 'R2', r2.list.length, r2.mode, 'used', used());
}
console.log('done used', used());
