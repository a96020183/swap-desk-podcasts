# Step 4: LLM-only baseline. One call per eligible anchor, no candidate list.
import json, os
from common import DATA, llm, usage

PROMPT = ('You help independent podcasters plan promo swaps (two shows play each other\'s trailer or episode).\n'
          'Podcast: "{title}"\nPublisher: {artist}\nApple genre: {genre}\nDescription: {desc}\n'
          'List 20 other existing podcasts, not from the same publisher, whose listeners would most likely also enjoy this podcast, '
          'best partner first. Use exact podcast titles.\n'
          'Return JSON only: {{"podcasts": ["title", ...]}}')

anchors = json.load(open(DATA + 'anchors.json', encoding='utf8'))
outf = DATA + 'llm_lists.json'
out = json.load(open(outf, encoding='utf8')) if os.path.exists(outf) else {}
for cid, a in anchors.items():
    if cid in out: continue
    r = llm(PROMPT.format(title=a['anchor'], artist=a['artist'] or 'unknown', genre=a['genre'] or 'unknown', desc=a['channel_desc'] or ''), max_tokens=800)
    out[cid] = [str(x) for x in r.get('podcasts', [])][:20]
    json.dump(out, open(outf, 'w', encoding='utf8'), ensure_ascii=False, indent=1)
print('llm lists', len(out), 'usd', round(usage()['usd'], 4))
