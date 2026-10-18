import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { foldToModel } from '../../src/foldstudio/lib/fold-io.js';
import { foldStudioToAssembly } from '../../src/foldstudio/lib/foldingAdapter.js';
import {
  polyForgeToAssembly, legacyAnglesToEngine, compileAssembly, evaluatePoses, applyPose, rad,
} from '@hyphi/folding';

const lily = () => foldToModel(JSON.parse(readFileSync(new URL('./fixtures/lily.fold', import.meta.url), 'utf8')));

test('lily: unassigned edges are reported, never guessed', () => {
  const m = lily();
  const r = foldStudioToAssembly(m, { sheetMm: 100 });
  const nU = m.edges.filter(e => e.assignment === 'U').length;
  assert.ok(nU > 0, 'fixture should contain U edges');
  assert.equal(r.issues.filter(i => i.code === 'ambiguousEdge').length, nU);
  // Scale: the 32-unit sheet becomes 100 mm.
  const xs = r.assembly.regions.flatMap(g => g.polygons.flat().map(p => p[0]));
  assert.ok(Math.abs(Math.max(...xs) - 100) < 1e-9);
  assert.ok(r.assembly.connections.every(c => c.type === 'idealHinge'));
});

test('lily: once the author classifies every U edge the assembly compiles', () => {
  const m = lily();
  const first = foldStudioToAssembly(m, { sheetMm: 100 });
  const cls = {};
  for (const i of first.issues) cls[i.edgeId] = 'join';
  const r = foldStudioToAssembly(m, { sheetMm: 100, classification: cls });
  assert.equal(r.issues.filter(i => i.code === 'ambiguousEdge').length, 0);
  assert.ok(r.assembly.regions.length >= 1 && r.assembly.regions.length < 48, `regions=${r.assembly.regions.length}`);
  const c = compileAssembly(r.assembly);
  assert.ok(c.ok, JSON.stringify(c.issues.slice(0, 3)));
  assert.ok(Object.keys(r.groups).length > 0);
});

// ── PolyForge parity ────────────────────────────────────────────────
function rotAboutAxis(p, a, u, cosT, sinT) {          // verbatim from Folded3D.vue
  const px = p[0] - a[0], py = p[1] - a[1], pz = p[2] - a[2];
  const dot = px * u[0] + py * u[1] + pz * u[2];
  const cx = u[1] * pz - u[2] * py, cy = u[2] * px - u[0] * pz, cz = u[0] * py - u[1] * px;
  return [a[0] + px * cosT + cx * sinT + u[0] * dot * (1 - cosT), a[1] + py * cosT + cy * sinT + u[1] * dot * (1 - cosT), a[2] + pz * cosT + cz * sinT + u[2] * dot * (1 - cosT)];
}
function legacyTransform(net, p, fi, theta) {            // verbatim chain walk
  const parentEdge = new Map(net.foldEdges.map(e => [e.faceB, e]));
  const chainFor = f => { const e = parentEdge.get(f); return e ? [...chainFor(e.faceA), e] : []; };
  const chain = chainFor(fi);
  let q = p;
  for (let i = chain.length - 1; i >= 0; i--) {
    const e = chain[i], d = [e.a1[0] - e.a0[0], e.a1[1] - e.a0[1], 0], l = Math.hypot(d[0], d[1]);
    q = rotAboutAxis(q, [e.a0[0], e.a0[1], 0], [d[0] / l, d[1] / l, 0], Math.cos(theta), Math.sin(theta));
  }
  return q;
}
// Cross-shaped cube net: centre face 0, arms 1(+x) 2(+y) 3(-x) 4(-y), 5 hangs off arm 1.
const quad = (x, y) => ({ polygon2D: [[x, y], [x + 1, y], [x + 1, y + 1], [x, y + 1]], vertIdx: [] });
const cubeNet = {
  faces: [quad(0, 0), quad(1, 0), quad(0, 1), quad(-1, 0), quad(0, -1), quad(2, 0)],
  foldEdges: [
    { faceA: 0, faceB: 1, a0: [1, 0], a1: [1, 1] },
    { faceA: 0, faceB: 2, a0: [0, 1], a1: [1, 1] },
    { faceA: 0, faceB: 3, a0: [0, 0], a1: [0, 1] },
    { faceA: 0, faceB: 4, a0: [0, 0], a1: [1, 0] },
    { faceA: 1, faceB: 5, a0: [2, 0], a1: [2, 1] },
  ],
};

for (const theta of [rad(90), -rad(90), rad(37)]) {
  test(`PolyForge net: engine matches legacy fold math (θ = ${(theta * 180 / Math.PI).toFixed(0)}°)`, () => {
    const asm = polyForgeToAssembly(cubeNet, { scaleMm: 1 });
    const c = compileAssembly(asm);
    assert.ok(c.ok, JSON.stringify(c.issues));
    const poses = evaluatePoses(c, legacyAnglesToEngine(c, theta));
    cubeNet.faces.forEach((f, fi) => {
      for (const [x, y] of f.polygon2D) {
        const legacy = legacyTransform(cubeNet, [x, y, 0], fi, theta);
        const eng = applyPose(poses.get(`face:${fi}`), [x, y, 0]);
        legacy.forEach((v, i) => assert.ok(Math.abs(v - eng[i]) < 1e-9, `face ${fi} (${x},${y}) [${i}] ${v} vs ${eng[i]}`));
      }
    });
  });
}
