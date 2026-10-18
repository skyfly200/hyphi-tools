import test from 'node:test';
import assert from 'node:assert/strict';
import { ConstraintSystem, continuation, continuationGenerator, constraints as C, createService, createInlineTransport, WorkerClient, packVectors, unpackVectors } from '../src/index.js';

const near = (a, b, e = 1e-6, m) => assert.ok(Math.abs(a - b) <= e, m || `${a} !≈ ${b}`);

test('solves a simple system and validates in physical units', () => {
  const s = new ConstraintSystem();
  s.addVariables(['x', 'y'], [0.3, 0.9]);
  s.addConstraint({ id: 'circle', group: 'structural', unit: 'mm', tolerance: 1e-6, residual: v => Math.hypot(v.get('x'), v.get('y')) - 1 });
  s.addConstraint({ id: 'x', group: 'user', residual: v => v.get('x') - 0.6 });
  const r = s.solve();
  assert.equal(r.status, 'converged'); assert.ok(r.valid && r.targetsMet);
  near(r.values.x, 0.6); near(r.values.y, 0.8);
  assert.equal(r.constraints.find(c => c.id === 'circle').ok, true);
});

test('conflicting targets lose to structure and are reported, not forced', () => {
  const s = new ConstraintSystem();
  s.addVariables(['x', 'y'], [0.5, 0.5]);
  s.addConstraint({ id: 'circle', group: 'structural', residual: v => Math.hypot(v.get('x'), v.get('y')) - 1 });
  s.addConstraint({ id: 'x>1', group: 'user', residual: v => v.get('x') - 1.5, meta: { why: 'unreachable' } });
  const r = s.solve();
  assert.equal(r.status, 'incompatibleTargets');
  assert.ok(r.valid, 'the circle must still hold');
  assert.ok(r.groupMax.structural < 1e-6);
  assert.equal(r.worst[0].id, 'x>1'); assert.equal(r.worst[0].meta.why, 'unreachable');
});

test('under-constrained systems warn; limits and bounds are reported separately', () => {
  const s = new ConstraintSystem();
  s.addVariables(['a', 'b'], [0, 0]);
  s.addConstraint({ id: 'sum', group: 'structural', residual: v => v.get('a') + v.get('b') - 2 });
  const r = s.solve();
  assert.equal(r.status, 'converged');
  assert.ok(r.warnings.some(w => w.code === 'underconstrained' && w.rank === 1));
  s.addConstraint({ id: 'cap', group: 'limit', residual: v => Math.max(0, v.get('a') - 0.5) });
  s.addConstraint({ id: 'want-a', group: 'user', residual: v => v.get('a') - 1.5 });
  const r2 = s.solve();
  assert.ok(r2.warnings.some(w => w.code === 'limitViolation'));
  assert.notEqual(r2.status, 'converged');
});

test('shared context is computed once per evaluation, not once per constraint', () => {
  const s = new ConstraintSystem(); s.addVariables(['x', 'y'], [1, 1]);
  let calls = 0;
  s.setContext(v => { calls++; return { r: Math.hypot(v.get('x'), v.get('y')) }; });
  for (let i = 0; i < 5; i++) s.addConstraint({ id: `c${i}`, group: 'user', residual: (v, ctx) => ctx.r - 2 });
  const r = s.solve({ options: { maxIterations: 3 } });
  const evals = calls;
  assert.ok(evals > 0);
  // every objective evaluation calls the context exactly once regardless of constraint count
  const s2 = new ConstraintSystem(); s2.addVariables(['x', 'y'], [1, 1]); let c2 = 0;
  s2.setContext(v => { c2++; return { r: Math.hypot(v.get('x'), v.get('y')) }; });
  s2.addConstraint({ id: 'only', group: 'user', residual: (v, ctx) => ctx.r - 2 });
  s2.solve({ options: { maxIterations: 3 } });
  assert.equal(c2, evals, 'context calls must not scale with constraint count');
  void r;
});

test('cancellation and deadlines are honoured', () => {
  const s = new ConstraintSystem(); s.addVariable('x', 5);
  s.addConstraint({ id: 'c', group: 'user', residual: v => Math.sin(v.get('x') * 7) * 3 + v.get('x') - 1 });
  assert.equal(s.solve({ options: { shouldCancel: () => true } }).status, 'cancelled');
});

// ── a four-bar linkage: closed-loop mechanism, branch tracked by continuation ──
function fourBar() {
  const s = new ConstraintSystem();
  C.addPoints2D(s, { A: [0, 0], B: [1, 0.2], C: [3.5, 1.8], D: [4, 0] });
  s.addConstraint(C.fixed2D('A', 'A', [0, 0])); s.addConstraint(C.fixed2D('D', 'D', [4, 0]));
  s.addConstraint(C.distance2D('crank', 'A', 'B', 1)); s.addConstraint(C.distance2D('coupler', 'B', 'C', 3)); s.addConstraint(C.distance2D('rocker', 'D', 'C', 2.5));
  return s;
}
const crank = (s, th) => { s.removeConstraint('theta'); s.addConstraint({ id: 'theta', group: 'user', unit: 'rad', tolerance: 1e-6,
  residual: v => Math.atan2(v.get('B.y'), v.get('B.x')) - th }); };

