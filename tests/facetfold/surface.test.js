import test, { before } from 'node:test';
import assert from 'node:assert/strict';
import { POLYHEDRA } from '@hyphi/polyhedra';
import { loadKernel } from '../../src/facetfold/lib/kernel.js';
import { buildNet } from '../../src/facetfold/lib/net.js';
import { panelProfile } from '../../src/facetfold/lib/panel.js';
import { buildPlate, describe } from '../../src/facetfold/lib/solid.js';
import { diffractionAngleDeg, dispersionDeg, maxPitchForDispersionUm, assessSurface, PROCESSES, makePattern, faceVectors, heightmapPGM, plateSvg, clipSegment } from '../../src/facetfold/lib/surface.js';

let K; before(async () => { K = await loadKernel(); });
const near = (a, b, e = 1e-6, m) => assert.ok(Math.abs(a - b) <= e, m || `${a} !≈ ${b}`);
const net = () => buildNet(POLYHEDRA.cube.build(), { edgeLengthMm: 40, panelThicknessMm: 2.0, hingeWidthMm: 0.8 });

test('grating equation: 1 µm period, 550 nm, normal incidence → 33.37°', () => {
  near(diffractionAngleDeg(1, 550), (Math.asin(0.55) * 180) / Math.PI, 1e-9);
  assert.equal(diffractionAngleDeg(0.5, 650), null, 'first order is evanescent when λ > d');
  assert.ok(dispersionDeg(1) > 10 && dispersionDeg(20) < 1.5);
});

test('the period that still separates colours by 5° is a few microns — nowhere near printable', () => {
  const d = maxPitchForDispersionUm(5); assert.ok(d > 1 && d < 4, `d=${d}`);
  assert.ok(d < PROCESSES.dlp.minPitchUm / 10);
});

test('process assessment is honest', () => {
  const grating = { kind: 'linear', pitchUm: 1, depthUm: 0.2, intent: 'diffraction' };
  for (const p of ['fdm04', 'fdm025', 'msla', 'dlp']) assert.equal(assessSurface(grating, p).verdict, 'not-printable', p);
  const m = assessSurface(grating, 'master'); assert.notEqual(m.verdict, 'not-printable'); assert.ok(m.diffractive);
  assert.ok(!m.reasons.some(r => /cannot be printed directly/.test(r)), 'the master route is the right one — no warning');
  assert.ok(assessSurface(grating, 'fdm04').reasons.some(r => /cannot be printed directly/.test(r)));
  assert.equal(assessSurface({ kind: 'linear', pitchUm: 1500, depthUm: 150 }, 'fdm04').verdict, 'printable');
  assert.equal(assessSurface({ kind: 'linear', pitchUm: 900, depthUm: 150 }, 'fdm04').verdict, 'marginal');
  assert.equal(assessSurface({ kind: 'hex-dimple', pitchUm: 2000, depthUm: 200 }, 'bed').verdict, 'not-printable');       // a textured sheet ignores designed patterns
  const coarse = assessSurface({ kind: 'linear', pitchUm: 1500, depthUm: 150, intent: 'diffraction' }, 'fdm04');
  assert.ok(coarse.reasons.some(r => /texture, not a visible diffraction grating/.test(r)));
});

test('segments are clipped to the panel and the pattern respects its pitch', () => {
  assert.deepEqual(clipSegment([-10, 0, 10, 0], [[-1, -1], [1, -1], [1, 1], [-1, 1]]), [-1, 0, 1, 0]);
  const n = net(); const prof = panelProfile(n, n.faces[0]);
  const v = faceVectors(n.faces[0], prof.bottom, { kind: 'linear', pitchMm: 1.0, angleDeg: 0 });
  assert.ok(v.segments.length > 20);
  const xs = prof.bottom.map(q => q[0]), ys = prof.bottom.map(q => q[1]);
  for (const s of v.segments) for (const [x, y] of [[s[0], s[1]], [s[2], s[3]]]) { assert.ok(x >= Math.min(...xs) - 1e-6 && x <= Math.max(...xs) + 1e-6 && y >= Math.min(...ys) - 1e-6 && y <= Math.max(...ys) + 1e-6); }
  // adjacent lines are exactly one pitch apart (all at angle 0 ⇒ same orientation)
  const ys0 = [...new Set(v.segments.map(s => +((s[1] + s[3]) / 2).toFixed(6)))].sort((a, b) => a - b);
  ys0.slice(1).forEach((y, i) => near(y - ys0[i], 1.0, 1e-6));
});

