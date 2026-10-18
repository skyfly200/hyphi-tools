// Folding solver entry point. Builds a ConstraintSystem from a compiled assembly and a set of
// constraints, runs it, and reports in folding vocabulary (mm / degrees).
//
// Residual groups (see @hyphi/solver-core):
//   structural — loop closure (never allowed to pass validation if large)
//   user       — drive / hold / point targets
//   limit      — angle and minimum-radius limits (warnings)
//   soft       — preference for staying near the starting configuration; picks a branch /
//                resolves under-constraint, never excuses structural error

import { ConstraintSystem } from '@hyphi/solver-core';
import { evaluatePoses, closureResiduals } from '../kinematics.js';
import { applyPose, deg, identityPose, rad, sub } from '../math.js';
import { bandAngleLimit } from '../bends/circular.js';

export const DEFAULT_TOLERANCES = Object.freeze({
  closureMm: 0.01,        // spec §15
  drivenAngleDeg: 0.1,
  pointMm: 0.01,
});

/**
 * @param compiled   compileAssembly() output (must be ok)
 * @param request    { initial?: number[], constraints?: Constraint[], anchorPose?, options? }
 * Constraint:
 *   { type:'drive'|'hold', connId, valueRad }
 *   { type:'point', regionId, local:[x,y], target:[x,y,z] }   (mm, assembly coords)
 */
export function solveConfiguration(compiled, request = {}) {
  if (!compiled.ok) return failure('invalidTopology', compiled.issues.filter(i => i.level === 'error'));
  const ids = compiled.variableConnIds, n = ids.length;
  const constraints = request.constraints || [];
  const anchorPose = request.anchorPose || identityPose();
  const opts = request.options || {};
  const tol = { ...DEFAULT_TOLERANCES, ...(opts.tolerances || {}) };

  const bad = constraints.find(c => (c.connId && !compiled.varIndex.has(c.connId)) || (c.regionId && !compiled.regionIndex.has(c.regionId)));
  if (bad) return failure('staleReferences', [{ level: 'error', code: 'staleReferences', message: `constraint references missing ${bad.connId || bad.regionId}` }]);

  const sc = compiled.scaleMm;
  // Weights identical to the original hand-rolled objective: structural 1000/scale, user 1, soft 1e-3.
  const sys = new ConstraintSystem({ weights: { structural: 1000, user: 1, limit: 1, soft: 1e-3 }, preferInitial: 1e-3 });
  ids.forEach((id, i) => sys.addVariable(id, request.initial?.[i] ?? 0));
  sys.setContext(v => {
    const poses = evaluatePoses(compiled, v.values, anchorPose);
    return { poses, closure: compiled.closureConnIds.length ? closureResiduals(compiled, v.values, poses) : [] };
  });

  if (compiled.closureConnIds.length) {
    sys.addConstraint({ id: 'closure', group: 'structural', unit: 'mm', scale: sc, tolerance: tol.closureMm, residual: (v, ctx) => ctx.closure });
  }
  constraints.forEach((c, i) => {
    if (c.type === 'point') {
      sys.addConstraint({ id: `point:${i}`, group: 'user', unit: 'mm', scale: sc, tolerance: tol.pointMm, meta: { constraint: c },
        residual: (v, ctx) => { const d = sub(applyPose(ctx.poses.get(c.regionId), [c.local[0], c.local[1], 0]), c.target); return [d[0], d[1], d[2]]; } });
    } else {
      sys.addConstraint({ id: `${c.type}:${i}`, group: 'user', unit: 'rad', tolerance: rad(tol.drivenAngleDeg), meta: { constraint: c },
        residual: v => v.get(c.connId) - c.valueRad });
    }
  });
  // One-sided angle / minimum-radius limits (fixed length, excess >= 0), reported as warnings.
  for (const id of ids) {
    const c = compiled.connIndex.get(id), fr = compiled.frames.get(id);
    const hasMax = Number.isFinite(c.maxAngleDeg), hasMin = Number.isFinite(c.minAngleDeg);
    const radiusLim = fr && fr.lengthMm > 0 && c.minRadiusMm > 0 ? bandAngleLimit(fr.lengthMm, c.minRadiusMm, fr.profile) : null;
    if (!hasMax && !hasMin && radiusLim === null) continue;
    sys.addConstraint({ id: `limit:${id}`, group: 'limit', unit: 'rad', residual: v => {
      const a = v.get(id);
      return [hasMax ? Math.max(0, a - rad(c.maxAngleDeg)) : 0, hasMin ? Math.max(0, rad(c.minAngleDeg) - a) : 0, radiusLim === null ? 0 : Math.max(0, Math.abs(a) - radiusLim)];
    } });
  }

  const r = sys.solve({ initial: request.initial, options: { maxIterations: opts.maxIterations ?? 120, deadlineMs: opts.deadlineMs, shouldCancel: opts.shouldCancel } });

  // ── report in folding vocabulary ──
  const by = id => r.constraints.find(c => c.id === id);
  const user = r.constraints.filter(c => c.group === 'user');
  const angleErr = user.filter(c => c.unit === 'rad').reduce((m, c) => Math.max(m, c.maxError), 0);
  const pointErr = user.filter(c => c.unit === 'mm').reduce((m, c) => Math.max(m, c.maxError), 0);
  const warnings = r.warnings.map(w => (w.code === 'limitViolation' ? { code: w.code, message: 'a connection exceeds its angle limit', maxExcessDeg: deg(w.maxExcess) } : w));
  return {
    status: r.status,
    geometryValid: r.valid,
    targetsMet: r.targetsMet,
    collisionStatus: 'notChecked',
    iterations: r.iterations,
    elapsedMs: r.elapsedMs,
    maxClosureErrorMm: by('closure')?.maxError ?? 0,
    maxDrivenAngleErrorDeg: deg(angleErr),
    maxPointErrorMm: pointErr,
    angles: Array.from(r.x),
    warnings,
    // Largest residuals first; NOT a minimal conflicting set.
    worstResiduals: r.worst.map(w => (w.unit === 'mm' ? { constraint: w.meta.constraint, errorMm: w.error } : { constraint: w.meta.constraint, errorDeg: deg(w.error) })),
  };
}

function failure(status, issues) {
  return { status, geometryValid: false, targetsMet: false, collisionStatus: 'notChecked', iterations: 0, angles: [], warnings: [], issues };
}
