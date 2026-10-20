import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { loadKernelNode } from '../src/kernel-node.js';
import { createSlicingServer } from '../src/server/server.js';
import { createSlicingClient, SlicingError } from '../src/client.js';

let K, srv, base, stl;
const KEY = 'test-key-aaaaaaaaaaaaaaaa', KEY2 = 'other-key-bbbbbbbbbbbbbbbb';
function stlOf(m) {
  const g = m.getMesh(), n = g.triVerts.length / 3, buf = new Uint8Array(84 + 50 * n), dv = new DataView(buf.buffer);
  dv.setUint32(80, n, true);
  for (let t = 0; t < n; t++) for (let v = 0; v < 3; v++) for (let k = 0; k < 3; k++) dv.setFloat32(84 + t * 50 + 12 + v * 12 + k * 4, g.vertProperties[g.triVerts[t * 3 + v] * g.numProp + k], true);
  return buf;
}
before(async () => {
  K = await loadKernelNode(); stl = stlOf(K.Manifold.cube([12, 12, 3]));
  srv = createSlicingServer({ apiKeys: [KEY, KEY2], corsOrigins: ['https://app.example'], maxBodyBytes: 2_000_000, maxQueuePerClient: 2 });
  const { port } = await srv.listen(0); base = `http://127.0.0.1:${port}`;
});
after(() => srv.close());

test('server refuses to start with no keys unless anonymous mode is explicit', () => {
  assert.throws(() => createSlicingServer({}), /API keys/);
  assert.doesNotThrow(() => createSlicingServer({ allowAnonymous: true }));
});

test('auth: health is open, everything else needs a valid bearer key', async () => {
  assert.equal((await fetch(`${base}/health`)).status, 200);
  assert.equal((await fetch(`${base}/v1/profiles`)).status, 401);
  assert.equal((await fetch(`${base}/v1/profiles`, { headers: { authorization: 'Bearer nope' } })).status, 401);
  assert.equal((await fetch(`${base}/v1/profiles`, { headers: { authorization: `Bearer ${KEY}` } })).status, 200);
});

test('client: submit → progress → G-code and analysis, via the real server and worker', async () => {
  const c = createSlicingClient({ baseUrl: base, apiKey: KEY }); const seen = [];
  const r = await c.slice({ stl, profile: { nozzleMm: 0.4, layerHeightMm: 0.2 }, nozzles: true }, { pollMs: 50, onProgress: j => seen.push(j.status) });
  assert.match(r.gcode, /;TYPE:Outer wall/);
  assert.equal(r.summary.stats.layers, 15);
  assert.ok(r.summary.analysis.filamentMm > 50 && r.summary.analysis.features.outer);
  assert.ok(r.summary.nozzleTable.recommended.nozzleMm > 0);
  assert.ok(seen.includes('running') || seen.includes('queued') || seen.includes('done'));
});

test('jobs are private to the key that made them', async () => {
  const a = createSlicingClient({ baseUrl: base, apiKey: KEY }), b = createSlicingClient({ baseUrl: base, apiKey: KEY2 });
  const job = await a.submit({ stl });
  await assert.rejects(() => b.get(job.id), e => e instanceof SlicingError && e.status === 404);
  await assert.rejects(() => b.gcode(job.id), e => e.status === 404);
  await a.cancel(job.id);
});

test('validation: bad profile, bad engine, empty body, oversized body, garbage STL', async () => {
  const c = createSlicingClient({ baseUrl: base, apiKey: KEY });
  await assert.rejects(() => c.submit({ stl, profile: { layerHeightMm: 0.5 } }), e => e.status === 400 && /layer height/.test(e.message));
  await assert.rejects(() => c.submit({ stl, engine: 'prusa' }), e => e.status === 400 && /not available/.test(e.message));
  await assert.rejects(() => c.submit({ stl: new Uint8Array(0) }), e => e.status === 400);
  await assert.rejects(() => c.submit({ stl: new Uint8Array(3_000_000) }), e => e.status === 413 || e.status === 0);
  const bad = await c.slice({ stl: new Uint8Array([1, 2, 3, 4]) }, { pollMs: 30 }).then(() => null, e => e);
  assert.match(bad.message, /STL/);
});

test('limits: per-client active job cap returns 429; cancelling frees the slot', async () => {
  const c = createSlicingClient({ baseUrl: base, apiKey: KEY2 }), big = stlOf(K.Manifold.cube([60, 60, 40]));
  const j1 = await c.submit({ stl: big, profile: { layerHeightMm: 0.1 } }), j2 = await c.submit({ stl: big, profile: { layerHeightMm: 0.1 } });
  await assert.rejects(() => c.submit({ stl: big }), e => e.status === 429);
  await c.cancel(j1.id); await c.cancel(j2.id);
  const j3 = await c.submit({ stl }); await c.cancel(j3.id);
});

test('cancel: aborting a running slice stops the remote job', async () => {
  const c = createSlicingClient({ baseUrl: base, apiKey: KEY }), ac = new AbortController(), big = stlOf(K.Manifold.cube([80, 80, 60]));
  const p = c.slice({ stl: big, profile: { layerHeightMm: 0.1 } }, { pollMs: 30, signal: ac.signal });
  setTimeout(() => ac.abort(), 200);
  await assert.rejects(p, /cancelled/);
});

