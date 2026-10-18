import test from 'node:test';
import assert from 'node:assert/strict';
import {
  compileAssembly, evaluatePoses, solveConfiguration, rad, deg, applyPose,
} from '../src/index.js';
import { triangulatePolygon } from '../src/collision/mesh.js';
import { triTriClosest } from '../src/collision/narrowphase.js';
import {
  checkCollisions, checkPath, sectionSegments, chainSegments, envelope, radialExtents, measureFeatures, checkObstacles,
} from '../src/collision/validation.js';
import { expandHingeWidths } from '../src/hinges.js';

const near = (a, b, e = 1e-6, m) => assert.ok(Math.abs(a - b) <= e, m || `${a} !≈ ${b}`);
const sq = (x0, y0, x1, y1) => [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];

test('ear clipping covers a concave polygon exactly', () => {
  const L = [[0, 0], [10, 0], [10, 4], [4, 4], [4, 10], [0, 10]];                // L-shape, area 64
  const tris = triangulatePolygon(L);
  const a = tris.reduce((s, [i, j, k]) => s + Math.abs((L[j][0] - L[i][0]) * (L[k][1] - L[i][1]) - (L[k][0] - L[i][0]) * (L[j][1] - L[i][1])) / 2, 0);
  near(a, 64, 1e-9); assert.equal(tris.length, 4);
});

test('triangle distance: separated, touching and crossing are distinguished', () => {
  const T = [[0, 0, 0], [4, 0, 0], [0, 4, 0]];
  near(triTriClosest(T, T.map(p => [p[0], p[1], p[2] + 3])).dist, 3, 1e-9);
  const touch = triTriClosest(T, [[0, 0, 0], [-4, 0, 0], [0, -4, 0]]);
  assert.equal(touch.crossing, false); near(touch.dist, 0, 1e-9);
  const cross = triTriClosest(T, [[1, 1, -2], [1, 1, 2], [3, 1, 0]]);
  assert.equal(cross.crossing, true);
});

// A centre panel with two side flaps hinged on its left/right edges.
function flaps({ thickness = 0 } = {}) {
  return {
    units: 'mm', anchor: 'A',
    regions: [
      { id: 'A', polygon: sq(0, 0, 10, 10), thicknessMm: thickness },
      { id: 'B', polygon: sq(10, 0, 30, 10), thicknessMm: thickness },
      { id: 'D', polygon: sq(-3, 0, 0, 10), thicknessMm: thickness },
      { id: 'C', polygon: sq(-8, 0, -3, 10), thicknessMm: thickness },
    ],
    connections: [
      { id: 'hb', type: 'idealHinge', a: 'A', b: 'B', edge: { p0: [10, 0], p1: [10, 10] } },
      { id: 'hd', type: 'idealHinge', a: 'A', b: 'D', edge: { p0: [0, 0], p1: [0, 10] } },
      { id: 'hc', type: 'idealHinge', a: 'D', b: 'C', edge: { p0: [-3, 0], p1: [-3, 10] } },
    ],
  };
}
const ang = (b, d, c) => [rad(b), rad(d), rad(c)];

test('flat sheet and a fold that clears everything are collision free', () => {
  const c = compileAssembly(flaps());
  assert.equal(checkCollisions(c, evaluatePoses(c, ang(0, 0, 0))).collisions.length, 0);
  assert.equal(checkCollisions(c, evaluatePoses(c, ang(90, 0, 0))).collisions.length, 0);
});

test('a flap swinging through a wall is a collision; adjacency alone is not', () => {
  const c = compileAssembly(flaps());
  // B (20 long) at 170° sweeps over A and hits the 5 mm wall C (hc = 90°, D flat).
  const r = checkCollisions(c, evaluatePoses(c, ang(170, 0, 90)));
  assert.equal(r.collisionStatus, 'collisionDetected');
  assert.ok(r.collisions.some(h => h.regions.includes('B') && h.regions.includes('C')), JSON.stringify(r.collisions));
  // Hinged neighbours at 90° are touching along their hinge only: not a collision.
  assert.equal(checkCollisions(c, evaluatePoses(c, ang(0, 90, 0))).collisions.length, 0);
});

test('swept check finds a collision between two collision-free endpoint samples', () => {
  const c = compileAssembly(flaps());
  // Endpoint 0 flat; endpoint 2 has B folded fully back onto A (coplanar) while the wall stands.
  const start = ang(0, 0, 90), end = ang(180, 0, 90);
  assert.equal(checkCollisions(c, evaluatePoses(c, start)).collisions.length, 0);
  assert.equal(checkCollisions(c, evaluatePoses(c, end)).collisions.length, 0, 'endpoint state is free');
  const path = checkPath(c, [start, end], { maxStepMm: 2 });
  assert.equal(path.collisionFree, false);
  assert.equal(path.method.kind, 'adaptive-interpolation');
  assert.ok(path.firstCollision.progress > 0 && path.firstCollision.progress < 1);
  // Coarse sampling with refinement disabled misses it — which is why the method is reported.
  const coarse = checkPath(c, [start, end], { maxStepMm: 1e9 });
  assert.equal(coarse.collisionFree, true);
});

