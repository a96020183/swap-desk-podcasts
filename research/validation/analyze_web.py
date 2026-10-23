# Wave 6b analysis (PROTOCOL_web.md sections 5-7). No API calls.
import json, random, re, sys, hashlib, urllib.parse
import xml.etree.ElementTree as ET
from email.utils import parsedate_to_datetime
from common import DATA, same, normalize, base, strip_html
sys.stdout.reconfigure(encoding='utf-8')

PROMO_RE = re.compile(r"feed[\s-]*drop|feed[\s-]*swap|promo[\s-]*swap|pod(cast)?[\s-]*swap|trailer[\s-]*swap|show[\s-]*swap|"
                      r"cross[\s-]*over|introducing|presenting|sneak[\s-]*peek|we think you.?ll (like|love|enjoy)|check out", re.I)
anchors = json.load(open(DATA + 'anchors.json', encoding='utf8'))
cands = json.load(open(DATA + 'candidates.json', encoding='utf8'))
ql = json.load(open(DATA + 'qloo_lists.json', encoding='utf8'))
ll = json.load(open(DATA + 'llm_lists.json', encoding='utf8'))
st = json.load(open(DATA + 'web_llm.json', encoding='utf8'))
E = st['model']
PRIMARY = st['primary_set']
KS = [5, 10, 20]


def clean(names, a):
    return [n for n in names if not same(n, a['anchor']) and not same(n, a.get('qname') or '')]


def recall(items, partners, k):
    items = items[:k]; hit = 0
    for p in partners:
        if any(same(i, p['name']) for i in items): hit += 1
    return hit / len(partners), hit


# ---------- leakage ----------
def url_norm(u):
    p = urllib.parse.urlsplit((u or '').strip().lower())
    host = p.netloc[4:] if p.netloc.startswith('www.') else p.netloc
    q = ''
    if 'apple.com' in host:
        i = urllib.parse.parse_qs(p.query).get('i')
        if i: q = '?i=' + i[0]
    return host + p.path.rstrip('/') + q


def host_of(u):
    h = urllib.parse.urlsplit((u or '').strip().lower()).netloc
    return h[4:] if h.startswith('www.') else h


def text_of(u, title=''):
    p = urllib.parse.urlsplit(u or '')
    s = urllib.parse.unquote(p.netloc + ' ' + p.path)
    s = re.sub(r'[-_/.]+', ' ', s)
    return ' ' + normalize(s) + ' ' + normalize(title or '') + ' '


def has(text, b):
    return len(b) >= 4 and (' ' + b + ' ') in text


def leak_info(cid):
    a, c = anchors[cid], cands[cid]
    raw = open(DATA + 'rss/' + hashlib.md5(c['feedUrl'].encode()).hexdigest() + '.xml', 'rb').read()
    ans, site = {url_norm(c['feedUrl'])}, ''
    try:
        ch = ET.fromstring(raw).find('channel')
    except Exception:
        ch = None
    pbases = [base(p['name']) for p in a['partners']]
    pdates = {p['date'] for p in a['partners']}
    if ch is not None:
        site = (ch.findtext('link') or '').strip()
        for it in ch.findall('item'):
            title = (it.findtext('title') or '').strip()
            if not PROMO_RE.search(title): continue
            try:
                dt = parsedate_to_datetime(it.findtext('pubDate')).date().isoformat()
            except Exception:
                dt = ''
            txt = ' ' + normalize(title + ' ' + strip_html(it.findtext('description') or '')) + ' '
            if not (dt in pdates or any(has(txt, b) for b in pbases)): continue
            link = (it.findtext('link') or '').strip()
            if link and url_norm(link) != url_norm(site) and urllib.parse.urlsplit(link).path.strip('/'):
                ans.add(url_norm(link))
            g = (it.findtext('guid') or '').strip()
            if g.startswith('http'): ans.add(url_norm(g))
            enc = it.find('enclosure')
            if enc is not None and enc.get('url'): ans.add(url_norm(enc.get('url')))
    abases = {base(a['anchor']), base(a.get('qname') or '')} - {''}
    return {'ans': ans, 'site_host': host_of(site), 'cid': cid, 'abases': abases, 'pbases': pbases}


def classify(info, u, title=''):
    t = text_of(u, title)
    about = ('id' + info['cid']) in (u or '') or (info['site_host'] and host_of(u) == info['site_host']) or any(has(t, b) for b in info['abases'])
    partner = any(has(t, b) for b in info['pbases'])
    l1 = url_norm(u) in info['ans'] or (about and partner) or (partner and any(has(t, b) for b in info['abases']))
    return 'L1' if l1 else ('L2' if about else '')


