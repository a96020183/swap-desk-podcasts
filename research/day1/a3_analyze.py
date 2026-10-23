# Test A step 3: frozen analysis (PROTOCOL_day1.md section 1). Writes derived numbers only.
import json, os, random
from day1_lib import (PRIV, REPO, load_wave6, clean, recall, mean, boot_diff, feed_path, pool_a, pool_b, promo, ep_key,
                      ep_text, normalize, base, same, itunes_map)
from day1_lib import appears  # word-for-word check

anchors = load_wave6('anchors.json')
ql = load_wave6('qloo_lists.json')
ids = sorted(anchors, key=int)
cutoffs = {cid: min(p['date'] for p in anchors[cid]['partners'] if p.get('date')) for cid in ids}


def feed_of(i):
    if not i or not os.path.exists(feed_path(i)): return None
    f = json.load(open(feed_path(i), encoding='utf8'))
    return f if f.get('ok') else None


def extracted(i):
    p = os.path.join(PRIV, 'extract', str(i) + '.json')
    return json.load(open(p, encoding='utf8')) if os.path.exists(p) else {'name': '', 'eps': {}}


def main_name(a):
    b = base(a['anchor'])
    return b if len(b) >= 4 else normalize(a['anchor'])


def h_rule(a, eps):
    mn = main_name(a)
    return int(any(mn not in normalize(ep_text(e)) for e in eps))


def h_agent(a, cand_name, eps, ex):
    for e in eps:
        x = ex['eps'].get(ep_key(e), '')
        if not x: continue
        if not appears(x, ep_text(e)): continue
        if same(x, cand_name) or same(x, ex.get('name') or cand_name): continue
        if same(x, a['anchor']) or same(x, a.get('qname') or ''): continue
        return 1
    return 0


def rerank(names, flags, k):
    order = sorted(range(len(names)), key=lambda j: ((j + 1) * (0.5 if flags[j] else 1), j + 1))
    return [names[j] for j in order][:k]


rows, counts = {}, {'cands': 0, 'with_feed': 0, 'promo_a': 0, 'agent_a': 0, 'rule_a': 0}
for cid in ids:
    a = anchors[cid]; im = itunes_map(cid)
    cands = [x for x in ql[cid]['Q'] if clean([x['name']], a)]
    names = [x['name'] for x in cands]
    sig = {'rule_a': [], 'agent_a': [], 'rule_b': [], 'agent_b': []}
    for x in cands:
        counts['cands'] += 1
        f = feed_of(im.get(x['id']))
        if not f:
            for k in sig: sig[k].append(0)
            continue
        counts['with_feed'] += 1
        ex = extracted(im.get(x['id']))
        pa, pb = promo(pool_a(f)), promo(pool_b(f, cutoffs[cid]))
        counts['promo_a'] += bool(pa)
        cname = f.get('name') or x['name']
        sig['rule_a'].append(h_rule(a, pa)); sig['agent_a'].append(h_agent(a, cname, pa, ex))
        sig['rule_b'].append(h_rule(a, pb)); sig['agent_b'].append(h_agent(a, cname, pb, ex))
    counts['agent_a'] += sum(sig['agent_a']); counts['rule_a'] += sum(sig['rule_a'])
    r = {'pop': a['pop'], 'names': names, 'sig': sig}
    for k in (5, 20):
        r[f'Q@{k}'] = recall(names, a['partners'], k)[0]
        for s in ('rule_a', 'agent_a', 'rule_b', 'agent_b'):
            r[f'{s}@{k}'] = recall(rerank(names, sig[s], k), a['partners'], k)[0]
    r['Q@50'] = recall(names, a['partners'], 50)[0]
    rows[cid] = r

per = lambda key: {c: rows[c][key] for c in ids}
pct = lambda key, sub=ids: round(100 * mean([rows[c][key] for c in sub]), 1)

# placebo (pool a)
rnd = random.Random(7); plac = []
for _ in range(1000):
    vals = []
    for c in ids:
        r = rows[c]; n = len(r['names']); m = sum(r['sig']['agent_a'])
        pick = set(rnd.sample(range(n), m)) if m else set()
        flags = [1 if j in pick else 0 for j in range(n)]
        vals.append(recall(rerank(r['names'], flags, 20), anchors[c]['partners'], 20)[0])
    plac.append(100 * mean(vals))
plac.sort()
p95 = round(plac[int(0.95 * len(plac))], 1)

pop_sorted = sorted(ids, key=lambda c: rows[c]['pop']); n = len(ids)
midcold = pop_sorted[: 2 * n // 3]


def verdict(pool):
    d = boot_diff(per(f'agent_{pool}@20'), per('Q@20'), ids)
    return {'Q@20': pct('Q@20'), 'QH_rule@20': pct(f'rule_{pool}@20'), 'QH_agent@20': pct(f'agent_{pool}@20'),
            'QH_agent - Q [CI]': d,
            'QH_agent - QH_rule [CI] (report only)': boot_diff(per(f'agent_{pool}@20'), per(f'rule_{pool}@20'), ids),
            'k=5: Q / QH_rule / QH_agent': [pct('Q@5'), pct(f'rule_{pool}@5'), pct(f'agent_{pool}@5')],
            'k=5: QH_agent - Q [CI]': boot_diff(per(f'agent_{pool}@5'), per('Q@5'), ids),
            'mid+cold (T2+T3) @20: Q / QH_rule / QH_agent': [pct('Q@20', midcold), pct(f'rule_{pool}@20', midcold), pct(f'agent_{pool}@20', midcold)],
            'cond1 diff >= 2.0': d[0] >= 2.0, 'cond2 CI low > 0': d[1] > 0}


A, Bv = verdict('a'), verdict('b')
A['placebo p95'] = p95; A['placebo mean'] = round(mean(plac), 1)
A['cond3 above placebo p95'] = A['QH_agent@20'] > p95
A['PASS'] = bool(A['cond1 diff >= 2.0'] and A['cond2 CI low > 0'] and A['cond3 above placebo p95'])
sep = A['QH_agent - QH_rule [CI] (report only)'][1] > 0
res = {'test': 'A', 'anchors': n, 'pairs': sum(len(anchors[c]['partners']) for c in ids),
       'Q recall@50 ceiling': pct('Q@50'), 'counts': counts,
       'pool (a) last 40 episodes': A, 'pool (b) before first swap': Bv,
       'b opposite to a': (A['QH_agent - Q [CI]'][0] > 0) != (Bv['QH_agent - Q [CI]'][0] > 0),
       'product decision': ('rerank with H_agent' if A['PASS'] and sep else 'rerank with H_rule' if A['PASS'] else 'info only, no rerank')}
out = os.path.join(REPO, 'research', 'day1', 'results_testA.json')
json.dump(res, open(out, 'w', encoding='utf8'), indent=1)
print(json.dumps(res, indent=1))
