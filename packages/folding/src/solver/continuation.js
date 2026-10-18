// Step solving by continuation on top of @hyphi/solver-core: advance driven controls in small
// increments, solve from the previous accepted state, validate, and refine or stop.
// On failure we STOP with diagnostics — we never stretch the model to continue.

import { continuationGenerator, EASINGS } from '@hyphi/solver-core';
import { solveConfiguration } from './backend.js';

/**
 * @param compiled   compileAssembly() output
 * @param startAngles configuration at step start
 * @param step       { controls:[{ connIds[], mode:'drive'|'hold'|'free', toRad? }], easing?, guides?, branchHint? }
 * @param options    { initialIncrement, minIncrement, maxSamples, tolerances, shouldCancel, branchHint, anchorPose }
 * @returns { status, completed:boolean, reachedProgress, samples:[{progress, angles, validated}], last, failure?, warnings }
 */
export function solveStepContinuation(compiled, startAngles, step, options = {}) {
  const it = stepGenerator(compiled, startAngles, step, options);
  let n = it.next();
  while (!n.done) n = it.next();
  return n.value;
}

/**
 * Same algorithm, but yields after every accepted sample ({ progress, angles }) so a host (the Web
 * Worker) can interleave cancellation and progress messages between bounded solver batches.
 */
export function* stepGenerator(compiled, startAngles, step, options = {}) {
  const { shouldCancel } = options;
  const ease = EASINGS[step.easing] || EASINGS.linear;
  const fail = (status, reached, samples, message, last) => ({ status, completed: false, reachedProgress: reached, samples, last: last ?? null,
    failure: { status, message, worstResiduals: last?.worstResiduals ?? [] } });
  let start = Array.from(startAngles);

  // The start must be a closed configuration. If it is not, project it onto the closure manifold
  // (no targets) and say so; if that fails the step cannot begin.
  const warnings = [];
  const closed = solveConfiguration(compiled, { initial: start, constraints: [], options: { tolerances: options.tolerances } });
  if (closed.status === 'invalidTopology' || closed.status === 'staleReferences') return fail(closed.status, 0, [], closed.status, closed);
  if (!closed.geometryValid) return fail('invalidStart', 0, [], 'the starting configuration does not satisfy the mechanism closure and could not be repaired', closed);
  if (Math.max(...start.map((v, i) => Math.abs(v - closed.angles[i])), 0) > 1e-6) {
    warnings.push({ code: 'startProjected', message: 'starting angles were not a closed configuration; projected onto the mechanism' });
    start = closed.angles;
  }

  // "free" is the default: connections without a control are solved, never auto-held.
  const driven = [], held = [];
  for (const ctl of step.controls || []) {
    for (const id of ctl.connIds || []) {
      if (!compiled.varIndex.has(id)) return fail('staleReferences', 0, [], `control references missing connection ${id}`);
      if (ctl.mode === 'drive') driven.push({ id, from: start[compiled.varIndex.get(id)], to: ctl.toRad });
      else if (ctl.mode === 'hold') held.push({ id, value: start[compiled.varIndex.get(id)] }); // captured at step start
    }
  }
  const dupes = [...driven, ...held].map(d => d.id).filter((id, i, a) => a.indexOf(id) !== i);
  if (dupes.length) return fail('ambiguousControls', 0, [], `connection ${dupes[0]} has more than one control in this step`);

  // Optional branch hint: nudge selected angles off a singular flat state onto a chosen branch.
  const guess = start.slice();
  for (const [id, a] of Object.entries({ ...(step.branchHint || {}), ...(options.branchHint || {}) })) {
    if (compiled.varIndex.has(id)) guess[compiled.varIndex.get(id)] += a;
  }

  const gen = continuationGenerator({
    start, firstGuess: guess,
    initialIncrement: options.initialIncrement ?? 0.1, minIncrement: options.minIncrement ?? 1e-3, maxSamples: options.maxSamples ?? 2000, shouldCancel,
    take: r => r.angles,
    solveAt: (s, current) => {
      const e = ease(s);
      const constraints = [
        ...driven.map(d => ({ type: 'drive', connId: d.id, valueRad: d.from + (d.to - d.from) * e })),
        ...held.map(h => ({ type: 'hold', connId: h.id, valueRad: h.value })),
        ...(step.guides || []).map(g => ({ ...g })), // point / pose targets
      ];
      return solveConfiguration(compiled, { initial: current, constraints, anchorPose: options.anchorPose, options: { tolerances: options.tolerances, shouldCancel } });
    },
    describe: (r, s) => {
      const reason = r.status === 'incompatibleTargets' ? 'targets cannot all be met'
        : r.status === 'singularConfiguration' ? 'mechanism closure lost (possible singular configuration)' : 'solver iteration limit';
      return `${reason} at ${(s * 100).toFixed(1)}% of the step`;
    },
  });
  let n = gen.next();
  while (!n.done) { yield { progress: n.value.progress, angles: n.value.state }; n = gen.next(); }
  const r = n.value;
  const samples = r.samples.map(x => ({ progress: x.progress, angles: x.state, validated: x.validated }));
  if (r.failure) return fail(r.status, r.reachedProgress, samples, r.failure.message, r.last);
  return { status: 'converged', completed: r.completed, reachedProgress: r.reachedProgress, samples, last: r.last, failure: null, warnings };
}
