# E4: "Says open to swaps" sample check (PROTOCOL_day1.md section 3).
# Step 1 (this script, no args): draw 100 candidates, run the product pipeline, write .private/.../e4_sample.json for review.
# Step 2 (--score): read reviewer labels from .private/.../e4_review.json ({itunes_id: true/false}) and write results.
import glob, json, os, random, re, sys
from day1_lib import PRIV, REPO, PROMPTS, llm, fill, appears

PRE = re.compile(PROMPTS['openToSwapsPrefilter'], re.I)
feeds = {}
for f in glob.glob(os.path.join(PRIV, 'feeds', '*.json')):
    if os.path.basename(f).startswith('_'): continue
    d = json.load(open(f, encoding='utf8'))
    if d.get('ok'): feeds[d['id']] = d
ids = sorted(feeds, key=int)
sample = random.Random(7).sample(ids, min(100, len(ids)))
SAMPLE = os.path.join(PRIV, 'e4_sample.json')
REVIEW = os.path.join(PRIV, 'e4_review.json')

if '--score' not in sys.argv:
    out = []
    for i in sample:
        d = feeds[i]; desc = d.get('channel_desc') or ''
        quote = ''
        if PRE.search(desc):
            r = llm(fill(PROMPTS['openToSwaps'], title=d['name'], desc=desc), max_tokens=300)
            q = (r.get('quote') or '').strip()
            quote = q if q and appears(q, desc) else ''
        out.append({'id': i, 'name': d['name'], 'prefilter': bool(PRE.search(desc)), 'llm_quote': quote, 'desc': desc})
    json.dump(out, open(SAMPLE, 'w', encoding='utf8'), ensure_ascii=False, indent=1)
    print('sample', len(out), 'prefilter hits', sum(o['prefilter'] for o in out), 'llm quotes', sum(1 for o in out if o['llm_quote']))
else:
    smp = json.load(open(SAMPLE, encoding='utf8'))
    rev = json.load(open(REVIEW, encoding='utf8'))
    llm_pos = {o['id'] for o in smp if o['llm_quote']}
    rev_pos = {k for k, v in rev.items() if v}
    res = {'E4': 'open to swaps sample', 'n': len(smp), 'reviewer': 'build agent (not an independent human)',
           'reviewer_explicit': len(rev_pos), 'llm_flagged': len(llm_pos), 'both': len(llm_pos & rev_pos),
           'llm_only': len(llm_pos - rev_pos), 'reviewer_only': len(rev_pos - llm_pos),
           'agreement': round(sum(1 for o in smp if (o['id'] in llm_pos) == (o['id'] in rev_pos)) / len(smp), 3),
           'tag on first screen': len(rev_pos) >= 3}
    json.dump(res, open(os.path.join(REPO, 'research', 'day1', 'results_e4.json'), 'w', encoding='utf8'), indent=1)
    print(json.dumps(res, indent=1))
