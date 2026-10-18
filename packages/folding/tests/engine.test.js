import test from 'node:test';
import assert from 'node:assert/strict';
import {
  compileAssembly, evaluatePoses, applyPose, solveConfiguration, solveStepContinuation,
  bandPose, bandChord, rad, deg, dist,
} from '../src/index.js';

const near = (a, b, eps = 1e-6, msg) => assert.ok(Math.abs(a - b) <= eps, msg || `${a} !≈ ${b}`);
const nearV = (a, b, eps = 1e-6) => a.forEach((x, i) => near(x, b[i], eps, `[${i}] ${x} !≈ ${b[i]} (${a} vs ${b})`));
const sq = (x0, y0, x1, y1) => [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];

function twoPanel(extra = {}) {
  return {
    units: 'mm', anchor: 'A',
    regions: [{ id: 'A', polygon: sq(0, 0, 10, 10) }, { id: 'B', polygon: sq(10, 0, 20, 10) }],
    connections: [{ id: 'h', type: 'idealHinge', a: 'A', b: 'B', edge: { p0: [10, 0], p1: [10, 10] }, ...extra }],
  };
}

test('single ideal hinge: valley is positive and panels stay rigid', () => {
  const c = compileAssembly(twoPanel());
  assert.ok(c.ok, JSON.stringify(c.issues));
  const poses = evaluatePoses(c, [rad(90)]);
  nearV(applyPose(poses.get('B'), [20, 5, 0]), [10, 5, 10]);          // rises toward +z
  nearV(applyPose(poses.get('B'), [10, 5, 0]), [10, 5, 0]);           // hinge line fixed
  near(dist(applyPose(poses.get('B'), [20, 0, 0]), applyPose(poses.get('B'), [20, 10, 0])), 10, 1e-9);
});

test('reversing the edge endpoints does not reverse the fold', () => {
  const a = compileAssembly(twoPanel());
  const b = compileAssembly(twoPanel({ edge: { p0: [10, 10], p1: [10, 0] } }));
  const pa = applyPose(evaluatePoses(a, [rad(60)]).get('B'), [20, 3, 0]);
  const pb = applyPose(evaluatePoses(b, [rad(60)]).get('B'), [20, 3, 0]);
  nearV(pa, pb);
});

test('three-panel tree matches analytical forward kinematics', () => {
  const asm = {
    units: 'mm', anchor: 'A',
    regions: [{ id: 'A', polygon: sq(0, 0, 10, 10) }, { id: 'B', polygon: sq(10, 0, 20, 10) }, { id: 'C', polygon: sq(20, 0, 30, 10) }],
    connections: [
      { id: 'h1', type: 'idealHinge', a: 'A', b: 'B', edge: { p0: [10, 0], p1: [10, 10] } },
      { id: 'h2', type: 'idealHinge', a: 'B', b: 'C', edge: { p0: [20, 0], p1: [20, 10] } },
    ],
  };
  const c = compileAssembly(asm);
  const [t1, t2] = [rad(90), rad(90)];
  const poses = evaluatePoses(c, [t1, t2]);
  // Independent 2D profile check: walk the polyline in the XZ plane.
  let p = [10, 0], dir = [1, 0], ang = 0;
  ang += t1; dir = [Math.cos(ang), Math.sin(ang)]; p = [p[0] + dir[0] * 10, p[1] + dir[1] * 10];
  ang += t2; dir = [Math.cos(ang), Math.sin(ang)]; p = [p[0] + dir[0] * 10, p[1] + dir[1] * 10];
  nearV(applyPose(poses.get('C'), [30, 5, 0]), [p[0], 5, p[1]], 1e-9);
});

test('circular band preserves free length and is tangent at both ends', () => {
  const L = 5, th = rad(90);
  const frame = { o: [10, 0, 0], u: [0, -1, 0], v: [1, 0, 0], lengthMm: L };
  // Sample the neutral surface by composing many small bends: arc length must equal L.
  const R = L / th;
  const F = bandPose(frame, th);
  const edgeB = applyPose(F, [10 + L, 5, 0]);              // B's own edge point (flat v-distance L)
  // In-frame: y = R sinθ, z = R(1 − cosθ)
  nearV(edgeB, [10 + R * Math.sin(th), 5, R * (1 - Math.cos(th))], 1e-9);
  near(Math.hypot(R * Math.sin(th), R * (1 - Math.cos(th))), bandChord(L, th), 1e-9);
  // Tangency: B's in-plane direction (v) is rotated by exactly θ.
  const d = applyPose(F, [10 + L + 1, 5, 0]).map((x, i) => x - edgeB[i]);
  nearV(d, [Math.cos(th), 0, Math.sin(th)], 1e-9);
  // F maps B's side only; at θ = 0 it is the identity, so A–band–B stays flat.
  nearV(applyPose(bandPose(frame, 0), [10 + L, 5, 0]), [10 + L, 5, 0], 1e-12);
});

test('straight-band limit is stable near zero angle', () => {
  const frame = { o: [0, 0, 0], u: [0, 1, 0], v: [-1, 0, 0].map(x => -x), lengthMm: 3 };
  const p = [3 + 2, 1, 0];
  const at0 = applyPose(bandPose(frame, 0), p);
  nearV(at0, p, 1e-12);
  for (const th of [1e-12, 1e-8, 1e-5, 1e-3]) {
    const q = applyPose(bandPose(frame, th), p);
    assert.ok(q.every(Number.isFinite));
    assert.ok(dist(q, p) < 5 * th + 1e-9, `jump at θ=${th}`);
  }
});

