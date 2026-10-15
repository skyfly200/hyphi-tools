// Main-thread client for the solver worker.
//
// - Every request carries (requestId, revision, geometryHash).
// - bumpRevision() after an edit: older in-flight requests are cancelled and their
//   promises resolve to { stale: true } — a late result is never applied.
// - Falls back to an in-process service when Worker is unavailable.

import { createSolverService, unpackSamples } from './worker-core.js';

export function createInlineTransport(service = createSolverService()) {
  const t = { onmessage: null, postMessage(m) { Promise.resolve().then(() => service.handle(m, r => t.onmessage?.({ data: r }))); }, terminate() {} };
  return t;
}

export function defaultTransport() {
  if (typeof Worker !== 'undefined') {
    try { return new Worker(new URL('./solver.worker.js', import.meta.url), { type: 'module' }); } catch { /* fall through */ }
  }
  return createInlineTransport();
}

export class SolverClient {
  constructor(transportFactory = defaultTransport) {
    this.factory = transportFactory;
    this.transport = null;
    this.revision = 0;
    this.nextId = 1;
    this.pending = new Map();
    this.geometryHash = null;
  }
  _ensure() {
    if (this.transport) return;
    this.transport = this.factory();
    this.transport.onmessage = e => this._onMessage(e.data);
  }
  _onMessage(m) {
    const p = this.pending.get(m.requestId);
    if (!p) return;
    if (m.revision !== this.revision) {            // edit happened since this was posted
      if (m.type !== 'progress') { this.pending.delete(m.requestId); p.resolve({ stale: true }); }
      return;
    }
    if (m.type === 'progress') { p.onProgress?.(m); return; }
    this.pending.delete(m.requestId);
    if (m.type === 'error') p.reject(Object.assign(new Error(m.error.message), { code: m.error.code }));
    else {
      const r = m.result;
      if (r && r.packedSamples) r.samples = unpackSamples(r.packedSamples);
      if (r && r.steps) for (const s of r.steps) if (s.packedSamples) s.samples = unpackSamples(s.packedSamples);
      p.resolve(r);
    }
  }
  request(op, payload, { onProgress } = {}) {
    this._ensure();
    const requestId = this.nextId++;
    return {
      requestId,
      promise: new Promise((resolve, reject) => {
        this.pending.set(requestId, { resolve, reject, onProgress });
        this.transport.postMessage({ requestId, revision: this.revision, geometryHash: this.geometryHash, op, payload });
      }),
    };
  }
  async compile(assembly, opts = {}) {
    const { promise } = this.request('compileAssembly', { assembly, expandHinges: opts.expandHinges });
    const r = await promise;
    if (r && r.hash) this.geometryHash = r.hash;
    return r;
  }
  solveConfiguration(req) { return this.request('solveConfiguration', req); }
  solveStep(payload, o) { return this.request('solveStep', payload, o); }
  solveSequence(payload, o) { return this.request('solveSequence', payload, o); }
  validate(payload) { return this.request('validateConfiguration', payload); }
  cancel(requestId) {
    this._ensure();
    this.transport.postMessage({ requestId: this.nextId++, revision: this.revision, op: 'cancel', payload: { requestId } });
  }
  /** Call after any edit that invalidates in-flight work. */
  bumpRevision() {
    this.revision++;
    for (const [id, p] of this.pending) { this.cancel(id); p.resolve({ stale: true }); }
    this.pending.clear();
  }
  terminate() { this.transport?.terminate(); this.transport = null; for (const p of this.pending.values()) p.resolve({ stale: true }); this.pending.clear(); }
}
