import test, { before } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { POLYHEDRA } from '@hyphi/polyhedra';
import { loadKernel } from '../../src/facetfold/lib/kernel.js';
import { buildNet } from '../../src/facetfold/lib/net.js';
import { buildPlate, facePieces, splitByColor, artDiagnostics } from '../../src/facetfold/lib/solid.js';
import { panelProfile } from '../../src/facetfold/lib/panel.js';
import { assignColors, DEFAULT_PALETTE } from '../../src/facetfold/lib/colors.js';
import { parseSvg, textShapes, loadFont, resolveLayer } from '../../src/facetfold/lib/art.js';
import { faceMountSpec } from '../../src/facetfold/lib/lighting.js';
import { export3MF } from '../../src/facetfold/lib/export.js';

let K, font;
before(async () => { K = await loadKernel(); const b = readFileSync(new URL('../../node_modules/@fontsource/open-sans/files/open-sans-latin-700-normal.woff', import.meta.url)); font = loadFont(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength)); });
const net = (o = {}) => buildNet(POLYHEDRA.cube.build(), { edgeLengthMm: 60, panelThicknessMm: 2.4, ...o });
const near = (a, b, e = 1e-6, m) => assert.ok(Math.abs(a - b) <= e, m || `${a} !≈ ${b}`);
const textLayer = (n, face, over = {}) => ({ groups: resolveLayer(textShapes(font, 'HI', { sizeMm: 12 }).shapes, n.faces[face], { placement: {}, defaultSlot: 1 }), depthMm: 0.6, side: 'outer', ...over });

test('text inlay: art volume = shape area × depth, remainder + art = the panel, all disjoint and manifold', () => {
  const n = net(), plate = buildPlate(K, n, { snap: { enabled: false } });
  const panel = plate.panels.get(0), L = textLayer(n, 0);
  const pieces = facePieces(K, panel, 0, [L], 2.4);
  assert.equal(pieces.length, 2);
  const [base, art] = pieces;
  assert.equal(base.color, 0); assert.equal(art.color, 1);
  const { CrossSection } = K; const area = new CrossSection(L.groups[0].polygons, 'NonZero').area();
  near(art.manifold.volume(), area * 0.6, 0.01 * area * 0.6 + 1e-6, `art ${art.manifold.volume()} vs ${area * 0.6}`);
  near(base.manifold.volume() + art.manifold.volume(), panel.volume(), 1e-6);
  assert.ok(base.manifold.intersect(art.manifold).volume() < 1e-6);
  for (const p of pieces) assert.equal(p.manifold.status(), 'NoError');
  assert.ok(art.manifold.boundingBox().min[2] >= -1e-9 && art.manifold.boundingBox().max[2] <= 0.6 + 1e-6, 'inlay sits in the bed-side layers');
});

test('depth modes: through = full thickness, inner = at the inner surface, outer keeps the outer surface', () => {
  const n = net(), plate = buildPlate(K, n, { snap: { enabled: false } }), panel = plate.panels.get(0);
  const through = facePieces(K, panel, 0, [textLayer(n, 0, { depthMm: 'through' })], 2.4)[1].manifold.boundingBox();
  near(through.min[2], 0, 1e-6); near(through.max[2], 2.4, 1e-6);
  const inner = facePieces(K, panel, 0, [textLayer(n, 0, { depthMm: 0.8, side: 'inner' })], 2.4)[1].manifold.boundingBox();
  near(inner.min[2], 1.6, 1e-6); near(inner.max[2], 2.4, 1e-6);
});

test('later layers win where shapes overlap, and nothing is lost or doubled', () => {
  const n = net(), plate = buildPlate(K, n, { snap: { enabled: false } }), panel = plate.panels.get(0);
  const a = textLayer(n, 0), b = { ...textLayer(n, 0), groups: textLayer(n, 0).groups.map(g => ({ ...g, slot: 2 })) };
  const pieces = facePieces(K, panel, 0, [a, b], 2.4);
  const slots = pieces.map(p => p.color);
  assert.ok(slots.includes(0) && slots.includes(2) && !slots.includes(1), `layer b fully covers a: ${slots}`);
  near(pieces.reduce((s, p) => s + p.manifold.volume(), 0), panel.volume(), 1e-6);
});

