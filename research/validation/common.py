# shared helpers. Keys are read from files and never printed or written.
import json, os, re, time, unicodedata, urllib.request, urllib.parse, html

W = 'C:/Users/678/AppData/Local/Temp/claude/c--2026---/135e2cdd-7648-492d-981b-527d5792a8c5/scratchpad/qloo2/wave6/'
DATA = W + 'data/'
os.makedirs(DATA, exist_ok=True)

STOP = {'the', 'a', 'an', 'podcast', 'pod', 'show', 'official'}


def normalize(s):
    s = unicodedata.normalize('NFKD', s or '')
    s = ''.join(c for c in s if not unicodedata.combining(c)).lower().replace('&', ' and ')
    s = re.sub(r'[^a-z0-9]+', ' ', s)
    return ' '.join(t for t in s.split() if t not in STOP)


def base(s):
    s = s or ''
    cut = len(s)
    for sep in [':', ' - ', ' | ', ' (', ' – ', ' — ']:
        i = s.find(sep)
        if i > 0: cut = min(cut, i)
    return normalize(s[:cut])


def same(a, b):
    na, nb = normalize(a), normalize(b)
    if na and na == nb: return True
    ba, bb = base(a), base(b)
    return len(ba) >= 4 and ba == bb


def strip_html(s):
    s = re.sub(r'<[^>]+>', ' ', s or '')
    return re.sub(r'\s+', ' ', html.unescape(s)).strip()


# ---------- iTunes Search API (official), <= 18 calls/min ----------
_IT_LAST = [0.0]
IT_CACHE = DATA + 'itunes_cache/'
os.makedirs(IT_CACHE, exist_ok=True)


def itunes(params):
    raw = urllib.parse.urlencode(sorted(params.items()))
    key = re.sub(r'[^\w.-]+', '_', raw)[:60] + '_' + __import__('hashlib').md5(raw.encode()).hexdigest()[:10]
    f = IT_CACHE + key + '.json'
    if os.path.exists(f):
        return json.load(open(f, encoding='utf8'))
    wait = 3.4 - (time.time() - _IT_LAST[0])
    if wait > 0: time.sleep(wait)
    url = 'https://itunes.apple.com/search?' + urllib.parse.urlencode(params)
    for i in range(3):
        try:
            _IT_LAST[0] = time.time()
            r = urllib.request.urlopen(urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'}), timeout=30)
            d = json.loads(r.read())
        except Exception as e:
            print('itunes err', e); time.sleep(20 * (i + 1)); continue
        json.dump(d, open(f, 'w', encoding='utf8'))
        return d
    return {'results': []}


# ---------- OpenAI gpt-4.1-mini ----------
KEY = None
MODEL = 'gpt-4.1-mini'; PIN, POUT = 0.4, 1.6; CAP = 0.95
USAGE = DATA + '_llm_usage.json'


def _key():
    global KEY
    if KEY is None:
        KEY = re.search(r'sk-[A-Za-z0-9_\-]+', open('C:/2026/1019aikey.txt', encoding='utf8').read()).group(0)
    return KEY


def usage():
    return json.load(open(USAGE)) if os.path.exists(USAGE) else {'usd': 0, 'calls': 0}


def llm(prompt, max_tokens=2000):
    u = usage()
    if u['usd'] > CAP: raise SystemExit('LLM cap reached')
    body = {'model': MODEL, 'temperature': 0, 'max_tokens': max_tokens, 'response_format': {'type': 'json_object'},
            'messages': [{'role': 'system', 'content': 'Reply with JSON only.'}, {'role': 'user', 'content': prompt}]}
    req = urllib.request.Request('https://api.openai.com/v1/chat/completions', data=json.dumps(body).encode(),
                                 headers={'Authorization': 'Bearer ' + _key(), 'Content-Type': 'application/json'})
    for i in range(3):
        try:
            r = json.loads(urllib.request.urlopen(req, timeout=120).read()); break
        except Exception as e:
            print('llm err', str(e)[:100]); time.sleep(10 * (i + 1))
    else:
        return {}
    tin, tout = r['usage']['prompt_tokens'], r['usage']['completion_tokens']
    u['usd'] += tin * PIN / 1e6 + tout * POUT / 1e6; u['calls'] += 1
    json.dump(u, open(USAGE, 'w'), indent=1)
    try:
        return json.loads(r['choices'][0]['message']['content'])
    except Exception:
        return {}
