import test, { before } from 'node:test';
import assert from 'node:assert/strict';
import { loadKernel } from '../../../src/facetfold/lib/kernel.js';
import { resolveProfile, validateProfile, toPrusaIni, generateGcode, parseGcode, analyzeGcode, analyzeNozzles, unprintableRegion, parseSTL, meshToManifold, lineArea, widthFromArea, normalizeType, hatch } from '../src/index.js';

let K;
before(async () => { K = await loadKernel(); });
const box = (x, y, z) => K.Manifold.cube([x, y, z]);
const near = (a, b, e, m) => assert.ok(Math.abs(a - b) <= e, m || `${a} !≈ ${b}`);

test('profile: validation catches impossible layer heights and sizes', () => {
  assert.equal(validateProfile(resolveProfile({})).length, 0);
  assert.ok(validateProfile(resolveProfile({ layerHeightMm: 0.4 })).some(i => i.code === 'layerTooTall' && i.level === 'error'));
  assert.ok(validateProfile(resolveProfile({ layerHeightMm: 0.05 })).some(i => i.code === 'layerTooThin'));
  assert.match(toPrusaIni({ nozzleMm: 0.6, layerHeightMm: 0.3 }), /nozzle_diameter = 0.6\n[\s\S]*layer_height = 0.3/);
  near(widthFromArea(lineArea(0.45, 0.2), 0.2), 0.45, 1e-12);
});

test('hatch: lines cover a square with the requested spacing', () => {
  const segs = hatch([[[0, 0], [10, 0], [10, 10], [0, 10]]], 1, 0);
  assert.ok(segs.length >= 9 && segs.length <= 11);
  segs.forEach(s => near(Math.abs(s[1][0] - s[0][0]), 10, 1e-9));
  const d = hatch([[[0, 0], [10, 0], [10, 10], [0, 10]]], 1, Math.PI / 4);
  assert.ok(d.length > 10);
});

test('slice a 20 mm cube: layers, walls, skin and infill produce a believable extrusion volume', () => {
  const prof = resolveProfile({ infillPct: 15 });
  const r = generateGcode(K, box(20, 20, 20), prof);
  assert.equal(r.stats.layers, 100);
  const types = new Set(r.layers.flatMap(l => l.paths.map(p => p.type)));
  for (const t of ['outer', 'inner', 'solid', 'sparse', 'skirt']) assert.ok(types.has(t), `has ${t}`);
  const volume = r.stats.filamentMm * Math.PI * (1.75 / 2) ** 2;
  assert.ok(volume > 0.25 * 8000 && volume < 0.5 * 8000, `extruded ${volume.toFixed(0)} mm³`);
  assert.ok(r.stats.fitsBed && r.stats.timeS > 600);
  const b = r.layers[5].paths.filter(p => p.type === 'outer').flatMap(p => p.pts);       // centred on the bed
  near((Math.min(...b.map(q => q[0])) + Math.max(...b.map(q => q[0]))) / 2, 128, 0.01);
  assert.match(r.gcode, /;TYPE:Outer wall/);
});

test('slice: top and bottom skin only where the part is exposed; hollow interior has no infill under the lid', () => {
  const tube = box(30, 30, 10).subtract(box(20, 20, 10).translate([5, 5, 2]));    // open-top box, floor 2 mm
  const r = generateGcode(K, tube, resolveProfile({ bottomLayers: 4, topLayers: 4, infillPct: 0 }));
  const floor = r.layers[2].paths.filter(p => p.type === 'solid'), mid = r.layers[30].paths.filter(p => p.type === 'solid' || p.type === 'sparse');
  assert.ok(floor.length > 20, 'floor is solid');
  assert.equal(mid.length, 0, 'walls only above the floor (infill 0%)');
});

test('parse: slicing then parsing the G-code recovers the same filament and feature widths', () => {
  const prof = resolveProfile({});
  const r = generateGcode(K, box(15, 15, 6), prof);
  const parsed = parseGcode(r.gcode);
  assert.equal(parsed.layers.length, r.stats.layers);
  const a = analyzeGcode(parsed, { nozzleMm: 0.4 });
  near(a.filamentMm, r.stats.filamentMm, 0.5);
  near(a.features.outer.widthMedianMm, prof.lineWidthMm, 0.02);
  assert.equal(a.issues.filter(i => i.code === 'narrowLines').length, 0);
  assert.ok(a.timeS > 0 && a.retractions > 0);
});

test('parse: foreign G-code (Orca/Prusa/Cura labels, absolute E) is understood', () => {
  const g = ['M82', 'G92 E0', ';LAYER_CHANGE', 'G1 Z0.2 F600', ';TYPE:Outer wall', 'G1 X10 Y0 F1200', 'G1 X20 Y0 E0.5', ';TYPE:WALL-INNER', 'G1 X30 Y0 E1.0', 'G1 X35 Y0 E0.9'].join('\n');
  const p = parseGcode(g);
  const ex = p.layers[0].moves.filter(m => m.extrude);
  assert.deepEqual(ex.map(m => m.type), ['outer', 'inner']);
  assert.equal(p.retractions, 1);
  for (const [s, t] of [['Perimeter', 'inner'], ['External perimeter', 'outer'], ['Internal infill', 'sparse'], ['Top solid infill', 'top'], ['Gap fill', 'gap'], ['Skirt/Brim', 'skirt'], ['SKIN', 'solid']]) assert.equal(normalizeType(s), t, s);
});

