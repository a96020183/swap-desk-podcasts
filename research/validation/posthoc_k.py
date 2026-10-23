# [post-hoc] 2026-10-23, added after the frozen result and after blind review R1 (must-fix 4).
# Same data, same lists, same clean/matching/recall/bootstrap code as analyze.py; ONLY k changes (5, 10, 20).
# No API calls. Never changes the primary verdict.
import json, random, sys
from common import DATA, same
sys.stdout.reconfigure(encoding='utf-8')
anchors = json.load(open(DATA + 'anchors.json', encoding='utf8'))
ql = json.load(open(DATA + 'qloo_lists.json', encoding='utf8'))
ll = json.load(open(DATA + 'llm_lists.json', encoding='utf8'))
post = json.load(open(DATA + 'anchors_posthoc.json', encoding='utf8'))

def clean(names, a):
    return [n for n in names if not same(n, a['anchor']) and not same(n, a.get('qname') or '')]

def recall(items, partners, k):
    items = items[:k]; hit = 0
    for p in partners:
        if any(same(i, p['name']) for i in items): hit += 1
    return hit / len(partners), hit

KS = [5, 10, 20]
M = ['Q', 'QS', 'R1', 'R2', 'L']
def build(cond=lambda p: True):
    rows = {}
    for cid, a in anchors.items():
        if cid not in ql or cid not in ll: continue
        parts = [p for p, pp in zip(a['partners'], post[cid]['partners']) if cond(pp)]
        if not parts: continue
        L = ql[cid]
        lists = {'Q': clean([x['name'] for x in L['Q']], a), 'QS': clean([x['name'] for x in L['QS']], a),
                 'R1': clean([x['name'] for x in L['R1']], a), 'R2': clean([x['name'] for x in L['R2']], a),
                 'L': clean(ll[cid], a)}
        r = {'pop': a['pop'], 'n': len(parts)}
        for m, it in lists.items():
            for k in KS:
                r[f'{m}@{k}'], r[f'{m}_h{k}'] = recall(it, parts, k)
        rows[cid] = r
    return rows

mean = lambda xs: sum(xs) / len(xs) if xs else float('nan')
def boot(rows, sub, k, a, b, B=10000, seed=7):
    rnd = random.Random(seed); d = []
    for _ in range(B):
        s = [rnd.choice(sub) for _ in sub]
        d.append(100 * (mean([rows[c][f'{a}@{k}'] for c in s]) - mean([rows[c][f'{b}@{k}'] for c in s])))
    d.sort()
    return round(100 * (mean([rows[c][f'{a}@{k}'] for c in sub]) - mean([rows[c][f'{b}@{k}'] for c in sub])), 1), round(d[int(0.025 * B)], 1), round(d[int(0.975 * B)], 1)
def bootmean(rows, sub, key, B=10000, seed=7):
    rnd = random.Random(seed); d = []
    for _ in range(B):
        s = [rnd.choice(sub) for _ in sub]; d.append(100 * mean([rows[c][key] for c in s]))
    d.sort(); return round(d[int(0.025 * B)], 1), round(d[int(0.975 * B)], 1)

out = {}
def report(label, rows, sub=None):
    ids = sub or sorted(rows, key=lambda c: rows[c]['pop'])
    res = {'anchors': len(ids), 'pairs': sum(rows[c]['n'] for c in ids)}
    for k in KS:
        tab = {m: round(100 * mean([rows[c][f'{m}@{k}'] for c in ids]), 1) for m in M}
        hit = {m: round(100 * mean([1.0 if rows[c][f'{m}_h{k}'] > 0 else 0.0 for c in ids]), 1) for m in M}
        best = max(['L', 'R1', 'R2'], key=lambda m: tab[m])
        res[f'k={k}'] = {'recall': tab, 'hit': hit, 'Q CI': bootmean(rows, ids, f'Q@{k}'), 'L CI': bootmean(rows, ids, f'L@{k}'),
                         'best': best, 'Q-best [CI]': boot(rows, ids, k, 'Q', best), 'Q-L [CI]': boot(rows, ids, k, 'Q', 'L'),
                         'hits Q/L (pairs)': (sum(rows[c][f'Q_h{k}'] for c in ids), sum(rows[c][f'L_h{k}'] for c in ids))}
    out[label] = res

rows = build()
ids = sorted(rows, key=lambda c: rows[c]['pop']); n = len(ids)
t3 = ids[:n // 3]; t2 = ids[n // 3: 2 * n // 3]; t1 = ids[2 * n // 3:]
report('ALL', rows)
report('T1 top', rows, t1)
report('T2+T3 mid+cold', rows, t2 + t3)
report('T3 cold', rows, t3)
report('independent owners [post-hoc]', build(lambda p: p.get('network') is False))
report('recent>=2025 [post-hoc]', build(lambda p: p['date'] >= '2025-01-01'))
report('independent & recent [post-hoc]', build(lambda p: p.get('network') is False and p['date'] >= '2025-01-01'))
json.dump(out, open('results_posthoc_k.json', 'w', encoding='utf8'), indent=1, ensure_ascii=False)
for lab, r in out.items():
    print('==', lab, r['anchors'], r['pairs'])
    for k in KS:
        x = r[f'k={k}']; print(' k', k, 'recall', x['recall'], 'hit', x['hit'], 'QCI', x['Q CI'], 'LCI', x['L CI'], 'best', x['best'], 'Q-best', x['Q-best [CI]'], 'Q-L', x['Q-L [CI]'], 'hits', x['hits Q/L (pairs)'])
