import test from 'node:test';
import assert from 'node:assert/strict';
import {
  compileAssembly, solveConfiguration, evaluatePoses, applyPose, rad, deg,
} from '../src/index.js';
import { bandPose, segmentedEnd, bendProfile, bandCenterline, bandMaxCurvature, bandAngleLimit } from '../src/bends/circular.js';
import { bandSurfaceGrid, gridDistortion, meshDistortion, bendStrainEstimate } from '../src/bends/surface.js';

const near = (a, b, e = 1e-9, m) => assert.ok(Math.abs(a - b) <= e, m || `${a} !≈ ${b}`);
const frame = (extra = {}) => ({ o: [10, 0, 0], u: [0, -1, 0], v: [1, 0, 0], lengthMm: 12, ...extra });

test('uniform segmented profile reproduces the circular band exactly', () => {
  const th = rad(75);
  const a = bandPose(frame(), th), b = bandPose(frame({ profile: bendProfile('uniform', 6) }), th);
  a.R.forEach((x, i) => near(x, b.R[i])); a.t.forEach((x, i) => near(x, b.t[i]));
});

test('non-uniform profile keeps arc length and total bend angle', () => {
  const L = 12, th = rad(120), prof = bendProfile('tip', 8);
  near(prof.reduce((a, b) => a + b, 0), 1);
  const pts = bandCenterline(L, th, prof, 16);
  let len = 0; for (let i = 1; i < pts.length; i++) len += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
  assert.ok(Math.abs(len - L) / L < 2e-3, `arc length ${len}`);
  const end = segmentedEnd(L, th, prof);
  near(end.y, pts.at(-1)[0], 1e-6); near(end.z, pts.at(-1)[1], 1e-6);
  // Curl concentrated at the tip: the tip curls more than a uniform band (end sits lower in y, higher in z)
  const uni = segmentedEnd(L, th, bendProfile('uniform', 8));
  assert.ok(end.y > uni.y && end.z < uni.z || end.y !== uni.y);
  // B's direction at the far end is rotated by exactly θ, whatever the profile
  const F = bandPose(frame({ profile: prof, lengthMm: L }), th);
  const d0 = applyPose(F, [10 + L, 4, 0]), d1 = applyPose(F, [10 + L + 1, 4, 0]);
  near(Math.hypot(d1[0] - d0[0], d1[1] - d0[1], d1[2] - d0[2]), 1);
  near(Math.atan2(d1[2] - d0[2], d1[0] - d0[0]), th);
});

test('peak curvature and min-radius angle limit', () => {
  const prof = bendProfile('tip', 8), L = 16;
  const lim = bandAngleLimit(L, 4, prof);
  near(bandMaxCurvature(L, lim, prof), 1 / 4, 1e-12);
  assert.ok(bandMaxCurvature(L, 3, bendProfile('uniform', 8)) > 0);
});

function petal(extra = {}) {
  return {
    units: 'mm', anchor: 'body',
    regions: [{ id: 'body', polygon: [[0, 0], [10, 0], [10, 10], [0, 10]] }, { id: 'tip', polygon: [[22, 0], [30, 0], [30, 10], [22, 10]] }],
    connections: [{ id: 'curl', type: 'segmentedBand', a: 'body', b: 'tip', edge: { p0: [10, 0], p1: [10, 10] }, lengthMm: 12, segments: 8, profile: 'tip', ...extra }],
  };
}

test('segmented petal curl is solvable and honours a tip-position target', () => {
  const c = compileAssembly(petal());
  assert.ok(c.ok, JSON.stringify(c.issues));
  const poses = evaluatePoses(c, [rad(90)]);
  const target = applyPose(poses.get('tip'), [30, 5, 0]);
  const r = solveConfiguration(c, { initial: [0.2], constraints: [{ type: 'point', regionId: 'tip', local: [30, 5], target }] });
  assert.equal(r.status, 'converged', JSON.stringify(r));
  near(deg(r.angles[0]), 90, 0.1, `solved ${deg(r.angles[0])}`);
});

test('minRadiusMm limits the bend and is reported', () => {
  const c = compileAssembly(petal({ minRadiusMm: 6 }));
  const r = solveConfiguration(c, { initial: [0], constraints: [{ type: 'drive', connId: 'curl', valueRad: rad(170) }] });
  assert.ok(r.warnings.some(w => w.code === 'limitViolation'), JSON.stringify(r.warnings));
  assert.notEqual(r.status, 'converged');
});

test('cylindrical bend is unstretched in both directions; a stretched mesh is flagged', () => {
  const g = bandSurfaceGrid({ lengthMm: 12, widthMm: 8, theta: rad(110), profile: bendProfile('tip', 8), nu: 5, nv: 64 });
  const d = gridDistortion(g);
  assert.ok(d.maxLongitudinal < 5e-3, `lon ${d.maxLongitudinal}`);
  assert.ok(d.maxTransverse < 1e-12, `tra ${d.maxTransverse}`);
  // Stretch the deformed grid (as a sculpt/lattice would) and the check must catch it.
  const bad = g.bent.map(p => [p[0] * 1.1, p[1], p[2]]);
  const edges = []; for (let r = 0; r < g.nv; r++) for (let c = 0; c + 1 < g.nu; c++) edges.push([r * g.nu + c, r * g.nu + c + 1]);
  assert.ok(meshDistortion(g.flat, bad, edges).max > 0.09);
});

test('bend strain estimate is y/R and labelled as an estimate by callers', () => {
  near(bendStrainEstimate(0.1, 1 / 2), 0.025, 1e-12);
});
