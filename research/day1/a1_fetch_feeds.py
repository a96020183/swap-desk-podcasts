# Test A step 1: candidate iTunes ids -> iTunes Lookup -> one GET per feed -> parsed fields in .private.
from concurrent.futures import ThreadPoolExecutor
from collections import Counter
from day1_lib import load_wave6, clean, itunes_lookup, fetch_and_parse, usage, itunes_map

anchors = load_wave6('anchors.json')
ql = load_wave6('qloo_lists.json')

cand = {}       # itunes id -> qloo name
no_id = 0
for cid, a in anchors.items():
    im = itunes_map(cid)
    for x in ql[cid]['Q']:
        if not clean([x['name']], a):
            continue
        it = im.get(x['id'])
        if not it:
            no_id += 1; continue
        cand.setdefault(str(it), x['name'])
ids = sorted(cand)
print('distinct candidates with iTunes id', len(ids), 'rows without id', no_id)

meta = {}
for i in range(0, len(ids), 150):
    for r in itunes_lookup(ids[i:i + 150]).get('results', []):
        if r.get('collectionId'):
            meta[str(r['collectionId'])] = r
print('lookup hits', len(meta), 'with feedUrl', sum(1 for m in meta.values() if m.get('feedUrl')))

jobs = [(i, meta[i]['feedUrl'], meta[i].get('collectionName') or cand[i]) for i in ids if i in meta and meta[i].get('feedUrl')]
with ThreadPoolExecutor(12) as ex:
    res = list(ex.map(lambda j: fetch_and_parse(*j), jobs))
print('feeds', len(res), Counter('ok' if r.get('ok') else 'fail' for r in res), 'usage', usage())
