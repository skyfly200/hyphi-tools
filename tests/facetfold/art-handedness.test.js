import test from 'node:test';
import assert from 'node:assert/strict';
import { POLYHEDRA } from '@hyphi/polyhedra';
import { evaluatePoses, applyPose } from '@hyphi/folding';
import { buildNet } from '../../src/facetfold/lib/net.js';
import { verifyNet } from '../../src/facetfold/lib/verify.js';
import { placeOnFace } from '../../src/facetfold/lib/art.js';

const sub = (a, b) => a.map((x, i) => x - b[i]);
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a, b) => a.reduce((s, x, i) => s + x * b[i], 0);

test('folded: art reads correctly from outside on every face (right × up points outward)', () => {
  const net = buildNet(POLYHEDRA.cube.build(), { edgeLengthMm: 60, panelThicknessMm: 2.4 });
  const v = verifyNet(net, { checkClosingPath: false });
  const poses = evaluatePoses(v.compiled, v.angles);
  const W = (f, p2) => applyPose(poses.get(`f${f.id}`), [p2[0], p2[1], 0]);
  const centres = net.faces.map(f => { const c = f.outer.reduce((s, q) => [s[0] + q[0] / f.outer.length, s[1] + q[1] / f.outer.length], [0, 0]); return W(f, c); });
  const body = centres.reduce((s, c) => s.map((x, i) => x + c[i] / centres.length), [0, 0, 0]);
  for (const f of net.faces) {
    // art-space axes: origin, +x (right), +y (up) as seen from outside
    const [o, r, u] = placeOnFace([[[0, 0], [1, 0], [0, 1]]], f, { })[0].map(p => W(f, p));
    const right = sub(r, o), up = sub(u, o), outward = sub(centres[f.id], body);
    assert.ok(dot(cross(right, up), outward) > 0, `face ${f.id} is mirrored`);
  }
});
