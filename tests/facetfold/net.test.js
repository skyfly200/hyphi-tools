import test from 'node:test';
import assert from 'node:assert/strict';
import { POLYHEDRA, EXTRA_POLYHEDRA } from '@hyphi/polyhedra';
import { buildNet, analyzeEdges, hingeTrimMm, defaultHingeKeys, DEFAULT_PARAMS } from '../../src/facetfold/lib/net.js';

const near = (a, b, e = 1e-6, m) => assert.ok(Math.abs(a - b) <= e, m || `${a} !≈ ${b}`);
const area = p => Math.abs(p.reduce((s, q, i) => { const r = p[(i + 1) % p.length]; return s + q[0] * r[1] - r[0] * q[1]; }, 0)) / 2;
const signedArea = p => p.reduce((s, q, i) => { const r = p[(i + 1) % p.length]; return s + q[0] * r[1] - r[0] * q[1]; }, 0) / 2;

test('hinge trim: preserves the apex, reduces to w/2 as φ→0', () => {
  near(hingeTrimMm(0.8, 1e-12), 0.4, 1e-9);
  const phi = Math.PI / 2, w = 0.8, r = w / phi;
  near(hingeTrimMm(w, phi), r * Math.tan(phi / 2), 1e-12);
});

test('cube: 12 edges, every exterior fold is 90°, tree gives 5 hinges and 7 seams', () => {
  const net = buildNet(POLYHEDRA.cube.build(), { edgeLengthMm: 30 });
  assert.equal(net.edges.length, 12);
  net.edges.forEach(e => near(e.phi, Math.PI / 2, 1e-9));
  assert.equal(net.hinges.length, 5); assert.equal(net.seams.length, 7);
  assert.equal(net.faces.length, 6);
});

test('tetrahedron winding is normalised: exterior fold = π − dihedral = acos(−1/3)', () => {
  const net = buildNet(POLYHEDRA.tetra.build(), { edgeLengthMm: 30 });
  net.edges.forEach(e => { near(e.phi, Math.acos(-1 / 3), 1e-9); near(e.dihedral, Math.acos(1 / 3), 1e-9); });
});

test('top-view polygons are counter-clockwise with the true face area', () => {
  const net = buildNet(POLYHEDRA.cube.build(), { edgeLengthMm: 30 });
  for (const f of net.faces) { assert.ok(signedArea(f.outer) > 0, `face ${f.id} CCW`); near(area(f.outer), 900, 1e-6); }
});

test('adjacent hinged panels: the TRIMMED bottom edges are exactly w apart', () => {
  const P = { edgeLengthMm: 30, hingeWidthMm: 0.8 };
  const net = buildNet(POLYHEDRA.cube.build(), P, { optimizeRotation: false });
  for (const h of net.hinges) {
    const parent = net.faces[h.parent], child = net.faces[h.child];
    // shared edge as seen by each face: vertices (va,vb)
    const [va, vb] = h.key.split('-').map(Number);
    const pa = parent.outer[parent.vertIdx.indexOf(va)], pb = parent.outer[parent.vertIdx.indexOf(vb)];
    const ca = child.outer[child.vertIdx.indexOf(va)], cb = child.outer[child.vertIdx.indexOf(vb)];
    // distance between the two ideal edges (parallel lines) measured along the hinge normal
    const d = (ca[0] - pa[0]) * h.normal[0] + (ca[1] - pa[1]) * h.normal[1];   // signed, along parent→child
    near(d, P.hingeWidthMm - 2 * h.trimMm, 1e-9);                          // ideal-edge spread = w − 2a (negative for large φ)
    near(d + 2 * h.trimMm, P.hingeWidthMm, 1e-9);                          // trimmed edges: a on each side → exactly w apart
    // edges stay parallel and equal length
    near(Math.hypot(pb[0] - pa[0], pb[1] - pa[1]), Math.hypot(cb[0] - ca[0], cb[1] - ca[1]), 1e-9);
  }
});

test('every catalogue solid produces a connected default net that covers all faces', () => {
  for (const [id, p] of Object.entries({ ...POLYHEDRA, ...EXTRA_POLYHEDRA })) {
    const net = buildNet(p.build(), { edgeLengthMm: 25 });
    assert.equal(net.faces.length, p.build().faces.length, id);
    assert.equal(net.hinges.length, net.faces.length - 1, `${id}: spanning tree`);
    assert.equal(net.hinges.length + net.seams.length, net.edges.length, id);
    assert.equal(net.components.length, 1, id);
    assert.ok(net.plate.width > 0 && net.plate.height > 0);
  }
});

test('custom hinge sets: cycles are rejected; cutting a hinge makes two pieces laid side by side', () => {
  const cube = POLYHEDRA.cube.build();
  const keys = defaultHingeKeys(cube);
  const all = new Set(analyzeEdges(buildNet(cube).solid).map(e => e.key));
  assert.throws(() => buildNet(cube, {}, { hingeKeys: all }), /cycle/);
  const cut = new Set(keys); const removed = [...cut][0]; cut.delete(removed);
  const net = buildNet(cube, { edgeLengthMm: 30 }, { hingeKeys: cut });
  assert.equal(net.components.length, 2);
  assert.equal(net.hinges.length, 4);
  const [a, b] = net.components; assert.ok(b.bbox.x >= a.bbox.x + a.bbox.w, 'pieces do not overlap on the plate');
});

test('plate layout is tight: rotation optimisation never makes the box bigger', () => {
  const a = buildNet(POLYHEDRA.icosa.build(), { edgeLengthMm: 25 }, { optimizeRotation: false });
  const b = buildNet(POLYHEDRA.icosa.build(), { edgeLengthMm: 25 });
  assert.ok(b.plate.width * b.plate.height <= a.plate.width * a.plate.height + 1e-6);
});

test('DEFAULT_PARAMS are documented values', () => {
  assert.equal(DEFAULT_PARAMS.hingeThicknessMm, 0.2); assert.equal(DEFAULT_PARAMS.panelThicknessMm, 1.6);
});
