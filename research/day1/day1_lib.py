# Shared helpers for the Day-1 tests. Keys are read from the repo's .env and never printed or written.
# Raw data (feeds, LLM output, Qloo responses) goes to .private/research/day1/ (git-ignored).
import hashlib, json, os, random, re, sys, time, urllib.error, urllib.parse, urllib.request
import xml.etree.ElementTree as ET
from email.utils import parsedate_to_datetime

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(HERE, '..', '..'))
sys.path.insert(0, os.path.join(REPO, 'research', 'validation'))
from common import normalize, base, same, strip_html  # noqa: E402  (verbatim copy of the frozen helpers)

WAVE6 = os.environ.get('WAVE6_DIR', 'C:/Users/678/AppData/Local/Temp/claude/c--2026---/135e2cdd-7648-492d-981b-527d5792a8c5/scratchpad/qloo2/wave6/')
WDATA = os.path.join(WAVE6, 'data')
PRIV = os.path.join(REPO, '.private', 'research', 'day1')
for d in ['feeds', 'extract', 'qloo', 'llm']:
    os.makedirs(os.path.join(PRIV, d), exist_ok=True)
PROMPTS = json.load(open(os.path.join(REPO, 'src', 'prompts.json'), encoding='utf8'))
PROMO_RE = re.compile(PROMPTS['promoTitleRegex'], re.I)
K = 20


def load_wave6(name):
    return json.load(open(os.path.join(WDATA, name), encoding='utf8'))


def env():
    out = {}
    for line in open(os.path.join(REPO, '.env'), encoding='utf8'):
        m = re.match(r'\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$', line)
        if m and not line.strip().startswith('#'):
            out[m.group(1)] = m.group(2).strip('"\'')
    return out


ENV = env()

# ---------- frozen scoring (same as research/validation/analyze.py) ----------

def clean(names, a):
    return [n for n in names if not same(n, a['anchor']) and not same(n, a.get('qname') or '')]


def recall(items, partners, k):
    items = items[:k]; hit = 0
    for p in partners:
        if any(same(i, p['name']) for i in items): hit += 1
    return hit / len(partners), hit


mean = lambda xs: sum(xs) / len(xs) if xs else float('nan')


def boot_diff(per_a, per_b, ids, B=10000, seed=7):
    """Same procedure as analyze.py boot(): resample anchors with replacement, macro mean difference in points."""
    rnd = random.Random(seed); d = []
    for _ in range(B):
        s = [rnd.choice(ids) for _ in ids]
        d.append(100 * (mean([per_a[c] for c in s]) - mean([per_b[c] for c in s])))
    d.sort()
    point = 100 * (mean([per_a[c] for c in ids]) - mean([per_b[c] for c in ids]))
    return round(point, 1), round(d[int(0.025 * B)], 1), round(d[int(0.975 * B)], 1)


# ---------- usage ----------
# One counter file per running script (no cross-process races); a lock guards threads; usage() sums all files.
import threading
_LOCK = threading.Lock()
_ME = os.path.splitext(os.path.basename(sys.argv[0] or 'interactive'))[0] or 'interactive'
USAGE = os.path.join(PRIV, '_usage_%s.json' % _ME)
_U = json.load(open(USAGE)) if os.path.exists(USAGE) else {'usd': 0.0, 'llm_calls': 0, 'qloo': 0, 'itunes': 0, 'rss': 0}


def _write():
    tmp = USAGE + '.tmp'
    json.dump(_U, open(tmp, 'w'), indent=1)
    os.replace(tmp, USAGE)


def usage():
    tot = {}
    import glob as _g
    for f in _g.glob(os.path.join(PRIV, '_usage*.json')):
        try:
            d = _U if os.path.abspath(f) == os.path.abspath(USAGE) else json.load(open(f))
        except Exception:
            continue
        for k, v in d.items(): tot[k] = round(tot.get(k, 0) + v, 6)
    return tot


def bump(field, n=1):
    with _LOCK:
        _U[field] = _U.get(field, 0) + n
        _write()