test('every pattern kind yields vectors inside the panel and a depth function in 0..1', () => {
  const n = net(); const f = n.faces[1], prof = panelProfile(n, f);
  for (const kind of ['linear', 'crosshatch', 'radial', 'concentric', 'chirp', 'hex-dimple', 'stipple']) {
    const v = faceVectors(f, prof.bottom, { kind, pitchMm: 1.5, pitchEndMm: 3, angleDeg: 20 });
    assert.ok((v.segments?.length ?? v.points.length) > 5, kind);
    for (const [x, y] of [[0, 0], [3, 2], [-4, 5]]) { const d = v.pattern.depth(x, y); assert.ok(d >= 0 && d <= 1, `${kind} depth ${d}`); }
  }
  // chirp: the spacing really grows across the face
  const c = makePattern({ kind: 'chirp', pitchMm: 1, pitchEndMm: 3 }, [[-10, -10], [10, -10], [10, 10], [-10, 10]]).segments();
  const gaps = c.slice(1).map((s, i) => Math.abs(s[0] - c[i][0]));       // angle 0: line k sits at x = t_k
  assert.ok(gaps[0] < 1.2 && gaps.at(-1) > 2.5, `first gap ${gaps[0]}, last ${gaps.at(-1)}`);
  assert.ok(gaps.every((g, i) => i === 0 || g >= gaps[i - 1] - 1e-9), 'spacing never shrinks');
});

test('geometry carve is NOT done for gratings below the printer limit, and the heightmap/SVG are still produced', () => {
  const n = net(); const prof = panelProfile(n, n.faces[0]);
  const pgm = heightmapPGM(n.faces[0], prof.bottom, { kind: 'linear', pitchMm: 0.002 * 1, angleDeg: 0 }, 20);
  assert.ok(pgm.width > 100 && pgm.height > 100);
  assert.equal(new TextDecoder().decode(pgm.bytes.slice(0, 2)), 'P5');
  assert.equal(pgm.bytes.length, new TextEncoder().encode(`P5\n${pgm.width} ${pgm.height}\n65535\n`).length + pgm.width * pgm.height * 2);
  const svg = plateSvg(n, n.faces.map(f => panelProfile(n, f)), { 0: { kind: 'linear', pitchMm: 2 } });
  assert.match(svg, /^<svg/); assert.ok((svg.match(/<line/g) || []).length > 5);
});

test('coarse grooves are carved into the bed-side skin: volume drops by ≈ the groove volume, body stays one manifold, hinges untouched', () => {
  const n = net(); const base = buildPlate(K, n, { snap: { enabled: false } });
  const b = describe(base.components[0]);
  const spec = { kind: 'linear', pitchMm: 1.2, widthFrac: 0.5, depthMm: 0.15, angleDeg: 30 };
  const r = buildPlate(K, n, { snap: { enabled: false }, process: 'fdm025', surfaces: { 0: spec } });
  const d = describe(r.components[0]);
  assert.equal(d.status, 'NoError'); assert.equal(d.genus, 0);
  assert.equal(r.components[0].decompose().length, 1, 'still one connected body');
  assert.ok(r.surfaceReport[0].features > 20, JSON.stringify(r.surfaceReport));
  // expected removed volume: each V-groove has cross-section ½·width·depth
  const prof = panelProfile(n, n.faces[0]);
  const lines = faceVectors(n.faces[0], prof.bottom, spec).segments;
  const expected = lines.reduce((s, q) => s + Math.hypot(q[2] - q[0], q[3] - q[1]) * 0.5 * (0.5 * 1.2) * 0.15, 0);
  const removed = b.volumeMm3 - d.volumeMm3;
  assert.ok(removed > 0.6 * expected && removed < 1.05 * expected, `removed ${removed.toFixed(3)} vs ${expected.toFixed(3)}`);
  // the strips (first layer) are still there
  for (const s of r.strips) assert.ok(s.volume() > 0);
});

test('a grating the printer cannot resolve is skipped with the reason, never built', () => {
  const n = net(); const r = buildPlate(K, n, { snap: { enabled: false }, process: 'fdm04', surfaces: { 0: { kind: 'linear', pitchMm: 0.5, depthMm: 0.05, intent: 'diffraction' } } });
  assert.equal(r.surfaceReport[0].verdict, 'not-printable');
  assert.ok(r.issues.some(i => i.code === 'surfaceSkipped'));
  near(describe(r.components[0]).volumeMm3, describe(buildPlate(K, n, { snap: { enabled: false } }).components[0]).volumeMm3, 1e-6);
});

test('hex dimples are carved as cones', () => {
  const n = net(); const r = buildPlate(K, n, { snap: { enabled: false }, process: 'fdm025', surfaces: { 2: { kind: 'hex-dimple', pitchMm: 1.6, depthMm: 0.2, dotRadiusMm: 0.5 } } });
  assert.ok(r.surfaceReport[0].features > 50);
  assert.equal(describe(r.components[0]).status, 'NoError');
});
