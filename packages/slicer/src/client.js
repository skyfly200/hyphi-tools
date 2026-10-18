// Client for the hosted slicing server (browser or Node; needs fetch).
//   const c = createSlicingClient({ baseUrl: 'https://slicer.example.com', apiKey });
//   const { gcode, summary } = await c.slice({ stl, profile, engine: 'builtin', nozzles: true }, { onProgress });

export class SlicingError extends Error { constructor(message, status) { super(message); this.status = status; } }

export function createSlicingClient({ baseUrl, apiKey = '', fetch: f = globalThis.fetch } = {}) {
  const base = String(baseUrl || '').replace(/\/+$/, '');
  if (!base) throw new Error('baseUrl is required');
  const headers = (extra = {}) => ({ ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {}), ...extra });
  async function call(path, init = {}, text = false) {
    let res;
    try { res = await f(`${base}${path}`, { ...init, headers: headers(init.headers) }); } catch (e) { throw new SlicingError(`cannot reach ${base}: ${e.message}`, 0); }
    if (!res.ok) { let msg = res.statusText; try { msg = (await res.json()).error || msg; } catch { /* not json */ } throw new SlicingError(msg, res.status); }
    return text ? res.text() : res.json();
  }
  const api = {
    health: () => call('/health'),
    profiles: () => call('/v1/profiles').then(r => r.profiles),
    /** stl: Uint8Array | ArrayBuffer. Returns the queued job. */
    submit: ({ stl, profile = {}, engine = 'builtin', nozzles = false }) =>
      call('/v1/jobs', { method: 'POST', headers: { 'content-type': 'application/octet-stream', 'x-slice-options': encodeURIComponent(JSON.stringify({ profile, engine, nozzles })) }, body: stl }),
    get: id => call(`/v1/jobs/${id}`),
    gcode: id => call(`/v1/jobs/${id}/gcode`, {}, true),
    cancel: id => call(`/v1/jobs/${id}`, { method: 'DELETE' }),
    /** Submit, poll until finished, fetch the G-code. Abort with `signal` (cancels the remote job). */
    async slice(spec, { onProgress, signal, pollMs = 700, timeoutMs = 10 * 60 * 1000 } = {}) {
      let job = await api.submit(spec); const t0 = Date.now();
      const abort = () => api.cancel(job.id).catch(() => {});
      signal?.addEventListener('abort', abort, { once: true });
      try {
        while (job.status === 'queued' || job.status === 'running') {
          if (signal?.aborted) throw new SlicingError('cancelled', 0);
          if (Date.now() - t0 > timeoutMs) { await abort(); throw new SlicingError('timed out waiting for the server', 0); }
          onProgress?.(job);
          await new Promise(r => setTimeout(r, pollMs));
          try { job = await api.get(job.id); } catch (e) { if (signal?.aborted) throw new SlicingError('cancelled', 0); throw e; }
        }
        if (job.status !== 'done') throw new SlicingError(job.error || `job ${job.status}`, 0);
        onProgress?.(job);
        return { id: job.id, summary: job.summary, gcode: await api.gcode(job.id) };
      } finally { signal?.removeEventListener('abort', abort); }
    },
  };
  return api;
}
