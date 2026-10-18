// Parameter continuation: advance a parameter s from 0 to 1 in adaptive increments, solving at each
// step from the previous accepted solution. Stops with diagnostics — it never forces a result.
// This is how a solver stays on one branch of a multi-solution problem (folding sequences, linkage
// motion, any "slide a control and re-solve" interaction).

export const EASINGS = Object.freeze({
  linear: s => s,
  smoothstep: s => s * s * (3 - 2 * s),
  easeInOut: s => (s < 0.5 ? 2 * s * s : 1 - 2 * (1 - s) * (1 - s)),
});

/**
 * Generator form: yields every accepted sample so a host (a Web Worker) can interleave cancellation
 * and progress between bounded solver batches. Its return value is the final result.
 *
 * @param {object} p
 * @param {(s:number, guess:any) => {status:string, x?:any}} p.solveAt  solve at parameter value s (0..1) starting from `guess`
 * @param {any} p.start             the accepted solution at s = 0 (e.g. a Float64Array or array)
 * @param {(r:any) => any} [p.take] extract the state to carry forward from a result (default r.x)
 * @param {number} [p.initialIncrement=0.1]
 * @param {number} [p.minIncrement=1e-3]
 * @param {number} [p.maxSamples=2000]
 * @param {() => boolean} [p.shouldCancel]
 * @param {(r:any) => boolean} [p.accept] default: r.status === 'converged'
 * @param {(r:any) => boolean} [p.fatal]  stop immediately instead of refining (default: cancelled / invalid input statuses)
 * @param {any} [p.firstGuess]  initial guess for the FIRST solve only (e.g. a branch-selecting nudge); samples[0] stays `start`
 * @param {(r:any, s:number) => string} [p.describe] failure message when increments are exhausted
 */
export function* continuationGenerator(p) {
  const { solveAt, start, take = r => r.x, initialIncrement = 0.1, minIncrement = 1e-3, maxSamples = 2000, shouldCancel } = p;
  const accept = p.accept || (r => r.status === 'converged');
  const fatal = p.fatal || (r => ['cancelled', 'invalidTopology', 'staleReferences'].includes(r.status));
  const samples = [{ progress: 0, state: start, validated: true }];
  let current = p.firstGuess ?? start, s = 0, inc = initialIncrement, last = null;
  const stop = (status, message) => ({ status, completed: false, reachedProgress: s, samples, last, failure: { status, message, worst: last?.worst ?? [] } });
  while (s < 1 && samples.length < maxSamples) {
    if (shouldCancel?.()) return stop('cancelled', 'cancelled');
    const next = Math.min(1, s + inc);
    const r = solveAt(next, current);
    last = r;
    if (accept(r)) {
      current = take(r); s = next; samples.push({ progress: s, state: current, validated: true });
      yield { progress: s, state: current };
      if (inc < initialIncrement) inc = Math.min(initialIncrement, inc * 1.5);
    } else if (fatal(r)) {
      return stop(r.status, r.status);
    } else {
      inc /= 2;
      if (inc < minIncrement) return stop(r.status, p.describe ? p.describe(r, s) : `no solution found at ${(s * 100).toFixed(1)}% (${r.status})`);
    }
  }
  return { status: 'converged', completed: s >= 1, reachedProgress: s, samples, last, failure: null };
}

/** Run a continuation to completion. */
export function continuation(p) {
  const it = continuationGenerator(p);
  let n = it.next();
  while (!n.done) n = it.next();
  return n.value;
}
