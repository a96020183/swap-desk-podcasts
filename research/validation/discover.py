# Step 1: discover candidate shows via iTunes episode search; fetch each RSS feed; keep promo episodes.
import json, os, re, sys, urllib.request, hashlib
import xml.etree.ElementTree as ET
from email.utils import parsedate_to_datetime
from common import DATA, itunes, strip_html

TERMS = ["feed drop", "feed swap", "promo swap", "pod swap", "podcast swap", "trailer swap", "show swap", "crossover episode"]
PROMO_RE = re.compile(r"feed[\s-]*drop|feed[\s-]*swap|promo[\s-]*swap|pod(cast)?[\s-]*swap|trailer[\s-]*swap|show[\s-]*swap|"
                      r"cross[\s-]*over|introducing|presenting|sneak[\s-]*peek|we think you.?ll (like|love|enjoy)|check out", re.I)
RSS_DIR = DATA + 'rss/'
os.makedirs(RSS_DIR, exist_ok=True)

cands = {}
for t in TERMS:
    d = itunes({'term': t, 'media': 'podcast', 'entity': 'podcastEpisode', 'country': 'US', 'limit': 200})
    for r in d.get('results', []):
        cid, feed = r.get('collectionId'), r.get('feedUrl')
        if cid and feed and cid not in cands:
            cands[cid] = {'collectionId': cid, 'collectionName': r.get('collectionName'), 'feedUrl': feed}
    print(t, len(d.get('results', [])), 'cands', len(cands))


def fetch(url):
    f = RSS_DIR + hashlib.md5(url.encode()).hexdigest() + '.xml'
    if os.path.exists(f): return open(f, 'rb').read()
    try:
        b = urllib.request.urlopen(urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0 (podcast research; one fetch per feed)'}), timeout=20).read()
    except Exception as e:
        print('rss err', url[:60], str(e)[:60]); return None
    open(f, 'wb').write(b)
    return b


IT = '{http://www.itunes.com/dtds/podcast-1.0.dtd}'
out = {}
for i, (cid, c) in enumerate(sorted(cands.items())):
    b = fetch(c['feedUrl'])
    if not b: continue
    try:
        root = ET.fromstring(b)
    except Exception as e:
        print('xml err', cid); continue
    ch = root.find('channel')
    if ch is None: continue
    desc = strip_html(ch.findtext('description') or ch.findtext(IT + 'summary') or '')[:400]
    author = ch.findtext(IT + 'author') or ''
    eps = []
    for it in ch.findall('item'):
        title = (it.findtext('title') or '').strip()
        if not PROMO_RE.search(title): continue
        try:
            dt = parsedate_to_datetime(it.findtext('pubDate')).date().isoformat()
        except Exception:
            dt = ''
        eps.append({'title': title, 'date': dt, 'desc': strip_html(it.findtext('description') or it.findtext(IT + 'summary') or '')[:300]})
    eps.sort(key=lambda e: e['date'], reverse=True)
    out[cid] = {**c, 'channel_desc': desc, 'rss_author': author, 'n_items': len(ch.findall('item')), 'promo_eps': eps[:40]}
    if i % 20 == 0: print(i, len(out))
json.dump(out, open(DATA + 'candidates.json', 'w', encoding='utf8'), ensure_ascii=False, indent=1)
print('shows', len(out), 'with promo eps', sum(1 for v in out.values() if v['promo_eps']))