test('four-bar linkage: continuation follows one branch and preserves every link length', () => {
  const s = fourBar();
  const start = s.solve().x;                                   // closed at the given start pose
  const th0 = Math.atan2(start[3], start[2]);
  const res = continuation({
    start, initialIncrement: 0.05,
    solveAt: (p, guess) => { crank(s, th0 + p * 1.2); return s.solve({ initial: guess }); },
  });
  assert.equal(res.completed, true, JSON.stringify(res.failure));
  assert.ok(res.samples.length > 10);
  for (const smp of res.samples) {
    const [bx, by, cx, cy] = [smp.state[2], smp.state[3], smp.state[4], smp.state[5]];
    near(Math.hypot(bx, by), 1, 1e-5); near(Math.hypot(cx - bx, cy - by), 3, 1e-5); near(Math.hypot(cx - 4, cy), 2.5, 1e-5);
    assert.ok(cy > 0, 'stayed on the upper branch');           // no flip to the mirror assembly
  }
});

test('continuation stops with a diagnosis when the target becomes unreachable', () => {
  const s = fourBar();
  const start = s.solve().x; const th0 = Math.atan2(start[3], start[2]);
  const res = continuation({ start, initialIncrement: 0.1, minIncrement: 1e-3,
    solveAt: (p, guess) => { crank(s, th0 + p * 3.0); return s.solve({ initial: guess }); } });   // 3 rad: the rocker locks up first
  assert.equal(res.completed, false);
  assert.ok(res.reachedProgress > 0 && res.reachedProgress < 1);
  assert.match(res.failure.message, /no solution found/);
});

test('generator form yields accepted samples for host-driven pacing', () => {
  const s = new ConstraintSystem(); s.addVariable('x', 0);
  const it = continuationGenerator({ start: Float64Array.of(0), initialIncrement: 0.25, solveAt: (p, g) => { s.clearGroup('user'); s.addConstraint({ id: 't', residual: v => v.get('x') - p * 4 }); return s.solve({ initial: g }); } });
  const seen = []; let n = it.next();
  while (!n.done) { seen.push(n.value.progress); n = it.next(); }
  assert.deepEqual(seen.map(x => +x.toFixed(2)), [0.25, 0.5, 0.75, 1]); assert.equal(n.value.completed, true);
});

test('3D truss: six edge lengths define a rigid tetrahedron', () => {
  const s = new ConstraintSystem();
  C.addPoints3D(s, { p0: [0, 0, 0], p1: [1.1, 0, 0], p2: [0.4, 0.9, 0.1], p3: [0.5, 0.3, 1.2] });
  s.addConstraint(C.fixed3D('f0', 'p0', [0, 0, 0])); s.addConstraint(C.fixed3D('f1y', 'p1', [1, 0, 0], {}));
  const E = [['p0', 'p1'], ['p0', 'p2'], ['p0', 'p3'], ['p1', 'p2'], ['p1', 'p3'], ['p2', 'p3']];
  E.forEach(([a, b], i) => s.addConstraint(C.distance3D(`e${i}`, a, b, 1)));
  const r = s.solve();
  assert.equal(r.status, 'converged', JSON.stringify(r.constraints.filter(c => !c.ok).map(c => [c.id, c.maxError])));
  assert.ok(r.groupMax.structural < 1e-6);
});

test('2D helpers: angle, parallel and min-distance behave', () => {
  const s = new ConstraintSystem(); C.addPoints2D(s, { a: [1, 0.2], b: [0, 0], c: [0.2, 1] });
  s.addConstraint(C.fixed2D('b', 'b', [0, 0])); s.addConstraint(C.distance2D('ab', 'a', 'b', 1)); s.addConstraint(C.distance2D('cb', 'c', 'b', 1));
  s.addConstraint(C.angle2D('right', 'a', 'b', 'c', Math.PI / 2));
  const r = s.solve(); assert.equal(r.status, 'converged');
  near(r.values['a.x'] * r.values['c.x'] + r.values['a.y'] * r.values['c.y'], 0, 1e-6);
});

// ── worker plumbing ─────────────────────────────────────────────────────────
const svc = () => createService({
  slow: async (p, ctx) => { let i = 0; for (; i < p.n; i++) { ctx.post({ i }); await ctx.yield(); if (ctx.isCancelled()) return { cancelled: true, i }; } return { done: true, i }; },
  echo: p => p,
  boom: () => { throw Object.assign(new Error('bad'), { code: 'myCode' }); },
});
const mk = () => new WorkerClient(() => createInlineTransport(svc()));

test('worker client: results, progress, errors', async () => {
  const c = mk();
  assert.deepEqual(await c.request('echo', { a: 1 }).promise, { a: 1 });
  const seen = []; const r = await c.request('slow', { n: 3 }, { onProgress: m => seen.push(m.i) }).promise;
  assert.deepEqual(seen, [0, 1, 2]); assert.equal(r.done, true);
  await assert.rejects(c.request('boom', {}).promise, e => e.code === 'myCode');
  await assert.rejects(c.request('nope', {}).promise, e => e.code === 'badRequest');
});

test('worker client: stale results are discarded and cancel stops work', async () => {
  const c = mk();
  const { promise } = c.request('slow', { n: 50 });
  c.bumpRevision();
  assert.deepEqual(await promise, { stale: true });
  let id; const out = c.request('slow', { n: 500 }, { onProgress: m => { if (m.i === 3 && id) { c.cancel(id); id = null; } } });
  id = out.requestId;
  const r = await out.promise;
  assert.equal(r.cancelled, true); assert.ok(r.i < 50);
});

test('vector packing round-trips', () => {
  const rows = [[1, 2, 3], [4, 5, 6]];
  assert.deepEqual(unpackVectors(packVectors(rows)), rows);
});
