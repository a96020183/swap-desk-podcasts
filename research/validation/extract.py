# Step 2: LLM extracts the OTHER podcast named in each promo episode; resolve via iTunes; apply exclusions -> truth.json
import json, os
from common import DATA, llm, itunes, normalize, base, same, usage

PROMPT = ('Podcast A is "{anchor}". Below are episodes from podcast A\'s own feed whose titles suggest promotion.\n'
          'For each episode, decide whether the episode mainly promotes, previews, feed-drops, trailer-swaps, or crosses over with a '
          'DIFFERENT podcast (not podcast A itself, not a new season of A). If yes, give that other podcast\'s title exactly as written in the '
          'episode text. If not, or if no other podcast title is stated, give "".\n'
          'Episodes:\n{eps}\n'
          'Return JSON only: {{"episodes": [{{"n": <episode number>, "other_podcast": "<title or empty>"}}]}} with one entry per episode.')

cands = json.load(open(DATA + 'candidates.json', encoding='utf8'))
exf = DATA + 'extracted.json'
ex = json.load(open(exf, encoding='utf8')) if os.path.exists(exf) else {}
for cid, c in cands.items():
    if cid in ex or not c['promo_eps']: continue
    eps = '\n'.join(f'{i + 1}. TITLE: {e["title"]} | TEXT: {e["desc"]}' for i, e in enumerate(c['promo_eps']))
    r = llm(PROMPT.format(anchor=c['collectionName'], eps=eps), max_tokens=3000)
    names = []
    for x in r.get('episodes', []):
        try:
            n = int(x.get('n')) - 1
        except Exception:
            continue
        nm = (x.get('other_podcast') or '').strip()
        if nm and 0 <= n < len(c['promo_eps']):
            names.append({'name': nm, 'date': c['promo_eps'][n]['date']})
    ex[cid] = names
    json.dump(ex, open(exf, 'w', encoding='utf8'), ensure_ascii=False, indent=1)
print('extracted shows', len(ex), 'usd', round(usage()['usd'], 4))

# anchor publisher via iTunes podcast search (needed for same-publisher exclusion)
truth = {}
for cid, names in ex.items():
    c = cands[cid]
    if not names: continue
    # only resolve if there could be >= 2 distinct partners
    if len({normalize(n['name']) for n in names}) < 2: continue
    a = itunes({'term': c['collectionName'], 'media': 'podcast', 'entity': 'podcast', 'country': 'US', 'limit': 5})
    arow = next((r for r in a.get('results', []) if str(r.get('collectionId')) == str(cid)), None)
    a_artist = (arow or {}).get('artistName') or c.get('rss_author') or ''
    a_genre = (arow or {}).get('primaryGenreName') or ''
    parts = {}
    for n in names:
        d = itunes({'term': n['name'], 'media': 'podcast', 'entity': 'podcast', 'country': 'US', 'limit': 5})
        hit = None
        for r in d.get('results', []):
            cn = r.get('collectionName') or ''
            if normalize(cn) == normalize(n['name']) or (len(base(n['name'])) >= 4 and base(cn) == base(n['name'])):
                hit = r; break
        if not hit: continue
        pid = str(hit['collectionId'])
        if pid == str(cid): continue
        if normalize(hit.get('artistName') or '') == normalize(a_artist) and normalize(a_artist): continue
        ab, pn = base(c['collectionName']), normalize(hit['collectionName'])
        an, pb = normalize(c['collectionName']), base(hit['collectionName'])
        if (len(ab) >= 4 and ab in pn) or (len(pb) >= 4 and pb in an): continue
        p = parts.setdefault(pid, {'id': pid, 'name': hit['collectionName'], 'artist': hit.get('artistName'), 'date': ''})
        p['date'] = max(p['date'], n['date'])
    truth[cid] = {'anchor': c['collectionName'], 'artist': a_artist, 'genre': a_genre, 'channel_desc': c['channel_desc'],
                  'partners': list(parts.values())}
    json.dump(truth, open(DATA + 'truth.json', 'w', encoding='utf8'), ensure_ascii=False, indent=1)
print('anchors with >=2 partners', sum(1 for t in truth.values() if len(t['partners']) >= 2),
      'pairs', sum(len(t['partners']) for t in truth.values() if len(t['partners']) >= 2))
