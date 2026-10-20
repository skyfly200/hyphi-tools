import test, { before } from 'node:test';
import assert from 'node:assert/strict';
import { POLYHEDRA } from '@hyphi/polyhedra';
import { resolveProfile, validateProfile } from '@hyphi/slicer';
import { loadKernel } from '../../src/facetfold/lib/kernel.js';
import { buildNet } from '../../src/facetfold/lib/net.js';
import { buildPlate, describe } from '../../src/facetfold/lib/solid.js';
import { verifyNet } from '../../src/facetfold/lib/verify.js';
import { hingePrintIssues, FLAT_SHEET_PRESET } from '../../src/facetfold/lib/printcheck.js';

let K; before(async () => { K = await loadKernel(); });

test('hinge vs nozzle: below one line it cannot print, under 1.5 lines it is flagged, thickness must hit the layer stack', () => {
  const pr = { lineWidthMm: 0.42, firstLayerHeightMm: 0.1, layerHeightMm: 0.2 };
  assert.ok(hingePrintIssues({ hingeWidthMm: 0.3, hingeThicknessMm: 0.1 }, pr).some(i => i.code === 'hingeNarrow' && i.level === 'error'));
  assert.ok(hingePrintIssues({ hingeWidthMm: 0.55, hingeThicknessMm: 0.1 }, pr).some(i => i.code === 'hingeThin'));
  assert.equal(hingePrintIssues({ hingeWidthMm: 0.75, hingeThicknessMm: 0.1 }, pr).length, 0);          // the proven lily numbers
  assert.ok(hingePrintIssues({ hingeWidthMm: 1.5, hingeThicknessMm: 0.1 }, { ...pr, firstLayerHeightMm: 0.2 }).some(i => i.code === 'hingeThickness'));
  assert.equal(hingePrintIssues({ hingeWidthMm: 1.5, hingeThicknessMm: 0.3 }, pr).length, 0);            // 0.1 + 0.2 is a layer boundary
});

test('flat-sheet preset: builds a clean single piece 0.3 mm tall, verifies in the solver, and its slicing profile is valid', () => {
  const P = FLAT_SHEET_PRESET, net = buildNet(POLYHEDRA.cube.build(), { edgeLengthMm: 40, ...P.params });
  const plate = buildPlate(K, net, { snap: P.snap });
  assert.equal(plate.components.length, 1);
  const d = describe(plate.components[0]); assert.equal(d.status, 'NoError'); assert.ok(Math.abs(d.size[2] - 0.3) < 1e-6);
  assert.equal(verifyNet(net, { checkClosingPath: false }).ok, true);
  assert.equal(plate.issues.filter(i => i.level !== 'info').length, 0, JSON.stringify(plate.issues.map(i => i.code)));  // small overhangs are within tolerance
  const prof = resolveProfile({ ...P.slicing, plate: P.plate });
  assert.equal(validateProfile(prof).filter(i => i.level === 'error' || i.level === 'warning').length, 0);
  assert.equal(hingePrintIssues(P.params, { lineWidthMm: prof.lineWidthMm, firstLayerHeightMm: prof.firstLayerHeightMm, layerHeightMm: prof.layerHeightMm }).length, 0);
});
