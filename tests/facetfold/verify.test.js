import test from 'node:test';
import assert from 'node:assert/strict';
import { POLYHEDRA, EXTRA_POLYHEDRA } from '@hyphi/polyhedra';
import { buildNet } from '../../src/facetfold/lib/net.js';
import { panelProfile, offsetPolygon } from '../../src/facetfold/lib/panel.js';
import { verifyNet } from '../../src/facetfold/lib/verify.js';

const near = (a, b, e = 1e-6, m) => assert.ok(Math.abs(a - b) <= e, m || `${a} !≈ ${b}`);

test('offsetPolygon moves every edge inward and rejects collapse', () => {
  const sq = [[0, 0], [10, 0], [10, 10], [0, 10]];
  const r = offsetPolygon(sq, [1, 1, 1, 1]); assert.deepEqual(r.map(p => p.map(x => +x.toFixed(9))), [[1, 1], [9, 1], [9, 9], [1, 9]]);
  assert.equal(offsetPolygon(sq, [6, 6, 6, 6]), null);
});

test('panel profile: hinge walls lean inward, mitre at the top is t·tan(φ/2)', () => {
  const net = buildNet(POLYHEDRA.cube.build(), { edgeLengthMm: 30, panelThicknessMm: 1.6, hingeWidthMm: 0.8 });
  const prof = panelProfile(net, net.faces[0]);
  assert.ok(prof.valid, JSON.stringify(prof.issues));
  const hinge = prof.edges.find(e => e.kind === 'hinge');
  near(hinge.topOffMm, 1.6 * Math.tan(Math.PI / 4), 1e-9);
  assert.ok(hinge.runMm > 0 && !hinge.overhang);
  assert.ok(prof.top.every((p, i) => p.length === 2));
});

test('thin walls on a big fold angle are flagged as overhangs, not silently produced', () => {
  const net = buildNet(POLYHEDRA.tetra.build(), { edgeLengthMm: 30, panelThicknessMm: 0.3, hingeWidthMm: 1.2 });
  const issues = net.faces.flatMap(f => panelProfile(net, f).issues);
  assert.ok(issues.some(i => i.code === 'overhang'), 'expected an overhang warning');
});

// The central claim: folding the printed net puts every panel exactly on the ideal solid.
for (const [id, p] of Object.entries({ cube: POLYHEDRA.cube, octa: POLYHEDRA.octa, icosa: POLYHEDRA.icosa, dodeca: POLYHEDRA.dodeca, tetra: POLYHEDRA.tetra,
  cubocta: EXTRA_POLYHEDRA.cubocta, hprism: EXTRA_POLYHEDRA.hprism, pbipyramid: EXTRA_POLYHEDRA.pbipyramid })) {
  test(`fold verification (engine): ${id} closes onto the ideal polyhedron`, () => {
    const net = buildNet(p.build(), { edgeLengthMm: 40, panelThicknessMm: 1.6, hingeWidthMm: 0.8 });
    const r = verifyNet(net);
    assert.ok(r.maxFaceErrorMm < 1e-6, `${id}: panels off by ${r.maxFaceErrorMm}`);
    assert.ok(r.maxSeamGapMm < 1e-6, `${id}: seams off by ${r.maxSeamGapMm}`);
    assert.equal(r.collisions.length, 0, `${id}: closed-state collisions ${JSON.stringify(r.collisions)}`);
  });
}

test('the verifier really measures: perturbing a hinge trim opens the seams', () => {
  const net = buildNet(POLYHEDRA.cube.build(), { edgeLengthMm: 40, hingeWidthMm: 0.8 });
  net.hinges.forEach(h => { h.trimMm += 0.3; });               // sabotage the spacing that makes seams close
  // rebuild the assembly from the sabotaged net: the engine fold must now disagree with the ideal solid
  const r = verifyNet(net, { checkClosingPath: false });
  assert.ok(r.maxFaceErrorMm > 0.05 || r.maxSeamGapMm > 0.05, `expected a visible error, got ${r.maxFaceErrorMm}/${r.maxSeamGapMm}`);
});
