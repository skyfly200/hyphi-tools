import test, { before } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { POLYHEDRA, EXTRA_POLYHEDRA } from '@hyphi/polyhedra';
import { loadKernel } from '../../src/facetfold/lib/kernel.js';
import { buildNet } from '../../src/facetfold/lib/net.js';
import { buildPlate, splitByColor } from '../../src/facetfold/lib/solid.js';
import { assignColors, colorAdjacent, faceAdjacency, hingeColor, colorChangeEstimate, DEFAULT_PALETTE } from '../../src/facetfold/lib/colors.js';
import { export3MF, pieceSTL } from '../../src/facetfold/lib/export.js';

let K; before(async () => { K = await loadKernel(); });
const net = (p, o = {}) => buildNet(p.build(), { edgeLengthMm: 40, panelThicknessMm: 2.4, ...o });
const proper = (n, colors) => { const adj = faceAdjacency(n); return n.faces.every((_, f) => [...adj[f]].every(g => colors[f] !== colors[g])); };

test('adjacent-different colouring: valid whenever the solid allows it, and honest when it does not', () => {
  const cube = net(POLYHEDRA.cube);
  const two = colorAdjacent(cube, 2); assert.equal(two.ok, false);              // a cube's faces need 3
  const three = colorAdjacent(cube, 3); assert.ok(three.ok && proper(cube, three.colors));
  assert.ok(colorAdjacent(net(POLYHEDRA.octa), 2).ok, 'octahedron faces are 2-colourable (checkerboard)');
  const dod = net(POLYHEDRA.dodeca);
  assert.equal(colorAdjacent(dod, 3).ok, false); const four = colorAdjacent(dod, 4); assert.ok(four.ok && proper(dod, four.colors));
  for (const [id, p] of Object.entries({ ...POLYHEDRA, ...EXTRA_POLYHEDRA })) { const n = net(p); const r = colorAdjacent(n, 6); assert.ok(r.ok && proper(n, r.colors), id); }
});

test('assignColors modes, with a warning when too few colours', () => {
  const n = net(POLYHEDRA.cube);
  assert.deepEqual(assignColors(n, { mode: 'single' }).colors, [0, 0, 0, 0, 0, 0]);
  assert.deepEqual(assignColors(n, { mode: 'each', count: 3 }).colors, [0, 1, 2, 0, 1, 2]);
  assert.deepEqual(assignColors(n, { mode: 'manual', count: 3, manual: { 1: 2, 4: 1, 5: 9 } }).colors, [0, 2, 0, 0, 1, 2]);   // clamped into range
  const bad = assignColors(n, { mode: 'adjacent', count: 2 });
  assert.ok(bad.issues.some(i => i.code === 'colorsNotEnough'));
});

test('hinge colour follows the parent, the child, or a dedicated slot', () => {
  const n = net(POLYHEDRA.cube), colors = [0, 1, 2, 3, 4, 5], h = n.hinges[0];
  assert.equal(hingeColor(n, h, colors, 'parent'), colors[h.parent]);
  assert.equal(hingeColor(n, h, colors, 'child'), colors[h.child]);
  assert.equal(hingeColor(n, h, colors, { slot: 7 }), 7);
});

test('split bodies are DISJOINT, watertight, and together equal the single-colour piece', () => {
  const n = net(POLYHEDRA.cube), plate = buildPlate(K, n, {});
  const whole = plate.components[0].volume();
  const colors = assignColors(n, { mode: 'adjacent', count: 3 }).colors;
  const bodies = splitByColor(K, plate, n, colors, 'parent');
  assert.deepEqual([...new Set(bodies.map(b => b.color))].sort(), [0, 1, 2]);
  for (const b of bodies) { assert.equal(b.manifold.status(), 'NoError'); assert.ok(b.manifold.volume() > 0); }
  for (let i = 0; i < bodies.length; i++) for (let j = i + 1; j < bodies.length; j++) {
    const ov = bodies[i].manifold.intersect(bodies[j].manifold).volume();
    assert.ok(ov < 1e-6, `bodies ${i}/${j} overlap by ${ov} mm³`);
  }
  const sum = bodies.reduce((s, b) => s + b.manifold.volume(), 0);
  assert.ok(Math.abs(sum - whole) / whole < 1e-4, `Σ bodies ${sum} vs whole ${whole}`);
});

