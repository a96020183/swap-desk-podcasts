// OpenAI chat completions (gpt-4.1-mini by default). JSON output only. Spend is counted and capped.
import { cfg } from './config.js';
import { makeLimiter } from './limiter.js';
import { getCached, setCached, DAY } from './cache.js';
import { add, usage } from './usage.js';
import { sha1, sleep } from './util.js';

const limit = makeLimiter({ minGapMs: 50, concurrency: 6 });
const PRICE = { 'gpt-4.1-mini': [0.4, 1.6], 'gpt-4.1-nano': [0.1, 0.4], 'gpt-4.1': [2, 8] };

export class LlmError extends Error {}
export const llmAvailable = () => Boolean(cfg.openaiKey);

export async function llmJson(prompt, { maxTokens = 1500, temperature = 0, cacheTtl = 7 * DAY, model = cfg.openaiModel } = {}) {
  if (!cfg.openaiKey) throw new LlmError('OPENAI_API_KEY is not set');
  const key = sha1(model + '|' + temperature + '|' + prompt);
  if (cacheTtl > 0) { const hit = getCached('llm', key, cacheTtl); if (hit) return hit; }
  if (usage().openaiUsd >= cfg.openaiUsdCap) throw new LlmError('OpenAI spend cap reached for this server');
  const body = {
    model, temperature, max_tokens: maxTokens, response_format: { type: 'json_object' },
    messages: [{ role: 'system', content: 'Reply with JSON only.' }, { role: 'user', content: prompt }],
  };
  let res;
  for (let i = 0; i < 3; i++) {
    res = await limit(async () => {
      try {
        const r = await fetch('https://api.openai.com/v1/chat/completions', {
          method: 'POST', body: JSON.stringify(body), signal: AbortSignal.timeout(90000),
          headers: { Authorization: 'Bearer ' + cfg.openaiKey, 'Content-Type': 'application/json' },
        });
        return { status: r.status, json: await r.json().catch(() => null) };
      } catch (e) { return { status: 0, json: null }; }
    });
    if (res.status === 200) break;
    if (![0, 429, 500, 502, 503].includes(res.status)) break;
    await sleep(2000 * (i + 1));
  }
  if (res.status !== 200 || !res.json) throw new LlmError('OpenAI request failed (' + res.status + ')');
  const [pin, pout] = PRICE[model] || PRICE['gpt-4.1-mini'];
  const u = res.json.usage || {};
  add('openaiUsd', ((u.prompt_tokens || 0) * pin + (u.completion_tokens || 0) * pout) / 1e6);
  add('openaiCalls');
  let out = {};
  try { out = JSON.parse(res.json.choices[0].message.content); } catch { out = {}; }
  if (cacheTtl > 0) setCached('llm', key, out);
  return out;
}
