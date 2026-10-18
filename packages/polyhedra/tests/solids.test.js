import test from 'node:test';
import assert from 'node:assert/strict';
import { POLYHEDRA, EXTRA_POLYHEDRA, convexHull, ensureOutward, buildEdges, unfold } from '../src/index.js';

const sub = (a, b) => [a[0]-b[0], a[1]-b[1], a[2]-b[2]];
const cross = (a, b) => [a[1]*b[2]-a[2]*b[1], a[2]*b[0]-a[0]*b[2], a[0]*b[1]-a[1]*b[0]];
const dot = (a, b) => a[0]*b[0]+a[1]*b[1]+a[2]*b[2];
const len = a => Math.hypot(...a);

function check(name, { vertices, faces }) {
  // Euler: V − E + F = 2, every edge shared by exactly two faces
  const edges = buildEdges(faces);
  assert.equal(vertices.length - edges.length + faces.length, 2, `${name}: Euler`);
  assert.ok(edges.every(e => e.faces.length === 2), `${name}: closed`);
  // planar, convex, outward-wound faces
  const c = vertices.reduce((s, v) => [s[0]+v[0]/vertices.length, s[1]+v[1]/vertices.length, s[2]+v[2]/vertices.length], [0,0,0]);
  for (const f of faces) {
    const n = cross(sub(vertices[f[1]], vertices[f[0]]), sub(vertices[f[2]], vertices[f[0]])); const nl = len(n); const nn = n.map(x => x / nl);
    assert.ok(dot(nn, sub(vertices[f[0]], c)) > 0, `${name}: outward`);
    for (const i of f) assert.ok(Math.abs(dot(nn, sub(vertices[i], vertices[f[0]]))) < 1e-6, `${name}: planar`);
    for (let i = 0; i < f.length; i++) {
      const a = vertices[f[i]], b = vertices[f[(i+1)%f.length]], d = vertices[f[(i+2)%f.length]];
      assert.ok(dot(cross(sub(b, a), sub(d, b)), nn) > 0, `${name}: convex CCW`);
    }
  }
  // every net unfolds without overlapping root assumptions: tree covers all faces
  const net = unfold({ vertices, faces }, 0);
  assert.equal(net.faces.filter(Boolean).length, faces.length, `${name}: unfold covers all faces`);
  assert.equal(net.foldEdges.length, faces.length - 1, `${name}: spanning tree`);
  return edges;
}

test('platonic solids pass the same structural checks (after ensureOutward)', () => {
  for (const [k, p] of Object.entries(POLYHEDRA)) check(k, ensureOutward(p.build()));
});

test('POLYHEDRA.tetra is stored wound inward (PolyForge compatibility); ensureOutward fixes it and leaves the rest alone', () => {
  const raw = POLYHEDRA.tetra.build();
  const fixed = ensureOutward(raw);
  assert.notDeepEqual(fixed.faces, raw.faces);
  for (const k of ['cube', 'octa', 'dodeca', 'icosa']) { const s = POLYHEDRA[k].build(); assert.deepEqual(ensureOutward(s).faces, s.faces, k); }
});

test('catalogue solids: closed, planar, convex, outward, unfoldable, shortest edge = 1', () => {
  for (const [k, p] of Object.entries(EXTRA_POLYHEDRA)) {
    const s = p.build(); const edges = check(k, s);
    const lens = edges.map(e => len(sub(s.vertices[e.v1], s.vertices[e.v2])));
    assert.ok(Math.abs(Math.min(...lens) - 1) < 1e-6, `${k}: shortest edge ${Math.min(...lens)}`);
  }
});

test('known counts: cuboctahedron 12 V / 14 F, truncated octahedron 24 V / 14 F, icosidodecahedron 30 V / 32 F', () => {
  const c = EXTRA_POLYHEDRA.cubocta.build(); assert.deepEqual([c.vertices.length, c.faces.length], [12, 14]);
  const t = EXTRA_POLYHEDRA.tocta.build(); assert.deepEqual([t.vertices.length, t.faces.length], [24, 14]);
  const i = EXTRA_POLYHEDRA.icosidodeca.build(); assert.deepEqual([i.vertices.length, i.faces.length], [30, 32]);
  const tc = EXTRA_POLYHEDRA.tcube.build(); assert.deepEqual([tc.vertices.length, tc.faces.length], [24, 14]);
  const tt = EXTRA_POLYHEDRA.ttetra.build(); assert.deepEqual([tt.vertices.length, tt.faces.length], [12, 8]);
});

test('hull drops interior points and merges coplanar triangles', () => {
  const pts = [[0,0,0],[1,0,0],[1,1,0],[0,1,0],[0,0,1],[1,0,1],[1,1,1],[0,1,1],[0.5,0.5,0.5]];
  const h = convexHull(pts);
  assert.equal(h.vertices.length, 8); assert.equal(h.faces.length, 6); assert.ok(h.faces.every(f => f.length === 4));
});
