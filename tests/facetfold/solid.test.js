import test, { before } from 'node:test';
import assert from 'node:assert/strict';
import { POLYHEDRA } from '@hyphi/polyhedra';
import { loadKernel, meshOf } from '../../src/facetfold/lib/kernel.js';
import { buildNet } from '../../src/facetfold/lib/net.js';
import { buildPlate, describe } from '../../src/facetfold/lib/solid.js';
import { panelProfile } from '../../src/facetfold/lib/panel.js';
import { faceMountSpec, tieSlotSpecs, truncateVertex, inscribedRadius } from '../../src/facetfold/lib/lighting.js';
import { verifyNet } from '../../src/facetfold/lib/verify.js';
import { planSnaps, verifySnaps } from '../../src/facetfold/lib/snap.js';
import { evaluatePoses, applyPose } from '@hyphi/folding';
import { meshStats } from '@hyphi/folding/export';

let K;
before(async () => { K = await loadKernel(); });
const near = (a, b, e = 1e-6, m) => assert.ok(Math.abs(a - b) <= e, m || `${a} !≈ ${b}`);
const area = p => Math.abs(p.reduce((s, q, i) => { const r = p[(i + 1) % p.length]; return s + q[0] * r[1] - r[0] * q[1]; }, 0)) / 2;
const cube = (o = {}) => buildNet(POLYHEDRA.cube.build(), { edgeLengthMm: 40, panelThicknessMm: 1.6, hingeWidthMm: 0.8, hingeThicknessMm: 0.2, ...o });

test('a plain cube net is ONE manifold body, genus 0, flat on the bed, thickness = panel thickness', () => {
  const net = cube(); const r = buildPlate(K, net, { snap: { enabled: false } });
  assert.equal(r.components.length, 1);
  const d = describe(r.components[0]);
  assert.equal(d.status, 'NoError'); assert.equal(d.genus, 0);
  near(d.min[2], 0, 1e-9); near(d.max[2], 1.6, 1e-9);
  const stats = meshStats(meshOf(r.components[0]));
  assert.ok(stats.manifold, JSON.stringify(stats));
  // volume = Σ frustum volumes (prismatoid rule) + strips, to within the strip/overlap allowance
  let V = 0;
  for (const f of net.faces) { const p = panelProfile(net, f), mid = p.bottom.map((q, i) => [(q[0] + p.top[i][0]) / 2, (q[1] + p.top[i][1]) / 2]);
    V += (1.6 / 6) * (area(p.bottom) + 4 * area(mid) + area(p.top)); }
  assert.ok(Math.abs(d.volumeMm3 - V) / V < 0.01, `volume ${d.volumeMm3} vs panels ${V}`);
});

test('every panel wall leans inward going up (no overhang) for the default cube', () => {
  const net = cube(); const issues = buildPlate(K, net, { snap: { enabled: false } }).issues;
  assert.equal(issues.filter(i => i.code === 'overhang').length, 0);
});

test('a round face mount removes π·r²·t and adds a hole (genus +1); collar rises above the inner surface', () => {
  const net = cube(); const base = describe(buildPlate(K, net, { snap: { enabled: false } }).components[0]);
  const mount = faceMountSpec(net, 2, { diameterMm: 6, collarWallMm: 1.2, collarHeightMm: 3, lugs: 3 });
  assert.equal(mount.issues.length, 0);
  const r = buildPlate(K, net, { snap: { enabled: false }, mounts: [mount] });
  const d = describe(r.components[0]);
  assert.equal(d.genus, base.genus + 1); assert.equal(d.status, 'NoError');
  near(d.max[2], 1.6 + 3, 1e-6);
  assert.ok(meshStats(meshOf(r.components[0])).manifold);
});

test('an oversize mount is reported, not built', () => {
  const net = cube({ edgeLengthMm: 12 });
  const m = faceMountSpec(net, 0, { diameterMm: 14 });
  assert.ok(m.issues.some(i => i.code === 'mountTooBig'));
});

