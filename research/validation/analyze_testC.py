# Wave 6c analysis (PROTOCOL_testC.md sections 4-6). No API calls. Reuses analyze_web.py leakage code by text exec
# (only the function definitions; analyze_web.py itself is not run).
import json, random, sys
from common import DATA, same
sys.stdout.reconfigure(encoding='utf-8')
_src = open('analyze_web.py', encoding='utf8').read()
_defs = _src[_src.index('# ---------- leakage ----------'):_src.index('rows, leak = {}')]
anchors = json.load(open(DATA + 'anchors.json', encoding='utf8'))
cands = json.load(open(DATA + 'candidates.json', encoding='utf8'))
ql = json.load(open(DATA + 'qloo_lists.json', encoding='utf8'))
ll = json.load(open(DATA + 'llm_lists.json', encoding='utf8'))
import re, hashlib, urllib.parse
import xml.etree.ElementTree as ET
from email.utils import parsedate_to_datetime
from common import normalize, base, strip_html
PROMO_RE = re.compile(r"feed[\s-]*drop|feed[\s-]*swap|promo[\s-]*swap|pod(cast)?[\s-]*swap|trailer[\s-]*swap|show[\s-]*swap|"
                      r"cross[\s-]*over|introducing|presenting|sneak[\s-]*peek|we think you.?ll (like|love|enjoy)|check out", re.I)
exec(_defs)

M = 'gpt-5.5-2026-04-23'
C = json.load(open(DATA + 'web_llm_C.json', encoding='utf8'))
B = json.load(open(DATA + 'web_llm.json', encoding='utf8'))
TEST = C['test_set']; SUB = B['primary_set']
runs = {**{c: B['runs'][f'{c}|{M}'] for c in SUB}, **{c: C['runs'][f'{c}|{M}'] for c in TEST}}
KS = [5, 10, 20]


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


rows, leak = {}, {}
for cid in SUB + TEST:
    a = anchors[cid]; rec = runs[cid]
    info = leak_info(cid)
    urls = [(x['url'], x.get('title', '')) for x in rec['cited']] + [(u, '') for u in rec['consulted']]
    leak[cid] = sum(classify(info, u, t) == 'L1' for u, t in urls)
    Q = clean([x['name'] for x in ql[cid]['Q']], a); W = clean(rec['titles'], a); L = clean(ll[cid], a)
    r = {'pop': float(a['pop']), 'n': len(a['partners'])}
    for k in KS:
        for m, it in {'Q': Q, 'W': W, 'L': L, 'QW': interleave(Q, W, k)}.items():
            r[f'{m}@{k}'], r[f'{m}_h{k}'] = recall(it, a['partners'], k)
    rows[cid] = r

mean = lambda xs: sum(xs) / len(xs) if xs else float('nan')


def boot(sub, k, x, y, B_=10000, seed=7):
    rnd = random.Random(seed); d = []
    for _ in range(B_):
        s = [rnd.choice(sub) for _ in sub]
        d.append(100 * (mean([rows[c][f'{x}@{k}'] for c in s]) - mean([rows[c][f'{y}@{k}'] for c in s])))
    d.sort()
    return round(100 * (mean([rows[c][f'{x}@{k}'] for c in sub]) - mean([rows[c][f'{y}@{k}'] for c in sub])), 1), round(d[int(0.025 * B_)], 1), round(d[int(0.975 * B_)], 1)


def report(ids):
    res = {'anchors': len(ids), 'pairs': sum(rows[c]['n'] for c in ids)}
    if not ids: return res
    best = 'Q' if mean([rows[c]['Q@20'] for c in ids]) >= mean([rows[c]['W@20'] for c in ids]) else 'W'
    res['best@20'] = best
    for k in KS:
        res[f'k={k}'] = {'recall': {m: round(100 * mean([rows[c][f'{m}@{k}'] for c in ids]), 1) for m in ['Q', 'W', 'L', 'QW']},
                         'hit': {m: round(100 * mean([1.0 if rows[c][f'{m}_h{k}'] > 0 else 0.0 for c in ids]), 1) for m in ['Q', 'W', 'L', 'QW']},
                         'pairs hit': {m: sum(rows[c][f'{m}_h{k}'] for c in ids) for m in ['Q', 'W', 'L', 'QW']},
                         'QW-best [CI]': boot(ids, k, 'QW', best), 'Q-W [CI]': boot(ids, k, 'Q', 'W'), 'QW-Q [CI]': boot(ids, k, 'QW', 'Q'),
                         'QW-W [CI]': boot(ids, k, 'QW', 'W'), 'Q-L [CI]': boot(ids, k, 'Q', 'L'), 'W-L [CI]': boot(ids, k, 'W', 'L')}
    return res


allids = sorted(anchors, key=lambda c: float(anchors[c]['pop'])); n = len(allids); t23 = set(allids[:2 * n // 3])
noL1 = [c for c in TEST if leak[c] == 0]
out = {'model': M, 'test_label': C['test_label'], 'cost_usd_testC': round(sum(x['usd'] for x in C['calls']), 3),
       '(a) HELD24 test set': report(TEST), '(b) HELD24 minus L1-leaked': report(noL1),
       'HELD24 mid+cold [report only]': report([c for c in TEST if c in t23]),
       'SUBSET24 (6b) incl. QW [QW post-hoc]': report(SUB),
       'POOLED 48 [post-hoc pooling]': report(SUB + TEST),
       'L1 leaked anchors in HELD24': len(TEST) - len(noL1)}
a = out['(a) HELD24 test set']['k=20']; D, lo, hi = a['QW-best [CI]']
b_ok = len(noL1) >= 12
lob = out['(b) HELD24 minus L1-leaked']['k=20']['QW-best [CI]'][1] if b_ok else None
out['PASS'] = bool(len(TEST) >= 20 and D >= 5.0 and lo > 0 and (lob is None or lob > 0))
out['note'] = ('(b) used' if b_ok else '(b) < 12 anchors; (a) alone') + ('' if len(TEST) >= 20 else '; UNDERPOWERED -> not PASS')
json.dump(out, open('results_testC.json', 'w', encoding='utf8'), indent=1, ensure_ascii=False)
for kx in ['(a) HELD24 test set', '(b) HELD24 minus L1-leaked', 'HELD24 mid+cold [report only]', 'SUBSET24 (6b) incl. QW [QW post-hoc]', 'POOLED 48 [post-hoc pooling]']:
    r = out[kx]; print('==', kx, r['anchors'], r.get('pairs'), 'best', r.get('best@20'))
    for k in KS:
        if f'k={k}' in r: print('  k', k, r[f'k={k}'])
print('L1 leaked', out['L1 leaked anchors in HELD24'], 'PASS', out['PASS'], out['note'], 'cost', out['cost_usd_testC'])
