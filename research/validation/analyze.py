# Step 5: frozen analysis (PROTOCOL sections 4-5).
import json, random
from common import DATA, same, normalize

anchors = json.load(open(DATA + 'anchors.json', encoding='utf8'))
ql = json.load(open(DATA + 'qloo_lists.json', encoding='utf8'))
ll = json.load(open(DATA + 'llm_lists.json', encoding='utf8'))
K = 20


def clean(names, a):
    return [n for n in names if not same(n, a['anchor']) and not same(n, a.get('qname') or '')]


def recall(items, partners, k):
    items = items[:k]; hit = 0
    for p in partners:
        if any(same(i, p['name']) for i in items): hit += 1
    return hit / len(partners), hit


def interleave(a, b, k):
    out = []
    for x, y in zip(a + [None] * k, b + [None] * k):
        for z in (x, y):
            if z and not any(same(z, o) for o in out): out.append(z)
        if len(out) >= k: break
    return out[:k]


rows = {}
for cid, a in anchors.items():
    if cid not in ql or cid not in ll: continue
    L = ql[cid]
    lists = {'Q': clean([x['name'] for x in L['Q']], a), 'QS': clean([x['name'] for x in L['QS']], a),
             'R1': clean([x['name'] for x in L['R1']], a), 'R2': clean([x['name'] for x in L['R2']], a),
             'L': clean(ll[cid], a)}
    lists['QL'] = interleave(lists['Q'], lists['L'], K)
    r = {'pop': a['pop'], 'n': len(a['partners'])}
    for m, it in lists.items():
        r[m + '@20'], r[m + '_h20'] = recall(it, a['partners'], 20)
        r[m + '@50'], _ = recall(it, a['partners'], 50)
        r[m + '_len'] = len(it)
    rows[cid] = r

ids = sorted(rows, key=lambda c: rows[c]['pop'])
n = len(ids); pairs = sum(rows[c]['n'] for c in ids)
t3 = ids[:n // 3]; t2 = ids[n // 3: 2 * n // 3]; t1 = ids[2 * n // 3:]
M = ['Q', 'QS', 'R1', 'R2', 'L', 'QL']
mean = lambda xs: sum(xs) / len(xs) if xs else float('nan')


def table(sub):
    return {m: (round(100 * mean([rows[c][m + '@20'] for c in sub]), 1), round(100 * mean([rows[c][m + '@50'] for c in sub]), 1),
                round(100 * mean([1.0 if rows[c][m + '_h20'] > 0 else 0.0 for c in sub]), 1)) for m in M}


full = table(ids)
best = max(['L', 'R1', 'R2'], key=lambda m: full[m][0])


def boot(sub, a='Q', b=None, B=10000, seed=7):
    b = b or best
    rnd = random.Random(seed); d = []
    for _ in range(B):
        s = [rnd.choice(sub) for _ in sub]
        d.append(100 * (mean([rows[c][a + '@20'] for c in s]) - mean([rows[c][b + '@20'] for c in s])))
    d.sort()
    return round(100 * (mean([rows[c][a + '@20'] for c in sub]) - mean([rows[c][b + '@20'] for c in sub])), 1), round(d[int(0.025 * B)], 1), round(d[int(0.975 * B)], 1)


D, lo, hi = boot(ids)
res = {'n_anchors': n, 'n_pairs': pairs, 'best_baseline': best,
       'full (recall@20, recall@50, hit-rate@20)': full,
       'PRIMARY D = Q - best @20 [CI]': (D, lo, hi),
       'PASS': bool(n >= 40 and pairs >= 100 and D >= 5 and lo > 0),
       'tiers': {'T1 top': table(t1), 'T2': table(t2), 'T3 cold': table(t3), 'T2+T3': table(t2 + t3)},
       'D in T1': boot(t1), 'D in T2+T3': boot(t2 + t3),
       'Q vs L': boot(ids, 'Q', 'L'), 'Q vs R1': boot(ids, 'Q', 'R1'), 'Q vs R2': boot(ids, 'Q', 'R2'),
       'QS vs best': boot(ids, 'QS'), 'QL vs best': boot(ids, 'QL'), 'QL vs L': boot(ids, 'QL', 'L'),
       'pop range T3/T2/T1': [(round(rows[s[0]]['pop'], 4), round(rows[s[-1]]['pop'], 4)) for s in (t3, t2, t1) if s],
       'mean list len': {m: round(mean([rows[c][m + '_len'] for c in ids]), 1) for m in M}}

# recency split (pair level -> per-anchor recall restricted to subset partners)
for lab, cond in [('recent>=2025', lambda p: p['date'] >= '2025-01-01'), ('older', lambda p: p['date'] < '2025-01-01')]:
    acc = {m: [] for m in M}
    for cid in ids:
        a = anchors[cid]; parts = [p for p in a['partners'] if cond(p)]
        if not parts: continue
        L = ql[cid]
        lists = {'Q': [x['name'] for x in L['Q']], 'QS': [x['name'] for x in L['QS']], 'R1': [x['name'] for x in L['R1']],
                 'R2': [x['name'] for x in L['R2']], 'L': ll[cid]}
        lists = {k: clean(v, a) for k, v in lists.items()}; lists['QL'] = interleave(lists['Q'], lists['L'], K)
        for m in M: acc[m].append(recall(lists[m], parts, 20)[0])
    res['recency ' + lab] = {'anchors': len(acc['Q']), **{m: round(100 * mean(v), 1) for m, v in acc.items()}}

json.dump({'rows': rows, 'res': res}, open(DATA + '_results.json', 'w', encoding='utf8'), indent=1)
print(json.dumps(res, indent=1, ensure_ascii=False))