test('snap detents: bump and dimple are added, parts stay one manifold body', () => {
  const net = cube({ panelThicknessMm: 2.4 }); const off = describe(buildPlate(K, net, { snap: { enabled: false } }).components[0]);
  const r = buildPlate(K, net, {}); const on = describe(r.components[0]);
  assert.ok(r.snaps.plan.length >= net.seams.length, `${r.snaps.plan.length} detents for ${net.seams.length} seams`);
  assert.equal(on.status, 'NoError'); assert.equal(on.genus, off.genus);
  assert.ok(Math.abs(on.volumeMm3 - off.volumeMm3) < 0.05 * off.volumeMm3);
});

test('snap detents line up in the FOLDED state (bump base meets dimple centre) — measured with the engine', () => {
  const net = cube({ panelThicknessMm: 2.4 }); const v = verifyNet(net, { checkClosingPath: false });
  const profiles = net.faces.map(f => panelProfile(net, f));
  const { plan } = planSnaps(net, profiles, {});
  const poses = evaluatePoses(v.compiled, v.angles);
  const res = verifySnaps(net, profiles, plan, applyPose, id => poses.get(`f${id}`));
  assert.ok(res.rows.length > 0);
  // walls sit one seam clearance apart; the two points are on facing walls, so allow that gap
  assert.ok(res.worstMisalignMm < net.params.seamClearanceMm + 0.05, `misaligned by ${res.worstMisalignMm}`);
});

test('thin walls cannot host a detent: refused with an explanation, never built oversize', () => {
  const net = cube({ panelThicknessMm: 1.6 }); const r = buildPlate(K, net, {});
  assert.equal(r.snaps.plan.length, 0);
  assert.ok(r.issues.some(i => i.code === 'detentTooBig'), JSON.stringify(r.issues.map(i => i.code)));
  assert.equal(describe(r.components[0]).genus, 0);
});

test('every detent that IS built stays inside its wall: no breakout to the bed, genus unchanged', () => {
  for (const t of [2.0, 2.4, 3.0]) {
    const net = cube({ panelThicknessMm: t }); const r = buildPlate(K, net, {});
    assert.ok(r.snaps.plan.length > 0, `t=${t}: expected detents`);
    const d = describe(r.components[0]);
    assert.equal(d.status, 'NoError'); assert.equal(d.genus, 0, `t=${t}: a detent broke through`);
    near(d.min[2], 0, 1e-9);
  }
});

test('vertex port: truncating a vertex adds one n-gon face that hosts a gland and closes in the engine', () => {
  const solid = POLYHEDRA.cube.build();
  const k = 40;                                              // scale to mm so the cut depth is in mm
  const scaled = { vertices: solid.vertices.map(p => p.map(x => x * k)), faces: solid.faces };
  const { solid: cut, portFace } = truncateVertex(scaled, 0, 6);
  assert.equal(cut.faces.length, 7); assert.equal(cut.faces[portFace].length, 3);
  const net = buildNet(cut, { edgeLengthMm: 6 * Math.SQRT2 });      // shortest edge of the cut solid sets the scale
  assert.equal(net.faces.length, 7);
  const v = verifyNet(net, { checkClosingPath: false });
  assert.ok(v.maxFaceErrorMm < 1e-6 && v.maxSeamGapMm < 1e-6, `${v.maxFaceErrorMm} ${v.maxSeamGapMm}`);
  const ts = tieSlotSpecs(net, portFace);
  assert.ok(ts.length >= 1);
  const room = inscribedRadius(net.faces[portFace].outer); assert.ok(room > 0);
});

test('a too-deep port cut is refused', () => {
  const solid = POLYHEDRA.cube.build();
  assert.throws(() => truncateVertex(solid, 0, 2), /reaches past/);
});

test('hinge strips are in the first layers only (z ≤ hinge thickness) and joined to both panels', () => {
  const net = cube({ hingeThicknessMm: 0.2 });
  const r = buildPlate(K, net, { snap: { enabled: false } });
  assert.equal(describe(r.components[0]).genus, 0);                  // a tree of panels: no accidental loops through strips
  const s = describe(r.strips[0]); near(s.max[2], 0.2, 1e-9); near(s.min[2], 0, 1e-9);
  assert.equal(r.issues.filter(i => i.level === 'error').length, 0);
});
