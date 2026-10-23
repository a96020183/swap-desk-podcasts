# Test B: seed fallback for shows Qloo doesn't know (PROTOCOL_day1.md section 2). Writes derived numbers only.
import json, os
from day1_lib import (REPO, PROMPTS, load_wave6, recall, mean, boot_diff, normalize, same, llm, fill, qloo, usage)

truth = load_wave6('truth.json')
notres = load_wave6('anchors_notresolved.json')
ids = sorted([c for c in notres if c in truth and len(truth[c]['partners']) >= 2], key=int)
print('shows', len(ids), 'pairs', sum(len(truth[c]['partners']) for c in ids))


def clean(names, t):
    return [n for n in names if not same(n, t['anchor'])]


def dedup(names):
    out = []
    for x in names:
        if x and not any(same(x, o) for o in out): out.append(x)
    return out


rows, seeds_found = {}, {}
for cid in ids:
    t = truth[cid]
    r = llm(fill(PROMPTS['llmOnly'], title=t['anchor'], artist=t.get('artist') or 'unknown', genre=t.get('genre') or 'unknown',
                 desc=t.get('channel_desc') or ''), max_tokens=800)
    L = [str(x) for x in r.get('podcasts', [])][:20]
    seeds = []
    for title in L:
        if len(seeds) >= 3: break
        if same(title, t['anchor']): continue
        d = qloo('B_search_' + normalize(title)[:60], '/search', {'query': title, 'types': 'urn:entity:podcast', 'take': 5})
        hit = next((e for e in (d.get('body') or {}).get('results', []) if normalize(e.get('name')) == normalize(title)), None)
        if hit: seeds.append({'name': hit['name'], 'id': hit['entity_id']})
    seeds_found[cid] = len(seeds)
    QF = []
    if seeds:
        d = qloo('B_ins_' + cid, '/v2/insights', {'filter.type': 'urn:entity:podcast',
                                                    'signal.interests.entities': ','.join(s['id'] for s in seeds), 'take': 50})
        names = [e['name'] for e in ((d.get('body') or {}).get('results') or {}).get('entities', [])]
        QF = clean(dedup([s['name'] for s in seeds] + names), t)[:20]
    Lc = clean(L, t)
    rows[cid] = {k: recall(v, t['partners'], kk)[0] for k, v, kk in
                 [('QF@20', QF, 20), ('L@20', Lc, 20), ('QF@5', QF, 5), ('L@5', Lc, 5)]}
    rows[cid]['hits QF/L @20'] = (recall(QF, t['partners'], 20)[1], recall(Lc, t['partners'], 20)[1])

per = lambda k: {c: rows[c][k] for c in ids}
pct = lambda k: round(100 * mean([rows[c][k] for c in ids]), 1)
d = boot_diff(per('QF@20'), per('L@20'), ids)
res = {'test': 'B', 'shows': len(ids), 'pairs': sum(len(truth[c]['partners']) for c in ids),
       'QF@20': pct('QF@20'), 'L@20': pct('L@20'), 'QF - L @20 [CI]': d,
       'k=5: QF / L': [pct('QF@5'), pct('L@5')], 'k=5: QF - L [CI]': boot_diff(per('QF@5'), per('L@5'), ids),
       'hits @20 QF / L': [sum(rows[c]['hits QF/L @20'][0] for c in ids), sum(rows[c]['hits QF/L @20'][1] for c in ids)],
       'seeds found (0/1/2/3)': [sum(1 for c in ids if seeds_found[c] == k) for k in range(4)],
       'PASS': bool(d[0] >= 3.0 and d[1] > 0), 'usage_after': {k: v for k, v in usage().items()}}
json.dump(res, open(os.path.join(REPO, 'research', 'day1', 'results_testB.json'), 'w', encoding='utf8'), indent=1)
print(json.dumps(res, indent=1))
