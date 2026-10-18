import test from 'node:test';
import assert from 'node:assert/strict';
import { SolverClient, createInlineTransport } from '../src/worker-client.js';
import { createSolverService } from '../src/worker-core.js';
import { rad } from '../src/index.js';

function vertex4() {
  const o = [10, 10], P = [[20, 10], [10, 20], [0, 10], [10, 0]], C = [[20, 20], [0, 20], [0, 0], [20, 0]];
  return { units: 'mm', anchor: 'P0', regions: P.map((p, k) => ({ id: `P${k}`, polygon: [o, p, C[k], P[(k + 1) % 4]] })),
    connections: P.map((p, k) => ({ id: `h${k}`, type: 'idealHinge', a: `P${(k + 3) % 4}`, b: `P${k}`, edge: { p0: o, p1: p } })) };
}
const step = { id: 's', branchHint: [{ target: { connectionId: 'h0' }, degrees: 3 }, { target: { connectionId: 'h1' }, degrees: -3 }, { target: { connectionId: 'h2' }, degrees: 3 }, { target: { connectionId: 'h3' }, degrees: -3 }], controls: [{ target: { connectionId: 'h1' }, mode: 'drive', toDegrees: 80 }] };
const mk = () => new SolverClient(() => createInlineTransport(createSolverService()));

test('compile, solve and sequence run through the message protocol', async () => {
  const c = mk();
  const comp = await c.compile(vertex4());
  assert.ok(comp.ok); assert.match(comp.hash, /^fnv:/);
  const sol = await c.solveConfiguration({ initial: [0.4, -0.4, 0.4, -0.4], constraints: [{ type: 'drive', connId: 'h1', valueRad: rad(70) }] }).promise;
  assert.equal(sol.status, 'converged');
  const progress = [];
  const { promise } = c.solveSequence({ doc: { groups: [], steps: [step] }, initialAngles: [0, 0, 0, 0] }, { onProgress: m => progress.push(m.progress) });
  const seq = await promise;
  assert.equal(seq.status, 'converged');
  assert.ok(progress.length > 2);
  assert.ok(seq.steps[0].samples.length > 2);                       // packed Float64 samples were unpacked
  assert.equal(Math.round(seq.finalAngles[1] * 180 / Math.PI), 80);
});

test('a stale response after an edit is discarded, never applied', async () => {
  const c = mk();
  await c.compile(vertex4());
  const { promise } = c.solveSequence({ doc: { groups: [], steps: [step] }, initialAngles: [0, 0, 0, 0] });
  c.bumpRevision();                                                  // user edits geometry while solving
  const r = await promise;
  assert.equal(r.stale, true);
});

test('cancel stops a running step between batches', async () => {
  const c = mk();
  await c.compile(vertex4());
  let id;
  const out = c.solveSequence({ doc: { groups: [], steps: [step] }, initialAngles: [0, 0, 0, 0], options: { initialIncrement: 0.01 } },
    { onProgress: m => { if (m.progress > 0.05 && id) { c.cancel(id); id = null; } } });
  id = out.requestId;
  const r = await out.promise;
  assert.equal(r.status, 'cancelled');
  assert.ok(r.steps.length === 0);
});

test('unknown geometry hash is a stale-reference error', async () => {
  const c = mk();
  c.geometryHash = 'fnv:deadbeef';
  await assert.rejects(c.solveConfiguration({ initial: [] }).promise, e => e.code === 'staleReferences');
});
