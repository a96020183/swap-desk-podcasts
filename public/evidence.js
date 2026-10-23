const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const p1 = v => Number(v).toFixed(1) + '%';
const ci = c => `${c[0]} to ${c[1]}`;
const COLORS = { qloo: '#1f1d1a', llm: '#c4472c', genre: '#b3aa98', genreSize: '#d8d0bf' };

function dotPlot(t) {
  const W = 760, rowH = 54, top = 18, left = 92, right = 24, H = top + rowH * t.ks.length + 34;
  const max = 35, x = v => left + (W - left - right) * v / max;
  let s = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Share of real partners found in the top 5, 10 and 20, by method, with 95% intervals">`;
  for (let v = 0; v <= max; v += 5) {
    s += `<line x1="${x(v)}" x2="${x(v)}" y1="${top - 6}" y2="${H - 26}" stroke="#e2dccf"/>`;
    s += `<text x="${x(v)}" y="${H - 8}" text-anchor="middle">${v}%</text>`;
  }
  t.ks.forEach((k, i) => {
    const y = top + rowH * i + rowH / 2;
    s += `<text class="lab" x="0" y="${y + 4}">Top ${k}${k === t.lockedK ? '' : ' *'}</text>`;
    s += `<line x1="${left}" x2="${W - right}" y1="${y}" y2="${y}" stroke="#efe9dc"/>`;
    t.rows.slice().reverse().forEach(r => {
      if (r.ci) s += `<line x1="${x(r.ci[i][0])}" x2="${x(r.ci[i][1])}" y1="${y}" y2="${y}" stroke="${COLORS[r.id]}" stroke-width="2" stroke-linecap="round" opacity="0.45"/>`;
      s += `<circle cx="${x(r.v[i])}" cy="${y}" r="${r.id === 'qloo' ? 7 : 5.5}" fill="${COLORS[r.id]}" stroke="#fffdf8" stroke-width="1.5"/>`;
    });
  });
  return s + '</svg>';
}

function day1(d) {
  const A = d.testA, B = d.testB, E4 = d.openToSwaps;
  const blocks = [];
  if (A) {
    const a = A['pool (a) last 40 episodes'];
    const pass = a.PASS;
    blocks.push(`<div class="test"><h3>Test A: does reading feeds for swap habits move real partners up?<span class="verdict ${pass ? 'pass' : 'fail'}">${pass ? 'Passed' : 'Did not pass'}</span></h3>
      <p>Qloo's top 50 for each of the 48 shows, re-ordered when a candidate's recent episodes show swaps with other shows. Top 20: Qloo alone ${p1(a['Q@20'])}, with swap habits read by the LLM ${p1(a['QH_agent@20'])}, with a keyword rule ${p1(a['QH_rule@20'])}. Difference ${a['QH_agent - Q [CI]'][0]} points (${ci(a['QH_agent - Q [CI]'].slice(1))}); random re-ordering of the same number of shows reaches ${p1(a['placebo p95'])} at its 95th percentile.</p>
      <p>${pass ? 'Swap habits could move rows, but the desk keeps Qloo's order so the shortlist matches the list scored above.' : 'So swap habits are shown on each row as information and never change the order. We claim no lift.'}</p></div>`);
  } else blocks.push('<div class="test"><h3>Test A<span class="verdict wait">Running</span></h3></div>');
  if (B) {
    blocks.push(`<div class="test"><h3>Test B: when Qloo doesn't know a show, do seed shows help?<span class="verdict ${B.PASS ? 'pass' : 'fail'}">${B.PASS ? 'Passed' : 'Did not pass'}</span></h3>
      <p>${B.shows} shows Qloo doesn't have (${B.pairs} real partners). Three seed shows plus Qloo found ${p1(B['QF@20'])} in the top 20; gpt-4.1-mini alone found ${p1(B['L@20'])}. Difference ${B['QF - L @20 [CI]'][0]} points (${ci(B['QF - L @20 [CI]'].slice(1))}).</p>
      <p>${B.PASS ? '' : 'Both are close to zero for these shows. The fallback screen still works from your picks, but it shows no accuracy number.'}</p></div>`);
  }
  if (E4) {
    blocks.push(`<div class="test"><h3>"Says open to swaps" spot check</h3>
      <p>In ${E4.n} randomly drawn channel descriptions, ${E4.reviewer_explicit === 0 ? 'none' : E4.reviewer_explicit} said outright that the show is open to swaps (read by the builder, not an independent reviewer). Our check flagged ${E4.llm_flagged === 0 ? 'none either' : E4.llm_flagged}.${E4['tag on first screen'] ? '' : ' Too rare to headline, so a quote, when a show has one, appears only in its receipt.'}</p></div>`);
  }
  const X = d.extras;
  if (X) {
    const ok = X['E1 consistency'].filter(r => r.overlap_top20 >= 18).length;
    blocks.push(`<div class="test"><h3>Smaller checks</h3>
      <p>Re-asking Qloo for ${X['E1 consistency'].length} test shows returned the same top 20 in ${ok} of ${X['E1 consistency'].length} cases. Qloo's compare call returns the tags two podcasts share, so the first five use it for their Why line. Qloo's explainability field scores each input show, so when you search from picks, a row can say which pick it is closest to.</p>
      <p>Found after the test: about 3% of Qloo's iTunes links point at a differently named show. Test A joined feeds by that link as written. Swap Desk now checks the names before reading a feed.</p></div>`);
  }
  return blocks.join('');
}

