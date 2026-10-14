// Step solving by continuation: advance driven controls in small increments,
// solve from the previous accepted state, validate, and refine or stop.
// On failure we STOP with diagnostics — we never stretch the model to continue.

import { solveConfiguration } from './backend.js';

const EASING = {
  linear: s => s,
  smoothstep: s => s * s * (3 - 2 * s),
  easeInOut: s => (s < 0.5 ? 2 * s * s : 1 - 2 * (1 - s) * (1 - s)),
};

/**
 * @param compiled   compileAssembly() output
 * @param startAngles configuration at step start
 * @param step       { controls:[{ connIds[], mode:'drive'|'hold'|'free', toRad? }], easing?, defaultMode?, anchors?, guides? }
 * @param options    { initialIncrement, minIncrement, maxSamples, tolerances, shouldCancel, branchHint }
 * @returns { status, completed:boolean, reachedProgress, samples:[{progress, angles}], last, failure? }
 */
export function solveStepContinuation(compiled, startAngles, step, options = {}) {
  const { initialIncrement = 0.1, minIncrement = 1e-3, maxSamples = 2000, shouldCancel } = options;
  const ease = EASING[step.easing] || EASING.linear;
  const start = Array.from(startAngles);

  // "free" is the default: connections without a control are solved, never auto-held.
  const driven = []; const held = [];
  for (const ctl of step.controls || []) {
    for (const id of ctl.connIds || []) {
      if (!compiled.varIndex.has(id)) {
        return fail('staleReferences', 0, [], `control references missing connection ${id}`);
      }
      if (ctl.mode === 'drive') driven.push({ id, from: start[compiled.varIndex.get(id)], to: ctl.toRad });
      else if (ctl.mode === 'hold') held.push({ id, value: start[compiled.varIndex.get(id)] }); // captured at step start
    }
  }
  const dupes = [...driven, ...held].map(d => d.id).filter((id, i, a) => a.indexOf(id) !== i);
  if (dupes.length) return fail('ambiguousControls', 0, [], `connection ${dupes[0]} has more than one control in this step`);

  // Optional branch hint: nudge selected angles off a singular flat state.
  let current = start.slice();
  for (const [id, a] of Object.entries(options.branchHint || {})) {
    if (compiled.varIndex.has(id)) current[compiled.varIndex.get(id)] += a;
  }

  const samples = [{ progress: 0, angles: start.slice(), validated: true }];
  let s = 0, inc = initialIncrement, last = null;
  while (s < 1 && samples.length < maxSamples) {
    if (shouldCancel?.()) return fail('cancelled', s, samples, 'cancelled', last);
    const sNext = Math.min(1, s + inc);
    const e = ease(sNext);
    const constraints = [
      ...driven.map(d => ({ type: 'drive', connId: d.id, valueRad: d.from + (d.to - d.from) * e })),
      ...held.map(h => ({ type: 'hold', connId: h.id, valueRad: h.value })),
      ...(step.guides || []).map(g => ({ ...g })), // point / pose targets
    ];
    const r = solveConfiguration(compiled, { initial: current, constraints, anchorPose: options.anchorPose, options: { tolerances: options.tolerances, shouldCancel } });
    last = r;
    if (r.status === 'converged') {
      current = r.angles; s = sNext; samples.push({ progress: s, angles: r.angles, validated: true });
      if (inc < initialIncrement) inc = Math.min(initialIncrement, inc * 1.5);
    } else if (r.status === 'cancelled' || r.status === 'invalidTopology' || r.status === 'staleReferences') {
      return fail(r.status, s, samples, r.status, r);
    } else {
      inc /= 2;
      if (inc < minIncrement) {
        const reason = r.status === 'incompatibleTargets' ? 'targets cannot all be met'
          : r.status === 'singularConfiguration' ? 'mechanism closure lost (possible singular configuration)' : 'solver iteration limit';
        return fail(r.status, s, samples, `${reason} at ${(s * 100).toFixed(1)}% of the step`, r);
      }
    }
  }
  return { status: 'converged', completed: s >= 1, reachedProgress: s, samples, last, failure: null };

  function fail(status, reached, smp, message, lastResult) {
    return { status, completed: false, reachedProgress: reached, samples: smp, last: lastResult ?? null, failure: { status, message, worstResiduals: lastResult?.worstResiduals ?? [] } };
  }
}