# ---------- OpenAI ----------
LLM_CAP_USD = 3.0


def llm(prompt, max_tokens=2000, cache_key=None):
    f = os.path.join(PRIV, 'llm', hashlib.sha1((cache_key or prompt).encode()).hexdigest() + '.json')
    if os.path.exists(f):
        return json.load(open(f, encoding='utf8'))
    if usage().get('usd', 0) > LLM_CAP_USD:
        raise SystemExit('LLM cap reached')
    body = {'model': 'gpt-4.1-mini', 'temperature': 0, 'max_tokens': max_tokens, 'response_format': {'type': 'json_object'},
            'messages': [{'role': 'system', 'content': 'Reply with JSON only.'}, {'role': 'user', 'content': prompt}]}
    req = urllib.request.Request('https://api.openai.com/v1/chat/completions', data=json.dumps(body).encode(),
                                 headers={'Authorization': 'Bearer ' + ENV['OPENAI_API_KEY'], 'Content-Type': 'application/json'})
    r = None
    for i in range(4):
        try:
            r = json.loads(urllib.request.urlopen(req, timeout=120).read()); break
        except Exception as e:
            print('llm err', str(e)[:100]); time.sleep(10 * (i + 1))
    if r is None:
        return {}
    tin, tout = r['usage']['prompt_tokens'], r['usage']['completion_tokens']
    bump('usd', tin * 0.4 / 1e6 + tout * 1.6 / 1e6); bump('llm_calls')
    try:
        out = json.loads(r['choices'][0]['message']['content'])
    except Exception:
        out = {}
    json.dump(out, open(f, 'w', encoding='utf8'), ensure_ascii=False)
    return out


def fill(template, **kw):
    for k, v in kw.items():
        template = template.replace('{' + k + '}', str(v))
    return template


# ---------- Qloo ----------
QLOO_CAP = 950  # Test B (<= 900) + extras


def qloo(label, path, params, refetch=False):
    f = os.path.join(PRIV, 'qloo', re.sub(r'[^\w.-]+', '_', label)[:80] + '.json')
    if os.path.exists(f) and not refetch:
        d = json.load(open(f, encoding='utf8'))
        if d.get('status') == 200:
            return d
    if usage().get('qloo', 0) >= QLOO_CAP:
        raise SystemExit('Qloo cap reached')
    url = ENV.get('QLOO_BASE_URL', 'https://hackathon.api.qloo.com').rstrip('/') + path + '?' + urllib.parse.urlencode(params)
    status, body = 0, None
    for i in range(3):
        bump('qloo'); time.sleep(0.3)
        try:
            r = urllib.request.urlopen(urllib.request.Request(url, headers={'X-Api-Key': ENV['QLOO_API_KEY'], 'accept': 'application/json'}), timeout=60)
            status, body = r.status, json.loads(r.read())
        except urllib.error.HTTPError as e:
            status = e.code
            try: body = json.loads(e.read())
            except Exception: body = {}
        except Exception as e:
            status, body = 0, {'error': str(e)[:200]}
        if status not in (0, 429, 502, 503, 504): break
        time.sleep(3 * (i + 1))
    d = {'path': path, 'params': params, 'status': status, 'body': body}
    json.dump(d, open(f, 'w', encoding='utf8'), ensure_ascii=False)
    return d


# ---------- iTunes Lookup (official API, <= 18 calls/min) ----------
_IT_LAST = [0.0]


def itunes_lookup(ids):
    key = hashlib.sha1(','.join(ids).encode()).hexdigest()
    f = os.path.join(PRIV, 'feeds', '_lookup_' + key + '.json')
    if os.path.exists(f):
        return json.load(open(f, encoding='utf8'))
    wait = 3.4 - (time.time() - _IT_LAST[0])
    if wait > 0: time.sleep(wait)
    url = 'https://itunes.apple.com/lookup?' + urllib.parse.urlencode({'id': ','.join(ids), 'entity': 'podcast'})
    for i in range(3):
        try:
            _IT_LAST[0] = time.time(); bump('itunes')
            d = json.loads(urllib.request.urlopen(urllib.request.Request(url, headers={'User-Agent': 'SwapDesk-research/0.1'}), timeout=60).read())
            json.dump(d, open(f, 'w', encoding='utf8'))
            return d
        except Exception as e:
            print('itunes err', str(e)[:80]); time.sleep(20 * (i + 1))
    return {'results': []}


