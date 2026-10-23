const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const pad = n => String(n).padStart(2, '0');
const DRAFT_LIMIT = 5;

const state = { mode: 'recorded', key: null, result: null, tab: 'desk', host: null, picks: [] };

function store(k, v) { try { if (v === undefined) return sessionStorage.getItem(k); sessionStorage.setItem(k, v); } catch { return null; } }
const draftsUsed = () => Number(store('drafts') || 0);

async function getJson(url, opts) {
  const r = await fetch(url, opts);
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || 'Something went wrong.');
  return j;
}
const post = (url, body) => getJson(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

/* mode */
document.querySelectorAll('.mode button').forEach(b => b.addEventListener('click', () => {
  state.mode = b.dataset.mode;
  document.querySelectorAll('.mode button').forEach(x => x.setAttribute('aria-pressed', String(x === b)));
}));

/* start screen */
async function loadPresets() {
  const { presets } = await getJson('/api/presets');
  $('#presets').innerHTML = presets.map(p => `
    <button class="preset" type="button" data-id="${esc(p.itunesId)}">
      <span class="k">${esc(p.label)}</span><span class="n">${esc(p.name)}</span><span class="d">${esc(p.note)}</span>
    </button>`).join('');
  $('#presets').querySelectorAll('button').forEach(b => b.addEventListener('click', () => start(b.dataset.id)));
}

$('#find').addEventListener('submit', async e => {
  e.preventDefault();
  const q = $('#q').value.trim();
  const list = $('#matches');
  list.hidden = false; list.innerHTML = '<li class="meta" style="padding:10px 4px">Searching the iTunes directory&hellip;</li>';
  try {
    const { shows } = await getJson('/api/search?q=' + encodeURIComponent(q));
    if (!shows.length) { list.innerHTML = '<li class="meta" style="padding:10px 4px">No show found. Try the exact name or paste the Apple Podcasts link.</li>'; return; }
    if (shows.length === 1 && /\d{6,}/.test(q)) return start(shows[0].itunesId);
    list.innerHTML = shows.map(s => `<li><button type="button" data-id="${esc(s.itunesId)}">
      <img src="${esc(s.artwork)}" alt="" width="40" height="40" loading="lazy"><span><span>${esc(s.name)}</span><br><span class="meta">${esc(s.artist)}${s.genre ? ' &middot; ' + esc(s.genre) : ''}</span></span></button></li>`).join('');
    list.querySelectorAll('button').forEach(b => b.addEventListener('click', () => start(b.dataset.id)));
  } catch (err) { list.innerHTML = `<li class="err">${esc(err.message)}</li>`; }
});

/* run */
async function start(itunesId, seeds = null) {
  $('#start').hidden = true; $('#run').hidden = false; $('#matches').hidden = true;
  $('#result').innerHTML = ''; $('#steps').innerHTML = ''; $('#steps').hidden = false;
  if (!seeds) $('#host').innerHTML = '<p class="sub">Finding your show&hellip;</p>';
  window.scrollTo({ top: 0 });
  try {
    const r = await post('/api/run', { itunesId, seeds, live: state.mode === 'live' });
    if (r.done) return show(r.result, r.key);
    poll(r.jobId);
  } catch (err) { $('#result').innerHTML = `<p class="err">${esc(err.message)}</p>`; }
}

async function poll(id) {
  try {
    const j = await getJson('/api/run/' + id);
    renderSteps(j.steps, j.state);
    if (j.state === 'running') return setTimeout(() => poll(id), 700);
    if (j.state === 'error') { $('#result').innerHTML = `<p class="err">${esc(j.error)}</p>`; return; }
    show(j.result, j.key);
  } catch (err) { $('#result').innerHTML = `<p class="err">${esc(err.message)}</p>`; }
}

function renderSteps(steps, st) {
  $('#steps').innerHTML = steps.map((s, i) => {
    const now = st === 'running' && i === steps.length - 1;
    const bar = s.total ? `<span class="bar"><i style="width:${Math.round(100 * s.done / s.total)}%"></i></span>` : '';
    return `<li class="${now ? 'now' : 'done'}">${esc(s.label)}${s.total ? ` <span style="font-family:var(--mono);font-size:13px">${s.done}/${s.total}</span>` : ''}${bar}</li>`;
  }).join('');
}

function hostBlock(h) {
  const f = h.feed;
  const facts = f ? [`${f.episodeCount} episodes`, f.cadence, f.firstYear ? `since ${f.firstYear}` : ''].filter(Boolean).join(' · ') : '';
  return `${h.artwork ? `<img src="${esc(h.artwork)}" alt="" width="64" height="64">` : ''}
    <div><h2>${esc(h.name)}<span class="badge ${h.inQloo ? 'in' : 'out'}">${h.inQloo ? 'Found in Qloo' : 'Not in Qloo'}</span></h2>
    <div class="sub">${esc(h.artist)}${facts ? ' &middot; ' + esc(facts) : ''}</div></div>
    <button class="ghost small again" type="button" id="again">Try another show</button>`;
}

function show(result, key) {
  state.result = result; state.key = key; state.host = result.host;
  $('#steps').hidden = true;
  $('#host').innerHTML = hostBlock(result.host);
  $('#again').addEventListener('click', () => { $('#run').hidden = true; $('#start').hidden = false; $('#q').focus(); });
  if (result.status === 'notInQloo') return renderFallback(result);
  renderResult();
}

/* fallback: Qloo doesn't have the show */
function renderFallback(r) {
  state.picks = [];
  $('#footline').innerHTML = 'Qloo knows about 55% of the indie shows in our test that trade promos. When it doesn’t know yours, results come from the shows you pick. <a href="/evidence">Evidence &rarr;</a>';
  const sugg = r.suggestions || [];
  $('#result').innerHTML = `<div class="fallback">
    <h3>Qloo doesn't have this show yet.</h3>
    <p>Pick 3 to 5 shows with a similar audience. We'll search from those.</p>
    <div class="picks" id="picks">${sugg.map((s, i) => `<button type="button" class="pick" data-i="${i}" aria-pressed="false" ${s.inQloo ? '' : 'disabled'}>${esc(s.name)} <small>${s.inQloo ? 'In Qloo' : 'Not in Qloo'}</small></button>`).join('')}</div>
    <form class="seedfind" id="seedfind"><input id="seedq" placeholder="Add a show you know" aria-label="Add a show"><button class="ghost small" type="submit">Look up</button></form>
    <div class="picks" id="seedres"></div>
    <button type="button" id="go" disabled>Search from these</button>
    <p class="based" style="font-size:13px;color:var(--ink-3)">Suggestions come from gpt-4.1-mini (no web search). Only shows Qloo knows can be picked.</p>
  </div>`;
  const all = sugg.map(s => ({ ...s }));
  const sync = () => {
    $('#go').disabled = state.picks.length < 1;
    $('#go').textContent = state.picks.length ? `Search from ${state.picks.length} show${state.picks.length > 1 ? 's' : ''}` : 'Search from these';
  };
  const toggle = (btn, s) => {
    const on = btn.getAttribute('aria-pressed') !== 'true';
    if (on && state.picks.length >= 5) return;
    btn.setAttribute('aria-pressed', String(on));
    state.picks = on ? [...state.picks, { qid: s.qid, name: s.name, popularity: s.popularity }] : state.picks.filter(p => p.qid !== s.qid);
    sync();
  };
  $('#picks').querySelectorAll('.pick').forEach(b => b.addEventListener('click', () => toggle(b, all[b.dataset.i])));
  $('#seedfind').addEventListener('submit', async e => {
    e.preventDefault();
    const q = $('#seedq').value.trim(); if (!q) return;
    $('#seedres').innerHTML = '<span class="based">Looking in Qloo&hellip;</span>';
    try {
      const { results } = await getJson('/api/seed-search?q=' + encodeURIComponent(q));
      if (!results.length) { $('#seedres').innerHTML = '<span class="based">Qloo has no show by that name.</span>'; return; }
      $('#seedres').innerHTML = results.map((s, i) => `<button type="button" class="pick" data-i="${i}" aria-pressed="${state.picks.some(p => p.qid === s.qid)}">${esc(s.name)} <small>In Qloo</small></button>`).join('');
      $('#seedres').querySelectorAll('.pick').forEach(b => b.addEventListener('click', () => toggle(b, results[b.dataset.i])));
    } catch (err) { $('#seedres').innerHTML = `<span class="err">${esc(err.message)}</span>`; }
  });
  $('#go').addEventListener('click', () => start(r.host.itunesId, state.picks));
}

/* result */
function chipHtml(chips, only) {
  const list = only ? chips.filter(c => only.includes(c.k)) : chips;
  return list.map(c => `<span class="chip ${esc(c.k)}">${esc(c.text)}</span>`).join('');
}

function receiptHtml(row) {
  const q = row.receipt.qloo, f = row.receipt.feed, c = row.receipt.call;
  const num = v => (v == null ? 'n/a' : Number(v).toFixed(3));
  const feed = f.error ? `<p>${esc(f.error)}</p>` : `<dl>
      <dt>Last episode</dt><dd>${esc(f.lastEpisode || 'n/a')}</dd>
      <dt>Episodes</dt><dd>${esc(f.episodeCount)}${f.cadence ? ', ' + esc(f.cadence) : ''}${f.firstYear ? ', since ' + esc(f.firstYear) : ''}</dd>
      <dt>Promo-looking episodes</dt><dd>${esc(f.promoChecked)} in the last 40</dd>
    </dl>
    ${f.swaps.length ? `<ul>${f.swaps.slice(0, 6).map(s => `<li>${esc(s.show)} <span style="color:var(--ink-3)">in &ldquo;${esc(s.episode)}&rdquo;, ${esc(s.date)}</span></li>`).join('')}</ul>` : '<p style="margin:8px 0 0;color:var(--ink-3)">No swaps with other shows found in its recent episodes.</p>'}
    ${f.openQuote ? `<p style="margin:8px 0 0">Channel description: &ldquo;${esc(f.openQuote)}&rdquo;</p>` : ''}`;
  return `<div class="receipt">
    <section><h4>Qloo says</h4><dl>
      <dt>Entity</dt><dd>${esc(q.name)}</dd>
      <dt>Rank</dt><dd>${q.seed ? 'Your pick' : '#' + esc(q.rank) + ' of 50'}</dd>
      <dt>Affinity</dt><dd>${num(q.affinity)}</dd>
      <dt>Popularity</dt><dd>${num(q.popularity)}${q.hostPopularity != null ? ` (${q.sizeBase === 'yours' ? 'yours' : 'median of your picks'} ${num(q.hostPopularity)})` : ''}</dd>
      <dt>Tags</dt><dd>${esc(q.tags.join(', ') || 'none')}</dd>
      ${q.compareTags ? `<dt>In common</dt><dd>${esc(q.compareTags.join(', '))} <span style="color:var(--ink-3)">(compare with ${esc(q.compareWith)})</span></dd>` : ''}
      ${q.explainScores ? `<dt>Explainability</dt><dd>${q.explainScores.map(x => esc(x.name) + ' ' + (x.score == null ? 'n/a' : Number(x.score).toFixed(2))).join('<br>')}</dd>` : ''}
    </dl>
    <details class="raw"><summary>Raw request</summary><p class="params">GET /v2/insights<br>${Object.entries(q.params || {}).map(([k, v]) => esc(k + '=' + v)).join('<br>')}<br>entity: ${esc(q.entityId)}</p></details></section>
    <section><h4>Their feed says</h4>${feed}</section>
    <section><h4>Our call</h4><dl>
      <dt>Position</dt><dd>${c.position ? '#' + c.position + (c.column === 'firstFive' ? ', Qloo’s top five' : '') : 'Below the top 20'}, in Qloo's order</dd>
    </dl>${c.reasons.length ? `<p style="margin:8px 0 0">Labels we added:</p><ul>${c.reasons.map(r => `<li>${esc(r)}</li>`).join('')}</ul>` : '<p style="margin:8px 0 0">No labels added.</p>'}
    <p class="ours">This part is Swap Desk's reading, not Qloo's.</p></section>
  </div>`;
}

const isQuiet = row => row.chips.some(c => c.k === 'quiet');
const isUnmatched = row => row.chips.some(c => c.text === 'Feed not matched');
const reachable = row => !isQuiet(row) && !isUnmatched(row) && Boolean(row.contact || row.website);
const swappedBefore = row => row.chips.some(c => c.k === 'you');

function firstFiveRow(row) {
  const why = !reachable(row) ? (isUnmatched(row) ? 'No feed matched' : isQuiet(row) ? 'Quiet feed' : 'No contact in feed') : '';
  return `<div class="row${row.key === state.startKey ? ' start' : ''}" data-key="${esc(row.key)}">
    <div class="num">${pad(row.position)}</div>
    ${row.artwork ? `<img class="art" src="${esc(row.artwork)}" alt="" loading="lazy">` : '<div class="art"></div>'}
    <div>
      ${row.key === state.startKey ? '<div class="startmark">Start here · first active show with a contact you haven’t swapped with</div>' : ''}
      <div class="name">${esc(row.name)}</div><div class="by">${esc(row.artist)}</div>
      <div class="chips">${chipHtml(row.chips, ['taste', 'reach', 'much', 'quiet', 'same', 'feed', 'swaps', 'you', 'open'])}</div>
      ${row.why.length ? `<ul class="why">${row.why.map(w => `<li data-src="${w.src === 'qloo' ? 'Qloo' : 'Feed'}">${esc(w.text)}</li>`).join('')}</ul>` : ''}
    </div>
    <div class="acts">
      <button class="small${why ? ' ghost' : ''}" type="button" data-draft="${esc(row.key)}">Draft invite</button>
      ${why ? `<span class="contact warn">${why}</span>` : ''}
      <span class="contact">${row.contact ? 'Email in feed' : row.website ? `<a href="${esc(row.website)}" target="_blank" rel="noopener">Website</a>` : 'No public contact'}</span>
      <button class="link" type="button" data-receipt="${esc(row.key)}">Receipt</button>
    </div>
  </div>`;
}

function restRow(row) {
  const order = ['quiet', 'much', 'same', 'you', 'swaps', 'reach'];
  const two = row.chips.filter(c => order.includes(c.k)).sort((a, b) => order.indexOf(a.k) - order.indexOf(b.k)).slice(0, 2);
  const taste = row.chips.find(c => c.k === 'taste');
  return `<div class="line" data-key="${esc(row.key)}">
    <div class="num">${pad(row.position)}</div>
    <div><div class="name">${row.key === state.startKey ? '<span class="startdot">Start here</span> ' : ''}${esc(row.name)}</div><div class="tagline">${esc(row.tagLine || '')}</div></div>
    <div class="chips">${chipHtml([taste, ...two].filter(Boolean))}</div>
    <button class="link" type="button" data-receipt="${esc(row.key)}">Receipt</button>
  </div>`;
}

// Shows Qloo ranked that you already swapped with, as found in the feeds. Rank and month only, nothing more.
function pastNote(r) {
  if (r.seeds?.length) return '';
  const past = r.shortlist.filter(swappedBefore).map(x => ({ name: x.name, pos: x.position, when: (x.chips.find(c => c.k === 'you')?.text || '').replace('Swapped with you in ', '') }));
  if (!past.length) return '';
  const list = past.map(p => `<b>${esc(p.name)}</b> #${p.pos} (you swapped in ${esc(p.when)})`).join(past.length === 2 ? ' and ' : ', ');
  return `<p class="pastnote">Already your partners: Qloo ranks ${list}. Found in the feeds, so Start here skips ${past.length === 1 ? 'it' : 'them'}.</p>`;
}

function renderResult() {
  const r = state.result;
  state.startKey = (r.shortlist.find(x => reachable(x) && !swappedBefore(x)) || {}).key || null;
  const readyFive = r.shortlist.slice(0, 5).filter(reachable).length;
  const shown = state.onlyReachable ? r.shortlist.filter(reachable) : r.shortlist;
  const five = shown.filter(x => x.position <= 5), rest = shown.filter(x => x.position > 5);
  $('#footline').innerHTML = r.seeds?.length
    ? 'Qloo doesn’t know this show, so the list starts from your picks. In our test this path rarely found real partners. Treat it as a starting list. <a href="/evidence">Evidence &rarr;</a>'
    : 'In our test of 48 shows, Qloo’s top 20 held 24.3% of the partners hosts really chose. <a href="/evidence">Evidence &rarr;</a>';
  const desk = `
    ${r.seeds?.length ? `<p class="based">Based on your picks: ${esc(r.seeds.join(', '))}. Qloo has not seen your show.</p>` : ''}
    ${pastNote(r)}
    <label class="only"><input type="checkbox" id="only" ${state.onlyReachable ? 'checked' : ''}> Hide quiet shows and shows with no contact <span>(hides rows, never reorders)</span></label>
    <div class="five"><div class="five-head"><h3>${r.seeds?.length ? 'Starting points from your picks' : 'Qloo’s top five'}</h3><span>${r.seeds?.length ? 'Not validated: in our test this path rarely found real partners' : 'Top 20 of Qloo’s matches, in Qloo’s order'} &middot; ready to contact now: ${readyFive} of ${Math.min(5, r.shortlist.length)}</span></div>
      ${five.map(firstFiveRow).join('') || '<p class="based">None of Qloo’s top five pass the filter.</p>'}</div>
    ${rest.length ? `<div class="rest"><h3>Next on the list</h3>${rest.map(restRow).join('')}</div>` : ''}
    <div class="sides">
      <div class="side"><h3>Big name, different crowd</h3><p class="hint">Famous in your genre but not among Qloo's 50 closest to you. Shown so you can see why they're not on your list.</p>
        <ul>${r.bigNames.map(b => `<li>${esc(b.name)}</li>`).join('') || '<li>None</li>'}</ul></div>
      <div class="side"><h3>Reading the labels</h3><p class="hint">Labels never change the order. They help you decide.</p>
        <ul>
          <li>Smaller / Bigger reach<span>beyond that range, either way</span></li>
          <li>Similar reach<span>Qloo popularity from 0.05 below to 0.02 above ${r.seeds?.length ? 'your picks (median)' : 'yours'}</span></li>
          <li>Much bigger reach<span>0.05 or more above yours</span></li>
          <li>Quiet for 4+ months<span>no new episode in their feed</span></li>
          <li>Swapped with N shows<span>promo episodes in their feed</span></li>
          <li>Swapped with you<span>found in your feed or theirs, any year</span></li>
        </ul></div>
    </div>
    <p class="usage">${r.usage.qloo + r.usage.feeds ? `This run: ${r.usage.qloo} Qloo calls, ${r.usage.feeds} feeds read, ${r.usage.llmCalls} LLM calls, ${r.seconds} s.` : 'This run reused data fetched in the last 24 hours.'} Run at ${esc(new Date(r.ranAt).toUTCString().slice(5, 22))} UTC${state.mode === 'recorded' ? ' (recorded mode; switch to Live to refetch)' : ''}.</p>`;
  const llm = `<p class="llm-note">What gpt-4.1-mini suggests with no web search and no Qloo, from the same show name, publisher, genre and description. Titles as the model wrote them; we did not check that they exist. In our test a top LLM with web search came close to Qloo; the gap was too small to call (<a href="/evidence">evidence</a>).</p>
    <ol class="llm-list">${r.llmOnly.map(x => `<li>${esc(x.name)}</li>`).join('')}</ol>`;
  $('#result').innerHTML = `
    <div class="tabs" role="tablist">
      <button role="tab" type="button" data-tab="desk" aria-selected="${state.tab === 'desk'}">Swap Desk shortlist</button>
      <button role="tab" type="button" data-tab="llm" aria-selected="${state.tab === 'llm'}">LLM only <span class="t-sub">gpt-4.1-mini, no web search</span></button>
    </div>
    <div id="pane">${state.tab === 'desk' ? desk : llm}</div>`;
  $('#only')?.addEventListener('change', e => { state.onlyReachable = e.target.checked; renderResult(); });
  $('#result').querySelectorAll('[data-tab]').forEach(b => b.addEventListener('click', () => { state.tab = b.dataset.tab; renderResult(); }));
  $('#result').querySelectorAll('[data-receipt]').forEach(b => b.addEventListener('click', () => toggleReceipt(b)));
  $('#result').querySelectorAll('[data-draft]').forEach(b => b.addEventListener('click', () => openDraft(b.dataset.draft)));
}

function findRow(key) {
  const r = state.result;
  return [...r.shortlist, ...r.more].find(x => x.key === key);
}

function toggleReceipt(btn) {
  const host = btn.closest('[data-key]');
  const open = host.querySelector('.receipt');
  if (open) { open.remove(); btn.textContent = 'Receipt'; return; }
  host.insertAdjacentHTML('beforeend', receiptHtml(findRow(host.dataset.key)));
  btn.textContent = 'Hide receipt';
}

/* drafts: a person reads, edits and sends from their own mail app */
const dlg = $('#draft');
async function openDraft(key) {
  const row = findRow(key);
  const left = DRAFT_LIMIT - draftsUsed();
  $('#draft-title').textContent = `Invite to ${row.name}`;
  $('#draft-ok').checked = false; $('#draft-prepare').disabled = true; $('#draft-ready').hidden = true;
  $('#draft-left').textContent = left > 0 ? `${left} of ${DRAFT_LIMIT} drafts left this session` : '';
  $('#draft-to').innerHTML = row.contact ? `To: ${esc(row.contact)} (from their feed)`
    : row.website ? `No email in their feed. Their website: <a href="${esc(row.website)}" target="_blank" rel="noopener">${esc(row.website.replace(/^https?:\/\//, '').slice(0, 60))}</a>. Copy the text and use the contact there.`
    : 'No email or website in their feed. Copy the text and reach them where they list a contact.';
  if (left <= 0) {
    $('#draft-subject').value = ''; $('#draft-body').value = '';
    $('#draft-note').textContent = `You've made ${DRAFT_LIMIT} drafts this session. Send those first.`;
    dlg.showModal(); return;
  }
  $('#draft-subject').value = ''; $('#draft-body').value = 'Writing a draft from the facts on this row…';
  $('#draft-note').textContent = '';
  const quiet = row.chips.find(c => c.k === 'quiet');
  if (quiet) $('#draft-to').innerHTML += `<br><b>${esc(quiet.text)}.</b> They may not reply.`;
  dlg.showModal();
  try {
    const d = await post('/api/draft', { key: state.key, row: key });
    store('drafts', String(draftsUsed() + 1));
    $('#draft-subject').value = d.subject; $('#draft-body').value = d.body;
    $('#draft-left').textContent = `${DRAFT_LIMIT - draftsUsed()} of ${DRAFT_LIMIT} drafts left this session`;
    $('#draft-note').textContent = d.source === 'llm'
      ? 'Drafted by gpt-4.1-mini from this row\'s facts only. Every show and episode name was checked against the receipt.'
      : 'Fixed template' + (d.fallbackReason ? ` (the AI draft failed our fact check: ${d.fallbackReason})` : '') + '.';
    dlg.dataset.to = d.to || ''; syncPrepare();
  } catch (err) { $('#draft-body').value = ''; $('#draft-note').textContent = err.message; }
}
const PLACEHOLDER = /\[(downloads per episode|link to your show|Your name)\]/;
const syncPrepare = () => {
  const text = $('#draft-subject').value + ' ' + $('#draft-body').value;
  const hole = text.match(PLACEHOLDER);
  $('#draft-prepare').disabled = !$('#draft-ok').checked || !$('#draft-body').value.trim() || Boolean(hole);
  $('#draft-left').textContent = hole ? `Fill in [${hole[1]}] first` : `${DRAFT_LIMIT - draftsUsed()} of ${DRAFT_LIMIT} drafts left this session`;
};
$('#draft-ok').addEventListener('change', syncPrepare);
$('#draft-body').addEventListener('input', syncPrepare);
$('#draft-subject').addEventListener('input', syncPrepare);
$('#draft-prepare').addEventListener('click', () => {
  const s = $('#draft-subject').value, b = $('#draft-body').value;
  $('#draft-mail').href = `mailto:${encodeURIComponent(dlg.dataset.to || '')}?subject=${encodeURIComponent(s)}&body=${encodeURIComponent(b)}`;
  $('#draft-ready').hidden = false;
});
$('#draft-copy').addEventListener('click', async () => {
  try { await navigator.clipboard.writeText($('#draft-subject').value + '\n\n' + $('#draft-body').value); $('#draft-copy').textContent = 'Copied'; } catch { $('#draft-copy').textContent = 'Select and copy'; }
  setTimeout(() => { $('#draft-copy').textContent = 'Copy text'; }, 1500);
});

loadPresets();
const params = new URLSearchParams(location.search);
if (params.get('show')) start(params.get('show'));
