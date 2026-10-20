// OctoPrint REST client (browser or Node, needs fetch / FormData / Blob). Used directly, or through the slicing server's
// bridge (/v1/octoprint/*) because an https page cannot call a plain-http OctoPrint on your network (mixed content) and
// OctoPrint needs CORS switched on for cross-origin browser calls.
//
// Starting a print moves a real machine, so it is opt-in: uploadAndPrint uploads only unless print is true, and a print
// needs confirmBedClear plus an operational, idle printer.

export class OctoPrintError extends Error { constructor(message, status) { super(message); this.status = status; } }

export function createOctoPrintClient({ baseUrl, apiKey, fetch: f = globalThis.fetch } = {}) {
  const base = String(baseUrl || '').replace(/\/+$/, '');
  if (!/^https?:\/\//.test(base)) throw new OctoPrintError('OctoPrint URL must start with http:// or https://', 0);
  if (!apiKey) throw new OctoPrintError('an OctoPrint API key is required', 0);
  async function call(path, init = {}) {
    let res;
    try { res = await f(`${base}${path}`, { ...init, headers: { 'x-api-key': apiKey, ...(init.headers || {}) } }); } catch (e) { throw new OctoPrintError(`cannot reach OctoPrint at ${base}: ${e.message}`, 0); }
    if (res.status === 403 || res.status === 401) throw new OctoPrintError('OctoPrint rejected the API key', res.status);
    if (!res.ok) { let m = res.statusText; try { m = (await res.text()).slice(0, 200) || m; } catch { /* ignore */ } throw new OctoPrintError(`OctoPrint: ${m}`, res.status); }
    return res.status === 204 ? null : res.json().catch(() => null);
  }
  const api = {
    version: () => call('/api/version'),
    /** { operational, printing, paused, text } — a printer that is not connected answers 409. */
    async state() {
      try { const r = await call('/api/printer'), fl = r.state?.flags || {}; return { operational: !!fl.operational, printing: !!(fl.printing || fl.paused || fl.pausing || fl.cancelling), paused: !!fl.paused, text: r.state?.text || '' }; }
      catch (e) { if (e.status === 409) return { operational: false, printing: false, paused: false, text: 'printer not connected to OctoPrint' }; throw e; }
    },
    job: () => call('/api/job'),
    cancel: () => call('/api/job', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ command: 'cancel' }) }),
    /** Upload G-code; with print:true also select and start it (after the safety checks). */
    async uploadAndPrint({ name, gcode, print = false, confirmBedClear = false }) {
      if (!/^[\w][\w .()+-]*\.(gcode|gco)$/i.test(name || '')) throw new OctoPrintError('file name must be plain letters/digits and end in .gcode', 0);
      if (!gcode) throw new OctoPrintError('no G-code to send', 0);
      if (print) {
        if (!confirmBedClear) throw new OctoPrintError('starting a print needs confirmBedClear (the bed must be clear and someone nearby)', 0);
        const st = await api.state();
        if (!st.operational) throw new OctoPrintError(`printer is not ready (${st.text})`, 0);
        if (st.printing) throw new OctoPrintError('the printer is busy with another job', 0);
      }
      const form = new FormData();
      form.append('file', new Blob([gcode], { type: 'text/plain' }), name); form.append('select', print ? 'true' : 'false'); form.append('print', print ? 'true' : 'false');
      const r = await call('/api/files/local', { method: 'POST', body: form });
      return { uploaded: r?.files?.local?.name || name, started: print, refs: r?.files?.local?.refs };
    },
  };
  return api;
}