test('thickness-aware mode flags layers closer than the material allows, but not at the hinge', () => {
  const c = compileAssembly(flaps({ thickness: 0.3 }));
  const flat = evaluatePoses(c, ang(0, 0, 0));
  assert.equal(checkCollisions(c, flat, { thicknessAware: true }).collisions.length, 0);   // hinge neighbours excluded near the hinge
  // B folded flat onto A (180°) puts two 0.3 mm layers at the same height: they cannot both fit.
  const folded = evaluatePoses(c, ang(180, 0, 0));
  const r = checkCollisions(c, folded, { thicknessAware: true });
  assert.ok(r.collisions.some(h => h.regions.join() === 'A,B'), JSON.stringify(r.collisions));
  assert.equal(r.method.mode, 'thicknessAware');
});

test('sections, envelope, radial extents and feature measurement', () => {
  const c = compileAssembly(flaps());
  const poses = evaluatePoses(c, ang(90, 0, 0));
  const env = envelope(c, poses);
  near(env.size[0], 8 + 10 + 0 + 0 + 0, 1e-9, `${env.size}`);       // x: -8..10 (B stands up at x=10)
  near(env.size[2], 20, 1e-9);                                         // z: B rises 20
  const segs = sectionSegments(c, poses, { origin: [0, 5, 0], normal: [0, 1, 0] });
  const chains = chainSegments(segs);
  assert.ok(chains.length >= 2);
  const lenB = chains.filter(ch => ch.region === 'B').reduce((s, ch) => s + Math.hypot(...ch.points.at(-1).map((v, i) => v - ch.points[0][i])), 0);
  near(lenB, 20, 1e-9);
  const rad_ = radialExtents(c, poses, [0, 5, 0], [0, 1, 0]);
  near(rad_.maxRadiusMm, Math.hypot(10, 20) , 1e-9);
  const m = measureFeatures(c, poses, { region: 'B', local: [30, 5] }, { region: 'A', local: [0, 5] });
  near(m.distanceMm, Math.hypot(10, 20), 1e-9);
});

test('imported obstacles require units, honour placement, and report clearance', () => {
  const c = compileAssembly(flaps());
  const poses = evaluatePoses(c, ang(0, 0, 0));
  const slab = [[[0, 0, 0], [1, 0, 0], [0, 1, 0]], [[1, 0, 0], [1, 1, 0], [0, 1, 0]]];       // 1 unit square in z=0
  assert.throws(() => checkObstacles(c, poses, [{ id: 'bad', triangles: slab }]));
  // 10 mm box face (given in cm) 2 mm above the sheet, via placement.
  const ob = { id: 'housing', units: 'cm', triangles: slab, placement: { R: [1, 0, 0, 0, 1, 0, 0, 0, 1], t: [2, 2, 2] } };
  const r = checkObstacles(c, poses, [ob], { clearanceMm: 1 });
  near(r.obstacles[0].minDistanceMm, 2, 1e-9); assert.equal(r.obstacles[0].violates, false);
  assert.equal(checkObstacles(c, poses, [ob], { clearanceMm: 3 }).obstacles[0].violates, true);
});

test('finite-width hinge: band replaces ideal crease, panels are trimmed, 90° pose is physical', () => {
  const asm = { units: 'mm', anchor: 'A', regions: [{ id: 'A', polygon: sq(0, 0, 10, 10) }, { id: 'B', polygon: sq(10, 0, 20, 10) }],
    connections: [{ id: 'h', type: 'idealHinge', a: 'A', b: 'B', edge: { p0: [10, 0], p1: [10, 10] }, widthMm: 2 }] };
  const { assembly, issues } = expandHingeWidths(asm, { hingeThicknessMm: 0.1 });
  assert.equal(issues.length, 0);
  assert.equal(assembly.connections[0].type, 'circularBand'); near(assembly.connections[0].lengthMm, 2);
  const xs = a => a.polygon.map(p => p[0]);
  near(Math.max(...xs(assembly.regions[0])), 9); near(Math.min(...xs(assembly.regions[1])), 11);   // trimmed back by w/2
  const c = compileAssembly(assembly); assert.ok(c.ok, JSON.stringify(c.issues));
  const P = evaluatePoses(c, [rad(90)]).get('B');
  const edge = applyPose(P, [11, 5, 0]);                    // B's trimmed edge
  const R = 2 / rad(90);
  near(edge[0], 9 + R * Math.sin(rad(90)), 1e-9); near(edge[2], R * (1 - Math.cos(rad(90))), 1e-9);
});

test('crossing hinge strips are reported as junctions, never silently thickened', () => {
  const o = [10, 10], P = [[20, 10], [10, 20], [0, 10], [10, 0]], C = [[20, 20], [0, 20], [0, 0], [20, 0]];
  const asm = { units: 'mm', anchor: 'P0',
    regions: P.map((p, k) => ({ id: `P${k}`, polygon: [o, p, C[k], P[(k + 1) % 4]] })),
    connections: P.map((p, k) => ({ id: `h${k}`, type: 'idealHinge', a: `P${(k + 3) % 4}`, b: `P${k}`, edge: { p0: o, p1: p }, widthMm: 1 })) };
  const { issues } = expandHingeWidths(asm);
  assert.ok(issues.some(i => i.code === 'hingeJunction'), JSON.stringify(issues));
});
