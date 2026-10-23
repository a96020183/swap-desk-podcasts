# Extras E1-E3 (PROTOCOL_day1.md section 3). Report only. Writes field names and counts, never Qloo values or ids.
import json, os, random
from day1_lib import REPO, load_wave6, clean, same, qloo, usage

anchors = load_wave6('anchors.json')
ql = load_wave6('qloo_lists.json')
ids = sorted(anchors, key=int)
order = ids[:]; random.Random(7).shuffle(order)
e1 = order[:5]


def keys_tree(o, depth=0, maxd=4):
    if depth >= maxd: return '...'
    if isinstance(o, dict): return {k: keys_tree(v, depth + 1, maxd) for k, v in o.items()}
    if isinstance(o, list): return [keys_tree(o[0], depth + 1, maxd)] if o else []
    return type(o).__name__


def ents(d):
    return ((d.get('body') or {}).get('results') or {}).get('entities', []) if isinstance((d.get('body') or {}).get('results'), dict) else []


res = {'E1 consistency': [], 'E2 compare': [], 'E3 explainability': []}
for cid in e1:
    a = anchors[cid]
    d = qloo('E1_Q_' + cid, '/v2/insights', {'filter.type': 'urn:entity:podcast', 'signal.interests.entities': a['qid'], 'take': 50})
    new = clean([e['name'] for e in ents(d)], a)[:20]
    old = clean([x['name'] for x in ql[cid]['Q']], a)[:20]
    res['E1 consistency'].append({'anchor': a['anchor'], 'status': d['status'], 'overlap_top20': sum(1 for x in new if any(same(x, y) for y in old))})
res['E1 any below 18/20'] = any(r['overlap_top20'] < 18 for r in res['E1 consistency'])

pairs = []
for cid in order:
    if len(pairs) >= 5: break
    a = anchors[cid]
    for p in a['partners']:
        hit = next((x for x in ql[cid]['Q'] if same(x['name'], p['name'])), None)
        if hit: pairs.append((cid, a, hit)); break
for cid, a, hit in pairs:
    d = qloo('E2_cmp_' + cid, '/v2/analysis/compare', {'a.signal.interests.entities': a['qid'], 'b.signal.interests.entities': hit['id']})
    body = d.get('body') or {}
    txt = json.dumps(body)
    res['E2 compare'].append({'anchor': a['anchor'], 'partner': hit['name'], 'status': d['status'],
                              'response_shape': keys_tree(body, maxd=3), 'mentions_tag': '"tag' in txt or 'urn:tag' in txt})

for j, cid in enumerate(e1):
    a = anchors[cid]
    if j < 3:
        sig, kind = a['qid'], 'single show'
    else:
        sig, kind = ','.join(x['id'] for x in ql[cid]['Q'][:3]), 'three seeds'
    d = qloo('E3_exp_' + cid, '/v2/insights', {'filter.type': 'urn:entity:podcast', 'signal.interests.entities': sig, 'take': 10,
                                               'feature.explainability': 'true'})
    e = ents(d)
    res['E3 explainability'].append({'kind': kind, 'status': d['status'], 'n': len(e),
                                     'entity_query_shape': keys_tree(e[0].get('query', {}), maxd=4) if e else None,
                                     'top_level_keys': list((d.get('body') or {}).keys())})
res['usage_after'] = usage()
json.dump(res, open(os.path.join(REPO, 'research', 'day1', 'results_extras.json'), 'w', encoding='utf8'), indent=1)
print(json.dumps(res, indent=1)[:6000])
