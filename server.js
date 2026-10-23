// Swap Desk server: static pages + a small JSON API. No user accounts; nothing about visitors is stored.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { cfg, ROOT, RULES } from './src/config.js';
import { searchShows, lookupShows } from './src/itunes.js';
import * as qloo from './src/qloo.js';
import { runShortlist } from './src/pipeline.js';
import { draftInvite } from './src/invite.js';
import { getCached, setCached } from './src/cache.js';
import { parseItunesId } from './src/util.js';
import { PRESETS } from './src/presets.js';
import { EVIDENCE } from './src/evidence.js';

const PUB = path.join(ROOT, 'public');
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.json': 'application/json' };
const jobs = new Map();       // jobId -> { state, steps, result, error, key }
const runs = new Map();       // runKey -> result (with private draft material)
const draftCount = new Map(); // `${day}|${hostId}` -> count

const send = (res, code, obj) => { res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(obj)); };
const readBody = req => new Promise((resolve) => {
  let b = ''; req.on('data', c => { b += c; if (b.length > 20000) req.destroy(); });
  req.on('end', () => { try { resolve(JSON.parse(b || '{}')); } catch { resolve({}); } });
});

// What the browser sees: no draft material.
function publicResult(r) {
  if (!r || r.status !== 'ok') return r;
  const strip = rows => rows.map(({ _draft, ...rest }) => rest);
  return { ...r, shortlist: strip(r.shortlist), more: strip(r.more) };
}

const runKey = (itunesId, seeds) => `${itunesId}|${(seeds || []).map(s => s.qid).sort().join(',')}`;

function startRun({ itunesId, seeds, live }) {
  const key = runKey(itunesId, seeds);
  if (!live) {
    const rec = runs.get(key) || getCached('runs', key);
    if (rec) { runs.set(key, rec); return { done: true, key, result: publicResult(rec), recorded: true }; }
  }
  for (const [id, j] of jobs) if (j.key === key && j.state === 'running') return { jobId: id };
  const id = crypto.randomUUID();
  const job = { key, state: 'running', steps: [], started: Date.now() };
  jobs.set(id, job);
  const step = (k, label, extra = {}) => {
    const last = job.steps[job.steps.length - 1];
    if (last && last.k === k) Object.assign(last, { label, ...extra }); else job.steps.push({ k, label, ...extra });
  };
  runShortlist({ itunesId, seeds, fresh: Boolean(live), step }).then(r => {
    r.seconds = Math.round((Date.now() - job.started) / 100) / 10;
    runs.set(key, r); setCached('runs', key, r);
    job.state = 'done'; job.result = publicResult(r);
  }).catch(e => { job.state = 'error'; job.error = String(e.message || e); });
  setTimeout(() => jobs.delete(id), 30 * 60 * 1000).unref();
  return { jobId: id };
}

async function api(req, res, url) {
  const p = url.pathname;
  if (p === '/api/search' && req.method === 'GET') {
    const q = (url.searchParams.get('q') || '').trim();
    if (!q) return send(res, 400, { error: 'Type a show name or paste an Apple Podcasts link.' });
    const id = parseItunesId(q);
    const shows = id ? [...(await lookupShows([id])).values()] : await searchShows(q, 6);
    return send(res, 200, { shows: shows.map(s => ({ itunesId: s.itunesId, name: s.name, artist: s.artist, artwork: s.artwork, genre: s.genre })) });
  }
  if (p === '/api/run' && req.method === 'POST') {
    const b = await readBody(req);
    const itunesId = parseItunesId(String(b.itunesId || ''));
    if (!itunesId) return send(res, 400, { error: 'Missing show id.' });
    const seeds = Array.isArray(b.seeds) ? b.seeds.filter(s => s && s.qid && s.name).slice(0, 5).map(s => ({ qid: String(s.qid), name: String(s.name).slice(0, 200), tags: [], popularity: Number.isFinite(Number(s.popularity)) ? Math.min(1, Math.max(0, Number(s.popularity))) : null })) : null;
    if (seeds && seeds.length < 1) return send(res, 400, { error: 'Pick at least one show.' });
    return send(res, 200, startRun({ itunesId, seeds, live: Boolean(b.live) }));
  }
  if (p.startsWith('/api/run/') && req.method === 'GET') {
    const j = jobs.get(p.slice('/api/run/'.length));
    if (!j) return send(res, 404, { error: 'This run expired. Start again.' });
    return send(res, 200, { state: j.state, steps: j.steps, result: j.result || null, error: j.error || null, key: j.key });
  }
  if (p === '/api/seed-search' && req.method === 'GET') {
    const q = (url.searchParams.get('q') || '').trim();
    if (q.length < 2) return send(res, 200, { results: [] });
    const r = await qloo.findPodcast(q);
    return send(res, 200, { results: r.results.slice(0, 5).map(e => ({ qid: e.qid, name: e.name, popularity: e.popularity })) });
  }
  if (p === '/api/draft' && req.method === 'POST') {
    const b = await readBody(req);
    const r = runs.get(String(b.key || '')) || getCached('runs', String(b.key || ''));
    if (!r || r.status !== 'ok') return send(res, 404, { error: 'Run not found. Start again.' });
    const all = [...r.shortlist, ...r.more];
    const row = all.find(x => x.key === String(b.row || ''));
    if (!row) return send(res, 404, { error: 'Show not found in this run.' });
    const day = new Date().toISOString().slice(0, 10);
    const ck = `${day}|${r.host.itunesId}`;
    const n = draftCount.get(ck) || 0;
    if (n >= RULES.draftsPerShowPerDay) return send(res, 429, { error: `Daily limit reached: ${RULES.draftsPerShowPerDay} drafts per show per day.` });
    draftCount.set(ck, n + 1);
    const d = await draftInvite(row._draft.host, row._draft.cand, { note: b.note || '' });
    return send(res, 200, { subject: d.subject, body: d.body, source: d.source, fallbackReason: d.fallbackReason || null, to: row.contact || '' });
  }
  if (p === '/api/presets') return send(res, 200, { presets: PRESETS });
  if (p === '/api/evidence') return send(res, 200, EVIDENCE);
  return send(res, 404, { error: 'Not found' });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  try {
    if (url.pathname === '/healthz') return send(res, 200, { ok: true });
    if (url.pathname.startsWith('/api/')) return await api(req, res, url);
    let file = url.pathname === '/' ? 'index.html' : url.pathname === '/evidence' ? 'evidence.html' : url.pathname.slice(1);
    const full = path.normalize(path.join(PUB, file));
    if (!full.startsWith(PUB) || !fs.existsSync(full) || fs.statSync(full).isDirectory()) { res.writeHead(404); return res.end('Not found'); }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(full)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    fs.createReadStream(full).pipe(res);
  } catch (e) {
    send(res, 500, { error: String(e.message || e) });
  }
});

server.listen(cfg.port, () => {
  console.log(`Swap Desk on http://localhost:${cfg.port}  (Qloo key ${cfg.qlooKey ? 'set' : 'missing'}, OpenAI key ${cfg.openaiKey ? 'set' : 'missing'})`);
  if (cfg.warmPresets) warm();
});

// Prepare the judge examples in the background so the first visit is instant.
async function warm() {
  for (const p of PRESETS) {
    if (!p.itunesId || p.kind === 'notInQloo') continue;
    const r = startRun({ itunesId: p.itunesId, seeds: null, live: false });
    if (r.jobId) await new Promise(ok => { const t = setInterval(() => { const j = jobs.get(r.jobId); if (!j || j.state !== 'running') { clearInterval(t); ok(); } }, 2000); });
  }
}
