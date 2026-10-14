import test from 'node:test';
import assert from 'node:assert/strict';
import { compileAssembly, validateSequence, solveSequence, rad, deg, stepCacheKey } from '../../src/folding/index.js';

function vertex4() {
  const o = [10, 10], P = [[20, 10], [10, 20], [0, 10], [10, 0]], C = [[20, 20], [0, 20], [0, 0], [20, 0]];
  return {
    units: 'mm', anchor: 'P0',
    regions: P.map((p, k) => ({ id: `P${k}`, polygon: [o, p, C[k], P[(k + 1) % 4]] })),
    connections: P.map((p, k) => ({ id: `h${k}`, type: 'idealHinge', a: `P${(k + 3) % 4}`, b: `P${k}`, edge: { p0: o, p1: p } })),
  };
}
const doc = () => ({
  version: 1,
  groups: [{ id: 'odd', connectionIds: ['h1', 'h3'] }],
  steps: [
    { id: 's1', title: 'Fold', controls: [{ target: { groupId: 'odd' }, mode: 'drive', quantity: 'angle', toDegrees: 30 }], easing: 'smoothstep' },
    { id: 's2', title: 'More', controls: [{ target: { connectionId: 'h1' }, mode: 'drive', toDegrees: 60 }] },
  ],
});

test('sequence validation rejects stale refs, duplicate controls and bad quantities', () => {
  const c = compileAssembly(vertex4());
  assert.ok(validateSequence(doc(), c).ok);
  const bad = doc();
  bad.steps[0].controls.push({ target: { connectionId: 'h1' }, mode: 'hold' });        // h1 is in group 'odd'
  assert.ok(validateSequence(bad, c).issues.some(i => i.code === 'ambiguousControls'));
  const stale = doc(); stale.groups[0].connectionIds.push('gone');
  assert.ok(validateSequence(stale, c).issues.some(i => i.code === 'staleReferences'));
  const q = doc(); q.steps[0].controls[0].quantity = 'curvature';
  assert.ok(validateSequence(q, c).issues.some(i => i.code === 'invalidControl'));
  const h = doc(); h.geometryHash = 'fnv:00000000';
  assert.ok(validateSequence(h, c).issues.some(i => i.code === 'staleGeometry'));
});

test('unlisted connections default to free (and default-hold warns)', () => {
  const c = compileAssembly(vertex4());
  const d = doc(); d.steps[0].defaultConnectionMode = 'hold';
  assert.ok(validateSequence(d, c).issues.some(i => i.code === 'defaultHold'));
});

test('sequence replays deterministically and the cache is keyed on geometry', () => {
  const c = compileAssembly(vertex4());
  const opts = { initialAngles: [0.2, -0.2, 0.2, -0.2] };
  const cache = new Map();
  const a = solveSequence(c, doc(), { ...opts, cache });
  assert.equal(a.status, 'converged', JSON.stringify(a.steps.at(-1)?.failure));
  const b = solveSequence(c, doc(), { ...opts, cache });
  assert.ok(b.steps.every(s => s.fromCache));
  assert.deepEqual(b.finalAngles, a.finalAngles);
  assert.equal(Math.round(deg(a.finalAngles[1])), 60);
  // Editing geometry changes the hash, so nothing is reused.
  const moved = vertex4(); moved.regions[1].polygon[2] = [0, 25];
  const c2 = compileAssembly(moved);
  assert.notEqual(c2.hash, c.hash);
  assert.notEqual(stepCacheKey(c, doc().steps[0], [0, 0, 0, 0], doc()), stepCacheKey(c2, doc().steps[0], [0, 0, 0, 0], doc()));
});

test('a failing step stops the sequence with the failing step named', () => {
  const c = compileAssembly(vertex4());
  const d = doc();
  d.steps[0].controls = [
    { target: { connectionId: 'h1' }, mode: 'drive', toDegrees: 70 },
    { target: { connectionId: 'h3' }, mode: 'drive', toDegrees: -10 },
  ];
  const r = solveSequence(c, d, { initialAngles: [0.4, -0.4, 0.4, -0.4] });
  assert.notEqual(r.status, 'converged');
  assert.equal(r.failedStep, 's1');
  assert.equal(r.steps.length, 1);
});