# ---------- RSS ----------
IT = '{http://www.itunes.com/dtds/podcast-1.0.dtd}'
MAX_BYTES = 25 * 1024 * 1024


def feed_path(itunes_id):
    return os.path.join(PRIV, 'feeds', str(itunes_id) + '.json')


def parse_date(s):
    try:
        return parsedate_to_datetime(s).date().isoformat()
    except Exception:
        return ''


def fetch_and_parse(itunes_id, url, name):
    """One GET per feed. Stores only parsed fields (title, date, first 300 chars of description), not raw XML."""
    f = feed_path(itunes_id)
    if os.path.exists(f):
        return json.load(open(f, encoding='utf8'))
    out = {'id': str(itunes_id), 'name': name, 'feedUrl': url, 'ok': False}
    try:
        bump('rss')
        r = urllib.request.urlopen(urllib.request.Request(url, headers={'User-Agent': 'SwapDesk-research/0.1 (one fetch per feed)'}), timeout=20)
        b = r.read(MAX_BYTES + 1)
        if len(b) > MAX_BYTES:
            out['err'] = 'too large'
        else:
            root = ET.fromstring(b)
            ch = root.find('channel')
            if ch is None:
                out['err'] = 'no channel'
            else:
                out['channel_desc'] = strip_html(ch.findtext('description') or ch.findtext(IT + 'summary') or '')[:2000]
                out['author'] = ch.findtext(IT + 'author') or ''
                items = []
                for it in ch.findall('item'):
                    items.append({'title': (it.findtext('title') or '').strip(), 'date': parse_date(it.findtext('pubDate')),
                                  'desc': strip_html(it.findtext('description') or it.findtext(IT + 'summary') or '')[:300]})
                items.sort(key=lambda e: (e['date'] != '', e['date']), reverse=True)  # dated newest first, undated last
                out['items'] = items
                out['ok'] = True
    except Exception as e:
        out['err'] = str(e)[:150]
    json.dump(out, open(f, 'w', encoding='utf8'), ensure_ascii=False)
    return out


def ep_text(e):
    return (e['title'] + ' ' + e['desc']).strip()


def pool_a(feed):
    return feed.get('items', [])[:40]


def pool_b(feed, cutoff):
    return [e for e in feed.get('items', []) if e['date'] and e['date'] < cutoff][:40]


def promo(pool):
    return [e for e in pool if PROMO_RE.search(e['title'])]


def ep_key(e):
    return hashlib.sha1((e['title'] + '|' + e['date'] + '|' + e['desc']).encode()).hexdigest()[:16]


def itunes_map(anchor_id):
    """entity id -> iTunes id, read from the cached raw Qloo Q response for this anchor."""
    d = json.load(open(os.path.join(WAVE6, 'qloo', 'Q_%s.json' % anchor_id), encoding='utf8'))
    out = {}
    for e in (d.get('body') or {}).get('results', {}).get('entities', []):
        ext = (e.get('external') or {}).get('itunes')
        if isinstance(ext, list): ext = ext[0] if ext else None
        if isinstance(ext, dict) and ext.get('id'):
            out[e['entity_id']] = str(ext['id'])
    return out


def _squash(t):
    t = (t or '').lower().replace('\u2018', "'").replace('\u2019', "'").replace('\u02bc', "'").replace('\u201c', '"').replace('\u201d', '"')
    t = t.replace('\u2013', '-').replace('\u2014', '-')
    return ' '.join(t.split())


def appears(needle, haystack):
    """Case- and whitespace-insensitive word-for-word check (same rule as src/util.js appearsVerbatim)."""
    n = _squash(needle)
    return len(n) >= 2 and n in _squash(haystack)
