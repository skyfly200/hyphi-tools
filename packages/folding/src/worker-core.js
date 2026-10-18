// Folding solver service for a Web Worker (solver.worker.js) or in-process use, built on the generic
// @hyphi/solver-core worker plumbing (request ids, revisions, progress, cancel between bounded
// batches, stale-response discard).
//
// Ops: compileAssembly, solveConfiguration, solveStep, solveSequence, validateConfiguration, cancel
// The service keys compiled assemblies by their geometry hash; requests must carry the hash of the
// assembly they refer to.

import { createService } from '@hyphi/solver-core';
import { compileAssembly } from './model.js';
import { solveConfiguration } from './solver/backend.js';
import { stepGenerator } from './solver/continuation.js';
import { evaluatePoses } from './kinematics.js';
import { checkCollisions, checkPath } from './collision/validation.js';
import { validateSequence, resolveStep } from './sequence.js';
import { expandHingeWidths } from './hinges.js';

/** Pack samples for cheap transfer: Float64Array of progress + Float64Array of angles (row-major). */
export function packSamples(samples) {
  const n = samples.length, k = n ? samples[0].angles.length : 0;
  const progress = new Float64Array(n), angles = new Float64Array(n * k);
  samples.forEach((s, i) => { progress[i] = s.progress; angles.set(s.angles, i * k); });
  return { progress, angles, count: n, width: k };
}
export function unpackSamples({ progress, angles, count, width }) {
  return Array.from({ length: count }, (_, i) => ({ progress: progress[i], angles: Array.from(angles.subarray(i * width, (i + 1) * width)), validated: true }));
}

export function createSolverService() {
  const cache = new Map();          // geometryHash -> compiled
  const need = hash => {
    const c = cache.get(hash);
    if (!c) { const e = new Error('unknown geometryHash: compileAssembly first'); e.code = 'staleReferences'; throw e; }
    return c;
  };
  const summary = c => ({ ok: c.ok, issues: c.issues, hash: c.hash, variableConnIds: c.variableConnIds, closureConnIds: c.closureConnIds,
    anchor: c.anchor, regionIds: [...c.regionIndex.keys()], scaleMm: c.scaleMm });

  // Run a step generator, posting progress and yielding between bounded batches so `cancel` can land.
  async function runStep(c, startAngles, step, options, ctx, stepId) {
    const gen = stepGenerator(c, startAngles, step, { ...(options || {}), shouldCancel: ctx.isCancelled });
    let n = gen.next();
    while (!n.done) {
      ctx.post({ stepId, progress: n.value.progress });
      await ctx.yield();
      if (ctx.isCancelled()) return { cancelled: true };
      n = gen.next();
    }
    return n.value;
  }

  const service = createService({
    compileAssembly(payload, ctx) {
      let asm = payload.assembly, extra = [];
      if (payload.expandHinges) { const e = expandHingeWidths(asm, payload.expandHinges); asm = e.assembly; extra = e.issues; }
      const c = compileAssembly(asm);
      c.issues.push(...extra);
      cache.set(c.hash, c); ctx.setKey(c.hash);
      return { ...summary(c), assembly: asm };
    },
    solveConfiguration(payload, ctx) {
      return solveConfiguration(need(ctx.key), { ...payload, options: { ...(payload.options || {}), shouldCancel: ctx.isCancelled } });
    },
    async solveStep(payload, ctx) {
      const c = need(ctx.key);
      const step = payload.resolved ? payload.step : resolveStep(payload.step, payload.doc || {}, c);
      let result = await runStep(c, payload.startAngles, step, payload.options, ctx);
      if (result.cancelled) result = { status: 'cancelled', completed: false, samples: [], failure: { status: 'cancelled', message: 'cancelled' } };
      return { ...result, samples: undefined, packedSamples: packSamples(result.samples || []) };
    },
    async solveSequence(payload, ctx) {
      const c = need(ctx.key);
      const v = validateSequence(payload.doc, c);
      if (!v.ok) return { status: 'invalidSequence', issues: v.issues, steps: [] };
      let angles = payload.initialAngles || new Array(c.variableConnIds.length).fill(0);
      const steps = [];
      const result = { status: 'converged', steps, issues: v.issues };
      for (const step of payload.doc.steps || []) {
        const r = await runStep(c, angles, resolveStep(step, payload.doc, c), payload.options, ctx, step.id);
        if (r.cancelled) { result.status = 'cancelled'; result.failedStep = step.id; break; }
        steps.push({ stepId: step.id, status: r.status, completed: r.completed, reachedProgress: r.reachedProgress, failure: r.failure, packedSamples: packSamples(r.samples) });
        if (!r.completed) { result.status = r.status; result.failedStep = step.id; break; }
        angles = r.samples.at(-1).angles;
      }
      if (result.status === 'converged') result.finalAngles = angles;
      return result;
    },
    validateConfiguration(payload, ctx) {
      const c = need(ctx.key);
      return payload.path ? checkPath(c, payload.path, payload.options) : checkCollisions(c, evaluatePoses(c, payload.angles), payload.options);
    },
  });
  return { handle: service.handle, cache };
}
