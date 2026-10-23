import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from './config.js';

// Prompt texts shared with the research scripts (research/day1). Placeholders are replaced as plain text.
const prompts = JSON.parse(fs.readFileSync(path.join(ROOT, 'src', 'prompts.json'), 'utf8'));
export default prompts;

export function fill(template, values) {
  let out = template;
  for (const [k, v] of Object.entries(values)) out = out.split('{' + k + '}').join(String(v ?? ''));
  return out;
}
