// Solver entry point: builds residuals from compiled assembly + constraints,
// runs the numerical backend, and VALIDATES the result in physical units.
//
// Residual groups (spec §6.4) are kept separate:
//   structural — loop closure (never allowed to pass validation if large)
//   user       — drive / hold / point targets
//   soft       — preference for staying near the starting configuration; picks a
//                branch / resolves under-constraint, never excuses structural error

import { evaluatePoses, closureResiduals, maxAbs } from '../kinematics.js';
import { applyPose, deg, identityPose, sub } from '../math.js';
import { bandAngleLimit } from '../bends/circular.js';
import { levenbergMarquardt, numericJacobian, numericalRank } from './levenberg-marquardt.js';

export const DEFAULT_TOLERANCES = Object.freeze({
  closureMm: 0.01,        // spec §15
  drivenAngleDeg: 0.1,
  pointMm: 0.01,
});

const SOFT_WEIGHT = 1e-3;
const USER_WEIGHT = 1;
// Structural error must lose to nothing: when targets conflict with the mechanism, the
// targets are violated (and reported) before the paper is allowed to tear.
const STRUCT_WEIGHT = 1000;

/**
 * @param compiled   compileAssembly() output (must be ok)
 * @param request    { initial?: number[], constraints?: Constraint[], anchorPose?, options? }
 * Constraint:
 *   { type:'drive'|'hold', connId, valueRad }
 *   { type:'point', regionId, local:[x,y], target:[x,y,z] }   (mm, assembly coords)
 */
