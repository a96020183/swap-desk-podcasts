# Test A step 2: frozen extraction prompt on each candidate's promo episodes (union of pool a and every pool b).
import json, os
from day1_lib import (PRIV, PROMPTS, load_wave6, clean, feed_path, pool_a, pool_b, promo, ep_key, llm, fill, usage, itunes_map)

anchors = load_wave6('anchors.json')
ql = load_wave6('qloo_lists.json')


cutoffs = {cid: min(p['date'] for p in a['partners'] if p.get('date')) for cid, a in anchors.items()}
need = {}  # itunes id -> {ep_key: episode}
for cid, a in anchors.items():
    im = itunes_map(cid)
    for x in ql[cid]['Q']:
        if not clean([x['name']], a): continue
        i = im.get(x['id'])
        if not i or not os.path.exists(feed_path(i)): continue
        feed = json.load(open(feed_path(i), encoding='utf8'))
        if not feed.get('ok'): continue
        eps = need.setdefault(i, {})
        for e in promo(pool_a(feed)) + promo(pool_b(feed, cutoffs[cid])):
            eps[ep_key(e)] = e

print('candidates with promo episodes', sum(1 for v in need.values() if v), 'episodes', sum(len(v) for v in need.values()))
done = 0
for i, eps in sorted(need.items()):
    if not eps: continue
    outf = os.path.join(PRIV, 'extract', i + '.json')
    if os.path.exists(outf): continue
    feed = json.load(open(feed_path(i), encoding='utf8'))
    lst = sorted(eps.values(), key=lambda e: e['date'], reverse=True)
    result = {}
    for s in range(0, len(lst), 40):
        chunk = lst[s:s + 40]
        text = '\n'.join(f'{n + 1}. TITLE: {e["title"]} | TEXT: {e["desc"]}' for n, e in enumerate(chunk))
        r = llm(fill(PROMPTS['extract'], anchor=feed['name'], eps=text), max_tokens=3000)
        for x in r.get('episodes', []):
            try:
                n = int(x.get('n')) - 1
            except Exception:
                continue
            if 0 <= n < len(chunk):
                result[ep_key(chunk[n])] = (x.get('other_podcast') or '').strip()
    json.dump({'name': feed['name'], 'eps': result}, open(outf, 'w', encoding='utf8'), ensure_ascii=False)
    done += 1
    if done % 50 == 0: print(done, usage())
print('extracted', done, 'usage', usage())