test('cors: only listed origins are allowed, preflight answers', async () => {
  const ok = await fetch(`${base}/v1/jobs`, { method: 'OPTIONS', headers: { origin: 'https://app.example' } });
  assert.equal(ok.status, 204); assert.equal(ok.headers.get('access-control-allow-origin'), 'https://app.example');
  assert.match(ok.headers.get('access-control-allow-headers'), /authorization/);
  const no = await fetch(`${base}/v1/jobs`, { method: 'OPTIONS', headers: { origin: 'https://evil.example' } });
  assert.equal(no.headers.get('access-control-allow-origin'), null);
});

test('client: unreachable server gives a readable error', async () => {
  await assert.rejects(() => createSlicingClient({ baseUrl: 'http://127.0.0.1:9' }).health(), e => e instanceof SlicingError && /cannot reach/.test(e.message));
});

test('external engine: a configured CLI is run as a child process and its G-code is analysed', async () => {
  const { mkdtempSync, writeFileSync, chmodSync } = await import('node:fs'), { tmpdir } = await import('node:os'), { join } = await import('node:path');
  const dir = mkdtempSync(join(tmpdir(), 'fake-')), fake = join(dir, 'fake-slicer.sh');
  // behaves like `prusa-slicer --export-gcode --load ini --output out in.stl`
  writeFileSync(fake, '#!/bin/sh\nwhile [ $# -gt 0 ]; do [ "$1" = "--output" ] && out="$2"; shift; done\nprintf "M83\\n;LAYER_CHANGE\\nG1 Z0.2 F600\\n;TYPE:External perimeter\\nG1 X10 Y0 F1200\\nG1 X20 Y0 E0.4\\n" > "$out"\n');
  chmodSync(fake, 0o755);
  const s2 = createSlicingServer({ apiKeys: [KEY], prusaPath: fake }), { port } = await s2.listen(0);
  try {
    const c = createSlicingClient({ baseUrl: `http://127.0.0.1:${port}`, apiKey: KEY });
    assert.deepEqual((await c.health()).engines, ['builtin', 'prusa']);
    const r = await c.slice({ stl, engine: 'prusa' }, { pollMs: 50 });
    assert.match(r.gcode, /External perimeter/); assert.equal(r.summary.engine, 'external'); assert.equal(r.summary.analysis.features.outer.moves, 1);
    const failing = createSlicingServer({ apiKeys: [KEY], prusaPath: '/nonexistent/slicer' }), p2 = await failing.listen(0);
    try { await assert.rejects(() => createSlicingClient({ baseUrl: `http://127.0.0.1:${p2.port}`, apiKey: KEY }).slice({ stl, engine: 'prusa' }, { pollMs: 30 }), /ENOENT|failed/); } finally { await failing.close(); }
  } finally { await s2.close(); }
});

test('orca engine: right CLI arguments, per-job datadir, generated profile JSON, G-code picked up from the output dir', async () => {
  const { mkdtempSync, writeFileSync, chmodSync, readFileSync } = await import('node:fs'), { tmpdir } = await import('node:os'), { join } = await import('node:path');
  const dir = mkdtempSync(join(tmpdir(), 'fake-orca-')), fake = join(dir, 'orca.sh'), log = join(dir, 'args.log');
  // stand-in for `orca-slicer --datadir D --slice 0 --load-settings "m;p" --load-filaments f --outputdir O in.stl`
  writeFileSync(fake, `#!/bin/sh
echo "$@" > "${log}"
while [ $# -gt 0 ]; do case "$1" in --outputdir) o="$2";; --load-settings) s="$2";; --load-filaments) f="$2";; esac; shift; done
p="\${s#*;}"; cp "$p" "${dir}/process.seen"; cp "$f" "${dir}/filament.seen"
mkdir -p "$o"; printf "M83\\n;LAYER_CHANGE\\nG1 Z0.2 F600\\n;TYPE:Outer wall\\nG1 X10 Y0 F1200\\nG1 X20 Y0 E0.4\\n" > "$o/plate_1.gcode"
`);
  chmodSync(fake, 0o755);
  const s2 = createSlicingServer({ apiKeys: [KEY], orca: { path: fake, wrapper: ['env', 'FOO=1'], bases: { process: { inherits: 'My Process', sparse_infill_pattern: 'gyroid' } } } }), { port } = await s2.listen(0);
  try {
    const c = createSlicingClient({ baseUrl: `http://127.0.0.1:${port}`, apiKey: KEY });
    assert.deepEqual((await c.health()).engines, ['builtin', 'orca']);
    const r = await c.slice({ stl, engine: 'orca', profile: { layerHeightMm: 0.16, walls: 3, infillPct: 20 } }, { pollMs: 50 });
    assert.match(r.gcode, /Outer wall/); assert.equal(r.summary.analysis.features.outer.moves, 1);
    const args = readFileSync(log, 'utf8'); assert.match(args, /--datadir \S+datadir --slice 0 --load-settings \S+machine\.json;\S+process\.json --load-filaments \S+filament\.json --outputdir/);
    const proc = JSON.parse(readFileSync(join(dir, 'process.seen'), 'utf8'));
    assert.equal(proc.layer_height, '0.16'); assert.equal(proc.wall_loops, '3'); assert.equal(proc.sparse_infill_density, '20%');
    assert.equal(proc.inherits, 'My Process'); assert.equal(proc.sparse_infill_pattern, 'gyroid');          // your base profile survives
    assert.equal(JSON.parse(readFileSync(join(dir, 'filament.seen'), 'utf8')).filament_diameter[0], '1.75');
  } finally { await s2.close(); }
});
