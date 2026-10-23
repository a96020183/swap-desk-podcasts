# Wave 6c runner (PROTOCOL_testC.md). Copied call/parse code from web_llm.py, unchanged. Key read from file, never printed or written.
import json, os, re, sys, time, random, threading, urllib.request
from concurrent.futures import ThreadPoolExecutor
from common import DATA
sys.stdout.reconfigure(encoding='utf-8')

PRICES = {'gpt-5.5-2026-04-23': (5.00, 0.50, 30.00), 'gpt-5.4-2026-03-05': (2.50, 0.25, 15.00)}
PSEARCH = 0.01
CAP = 4.30  # no new call once spend >= 4.30 (PROTOCOL_testC.md section 3)
EFFORT = 'low'
PROMPT = ('You help independent podcasters plan promo swaps (two shows play each other\'s trailer or an episode in their feeds).\n'
          'Podcast: "{title}"\nPublisher: {artist}\nApple genre: {genre}\nDescription: {desc}\n'
          'Search the web as much as you need. Then list the 20 existing podcasts that would be the best promo-swap partners '
          'for this podcast, best partner first. Do not include shows from the same publisher. Use exact podcast titles.\n'
          'Return JSON only, in this form: {{"podcasts": ["title", ...]}}')
OUT = DATA + 'web_llm_C.json'
RAW = DATA + 'web_raw_C/'
os.makedirs(RAW, exist_ok=True)
LOCK = threading.Lock()

anchors = json.load(open(DATA + 'anchors.json', encoding='utf8'))
order = sorted(anchors)
random.Random(20261023).shuffle(order)
HELD = order[24:]

state = json.load(open(OUT, encoding='utf8')) if os.path.exists(OUT) else {'order': order, 'held': order[24:], 'calls': [], 'model': 'gpt-5.5-2026-04-23', 'runs': {}}


def key():
    return re.search(r'sk-[A-Za-z0-9_\-]+', open('C:/2026/1019aikey.txt', encoding='utf8').read()).group(0)


def total():
    return sum(c['usd'] for c in state['calls'])


def save():
    json.dump(state, open(OUT, 'w', encoding='utf8'), ensure_ascii=False, indent=1)


def parse_titles(text):
    objs = []
    for m in re.finditer(r'\{', text):
        depth = 0
        for j in range(m.start(), len(text)):
            if text[j] == '{': depth += 1
            elif text[j] == '}':
                depth -= 1
                if depth == 0:
                    try:
                        o = json.loads(text[m.start():j + 1])
                        if isinstance(o, dict) and isinstance(o.get('podcasts'), list): objs.append(o)
                    except Exception:
                        pass
                    break
    if objs:
        return [str(x).strip() for x in objs[-1]['podcasts'] if str(x).strip()][:20]
    out = []
    for line in text.splitlines():
        m = re.match(r'^\s*(?:\d+[.)]|[-*])\s*(.+)$', line)
        if m:
            t = re.sub(r'\[[^\]]*\]|\([^)]*https?://[^)]*\)|[*_`"]', '', m.group(1)).strip()
            if t: out.append(t)
    return out[:20]


def call(cid, model):
    a = anchors[cid]
    body = {'model': model, 'input': PROMPT.format(title=a['anchor'], artist=a['artist'] or 'unknown', genre=a['genre'] or 'unknown',
                                                   desc=a['channel_desc'] or ''),
            'tools': [{'type': 'web_search', 'search_context_size': 'low'}], 'tool_choice': 'auto', 'include': ['web_search_call.action.sources'],
            'reasoning': {'effort': EFFORT}, 'max_output_tokens': 20000, 'store': False}
    req = urllib.request.Request('https://api.openai.com/v1/responses', data=json.dumps(body).encode(),
                                 headers={'Authorization': 'Bearer ' + key(), 'Content-Type': 'application/json'})
    r, err = None, ''
    for i in range(3):
        try:
            r = json.loads(urllib.request.urlopen(req, timeout=600).read()); break
        except Exception as e:
            err = str(e)[:200]
            try: err += ' ' + e.read().decode()[:300]
            except Exception: pass
            print('err', cid, err[:200]); time.sleep(15 * (i + 1))
    rec = {'cid': cid, 'model': model, 'effort': EFFORT, 'titles': [], 'cited': [], 'consulted': [], 'queries': [], 'usd': 0.0, 'status': 'fail', 'err': err}
    if r is None:
        return rec
    json.dump(r, open(RAW + f'{cid}_{model}.json', 'w', encoding='utf8'), ensure_ascii=False)
    text, n_ws = '', 0
    for it in r.get('output', []):
        if it.get('type') == 'web_search_call':
            n_ws += 1
            act = it.get('action') or {}
            if act.get('query'): rec['queries'].append(act['query'])
            for q in act.get('queries') or []: rec['queries'].append(q)
            for s in act.get('sources') or []:
                if s.get('url'): rec['consulted'].append(s['url'])
            if act.get('url'): rec['consulted'].append(act['url'])
        elif it.get('type') == 'message':
            for c in it.get('content', []):
                if c.get('type') == 'output_text':
                    text += c.get('text', '')
                    for an in c.get('annotations', []) or []:
                        if an.get('type') == 'url_citation':
                            rec['cited'].append({'url': an.get('url'), 'title': an.get('title', '')})
    u = r.get('usage') or {}
    tin = u.get('input_tokens', 0); cached = (u.get('input_tokens_details') or {}).get('cached_tokens', 0)
    tout = u.get('output_tokens', 0)
    PIN, PCACHE, POUT = PRICES[model]
    rec.update({'usd': (tin - cached) * PIN / 1e6 + cached * PCACHE / 1e6 + tout * POUT / 1e6 + n_ws * PSEARCH,
                'tokens': [tin, cached, tout], 'n_web_search_calls': n_ws, 'status': r.get('status', ''),
                'incomplete': r.get('incomplete_details'), 'text': text, 'titles': parse_titles(text)})
    return rec


def run(ids, model, tag):
    def job(cid):
        with LOCK:
            if total() >= CAP:
                print('cap reached, skip', cid); return
        rec = call(cid, model)
        with LOCK:
            state['calls'].append({'cid': cid, 'model': model, 'usd': rec['usd'], 'stage': tag})
            state['runs'][f'{cid}|{model}'] = rec
            save()
            print(tag, cid, 'titles', len(rec['titles']), 'ws', rec.get('n_web_search_calls'), 'usd', round(rec['usd'], 3),
                  'total', round(total(), 3), flush=True)
    todo = [c for c in ids if f'{c}|{model}' not in state['runs']]
    with ThreadPoolExecutor(3) as ex:
        list(ex.map(job, todo))


if __name__ == '__main__':
    M = 'gpt-5.5-2026-04-23'
    run(HELD, M, 'C')
    done = [c for c in HELD if f'{c}|{M}' in state['runs']]
    state['test_set'] = done
    state['test_label'] = f'HELD24 ({len(done)} done)' + (' UNDERPOWERED' if len(done) < 20 else '')
    save()
    print(state['test_label'], 'spend usd', round(total(), 3))
