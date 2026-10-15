// Transport-agnostic solver service. Runs inside a Web Worker (solver.worker.js)
// or in-process (tests, SSR, browsers without module workers).
//
// Request:  { requestId, revision, geometryHash?, op, payload }
// Responses (posted zero or more times, then exactly one terminal message):
//   { type:'progress', requestId, revision, geometryHash, progress, ... }
//   { type:'result',   requestId, revision, geometryHash, result }
//   { type:'error',    requestId, revision, geometryHash, error }
// Ops: compileAssembly, solveConfiguration, solveStep, solveSequence,
//      validateConfiguration, cancel
// Long operations yield to the event loop between bounded solver batches so a
// `cancel` message can be processed; worker termination is the hard fallback.

import { compileAssembly } from './model.js';
import { solveConfiguration } from './solver/backend.js';
import { stepGenerator } from './solver/continuation.js';
import { evaluatePoses } from './kinematics.js';
import { checkCollisions, checkPath } from './collision/validation.js';
import { validateSequence, resolveStep } from './sequence.js';
import { expandHingeWidths } from './hinges.js';

const tick = () => new Promise(r => setTimeout(r, 0));

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
  const cancelled = new Set();

  const summary = c => ({ ok: c.ok, issues: c.issues, hash: c.hash, variableConnIds: c.variableConnIds, closureConnIds: c.closureConnIds,
    anchor: c.anchor, regionIds: [...c.regionIndex.keys()], scaleMm: c.scaleMm });

  const need = hash => {
    const c = cache.get(hash);
    if (!c) { const e = new Error('unknown geometryHash: compileAssembly first'); e.code = 'staleReferences'; throw e; }
    return c;
  };

  async function handle(msg, post) {
    const { requestId, revision, op, payload } = msg;
    let geometryHash = msg.geometryHash;
    const base = () => ({ requestId, revision, geometryHash });
    const isCancelled = () => cancelled.has(requestId);
    try {
      if (op === 'cancel') { cancelled.add(payload.requestId); post({ type: 'result', ...base(), result: { cancelled: payload.requestId } }); return; }
      let result;
      if (op === 'compileAssembly') {
        let asm = payload.assembly;
        let extra = [];
        if (payload.expandHinges) { const e = expandHingeWidths(asm, payload.expandHinges); asm = e.assembly; extra = e.issues; }
        const c = compileAssembly(asm);
        c.issues.push(...extra);
        cache.set(c.hash, c); geometryHash = c.hash;
        result = { ...summary(c), assembly: asm };
      } else if (op === 'solveConfiguration') {
        const c = need(geometryHash);
        result = solveConfiguration(c, { ...payload, options: { ...(payload.options || {}), shouldCancel: isCancelled } });
      } else if (op === 'solveStep') {
        const c = need(geometryHash);
        const step = payload.resolved ? payload.step : resolveStep(payload.step, payload.doc || {}, c);
        const gen = stepGenerator(c, payload.startAngles, step, { ...(payload.options || {}), shouldCancel: isCancelled });
        let n = gen.next();
        while (!n.done) {
          post({ type: 'progress', ...base(), progress: n.value.progress });
          await tick();
          if (isCancelled()) { result = { status: 'cancelled', completed: false, samples: [], failure: { status: 'cancelled', message: 'cancelled' } }; break; }
          n = gen.next();
        }
        if (!result) result = n.value;
        const packed = packSamples(result.samples || []);
        result = { ...result, samples: undefined, packedSamples: packed };
      } else if (op === 'solveSequence') {
        const c = need(geometryHash);
        const v = validateSequence(payload.doc, c);
        if (!v.ok) { result = { status: 'invalidSequence', issues: v.issues, steps: [] }; }
        else {
          let angles = payload.initialAngles || new Array(c.variableConnIds.length).fill(0);
          const steps = [];
          result = { status: 'converged', steps, issues: v.issues };
          for (const step of payload.doc.steps || []) {
            const gen = stepGenerator(c, angles, resolveStep(step, payload.doc, c), { ...(payload.options || {}), shouldCancel: isCancelled });
            let n = gen.next();
            while (!n.done) {
              post({ type: 'progress', ...base(), stepId: step.id, progress: n.value.progress });
              await tick();
              if (isCancelled()) break;
              n = gen.next();
            }
            if (isCancelled()) { result.status = 'cancelled'; result.failedStep = step.id; break; }
            const r = n.value;
            steps.push({ stepId: step.id, status: r.status, completed: r.completed, reachedProgress: r.reachedProgress, failure: r.failure, packedSamples: packSamples(r.samples) });
            if (!r.completed) { result.status = r.status; result.failedStep = step.id; break; }
            angles = r.samples.at(-1).angles;
          }
          if (result.status === 'converged') result.finalAngles = angles;
        }
      } else if (op === 'validateConfiguration') {
        const c = need(geometryHash);
        if (payload.path) result = checkPath(c, payload.path, payload.options);
        else result = checkCollisions(c, evaluatePoses(c, payload.angles), payload.options);
      } else throw Object.assign(new Error(`unknown op ${op}`), { code: 'badRequest' });
      if (isCancelled() && result && result.status !== 'cancelled') result = { ...result, cancelledLate: true };
      post({ type: 'result', ...base(), result });
    } catch (e) {
      post({ type: 'error', ...base(), error: { code: e.code || 'workerError', message: e.message } });
    } finally {
      cancelled.delete(requestId);
    }
  }
  return { handle, cache };
}