test('nozzle analysis: a 0.3 mm wall needs a 0.2 mm nozzle; a chunky part takes the 0.8', () => {
  const thin = box(30, 0.3, 12).add(box(30, 5, 1));
  const a = analyzeNozzles(K, thin);
  const by = Object.fromEntries(a.table.map(r => [r.nozzleMm, r]));
  assert.ok(by[0.4].lostPct > 2 && !by[0.4].ok, `0.4 loses ${by[0.4].lostPct}%`);
  assert.ok(by[0.2].lostPct < by[0.4].lostPct);
  assert.ok(a.recommended.nozzleMm <= 0.25, `recommended ${a.recommended.nozzleMm}`);
  const chunky = analyzeNozzles(K, box(40, 40, 20));
  assert.equal(chunky.recommended.nozzleMm, 0.8);
  assert.ok(chunky.table[chunky.table.length - 1].relativeTime < chunky.table[0].relativeTime, 'bigger nozzle is faster');
  const lost = unprintableRegion(K, K.Manifold.cube([30, 0.3, 12]).slice(6), 0.4);
  near(lost.area(), 30 * 0.3, 1e-6);
});

test('thin features: slicing a part below one line width reports lost volume and no walls', () => {
  const r = generateGcode(K, box(20, 0.2, 4), resolveProfile({}));
  assert.ok(r.stats.lostAreaMm2 > 0.8 * 20 * 0.2 * 4, 'volume reported lost');
  assert.equal(r.layers.flatMap(l => l.paths).filter(p => p.type === 'outer').length, 0);
});

test('stl: parse binary STL and re-slice through meshToManifold', () => {
  const m = box(10, 10, 10).getMesh(), n = m.triVerts.length / 3, buf = new ArrayBuffer(84 + 50 * n), dv = new DataView(buf);
  dv.setUint32(80, n, true);
  for (let t = 0; t < n; t++) for (let v = 0; v < 3; v++) for (let k = 0; k < 3; k++) dv.setFloat32(84 + t * 50 + 12 + v * 12 + k * 4, m.vertProperties[m.triVerts[t * 3 + v] * m.numProp + k], true);
  const man = meshToManifold(K, parseSTL(buf));
  near(man.volume(), 1000, 1e-3);
  assert.throws(() => parseSTL(new Uint8Array([1, 2, 3])));
});

test('ribbons: one quad per extrusion move, widths match the profile, layers are cumulative', async () => {
  const { buildRibbons, TYPE_KEYS } = await import('../src/index.js');
  const prof = resolveProfile({}), r = generateGcode(K, box(10, 10, 2), prof), parsed = parseGcode(r.gcode);
  const rb = buildRibbons(parsed);
  const moves = parsed.layers.reduce((s, l) => s + l.moves.filter(m => m.extrude).length, 0);
  assert.equal(rb.indices.length, moves * 6);
  assert.equal(rb.layerIndexEnd.length, parsed.layers.length);
  assert.equal(rb.layerIndexEnd.at(-1), rb.indices.length);
  for (let i = 1; i < rb.layerIndexEnd.length; i++) assert.ok(rb.layerIndexEnd[i] > rb.layerIndexEnd[i - 1]);
  const outerW = []; rb.typeIdx.forEach((t, i) => { if (TYPE_KEYS[t] === 'outer') outerW.push(rb.widthMm[i]); });
  near(outerW.reduce((a, b) => a + b, 0) / outerW.length, prof.lineWidthMm, 0.02);
});

test('simplify: circle offsets collapse to few moves without leaving the tolerance band', async () => {
  const { simplify } = await import('../src/slice.js');
  const circ = Array.from({ length: 200 }, (_, i) => [10 * Math.cos(i / 200 * 2 * Math.PI), 10 * Math.sin(i / 200 * 2 * Math.PI)]); circ.push(circ[0]);
  const s = simplify(circ, 0.015);
  assert.ok(s.length < 90 && s.length > 40, `kept ${s.length}`);
  assert.deepEqual(s[0], s.at(-1));
  const sq = simplify([[0, 0], [5, 0], [10, 0], [10, 10], [0, 10], [0, 0]], 0.01);
  assert.equal(sq.length, 5);
});

test('nozzle analysis: a vertical feature thinner than the layer height rules larger nozzles out', () => {
  const a = analyzeNozzles(K, box(40, 40, 20), { maxLayerHeightMm: 0.1 });
  assert.ok(a.recommended.layerHeightMm <= 0.125 && a.recommended.nozzleMm <= 0.25, `got ${a.recommended.nozzleMm}`);
  assert.match(a.recommended.reason, /thinnest vertical feature/);
  assert.equal(a.table.find(r => r.nozzleMm === 0.8).layerOk, false);
});
