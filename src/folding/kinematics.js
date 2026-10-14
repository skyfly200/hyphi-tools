// Forward kinematics (tree fast path) and closure residuals for loops.
// No numerical optimisation happens here.

import { applyPose, composePose, identityPose, invertPose, sub } from './math.js';
import { connectionPose } from './model.js';

const angleOf = (compiled, angles, id) => {
  const i = compiled.varIndex.get(id);
  return i === undefined ? 0 : angles[i];
};

/**
 * Propagate region poses from the anchor through the spanning tree.
 * @param compiled result of compileAssembly()
 * @param angles   Float64Array|number[] indexed by compiled.varIndex (radians)
 * @returns Map<regionId, pose>
 */
export function evaluatePoses(compiled, angles, anchorPose = identityPose()) {
  const poses = new Map([[compiled.anchor, anchorPose]]);
  for (const step of compiled.tree) {
    const F = connectionPose(compiled, step.connId, angleOf(compiled, angles, step.connId));
    // F maps B's flat coords into A's frame. Walking from A to B: P_B = P_A ∘ F.
    // Walking from B to A: P_A = P_B ∘ F⁻¹.
    const P = poses.get(step.parent);
    poses.set(step.child, composePose(P, step.reversed ? invertPose(F) : F));
  }
  return poses;
}

// Three non-collinear flat sample points for a connection (spans a rigid frame).
function sampleFlatPoints(frame) {
  const w = Math.max(frame.edgeLen, 1e-6);
  const { o, u, v } = frame;
  const p = (a, b) => [o[0] + u[0] * a + v[0] * b, o[1] + u[1] * a + v[1] * b, 0];
  return [p(0, 0), p(w, 0), p(0, w)];
}

/**
 * Closure residuals for connections that are not part of the spanning tree:
 * P_B(q) − P_A(F(q)) at three non-collinear points q (mm). 9 numbers each.
 * rigidJoin closures use P_B(q) − P_A(q) at the region's own vertices.
 */
export function closureResiduals(compiled, angles, poses) {
  const out = [];
  for (const id of compiled.closureConnIds) {
    const c = compiled.connIndex.get(id);
    const PA = poses.get(c.a), PB = poses.get(c.b);
    const f = compiled.frames.get(id);
    let pts, F = null;
    if (f) { pts = sampleFlatPoints(f); F = connectionPose(compiled, id, angleOf(compiled, angles, id)); }
    else {
      const poly = compiled.regionIndex.get(c.b).polygon;
      pts = [poly[0], poly[1], poly[2]].map(p => [p[0], p[1], 0]);
    }
    for (const q of pts) {
      const viaA = applyPose(PA, F ? applyPose(F, q) : q);
      const viaB = applyPose(PB, q);
      const d = sub(viaB, viaA);
      out.push(d[0], d[1], d[2]);
    }
  }
  return out;
}

export function maxAbs(arr) { let m = 0; for (const x of arr) m = Math.max(m, Math.abs(x)); return m; }
