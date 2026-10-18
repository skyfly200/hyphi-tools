// Worker plumbing shared by every solver-backed application: a transport-agnostic service and a
// main-thread client. Works inside a real Web Worker or fully in-process (tests, SSR, fallback).
//
// Request:  { requestId, revision, key, op, payload }
// Responses (zero or more `progress`, then exactly one terminal message):
//   { type:'progress'|'result'|'error', requestId, revision, key, ... }
//
// Guarantees:
//  - `cancel` is processed between bounded solver batches (handlers `await ctx.yield()`), with worker
//    termination as the hard fallback.
//  - bumpRevision() after an edit cancels in-flight work and discards late results as { stale: true }.

const tick = () => new Promise(r => setTimeout(r, 0));

/**
 * @param {Record<string, (payload:any, ctx:{post:Function, isCancelled:()=>boolean, yield:()=>Promise<void>, key:any, requestId:any, setKey:(k:any)=>void}) => Promise<any>|any>} handlers
 */
export function createService(handlers) {
  const cancelled = new Set();
  async function handle(msg, post) {
    const { requestId, revision, op, payload } = msg;
    let key = msg.key;
    const base = () => ({ requestId, revision, key });
    const ctx = {
      post: m => post({ type: 'progress', ...base(), ...m }),
      isCancelled: () => cancelled.has(requestId),
      yield: tick, get key() { return key; }, requestId, setKey: k => { key = k; },
    };
    try {
      if (op === 'cancel') { cancelled.add(payload.requestId); post({ type: 'result', ...base(), result: { cancelled: payload.requestId } }); return; }
      const fn = handlers[op];
      if (!fn) throw Object.assign(new Error(`unknown op ${op}`), { code: 'badRequest' });
      const result = await fn(payload, ctx);
      post({ type: 'result', ...base(), result });
    } catch (e) {
      post({ type: 'error', ...base(), error: { code: e.code || 'workerError', message: e.message } });
    } finally { cancelled.delete(requestId); }
  }
  return { handle };
}

/** In-process transport (no Worker). */
export function createInlineTransport(service) {
  const t = { onmessage: null, postMessage(m) { Promise.resolve().then(() => service.handle(m, r => t.onmessage?.({ data: r }))); }, terminate() {} };
  return t;
}

export class WorkerClient {
  /** @param {() => {postMessage:Function, terminate:Function, onmessage:any}} transportFactory */
  constructor(transportFactory, { unpack } = {}) {
    this.factory = transportFactory; this.unpack = unpack;
    this.transport = null; this.revision = 0; this.nextId = 1; this.pending = new Map(); this.key = null;
  }
  _ensure() { if (this.transport) return; this.transport = this.factory(); this.transport.onmessage = e => this._onMessage(e.data); }
  _onMessage(m) {
    const p = this.pending.get(m.requestId); if (!p) return;
    if (m.revision !== this.revision) { if (m.type !== 'progress') { this.pending.delete(m.requestId); p.resolve({ stale: true }); } return; }
    if (m.type === 'progress') { p.onProgress?.(m); return; }
    this.pending.delete(m.requestId);
    if (m.type === 'error') p.reject(Object.assign(new Error(m.error.message), { code: m.error.code }));
    else p.resolve(this.unpack ? this.unpack(m.result) : m.result);
  }
  /** @returns {{requestId:number, promise:Promise<any>}} */
  request(op, payload, { onProgress } = {}) {
    this._ensure();
    const requestId = this.nextId++;
    return { requestId, promise: new Promise((resolve, reject) => {
      this.pending.set(requestId, { resolve, reject, onProgress });
      this.transport.postMessage({ requestId, revision: this.revision, key: this.key, op, payload });
    }) };
  }
  cancel(requestId) { this._ensure(); this.transport.postMessage({ requestId: this.nextId++, revision: this.revision, op: 'cancel', payload: { requestId } }); }
  bumpRevision() { this.revision++; for (const [id, p] of this.pending) { this.cancel(id); p.resolve({ stale: true }); } this.pending.clear(); }
  terminate() { this.transport?.terminate(); this.transport = null; for (const p of this.pending.values()) p.resolve({ stale: true }); this.pending.clear(); }
}

/** Float64Array packing for cheap transfer of sample sets. */
export function packVectors(rows) {
  const n = rows.length, k = n ? rows[0].length : 0, data = new Float64Array(n * k);
  rows.forEach((r, i) => data.set(r, i * k));
  return { data, count: n, width: k };
}
export function unpackVectors({ data, count, width }) {
  return Array.from({ length: count }, (_, i) => Array.from(data.subarray(i * width, (i + 1) * width)));
}