// ── a degree-4 vertex with four 90° sectors: one-DOF closed mechanism ──────────────
function vertex4() {
  const o = [10, 10];
  const P = [[20, 10], [10, 20], [0, 10], [10, 0]];
  const corner = [[20, 20], [0, 20], [0, 0], [20, 0]];
  const regions = P.map((p, k) => ({ id: `P${k}`, polygon: [o, p, corner[k], P[(k + 1) % 4]] }));
  const connections = P.map((p, k) => ({
    // ray k separates panel k-1 and panel k
    id: `h${k}`, type: 'idealHinge', a: `P${(k + 3) % 4}`, b: `P${k}`, edge: { p0: o, p1: p },
  }));
  return { units: 'mm', anchor: 'P0', regions, connections };
}

test('coupled degree-4 vertex: closure holds when one crease is driven', () => {
  const c = compileAssembly(vertex4());
  assert.ok(c.ok, JSON.stringify(c.issues));
  assert.equal(c.closureConnIds.length, 1);                  // 4 hinges, 3 in the tree
  const r = solveConfiguration(c, {
    initial: [0.4, -0.4, 0.4, -0.4],
    constraints: [{ type: 'drive', connId: 'h1', valueRad: rad(70) }],
  });
  assert.equal(r.status, 'converged', JSON.stringify(r));
  assert.ok(r.maxClosureErrorMm < 0.01);
  near(deg(r.angles[1]), 70, 0.1);
  // Rigid-origami symmetry of an all-90° vertex: opposite creases share |angle|.
  near(Math.abs(r.angles[0]), Math.abs(r.angles[2]), 1e-3);
  near(Math.abs(r.angles[1]), Math.abs(r.angles[3]), 1e-3);
});

test('conflicting targets are reported, never satisfied by tearing the paper', () => {
  const c = compileAssembly(vertex4());
  const r = solveConfiguration(c, {
    initial: [0.4, -0.4, 0.4, -0.4],
    constraints: [
      { type: 'drive', connId: 'h1', valueRad: rad(70) },
      { type: 'drive', connId: 'h3', valueRad: rad(-20) },     // opposite creases must match
    ],
  });
  assert.equal(r.status, 'incompatibleTargets');
  assert.ok(r.geometryValid, 'structure must stay closed');
  assert.ok(r.maxClosureErrorMm < 0.01);
  assert.ok(r.maxDrivenAngleErrorDeg > 1);
  assert.ok(r.worstResiduals.length > 0);
});

test('point target solves a coupled mechanism', () => {
  const c = compileAssembly(twoPanel());
  const r = solveConfiguration(c, { initial: [0.1], constraints: [{ type: 'point', regionId: 'B', local: [20, 5], target: [10, 5, 10] }] });
  assert.equal(r.status, 'converged');
  near(deg(r.angles[0]), 90, 0.1);
});

test('unanchored regions and stale references are diagnosed', () => {
  const asm = twoPanel();
  asm.regions.push({ id: 'Z', polygon: sq(50, 50, 60, 60) });
  const c = compileAssembly(asm);
  assert.ok(!c.ok);
  assert.ok(c.issues.some(i => i.code === 'unanchoredComponent'));
  const r = solveConfiguration(c, {});
  assert.equal(r.status, 'invalidTopology');
  const ok = compileAssembly(twoPanel());
  assert.equal(solveConfiguration(ok, { constraints: [{ type: 'drive', connId: 'nope', valueRad: 0 }] }).status, 'staleReferences');
});

test('continuation reaches the target in validated samples', () => {
  const c = compileAssembly(vertex4());
  const res = solveStepContinuation(c, [0, 0, 0, 0], { controls: [{ connIds: ['h1'], mode: 'drive', toRad: rad(80) }], easing: 'smoothstep' },
    { branchHint: { h0: 0.05, h1: -0.05, h2: 0.05, h3: -0.05 } });
  assert.equal(res.completed, true, JSON.stringify(res.failure));
  assert.ok(res.samples.length > 3);
  const last = res.samples.at(-1);
  near(deg(last.angles[1]), 80, 0.1);
  assert.ok(res.samples.every(s => s.validated));
});

test('continuation stops with diagnostics when targets conflict', () => {
  const c = compileAssembly(vertex4());
  const res = solveStepContinuation(c, [0.4, -0.4, 0.4, -0.4], {
    controls: [{ connIds: ['h1'], mode: 'drive', toRad: rad(70) }, { connIds: ['h3'], mode: 'drive', toRad: rad(-10) }],
  });
  assert.equal(res.completed, false);
  assert.ok(res.failure.message.length > 0);
  assert.ok(res.reachedProgress < 1);
});

test('"hold" captures the value at step start and is not silently updated', () => {
  const c = compileAssembly(twoPanel());
  const res = solveStepContinuation(c, [rad(30)], { controls: [{ connIds: ['h'], mode: 'hold' }] });
  assert.equal(res.completed, true);
  near(res.samples.at(-1).angles[0], rad(30), 1e-6);
});
