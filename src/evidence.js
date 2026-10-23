// Numbers on the evidence page. Derived values only (no Qloo responses), copied from the result files in
// research/validation/ and research/day1/. Each block names the commit where its method was frozen.
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from './config.js';

const readJson = f => { try { return JSON.parse(fs.readFileSync(path.join(ROOT, f), 'utf8')); } catch { return null; } };

export const EVIDENCE = {
  sample: { shows: 48, partners: 185, source: 'each show\'s own public RSS feed' },
  commits: {
    locked: '81b319e', addedCutoffs: 'ba117e4', webMethod: 'cde749f', webResult: '7e89b98',
    mixMethod: '4d71e7b', mixResult: '60d418f', day1Method: '3f0d9a5',
  },
  // recall in the top k, percent; ci = 95% bootstrap interval over shows (10,000 resamples)
  kTable: {
    ks: [5, 10, 20], lockedK: 20,
    rows: [
      { id: 'qloo', label: 'Qloo taste match', v: [10.9, 19.1, 24.3], ci: [[6.0, 16.4], [12.3, 26.4], [16.6, 32.9]] },
      { id: 'llm', label: 'gpt-4.1-mini, no web search', v: [3.1, 3.8, 6.1], ci: [[0.3, 6.6], [1.0, 7.6], [2.2, 10.6]] },
      { id: 'genre', label: 'Most popular in genre', v: [1.6, 1.6, 3.7] },
      { id: 'genreSize', label: 'Popular in genre, same size', v: [1.6, 1.6, 3.0] },
    ],
    diffTop20: { value: 18.2, ci: [9.6, 27.3], vs: 'gpt-4.1-mini, no web search' },
  },
  webTable: {
    rows: [
      { label: 'Qloo, all 48 shows', v: [10.9, 19.1, 24.3] },
      { label: 'gpt-5.5 with web search, all 48 shows', v: [10.9, 15.8, 19.0] },
      { label: 'First half (24): Qloo / web', pair: [[9.4, 9.8], [12.8, 14.0], [17.7, 17.7]] },
      { label: 'Second half (24): Qloo / web', pair: [[12.3, 12.1], [25.4, 17.6], [31.0, 20.3]] },
    ],
    gapTop20: { value: 5.4, ci: [-2.7, 13.9] },
    mixedTop20: { value: 25.1, vsQloo: 0.7, ci: [-3.5, 4.9] },
  },
  facts: {
    hitTop5: { qloo: 31.2, llm: 8.3 },
    midSmall: { qloo: 23.0, llm: 6.2 },
    smallestThird: { qloo: 17.3, llm: 3.1 },
    differentOwners: { qloo: 23.4, llm: 5.5 },
    since2025: { qloo: 11.6, llm: 4.2, ci: [1.9, 14.3] },
    sameSizeOnly: 19.2,
    coverage: 55,
    itunesIds: 97.7,
    activeShows90d: 466249,
  },
  day1: {
    testA: readJson('research/day1/results_testA.json'),
    testB: readJson('research/day1/results_testB.json'),
    extras: readJson('research/day1/results_extras.json'),
    openToSwaps: readJson('research/day1/results_e4.json'),
  },
};