async function main() {
  const e = await (await fetch('/api/evidence')).json();
  const k = e.kTable, w = e.webTable, f = e.facts, c = e.commits;
  const rowsK = k.rows.map(r => `<tr class="${r.id === 'qloo' ? 'q' : ''}"><td>${esc(r.label)}</td>${r.v.map((v, i) => `<td class="${k.ks[i] === k.lockedK ? 'lock' : ''}">${p1(v)}</td>`).join('')}</tr>`).join('');
  const rowsW = w.rows.map(r => `<tr><td>${esc(r.label)}</td>${(r.v || r.pair).map((v, i) => `<td class="${i === 2 ? 'lock' : ''}">${Array.isArray(v) ? `${v[0].toFixed(1)} / ${v[1].toFixed(1)}` : p1(v)}</td>`).join('')}</tr>`).join('');
  document.getElementById('body').innerHTML = `
    <div class="big">
      <div><b>${p1(k.rows[0].v[2])}</b><span>of real partners in Qloo's top 20</span></div>
      <div><b>${p1(k.rows[1].v[2])}</b><span>gpt-4.1-mini, no web search</span></div>
      <div><b>${p1(k.rows[2].v[2])}</b><span>most popular in genre</span></div>
    </div>
    <p class="note">Top 20 was fixed before we looked (commit <span class="mono">${c.locked}</span>). Qloo minus the LLM-only list: +${k.diffTop20.value} points, 95% interval ${ci(k.diffTop20.ci)}.</p>

    <h2>Every cutoff</h2>
    <p>One dot per method, lines show 95% intervals across shows.</p>
    <div class="plot">${dotPlot(k)}</div>
    <div class="legend">${k.rows.map(r => `<span><i style="background:${COLORS[r.id]}"></i>${esc(r.label)}</span>`).join('')}</div>
    <div class="tablewrap"><table class="k"><thead><tr><th></th><th>Top 5*</th><th>Top 10*</th><th>Top 20</th></tr></thead><tbody>${rowsK}</tbody></table></div>
    <p class="note">* Added after the locked test (commit <span class="mono">${c.addedCutoffs}</span>): same data and scoring, only the cutoff changes.</p>

    <h2>Against a top LLM with web search</h2>
    <p>We ran a top LLM with web search on the same 48 shows, in two halves. Qloo is ahead in the top 20, but the gap is too small to call, so we count it as a tie. Mixing the two lists did not beat Qloo alone.</p>
    <div class="tablewrap"><table class="k"><thead><tr><th>Web search check</th><th>Top 5</th><th>Top 10</th><th>Top 20</th></tr></thead><tbody>${rowsW}</tbody></table></div>
    <p class="note">Top 20, all 48: Qloo minus web search +${w.gapTop20.value} points (${ci(w.gapTop20.ci)}). The two halves were run separately; the second half was added later to test a mixed list (methods <span class="mono">${c.webMethod}</span>, <span class="mono">${c.mixMethod}</span>; results <span class="mono">${c.webResult}</span>, <span class="mono">${c.mixResult}</span>). Pooling the halves was not planned in advance.</p>

    <h2>How we built the test</h2>
    <ul class="facts">
      <li>48 shows, 185 real swap partners, taken from their own public feeds. We committed the test before fetching a single feed (commit <span class="mono">${c.locked}</span>).</li>
      <li>Shows with at least one real partner in the top 5: ${Math.round(f.hitTop5.qloo)}% with Qloo, ${Math.round(f.hitTop5.llm)}% with gpt-4.1-mini.</li>
      <li>Mid-size and small shows, top 20: ${p1(f.midSmall.qloo)} vs ${p1(f.midSmall.llm)}.</li>
      <li>We did not compare against Apple's lists (site terms) or Rephonic (paid).</li>
      <li>${f.itunesIds}% of Qloo's podcast results carry an iTunes ID, which is how every row links to its public feed.</li>
    </ul>

    <div class="cols">
      <div><h3>What Qloo adds</h3><ul>
        <li>In its top 20, Qloo found about <b>one in four</b> of the partners these shows really chose. An LLM-only list without web search found one in sixteen.</li>
        <li>Against that LLM-only list, it holds for mid-size and small shows (${p1(f.midSmall.qloo)} vs ${p1(f.midSmall.llm)}), for the smallest third (${p1(f.smallestThird.qloo)} vs ${p1(f.smallestThird.llm)}), and when the two shows have different owners (${p1(f.differentOwners.qloo)} vs ${p1(f.differentOwners.llm)}).</li>
        <li>One call returns a ranked list with iTunes IDs and popularity, so every row can be joined to its public feed.</li>
        <li>For a family history show, Qloo ranked NPE Stories and CutOff Genes second and third. The show really swapped with both.</li>
      </ul></div>
      <div><h3>What it doesn't</h3><ul>
        <li><b>Beat a top LLM with web search.</b> On the same 48 shows, gpt-5.5 with web search found 19.0% in its top 20 and Qloo 24.3%. That gap is too small to call. Mixing the two lists did not help.</li>
        <li><b>Get better from our feed reading.</b> Re-ordering Qloo's list by who trades promos did not find more real partners (Test A below), and seed shows did not help for shows Qloo doesn't know (Test B). So the shortlist stays in Qloo's order and our feed reading only adds labels and facts.</li>
        <li><b>Coverage.</b> Qloo knows ${f.coverage}% of the indie shows in our test that trade promos. When it doesn't know yours, we say so and ask for seed shows.</li>
        <li><b>Other tools.</b> Apple shows "Listeners Also Subscribe To" lists and Rephonic sells audience and cross-promo data. We did not compare against either.</li>
        <li><b>What feeds miss.</b> A feed only shows swaps that hosts wrote into episode titles or notes. A promo read out loud and never written down is invisible to us.</li>
        <li><b>Cause and effect.</b> Shows that already swapped may share more listeners because of the swap. Swaps since 2025 are harder to find: ${p1(f.since2025.qloo)} vs ${p1(f.since2025.llm)} in the top 20 (gap ${ci(f.since2025.ci)} points).</li>
        <li><b>Results.</b> We measured who hosts chose, not how well the swap worked.</li>
      </ul></div>
    </div>

    <h2>Day-one checks on the agent</h2>
    <p>Written down and committed before we fetched any candidate feed (commit <span class="mono">${c.day1Method}</span>). They decide what the AI layer may claim, nothing else.</p>
    ${day1(e.day1)}

    <h2>Method and files</h2>
    <ul class="facts">
      <li>Protocols, scripts and derived results: <span class="mono">research/validation/</span> and <span class="mono">research/day1/</span> in the repository.</li>
      <li>Answer key: shows found with the iTunes Search API by promo-swap words; partners extracted from each show's own feed by gpt-4.1-mini and kept only when the name appears in the episode text and resolves in the iTunes directory. Same publisher and spin-offs removed.</li>
      <li>Scoring: share of a show's real partners found in a method's list, averaged over shows; intervals from 10,000 resamples of shows.</li>
      <li>Known bias: the 48 shows were found because they write about swaps, so they are easier cases than a typical host.</li>
    </ul>`;
}
main().catch(() => { document.getElementById('body').innerHTML = '<p class="err">Could not load the numbers.</p>'; });
