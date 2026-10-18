// Verify a net by folding it through the real folding engine (@hyphi/folding).
//
// The assembly uses each panel's TRIMMED bottom polygon as a rigid region at the outer surface (z = 0) and a
// circularBand of flat length w for every hinge. Folding every hinge by its exterior angle φ must put each
// panel exactly on its ideal face; we measure that, plus seam gaps, plus a swept self-collision check along the
// closing path. Nothing is assumed: numbers come from the engine.

import { compileAssembly, evaluatePoses, applyPose, rad } from '@hyphi/folding';
import { checkCollisions, checkPath } from '@hyphi/folding/collision';
import { panelProfile } from './panel.js';

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const unit = a => { const l = Math.hypot(...a) || 1; return a.map(x => x / l); };
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

/** The engine assembly for a net (regions + band hinges). */
export function netToAssembly(net) {
  const { hingeWidthMm: w, hingeThicknessMm: th, panelThicknessMm: t } = net.params;
  const profiles = net.faces.map(f => panelProfile(net, f));
  const regions = net.faces.map((f, i) => ({ id: `f${f.id}`, polygon: profiles[i].bottom || f.outer, thicknessMm: t, source: { face: f.id } }));
  const connections = net.hinges.map(h => {
    const parent = net.faces[h.parent], child = net.faces[h.child];
    const [va, vb] = h.key.split('-').map(Number);
    const pa = parent.outer[parent.vertIdx.indexOf(va)], pb = parent.outer[parent.vertIdx.indexOf(vb)];
    const n = h.normal, a = h.trimMm;
    // parent's trimmed edge line = ideal edge shifted back into the parent by a
    const p0 = [pa[0] - n[0] * a, pa[1] - n[1] * a], p1 = [pb[0] - n[0] * a, pb[1] - n[1] * a];
    const cc = child.outer.reduce((s, q) => [s[0] + q[0] / child.outer.length, s[1] + q[1] / child.outer.length], [0, 0]);
    return { id: `h:${h.key}`, type: 'circularBand', a: `f${parent.id}`, b: `f${child.id}`, edge: { p0, p1, sideB: cc }, lengthMm: w, thicknessMm: th,
      source: { edgeKey: h.key, phi: h.phi } };
  });
  return { units: 'mm', anchor: `f${net.faces[0].id}`, regions, connections };
}

/** Rigid map from solid coordinates to the folded world, anchored on the anchor face (outer surface down). */
function solidToWorld(net) {
  const f = net.faces[0], S = net.solid.vertices;
  const a3 = S[f.vertIdx[0]], b3 = S[f.vertIdx[1]];
  const e1 = unit(sub(b3, a3)), e3 = unit(f.normal) /* outward */, e2 = cross(e3, e1);
  const a2 = f.outer[0], b2 = f.outer[1];
  const e1w = unit([b2[0] - a2[0], b2[1] - a2[1], 0]), e3w = [0, 0, -1], e2w = cross(e3w, e1w);   // outer surface faces −z
  const F = [e1, e2, e3], W = [e1w, e2w, e3w];
  const map = p => { const d = sub(p, a3); const c = [dot(d, e1), dot(d, e2), dot(d, e3)]; return [0, 1, 2].map(k => a2[k === 2 ? 0 : k] * 0 + W[0][k] * c[0] + W[1][k] * c[1] + W[2][k] * c[2]).map((x, k) => x + (k < 2 ? a2[k] : 0)); };
  void F;
  return map;
}

/**
 * @returns {{ ok, maxFaceErrorMm, maxSeamGapMm, seamGaps, collisions, pathCollisionFree, issues, compiled }}
 */
export function verifyNet(net, { pathStepMm = 2, checkClosingPath = true } = {}) {
  const issues = [];
  const asm = netToAssembly(net);
  const compiled = compileAssembly(asm);
  if (!compiled.ok) return { ok: false, issues: compiled.issues, compiled };
  const angles = compiled.variableConnIds.map(id => compiled.connIndex.get(id).source.phi);
  const poses = evaluatePoses(compiled, angles);
  const toWorld = solidToWorld(net);

  // 1. every panel on its ideal face
  let maxFace = 0;
  for (const f of net.faces) {
    const P = poses.get(`f${f.id}`);
    f.outer.forEach((q, k) => {
      const folded = applyPose(P, [q[0], q[1], 0]);
      const ideal = toWorld(net.solid.vertices[f.vertIdx[k]]);
      maxFace = Math.max(maxFace, dist(folded, ideal));
    });
  }
  // 2. seam gaps: both faces' idea of the shared edge endpoints
  const seamGaps = net.seams.map(s => {
    const [fa, fb] = s.faces.map(i => net.faces[i]);
    let worst = 0;
    for (const v of [s.v1, s.v2]) {
      const pa = applyPose(poses.get(`f${fa.id}`), [...fa.outer[fa.vertIdx.indexOf(v)], 0]);
      const pb = applyPose(poses.get(`f${fb.id}`), [...fb.outer[fb.vertIdx.indexOf(v)], 0]);
      worst = Math.max(worst, dist(pa, pb));
    }
    return { key: s.key, faces: s.faces, gapMm: worst };
  });
  const maxSeam = seamGaps.reduce((m, s) => Math.max(m, s.gapMm), 0);
  if (maxFace > 0.05) issues.push({ level: 'error', code: 'foldMismatch', message: `folded panels deviate from the ideal polyhedron by up to ${maxFace.toFixed(3)} mm` });
  if (maxSeam > net.params.seamClearanceMm + 0.05) issues.push({ level: 'error', code: 'seamGap', message: `a seam is off by ${maxSeam.toFixed(3)} mm when folded` });

  // 3. no panel passes through another in the closed state, nor on the way there
  const closed = checkCollisions(compiled, poses);
  let pathFree = null, pathInfo = null;
  if (checkClosingPath) {
    const zero = angles.map(() => 0);
    const path = checkPath(compiled, [zero, angles], { maxStepMm: pathStepMm });
    pathFree = path.collisionFree; pathInfo = path;
    if (!path.collisionFree) issues.push({ level: 'warning', code: 'closingCollision', message: `panels collide while closing (${(path.firstCollision.progress * 100).toFixed(0)}% of the way): ${path.firstCollision.collisions.map(c => c.regions.join('×')).join(', ')}`, collisions: path.firstCollision.collisions });
  }
  if (closed.collisions.length) issues.push({ level: 'error', code: 'collision', message: `panels interpenetrate when closed: ${closed.collisions.map(c => c.regions.join('×')).join(', ')}` });

  return { ok: !issues.some(i => i.level === 'error'), maxFaceErrorMm: maxFace, maxSeamGapMm: maxSeam, seamGaps,
    collisions: closed.collisions, pathCollisionFree: pathFree, pathMethod: pathInfo?.method ?? null, issues, compiled, assembly: asm, angles };
}