export function solveConfiguration(compiled, request = {}) {
  const t0 = Date.now();
  if (!compiled.ok) {
    return failure('invalidTopology', compiled.issues.filter(i => i.level === 'error'));
  }
  const n = compiled.variableConnIds.length;
  const initial = Float64Array.from(request.initial ?? new Array(n).fill(0));
  const constraints = request.constraints || [];
  const anchorPose = request.anchorPose || identityPose();
  const tol = { ...DEFAULT_TOLERANCES, ...(request.options?.tolerances || {}) };

  const bad = constraints.find(c => (c.connId && !compiled.varIndex.has(c.connId)) || (c.regionId && !compiled.regionIndex.has(c.regionId)));
  if (bad) return failure('staleReferences', [{ level: 'error', code: 'staleReferences', message: `constraint references missing ${bad.connId || bad.regionId}` }]);

  const sc = compiled.scaleMm;
  // Residual evaluation split by group so validation can report each one.
  const groups = x => {
    const poses = evaluatePoses(compiled, x, anchorPose);
    const structural = closureResiduals(compiled, x, poses); // mm
    const user = [];
    for (const c of constraints) {
      if (c.type === 'drive' || c.type === 'hold') user.push(x[compiled.varIndex.get(c.connId)] - c.valueRad);
      else if (c.type === 'point') {
        const p = applyPose(poses.get(c.regionId), [c.local[0], c.local[1], 0]);
        const d = sub(p, c.target); user.push(d[0], d[1], d[2]);
      }
    }
    // One-sided penalties for connection angle limits (soft; reported if violated).
    const limits = [];
    for (const id of compiled.variableConnIds) {
      const c = compiled.connIndex.get(id), v = x[compiled.varIndex.get(id)];
      if (Number.isFinite(c.maxAngleDeg) && v > c.maxAngleDeg * Math.PI / 180) limits.push(v - c.maxAngleDeg * Math.PI / 180);
      if (Number.isFinite(c.minAngleDeg) && v < c.minAngleDeg * Math.PI / 180) limits.push(v - c.minAngleDeg * Math.PI / 180);
      const fr = compiled.frames.get(id);
      if (fr && fr.lengthMm > 0 && c.minRadiusMm > 0) {
        const lim = bandAngleLimit(fr.lengthMm, c.minRadiusMm, fr.profile);
        if (Math.abs(v) > lim) limits.push(Math.abs(v) - lim);
      }
    }
    return { structural, user, limits, poses };
  };
  const nUserPoint = constraints.map(c => (c.type === 'point' ? [3, sc] : [1, 1]));
  const objective = x => {
    const g = groups(x);
    const r = [];
    for (const v of g.structural) r.push(STRUCT_WEIGHT * v / sc);
    let k = 0;
    for (const [cnt, s] of nUserPoint) { for (let i = 0; i < cnt; i++) r.push(USER_WEIGHT * g.user[k++] / s); }
    for (const v of g.limits) r.push(USER_WEIGHT * v);
    for (let i = 0; i < n; i++) r.push(SOFT_WEIGHT * (x[i] - initial[i]));
    return r;
  };

  const opts = request.options || {};
  const res = levenbergMarquardt(objective, initial, {
    maxIterations: opts.maxIterations ?? 120, deadlineMs: opts.deadlineMs, shouldCancel: opts.shouldCancel,
  });

  // ── physical validation ────────────────────────────────────────────
  const g = groups(res.x);
  const maxClosureErrorMm = maxAbs(g.structural);
  let maxDrivenAngleErrorDeg = 0, maxPointErrorMm = 0, k = 0;
  for (const c of constraints) {
    if (c.type === 'point') { maxPointErrorMm = Math.max(maxPointErrorMm, Math.hypot(g.user[k], g.user[k + 1], g.user[k + 2])); k += 3; }
    else { maxDrivenAngleErrorDeg = Math.max(maxDrivenAngleErrorDeg, Math.abs(deg(g.user[k]))); k += 1; }
  }
  const warnings = [];
  if (g.limits.length) warnings.push({ code: 'limitViolation', message: 'a connection exceeds its angle limit', maxExcessDeg: deg(maxAbs(g.limits)) });
  // Rank of the bare constraint Jacobian (without soft rows) → under-constrained mechanisms.
  const bare = x => { const gg = groups(x); const r = gg.structural.map(v => v / sc); gg.user.forEach(v => r.push(v)); return r; };
  const rb = bare(res.x);
  const rank = rb.length ? numericalRank(numericJacobian(bare, res.x, rb)) : 0;
  if (rank < n) warnings.push({ code: 'underconstrained', message: `${n - rank} free degree(s) of freedom held near the starting configuration`, rank, variables: n });

  const structuralOk = maxClosureErrorMm <= tol.closureMm;
  const userOk = maxDrivenAngleErrorDeg <= tol.drivenAngleDeg && maxPointErrorMm <= tol.pointMm;
  let status;
  if (res.status === 'cancelled') status = 'cancelled';
  else if (structuralOk && userOk) status = 'converged';
  else if (res.status === 'iterationLimit' || res.status === 'timeLimit') status = 'iterationLimit';
  else status = structuralOk ? 'incompatibleTargets' : 'singularConfiguration';

  return {
    status,
    geometryValid: structuralOk,
    targetsMet: userOk,
    collisionStatus: 'notChecked',
    iterations: res.iterations,
    elapsedMs: Date.now() - t0,
    maxClosureErrorMm, maxDrivenAngleErrorDeg, maxPointErrorMm,
    angles: Array.from(res.x),
    warnings,
    // Largest residuals first; NOT a minimal conflicting set.
    worstResiduals: worst(constraints, g),
  };

  function worst(cons, gg) {
    const rows = []; let kk = 0;
    for (const c of cons) {
      if (c.type === 'point') { rows.push({ constraint: c, errorMm: Math.hypot(gg.user[kk], gg.user[kk + 1], gg.user[kk + 2]) }); kk += 3; }
      else { rows.push({ constraint: c, errorDeg: Math.abs(deg(gg.user[kk])) }); kk += 1; }
    }
    return rows.sort((a, b) => (b.errorMm ?? b.errorDeg) - (a.errorMm ?? a.errorDeg)).slice(0, 5);
  }
}

function failure(status, issues) {
  return { status, geometryValid: false, targetsMet: false, collisionStatus: 'notChecked', iterations: 0, angles: [], warnings: [], issues };
}