rows, leak = {}, {}
WATCH = ['podcasts.apple.com', 'rephonic.com', 'matchmaker.fm', 'podchaser.com', 'listennotes.com']
for cid in PRIMARY:
    a = anchors[cid]; rec = st['runs'][f'{cid}|{E}']
    info = leak_info(cid)
    cited = [(x['url'], x.get('title', '')) for x in rec['cited']]
    cons = [(u, '') for u in rec['consulted']]
    cl_c = [classify(info, u, t) for u, t in cited]
    cl_s = [classify(info, u, t) for u, t in cons]
    hosts = {host_of(u) for u, _ in cited + cons}
    leak[cid] = {'L1_cited': sum(x == 'L1' for x in cl_c), 'L1_consulted': sum(x == 'L1' for x in cl_s),
                 'L2_any': sum(x in ('L1', 'L2') for x in cl_c + cl_s), 'n_cited': len(cited), 'n_consulted': len(cons),
                 'L1_urls': sorted({u for (u, _), x in zip(cited + cons, cl_c + cl_s) if x == 'L1'})[:10],
                 'watch': {w: any(h == w or h.endswith('.' + w) for h in hosts) for w in WATCH},
                 'n_titles': len(rec['titles']), 'status': rec['status']}
    lists = {'Q': clean([x['name'] for x in ql[cid]['Q']], a), 'W': clean(rec['titles'], a), 'L': clean(ll[cid], a)}
    r = {'pop': float(a['pop']), 'n': len(a['partners'])}
    for m, it in lists.items():
        for k in KS:
            r[f'{m}@{k}'], r[f'{m}_h{k}'] = recall(it, a['partners'], k)
    rows[cid] = r

mean = lambda xs: sum(xs) / len(xs) if xs else float('nan')


def boot(sub, k, x, y, B=10000, seed=7):
    rnd = random.Random(seed); d = []
    for _ in range(B):
        s = [rnd.choice(sub) for _ in sub]
        d.append(100 * (mean([rows[c][f'{x}@{k}'] for c in s]) - mean([rows[c][f'{y}@{k}'] for c in s])))
    d.sort()
    return round(100 * (mean([rows[c][f'{x}@{k}'] for c in sub]) - mean([rows[c][f'{y}@{k}'] for c in sub])), 1), round(d[int(0.025 * B)], 1), round(d[int(0.975 * B)], 1)


def report(ids):
    res = {'anchors': len(ids), 'pairs': sum(rows[c]['n'] for c in ids)}
    if not ids: return res
    for k in KS:
        res[f'k={k}'] = {'recall': {m: round(100 * mean([rows[c][f'{m}@{k}'] for c in ids]), 1) for m in 'QWL'},
                         'hit': {m: round(100 * mean([1.0 if rows[c][f'{m}_h{k}'] > 0 else 0.0 for c in ids]), 1) for m in 'QWL'},
                         'pairs hit': {m: sum(rows[c][f'{m}_h{k}'] for c in ids) for m in 'QWL'},
                         'Q-W [CI]': boot(ids, k, 'Q', 'W'), 'W-L [CI]': boot(ids, k, 'W', 'L')}
    return res


# tiers on the full 48 (as in analyze.py)
allids = sorted(anchors, key=lambda c: float(anchors[c]['pop'])); n = len(allids)
t23 = set(allids[:2 * n // 3]); t3 = set(allids[:n // 3])
ids = list(PRIMARY)
noL1 = [c for c in ids if leak[c]['L1_cited'] + leak[c]['L1_consulted'] == 0]
noL2 = [c for c in ids if leak[c]['L2_any'] == 0]
ok = [c for c in ids if leak[c]['n_titles'] > 0]
out = {'model': E, 'effort': 'low', 'search_context_size': 'low', 'primary_label': st['primary_label'],
       'cost_usd_new_spend': round(sum(x['usd'] for x in st['calls']), 3), 'cost_usd_precommit_incident_assumed': 2.0, 'n_calls': len(st['calls']),
       '(a) primary': report(ids), '(b) minus L1-leaked anchors': report(noL1), '(c) minus L2 anchors [report only]': report(noL2),
       'mid+cold within primary [report only]': report([c for c in ids if c in t23]),
       'coldest third within primary [report only]': report([c for c in ids if c in t3]),
       'sensitivity: anchors with >=1 parsed title': report(ok),
       'leak counts': {'anchors with L1 (cited or consulted)': len(ids) - len(noL1), 'anchors with L1 cited': sum(leak[c]['L1_cited'] > 0 for c in ids),
                       'anchors with L2': len(ids) - len(noL2),
                       'mean cited urls': round(mean([leak[c]['n_cited'] for c in ids]), 1), 'mean consulted urls': round(mean([leak[c]['n_consulted'] for c in ids]), 1),
                       'share citing/consulting': {w: round(100 * mean([1.0 if leak[c]['watch'][w] else 0.0 for c in ids]), 1) for w in WATCH}},
       'per_anchor_leak': leak}
lo_a = out['(a) primary']['k=20']['Q-W [CI]'][1]
b_ok = len(noL1) >= 12
lo_b = out['(b) minus L1-leaked anchors']['k=20']['Q-W [CI]'][1] if b_ok else None
out['verdict'] = 'QLOO STILL WINS' if (lo_a > 0 and (lo_b is None or lo_b > 0)) else 'WEB LLM NOT WORSE'
out['verdict_note'] = '(b) used' if b_ok else '(b) has < 12 anchors; (a) alone decides'
json.dump(out, open('results_web.json', 'w', encoding='utf8'), indent=1, ensure_ascii=False)
for kx in ['(a) primary', '(b) minus L1-leaked anchors', '(c) minus L2 anchors [report only]', 'mid+cold within primary [report only]',
           'coldest third within primary [report only]', 'sensitivity: anchors with >=1 parsed title']:
    r = out[kx]; print('==', kx, r['anchors'], r.get('pairs'))
    for k in KS:
        if f'k={k}' in r: print('  k', k, r[f'k={k}'])
print(out['leak counts']); print(out['verdict'], out['verdict_note'], 'new spend', out['cost_usd_new_spend'])