test('multi-colour SVG: each colour lands in its own body (nearest palette slot), bodies stay disjoint, 3MF carries them', () => {
  const n = net(), plate = buildPlate(K, n, { snap: { enabled: false } });
  const svg = parseSvg('<svg viewBox="0 0 40 20"><rect x="0" y="0" width="20" height="20" fill="#d9372a"/><circle cx="30" cy="10" r="9" fill="#2a62d9"/></svg>', { widthMm: 36 });
  const layer = { groups: resolveLayer(svg.shapes, n.faces[1], { palette: DEFAULT_PALETTE.map(c => ({ ...c })), placement: {} }), depthMm: 0.8, side: 'outer' };
  assert.deepEqual(layer.groups.map(g => g.slot), [1, 2]);                              // red → slot 1, blue → slot 2
  const colors = assignColors(n, { mode: 'single' }).colors;
  const bodies = splitByColor(K, plate, n, colors, 'parent', { 1: [layer] });
  assert.deepEqual([...new Set(bodies.map(b => b.color))].sort(), [0, 1, 2]);
  for (let i = 0; i < bodies.length; i++) for (let j = i + 1; j < bodies.length; j++) assert.ok(bodies[i].manifold.intersect(bodies[j].manifold).volume() < 1e-6);
  const whole = plate.components[0].volume(); near(bodies.reduce((s, b) => s + b.manifold.volume(), 0), whole, whole * 1e-4);
  const r = export3MF(bodies, DEFAULT_PALETTE); assert.equal(r.slots.length, 3);
});

test('art never fills a hole: artwork over a mount opening is cut away with the panel', () => {
  const n = net(), L = textLayer(n, 2);
  const solid = buildPlate(K, n, { snap: { enabled: false } });
  const holed = buildPlate(K, n, { snap: { enabled: false }, mounts: [faceMountSpec(n, 2, { diameterMm: 6 })] });
  const [, artSolid] = facePieces(K, solid.panels.get(2), 0, [L], 2.4);
  const [, artHoled] = facePieces(K, holed.panels.get(2), 0, [L], 2.4);
  const removed = artSolid.manifold.volume() - artHoled.manifold.volume();
  assert.ok(removed > 0.5, `the hole should remove inlay material, removed ${removed} mm³`);
  // and nothing of the art body lies inside the opening
  const hole = K.Manifold.cylinder(10, 3, 3, 64, true).translate([...n.faces[2].outer.reduce((s, q) => [s[0] + q[0] / n.faces[2].outer.length, s[1] + q[1] / n.faces[2].outer.length], [0, 0]), 1.2]);
  assert.ok(artHoled.manifold.intersect(hole).volume() < 0.05);
});

test('diagnostics: clipped, too-fine and too-shallow artwork are called out; sensible art is clean', () => {
  const n = net(), profiles = n.faces.map(f => panelProfile(n, f));
  const ok = { 0: [textLayer(n, 0)] };
  assert.equal(artDiagnostics(K, n, profiles, ok, 'fdm04').length, 0, JSON.stringify(artDiagnostics(K, n, profiles, ok, 'fdm04')));
  const big = { 0: [{ ...textLayer(n, 0), groups: resolveLayer(textShapes(font, 'HELLO WORLD', { sizeMm: 30 }).shapes, n.faces[0], { placement: {}, defaultSlot: 1 }) }] };
  assert.ok(artDiagnostics(K, n, profiles, big, 'fdm04').some(i => i.code === 'artClipped'));
  const tiny = { 0: [{ ...textLayer(n, 0), groups: resolveLayer(textShapes(font, 'tiny text here', { sizeMm: 2.2 }).shapes, n.faces[0], { placement: {}, defaultSlot: 1 }) }] };
  assert.ok(artDiagnostics(K, n, profiles, tiny, 'fdm04').some(i => i.code === 'artFine'));
  assert.ok(!artDiagnostics(K, n, profiles, tiny, 'msla').some(i => i.code === 'artFine'), 'a resin printer resolves it');
  assert.ok(artDiagnostics(K, n, profiles, { 0: [textLayer(n, 0, { depthMm: 0.1 })] }, 'fdm04').some(i => i.code === 'artShallow'));
});

test('no art: facePieces returns the panel untouched', () => {
  const n = net(), plate = buildPlate(K, n, { snap: { enabled: false } });
  const p = facePieces(K, plate.panels.get(0), 3, [], 2.4);
  assert.equal(p.length, 1); assert.equal(p[0].color, 3);
});
