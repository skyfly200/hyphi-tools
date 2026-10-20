// Hosted slicing server: a small authenticated HTTP job API over the slicer.
//   POST   /v1/jobs            body: JSON { stl: base64, profile, engine, nozzles }  or raw STL with X-Slice-Options (JSON)
//   GET    /v1/jobs/:id        status, progress, summary
//   GET    /v1/jobs/:id/gcode  the G-code (when done)
//   DELETE /v1/jobs/:id        cancel / discard
//   GET    /v1/profiles, GET /health
// Jobs run in worker threads (built-in slicer) or as a child process (PrusaSlicer / OrcaSlicer CLI, if configured).
// Node only, no dependencies. Put TLS in front of it (reverse proxy / platform ingress).

import http from 'node:http';
import { Worker } from 'node:worker_threads';
import { randomBytes, createHash, timingSafeEqual } from 'node:crypto';
import { resolveProfile, validateProfile } from '../profile.js';
import { runExternalSlicer } from './external.js';

const sha = s => createHash('sha256').update(s).digest();
const HDR = { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' };

export function createSlicingServer(opts = {}) {
  const o = { apiKeys: [], allowAnonymous: false, maxBodyBytes: 64 * 1024 * 1024, concurrency: 2, maxQueuePerClient: 5, jobTtlMs: 60 * 60 * 1000, jobTimeoutMs: 5 * 60 * 1000,
    maxTriangles: 2_000_000, maxLayers: 4000, corsOrigins: [], prusaPath: null, orca: null, profiles: [], ...opts };
  // external engines: { prusa: { path, wrapper? }, orca: { path, wrapper?, bases? } }
  o.external = { ...(o.prusaPath ? { prusa: { path: o.prusaPath } } : {}), ...(o.orca?.path ? { orca: o.orca } : {}), ...(opts.external || {}) };
  if (!o.allowAnonymous && !o.apiKeys.length) throw new Error('refusing to start without API keys (set apiKeys, or allowAnonymous for local development)');
  const keyHashes = o.apiKeys.map(sha), jobs = new Map(), queue = [];
  let running = 0;
  const engines = ['builtin', ...Object.keys(o.external)];

  const clientOf = req => {
    const m = /^Bearer\s+(.+)$/i.exec(req.headers.authorization || ''); if (!m) return o.allowAnonymous ? 'anon' : null;
    const h = sha(m[1].trim());
    for (const k of keyHashes) if (timingSafeEqual(h, k)) return h.toString('hex').slice(0, 12);
    return o.allowAnonymous ? 'anon' : null;
  };
  const cors = (req, res) => {
    const origin = req.headers.origin;
    if (origin && (o.corsOrigins.includes('*') || o.corsOrigins.includes(origin))) {
      res.setHeader('access-control-allow-origin', origin); res.setHeader('vary', 'origin');
      res.setHeader('access-control-allow-headers', 'authorization, content-type, x-slice-options'); res.setHeader('access-control-allow-methods', 'GET, POST, DELETE, OPTIONS');
    }
  };
  const send = (res, code, body, headers = HDR) => { res.writeHead(code, headers); res.end(typeof body === 'string' ? body : JSON.stringify(body)); };
  const fail = (res, code, message) => send(res, code, { error: message });
  const readBody = (req, limit) => new Promise((resolve, reject) => {
    const chunks = []; let n = 0;
    req.on('data', c => { n += c.length; if (n > limit) { reject(Object.assign(new Error('request body too large'), { code: 413 })); req.destroy(); } else chunks.push(c); });
    req.on('end', () => resolve(Buffer.concat(chunks))); req.on('error', reject);
  });
  const publicJob = j => ({ id: j.id, status: j.status, progress: j.progress, engine: j.engine, createdAt: j.createdAt, startedAt: j.startedAt, finishedAt: j.finishedAt, error: j.error, summary: j.summary, queuePosition: j.status === 'queued' ? queue.indexOf(j) + 1 : 0 });

  function finish(j, patch) {
    if (j.status === 'cancelled') return;
    Object.assign(j, patch, { finishedAt: Date.now() }); j.stl = null; running--; pump();
  }
  async function execute(j) {
    j.status = 'running'; j.startedAt = Date.now(); running++;
    const limits = { maxTriangles: o.maxTriangles, maxLayers: o.maxLayers };
    const runWorker = data => {
      const w = new Worker(new URL('./worker.js', import.meta.url), { workerData: { ...data, profile: j.profile, nozzles: j.nozzles, limits }, resourceLimits: { maxOldGenerationSizeMb: 1536 } });
      j.worker = w;
      const timer = setTimeout(() => { w.terminate(); finish(j, { status: 'failed', error: 'job timed out' }); }, o.jobTimeoutMs);
      w.on('message', m => {
        if (m.type === 'progress') j.progress = m.progress;
        else if (m.type === 'done') { clearTimeout(timer); j.gcode = m.gcode; j.progress = 1; finish(j, { status: 'done', summary: m.summary }); }
        else if (m.type === 'error') { clearTimeout(timer); finish(j, { status: 'failed', error: m.message }); }
      });
      w.on('error', e => { clearTimeout(timer); finish(j, { status: 'failed', error: `worker error: ${e.message}` }); });
      w.on('exit', () => { clearTimeout(timer); if (j.status === 'running') finish(j, { status: 'failed', error: 'worker exited unexpectedly' }); });
    };
    if (j.engine === 'builtin') return runWorker({ mode: 'builtin', stl: j.stl });
    try {
      const gcode = await runExternalSlicer(j.engine, { stl: j.stl, profile: j.profile, config: o.external[j.engine], timeoutMs: o.jobTimeoutMs, onChild: c => { j.child = c; } });
      j.child = null;
      if (j.status === 'cancelled') return;
      runWorker({ mode: 'analyze', gcode, stl: j.stl });
    } catch (e) { finish(j, { status: 'failed', error: String(e.message).slice(0, 300) }); }
  }
  function pump() { while (running < o.concurrency && queue.length) execute(queue.shift()); }

  async function handle(req, res) {
    cors(req, res);
    const url = new URL(req.url, 'http://x'), path = url.pathname.replace(/\/+$/, '') || '/';
    if (req.method === 'OPTIONS') return send(res, 204, '');
    if (path === '/health') return send(res, 200, { ok: true, engines, running, queued: queue.length });
    const client = clientOf(req);
    if (!client) { res.setHeader('www-authenticate', 'Bearer'); return fail(res, 401, 'missing or invalid API key'); }
    if (path === '/v1/profiles' && req.method === 'GET') return send(res, 200, { profiles: o.profiles });
    if (path === '/v1/jobs' && req.method === 'POST') {
      const mine = [...jobs.values()].filter(j => j.client === client && (j.status === 'queued' || j.status === 'running')).length;
      if (mine >= o.maxQueuePerClient) return fail(res, 429, `too many active jobs (limit ${o.maxQueuePerClient})`);
      let body, spec;
      try { body = await readBody(req, o.maxBodyBytes); } catch (e) { return fail(res, e.code || 400, e.message); }
      try {
        if ((req.headers['content-type'] || '').includes('json')) { const j = JSON.parse(body.toString('utf8')); spec = { stl: Buffer.from(String(j.stl || ''), 'base64'), profile: j.profile, engine: j.engine, nozzles: j.nozzles }; }
        else spec = { stl: body, ...JSON.parse(decodeURIComponent(req.headers['x-slice-options'] || '{}')) };
      } catch { return fail(res, 400, 'invalid request body or options'); }
      if (!spec.stl?.length) return fail(res, 400, 'no STL data');
      const engine = spec.engine || 'builtin';
      if (!engines.includes(engine)) return fail(res, 400, `engine "${engine}" is not available (have: ${engines.join(', ')})`);
      let profile; try { profile = resolveProfile(spec.profile || {}); } catch (e) { return fail(res, 400, e.message); }
      const bad = validateProfile(profile).filter(i => i.level === 'error'); if (bad.length) return fail(res, 400, bad.map(i => i.message).join('; '));
      const j = { id: randomBytes(16).toString('hex'), client, status: 'queued', progress: 0, engine, createdAt: Date.now(), profile, nozzles: !!spec.nozzles, stl: spec.stl };
      jobs.set(j.id, j); queue.push(j); pump();
      return send(res, 202, publicJob(j));
    }
    const m = /^\/v1\/jobs\/([0-9a-f]{32})(\/gcode)?$/.exec(path);
    if (m) {
      const j = jobs.get(m[1]); if (!j || j.client !== client) return fail(res, 404, 'no such job');
      if (req.method === 'GET' && !m[2]) return send(res, 200, publicJob(j));
      if (req.method === 'GET' && m[2]) return j.status === 'done' ? send(res, 200, j.gcode, { 'content-type': 'text/plain; charset=utf-8', 'content-disposition': `attachment; filename="${j.id}.gcode"`, 'cache-control': 'no-store' }) : fail(res, 409, `job is ${j.status}`);
      if (req.method === 'DELETE') {
        if (j.status === 'queued') { queue.splice(queue.indexOf(j), 1); j.status = 'cancelled'; }
        else if (j.status === 'running') { j.status = 'cancelled'; j.worker?.terminate(); j.child?.kill('SIGKILL'); running--; pump(); }
        j.stl = null; j.gcode = null; jobs.delete(j.id); return send(res, 200, { id: j.id, status: 'cancelled' });
      }
    }
    return fail(res, 404, 'not found');
  }

  const server = http.createServer((req, res) => { handle(req, res).catch(() => { if (!res.headersSent) fail(res, 500, 'internal error'); else res.end(); }); });
  server.requestTimeout = 120000; server.headersTimeout = 20000;
  const sweep = setInterval(() => { const now = Date.now(); for (const [id, j] of jobs) if (j.finishedAt && now - j.finishedAt > o.jobTtlMs) jobs.delete(id); }, 60000); sweep.unref();
  return {
    server, engines,
    listen: (port = 0, host = '127.0.0.1') => new Promise(resolve => server.listen(port, host, () => resolve({ port: server.address().port, host }))),
    close: () => new Promise(resolve => { clearInterval(sweep); for (const j of jobs.values()) { j.worker?.terminate(); j.child?.kill('SIGKILL'); } server.close(() => resolve()); server.closeAllConnections?.(); }),
  };
}
