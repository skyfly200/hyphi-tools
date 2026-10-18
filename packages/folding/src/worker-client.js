// Main-thread client for the folding solver worker (see @hyphi/solver-core/worker for the protocol).
// Falls back to an in-process service when Worker is unavailable.

import { WorkerClient, createInlineTransport as inline } from '@hyphi/solver-core';
import { createSolverService, unpackSamples } from './worker-core.js';

export function createInlineTransport(service = createSolverService()) { return inline(service); }

export function defaultTransport() {
  if (typeof Worker !== 'undefined') {
    try { return new Worker(new URL('./solver.worker.js', import.meta.url), { type: 'module' }); } catch { /* fall through */ }
  }
  return createInlineTransport();
}

function unpack(r) {
  if (r && r.packedSamples) r.samples = unpackSamples(r.packedSamples);
  if (r && r.steps) for (const s of r.steps) if (s.packedSamples) s.samples = unpackSamples(s.packedSamples);
  return r;
}

export class SolverClient extends WorkerClient {
  constructor(transportFactory = defaultTransport) { super(transportFactory, { unpack }); }
  get geometryHash() { return this.key; }
  set geometryHash(v) { this.key = v; }
  async compile(assembly, opts = {}) {
    const { promise } = this.request('compileAssembly', { assembly, expandHinges: opts.expandHinges });
    const r = await promise;
    if (r && r.hash) this.key = r.hash;
    return r;
  }
  solveConfiguration(req) { return this.request('solveConfiguration', req); }
  solveStep(payload, o) { return this.request('solveStep', payload, o); }
  solveSequence(payload, o) { return this.request('solveSequence', payload, o); }
  validate(payload) { return this.request('validateConfiguration', payload); }
}
