import test, { before } from 'node:test';
import assert from 'node:assert/strict';
import { POLYHEDRA } from '@hyphi/polyhedra';
import { loadKernel } from '../../src/facetfold/lib/kernel.js';
import { buildNet } from '../../src/facetfold/lib/net.js';
import { buildPlate } from '../../src/facetfold/lib/solid.js';
import { verifyNet } from '../../src/facetfold/lib/verify.js';
import { pieceSTL, hingeStrains, classifyStrain, minHingeWidthMm, buildReport } from '../../src/facetfold/lib/export.js';
import { parseSTL } from '@hyphi/folding/export';

let K; before(async () => { K = await loadKernel(); });
const near = (a, b, e = 1e-6, m) => assert.ok(Math.abs(a - b) <= e, m || `${a} !≈ ${b}`);

test('strain: (t/2)·φ/w, and the default 0.2×0.8 mm hinge at 90° is flagged as far too strained for repeated flexing', () => {
  const net = buildNet(POLYHEDRA.cube.build(), { edgeLengthMm: 40, hingeThicknessMm: 0.2, hingeWidthMm: 0.8 });
  const s = hingeStrains(net)[0];
  near(s.strain, 0.1 * (Math.PI / 2) / 0.8, 1e-9);
  assert.equal(s.band, 'likely-cracks');
  assert.equal(classifyStrain(0.01), 'elastic'); assert.equal(classifyStrain(0.04), 'yields-once');
});

test('the suggested minimum hinge width really brings the worst hinge to the yield band', () => {
  const base = buildNet(POLYHEDRA.cube.build(), { edgeLengthMm: 40, hingeThicknessMm: 0.2, hingeWidthMm: 0.8 });
  const w = minHingeWidthMm(base);
  const fixed = buildNet(POLYHEDRA.cube.build(), { edgeLengthMm: 40, hingeThicknessMm: 0.2, hingeWidthMm: w });
  assert.ok(hingeStrains(fixed).every(s => s.strain <= 0.06 + 1e-9));
});

test('STL round-trip is in millimetres and watertight', () => {
  const net = buildNet(POLYHEDRA.cube.build(), { edgeLengthMm: 40, panelThicknessMm: 2 });
  const r = buildPlate(K, net, { snap: { enabled: false } });
  const stl = pieceSTL(r.components[0], 'cube');
  assert.equal(stl.units, 'mm'); assert.equal(stl.printReady, false); assert.ok(stl.stats.manifold, JSON.stringify(stl.stats));
  const tris = parseSTL(stl.bytes); assert.equal(tris.length, stl.stats.triangles);
  const zs = tris.flat().map(p => p[2]); near(Math.min(...zs), 0, 1e-4); near(Math.max(...zs), 2, 1e-3);
});

test('report: verification, strain, fit and a bed-size error when the net is too big', () => {
  const net = buildNet(POLYHEDRA.dodeca.build(), { edgeLengthMm: 50, panelThicknessMm: 2.4 });
  const ver = verifyNet(net); const plate = buildPlate(K, net, {});
  const small = buildReport(net, ver, plate, { bedMm: [100, 100] });
  assert.ok(small.issues.some(i => i.code === 'bedFit'));
  const big = buildReport(net, ver, plate, { bedMm: [400, 400] });
  assert.ok(!big.issues.some(i => i.code === 'bedFit'));
  assert.equal(big.verification.ok, true); assert.ok(big.verification.maxSeamGapMm < 1e-6);
  assert.equal(big.counts.faces, 12); assert.equal(big.counts.hinges, 11); assert.equal(big.counts.seams, 19);
  assert.match(big.disclaimer, /Print a test piece/);
});

test('the DEFAULT hinge is in the yield band for a cube (not cracking), so a fresh design does not start with a warning', async () => {
  const { DEFAULT_PARAMS } = await import('../../src/facetfold/lib/net.js');
  const net = buildNet(POLYHEDRA.cube.build(), {});
  const worst = Math.max(...hingeStrains(net).map(s => s.strain));
  assert.ok(worst <= 0.06, `default strain ${worst}`);
  assert.equal(DEFAULT_PARAMS.hingeThicknessMm, 0.1);
});