test('a dedicated hinge material puts every strip in its own body', () => {
  const n = net(POLYHEDRA.cube), plate = buildPlate(K, n, { snap: { enabled: false } });
  const colors = [0, 1, 0, 1, 0, 1];
  const bodies = splitByColor(K, plate, n, colors, { slot: 5 });
  const hinge = bodies.find(b => b.color === 5);
  assert.ok(hinge, 'a body for the hinge slot');
  assert.ok(hinge.manifold.boundingBox().max[2] <= n.params.hingeThicknessMm + 1e-6);
  assert.equal(new Set(bodies.map(b => b.color)).size, 3);
});

test('colour-change estimate scales with colours and layers', () => {
  const n = net(POLYHEDRA.cube), one = colorChangeEstimate(n, [0, 0, 0, 0, 0, 0], [0]), many = colorChangeEstimate(n, [0, 1, 2, 3, 0, 1], [0]);
  assert.equal(one.changes, 0); assert.equal(many.colorsUsed, 4); assert.equal(many.changes, 3 * many.layers);
});

test('3MF: valid package, one object per colour body, units mm, extruder map, indices in range', () => {
  const n = net(POLYHEDRA.cube), plate = buildPlate(K, n, {});
  const bodies = splitByColor(K, plate, n, assignColors(n, { mode: 'adjacent', count: 3 }).colors);
  const r = export3MF(bodies, DEFAULT_PALETTE, { name: 'cube' });
  assert.equal(r.objects, bodies.length); assert.equal(r.slots.length, 3);
  const dir = mkdtempSync(join(tmpdir(), '3mf-'));
  try {
    writeFileSync(join(dir, 'a.3mf'), r.bytes);
    const out = JSON.parse(execFileSync('python3', ['-c', `
import zipfile, json, sys, xml.etree.ElementTree as ET
z = zipfile.ZipFile(sys.argv[1]); assert z.testzip() is None
names = z.namelist()
ns = {'m': 'http://schemas.microsoft.com/3dmanufacturing/core/2015/02'}
root = ET.fromstring(z.read('3D/3dmodel.model'))
objs = root.findall('.//m:object', ns); bad = 0; tri = 0
for o in objs:
    nv = len(o.findall('.//m:vertex', ns))
    for t in o.findall('.//m:triangle', ns):
        tri += 1
        if any(int(t.get(k)) >= nv for k in ('v1','v2','v3')): bad += 1
mats = root.findall('.//m:base', ns)
cfg = ET.fromstring(z.read('Metadata/model_settings.config'))
print(json.dumps({'names': names, 'unit': root.get('unit'), 'objects': len(objs), 'badIdx': bad, 'tris': tri, 'mats': [m.get('displaycolor') for m in mats],
  'items': len(root.findall('.//m:item', ns)), 'ext': [m.get('value') for m in cfg.findall('.//metadata[@key="extruder"]')]}))
`, join(dir, 'a.3mf')], { encoding: 'utf8' }));
    assert.deepEqual(out.names.slice(0, 2), ['[Content_Types].xml', '_rels/.rels']);
    assert.equal(out.unit, 'millimeter'); assert.equal(out.objects, bodies.length); assert.equal(out.items, bodies.length);
    assert.equal(out.badIdx, 0); assert.ok(out.tris > 100); assert.equal(out.mats.length, 3);
    assert.ok(out.mats.every(m => /^#[0-9A-F]{8}$/.test(m)));
    assert.deepEqual([...new Set(out.ext)].sort(), ['1', '2', '3']);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('one STL per colour body shares the plate frame', () => {
  const n = net(POLYHEDRA.cube), plate = buildPlate(K, n, {});
  const bodies = splitByColor(K, plate, n, assignColors(n, { mode: 'adjacent', count: 3 }).colors);
  const z = bodies.map(b => pieceSTL(b.manifold).stats);
  assert.ok(z.every(s => s.triangles > 0));
  const box = bodies.map(b => b.manifold.boundingBox());
  assert.ok(box.every(b => b.min[2] >= -1e-9 && b.max[2] <= 2.4 + 1e-6), 'all bodies sit on the bed');
});
