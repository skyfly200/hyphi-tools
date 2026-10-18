import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { compileAssembly, solveSequence, rad, evaluatePoses } from '../src/index.js';
import { buildMesh, meshStats, meshBounds, exportGLB, exportSTL, parseSTL, buildAnimationBundle, refineSamples, foldFrameFor } from '../src/export/index.js';

const sq = (x0, y0, x1, y1) => [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
const near = (a, b, e = 1e-6, m) => assert.ok(Math.abs(a - b) <= e, m || `${a} !≈ ${b}`);

const strip = () => ({
  units: 'mm', anchor: 'A',
  regions: [{ id: 'A', polygon: sq(0, 0, 10, 10), thicknessMm: 0.3 }, { id: 'B', polygon: sq(12, 0, 22, 10), thicknessMm: 0.3 }],
  connections: [{ id: 'band', type: 'circularBand', a: 'A', b: 'B', edge: { p0: [10, 0], p1: [10, 10] }, lengthMm: 2, thicknessMm: 0.1 }],
});
function vertex4() {
  const o = [10, 10], P = [[20, 10], [10, 20], [0, 10], [10, 0]], C = [[20, 20], [0, 20], [0, 0], [20, 0]];
  return { units: 'mm', anchor: 'P0', regions: P.map((p, k) => ({ id: `P${k}`, polygon: [o, p, C[k], P[(k + 1) % 4]] })),
    connections: P.map((p, k) => ({ id: `h${k}`, type: 'idealHinge', a: `P${(k + 3) % 4}`, b: `P${k}`, edge: { p0: o, p1: p } })) };
}

test('mesh topology is independent of the configuration', () => {
  const c = compileAssembly(strip());
  const a = buildMesh(c, [0]), b = buildMesh(c, [rad(120)]);
  assert.deepEqual(Array.from(a.indices), Array.from(b.indices));
  assert.equal(a.positions.length, b.positions.length);
  assert.deepEqual(a.parts.map(p => p.id), ['A', 'B', 'band']);
  assert.notDeepEqual(Array.from(a.positions), Array.from(b.positions));
});

test('a thick panel is a closed solid; the assembled mesh is reported, never called print-ready', () => {
  const one = compileAssembly({ units: 'mm', anchor: 'A', regions: [{ id: 'A', polygon: sq(0, 0, 10, 10), thicknessMm: 0.3 }], connections: [] });
  const m = buildMesh(one, []);
  assert.equal(meshStats(m).manifold, true);
  near(meshBounds(m).size[2], 0.3, 1e-9);
  const c = compileAssembly(strip());
  const stl = exportSTL(buildMesh(c, [rad(90)]));
  assert.equal(stl.printReady, false);
  assert.equal(stl.units, 'mm');
});

test('band mesh follows the arc: length preserved, UVs are material coordinates', () => {
  const c = compileAssembly(strip());
  const flat = buildMesh(c, [0], { thickness: false });
  near(meshBounds(flat).size[0], 22, 1e-9);                         // 0..22 flat
  const bent = buildMesh(c, [rad(180)], { thickness: false });
  const band = bent.parts.find(p => p.id === 'band');
  let lo = Infinity, hi = -Infinity;
  for (let v = band.vertexStart; v < band.vertexStart + band.vertexCount; v++) { lo = Math.min(lo, bent.uvs[2 * v]); hi = Math.max(hi, bent.uvs[2 * v]); }
  near(lo, 10 / 22, 1e-9); near(hi, 12 / 22, 1e-9);                 // UV stays at the flat position of the band
  // 180° bend of L = 2: the arc is a half circle of radius 2/π, so it is 2R = 4/π tall.
  const bp = { positions: bent.positions.slice(3 * band.vertexStart, 3 * (band.vertexStart + band.vertexCount)) };
  near(meshBounds(bp).size[2], 4 / Math.PI, 1e-9);
  near(meshBounds(bp).size[1], 10, 1e-9);                           // band spans the full edge width (along y)
});

test('GLB is valid, in metres, and keeps stable part IDs', () => {
  const c = compileAssembly(strip());
  const mesh = buildMesh(c, [rad(90)]);
  const glb = exportGLB(mesh, { geometryHash: c.hash });
  const dv = new DataView(glb.buffer, glb.byteOffset, glb.byteLength);
  assert.equal(dv.getUint32(0, true), 0x46546c67); assert.equal(dv.getUint32(8, true), glb.length);
  const jl = dv.getUint32(12, true);
  assert.equal(jl % 4, 0);
  const json = JSON.parse(new TextDecoder().decode(glb.subarray(20, 20 + jl)));
  const b = meshBounds(mesh);
  json.accessors[0].min.forEach((v, k) => near(v, b.min[k] / 1000, 1e-7));
  json.accessors[0].max.forEach((v, k) => near(v, b.max[k] / 1000, 1e-7));
  assert.equal(json.meshes[0].extras.sourceUnits, 'mm');
  assert.deepEqual(json.meshes[0].primitives.map(p => p.extras.id), ['A', 'B', 'band']);
  assert.equal(json.meshes[0].extras.geometryHash, c.hash);
  assert.ok(json.nodes[0].rotation);                                   // Z-up assembly → Y-up viewers
  const binStart = 20 + jl + 8;
  assert.equal(binStart + json.buffers[0].byteLength, glb.length);
});

test('STL round-trips in millimetres', () => {
  const c = compileAssembly(strip());
  const mesh = buildMesh(c, [rad(45)]);
  const { bytes } = exportSTL(mesh);
  const tris = parseSTL(bytes);
  assert.equal(tris.length, mesh.indices.length / 3);
  const t0 = mesh.indices[0] * 3;
  near(tris[0][0][0], mesh.positions[t0], 1e-3);
  const ascii = `solid x\nfacet normal 0 0 1\nouter loop\nvertex 0 0 0\nvertex 1 0 0\nvertex 0 1 0\nendloop\nendfacet\nendsolid`;
  assert.deepEqual(parseSTL(new TextEncoder().encode(ascii)), [[[0, 0, 0], [1, 0, 0], [0, 1, 0]]]);
});

const doc = { groups: [], steps: [{ id: 's1', title: 'Fold up', branchHint: [{ target: { connectionId: 'h0' }, degrees: 3 }, { target: { connectionId: 'h1' }, degrees: -3 }, { target: { connectionId: 'h2' }, degrees: 3 }, { target: { connectionId: 'h3' }, degrees: -3 }],  notes: 'drive h1', instruction: 'Pinch the valley', durationSeconds: 1, controls: [{ target: { connectionId: 'h1' }, mode: 'drive', toDegrees: 80 }], easing: 'smoothstep' }] };

test('adaptive refinement keeps linear interpolation within the error budget', () => {
  const c = compileAssembly(vertex4());
  const seq = solveSequence(c, doc, { initialAngles: [0, 0, 0, 0], options: { initialIncrement: 0.5 } });
  assert.equal(seq.status, 'converged');
  const coarse = seq.steps[0].samples;
  const r = refineSamples(c, coarse, { maxInterpErrorMm: 0.05 });
  assert.ok(r.maxErrorMm <= 0.05 + 1e-9, `err ${r.maxErrorMm}`);
  assert.ok(r.samples.length >= coarse.length);
  const loose = refineSamples(c, coarse, { maxInterpErrorMm: 5 });
  assert.ok(loose.samples.length <= r.samples.length);
});

test('animation bundle is consistent and Blender-side scale matches the source millimetres', () => {
  const c = compileAssembly(vertex4());
  const seq = solveSequence(c, doc, { initialAngles: [0, 0, 0, 0] });
  const bundle = buildAnimationBundle(c, seq, doc, { fps: 24, maxInterpErrorMm: 0.1, assembly: vertex4() });
  assert.deepEqual(Object.keys(bundle).sort(), ['assembly.json', 'configurations.json', 'diagnostics.json', 'mesh-topology.json']);
  const topo = JSON.parse(bundle['mesh-topology.json']), cfg = JSON.parse(bundle['configurations.json']).configurations;
  assert.ok(cfg.every(x => x.positions.length === 3 * topo.vertexCount));
  const asm = JSON.parse(bundle['assembly.json']);
  assert.equal(asm.steps[0].startFrame, 0); assert.equal(asm.steps[0].endFrame, 24);
  assert.equal(asm.geometryHash, c.hash);
  const diag = JSON.parse(bundle['diagnostics.json']).validation;
  assert.ok(diag.every(d => d.maxClosureErrorMm < 0.01));
  // Python importer (no Blender) reads the same bundle and reports identical extents.
  const dir = mkdtempSync(join(tmpdir(), 'bundle-'));
  try {
    for (const [name, text] of Object.entries(bundle)) writeFileSync(join(dir, name), text);
    const out = JSON.parse(execFileSync('python3', ['packages/folding/tools/blender/import_folding_bundle.py', '--check', dir], { encoding: 'utf8' }));
    assert.equal(out.units, 'mm'); assert.equal(out.configs, cfg.length); assert.equal(out.vertexCount, topo.vertexCount);
    const last = cfg.at(-1), mine = meshBounds({ positions: Float64Array.from(last.positions) }).size;
    out.extentMm.at(-1).forEach((v, k) => near(v, mine[k], 1e-6));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('FOLD folded-form frame maps authored vertices through region poses', () => {
  const c = compileAssembly(vertex4());
  const poses = evaluatePoses(c, [0, 0, 0, 0]);
  const model = { vertices: [[0, 0], [1, 0], [1, 1], [0, 1], [0.5, 0.5]] };
  const { frame, unmapped } = foldFrameFor(poses, model, { 4: 'P0', 0: 'P2' }, { sheetMm: 20 });
  assert.deepEqual(frame.vertices_coords[4], [10, 10, 0]);
  assert.deepEqual(unmapped.sort(), [1, 2, 3]);                       // reported, not invented
  assert.equal(frame.frame_unit, 'mm');
});
