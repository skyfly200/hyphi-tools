import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createOctoPrintClient, OctoPrintError, createSlicingClient, slicerOpenUrl } from '../src/index.js';
import { createSlicingServer } from '../src/server/server.js';

let fake, fakeUrl, fakeHost, log, flags, srv, base;
before(async () => {
  log = []; flags = { operational: true, printing: false };
  fake = http.createServer((req, res) => {
    const chunks = []; req.on('data', c => chunks.push(c)); req.on('end', () => {
      const body = Buffer.concat(chunks).toString('latin1');
      log.push({ method: req.method, url: req.url, key: req.headers['x-api-key'], body });
      if (req.headers['x-api-key'] !== 'KEY') { res.writeHead(403); return res.end('forbidden'); }
      const j = (c, o) => { res.writeHead(c, { 'content-type': 'application/json' }); res.end(JSON.stringify(o)); };
      if (req.url === '/api/version') return j(200, { api: '0.1', server: '1.10.0', text: 'OctoPrint 1.10.0' });
      if (req.url === '/api/printer') return flags.operational === null ? j(409, {}) : j(200, { state: { text: flags.printing ? 'Printing' : 'Operational', flags } });
      if (req.url === '/api/job' && req.method === 'GET') return j(200, { state: 'Operational', progress: {} });
      if (req.url === '/api/job' && req.method === 'POST') return j(204, {}) || 0;
      if (req.url === '/api/files/local') return j(201, { done: true, files: { local: { name: /filename="([^"]+)"/.exec(body)[1], refs: {} } } });
      j(404, {});
    });
  });
  await new Promise(r => fake.listen(0, '127.0.0.1', r)); fakeHost = `127.0.0.1:${fake.address().port}`; fakeUrl = `http://${fakeHost}`;
  srv = createSlicingServer({ apiKeys: ['sk-aaaaaaaaaaaaaaaa'], octoprintHosts: [fakeHost] }); const { port } = await srv.listen(0); base = `http://127.0.0.1:${port}`;
});
after(async () => { await srv.close(); fake.close(); });

test('octoprint client: upload only by default; the file goes to /api/files/local with the key and select/print = false', async () => {
  log.length = 0; const op = createOctoPrintClient({ baseUrl: fakeUrl, apiKey: 'KEY' });
  const r = await op.uploadAndPrint({ name: 'lily.gcode', gcode: 'G28\n' });
  assert.deepEqual([r.uploaded, r.started], ['lily.gcode', false]);
  const up = log.find(l => l.url === '/api/files/local'); assert.equal(up.key, 'KEY'); assert.match(up.body, /name="print"\r\n\r\nfalse/); assert.match(up.body, /G28/);
  assert.equal(log.some(l => l.url === '/api/printer'), false, 'no printer-state check when not printing');
});

test('octoprint client: starting a print needs confirmation, an operational idle printer, and sends print=true', async () => {
  const op = createOctoPrintClient({ baseUrl: fakeUrl, apiKey: 'KEY' });
  await assert.rejects(() => op.uploadAndPrint({ name: 'a.gcode', gcode: 'x', print: true }), /confirmBedClear/);
  flags = { operational: true, printing: true }; await assert.rejects(() => op.uploadAndPrint({ name: 'a.gcode', gcode: 'x', print: true, confirmBedClear: true }), /busy/);
  flags = { operational: false, printing: false }; await assert.rejects(() => op.uploadAndPrint({ name: 'a.gcode', gcode: 'x', print: true, confirmBedClear: true }), /not ready/);
  flags = { operational: true, printing: false }; log.length = 0;
  const r = await op.uploadAndPrint({ name: 'a.gcode', gcode: 'x', print: true, confirmBedClear: true }); assert.equal(r.started, true);
  assert.match(log.find(l => l.url === '/api/files/local').body, /name="print"\r\n\r\ntrue/);
});

test('octoprint client: bad key, bad file names, unreachable host, not connected', async () => {
  await assert.rejects(() => createOctoPrintClient({ baseUrl: fakeUrl, apiKey: 'WRONG' }).version(), /rejected the API key/);
  const op = createOctoPrintClient({ baseUrl: fakeUrl, apiKey: 'KEY' });
  for (const n of ['../evil.gcode', 'a/b.gcode', 'x.exe', '']) await assert.rejects(() => op.uploadAndPrint({ name: n, gcode: 'x' }), /file name/);
  await assert.rejects(() => createOctoPrintClient({ baseUrl: 'http://127.0.0.1:9', apiKey: 'K' }).version(), /cannot reach/);
  flags = { operational: null }; assert.match((await op.state()).text, /not connected/); flags = { operational: true, printing: false };
  assert.throws(() => createOctoPrintClient({ baseUrl: 'ftp://x', apiKey: 'K' }), /http/);
});

test('server bridge: allow-listed host works end to end; other hosts are refused; safety checks still apply', async () => {
  const c = createSlicingClient({ baseUrl: base, apiKey: 'sk-aaaaaaaaaaaaaaaa' });
  const st = await c.octoprint.status({ baseUrl: fakeUrl, apiKey: 'KEY' }); assert.equal(st.state.operational, true); assert.match(st.version.text, /OctoPrint/);
  const up = await c.octoprint.send({ baseUrl: fakeUrl, apiKey: 'KEY', name: 'lily.gcode', gcode: 'G28' }); assert.equal(up.started, false);
  await assert.rejects(() => c.octoprint.send({ baseUrl: fakeUrl, apiKey: 'KEY', name: 'lily.gcode', gcode: 'G28', print: true }), /confirmBedClear/);
  await assert.rejects(() => c.octoprint.status({ baseUrl: 'http://169.254.169.254', apiKey: 'KEY' }), e => e.status === 403 && /not allowed/.test(e.message));
  await assert.rejects(() => c.octoprint.status({ baseUrl: fakeUrl, apiKey: 'WRONG' }), /API key/);
  await assert.rejects(() => createSlicingClient({ baseUrl: base, apiKey: 'nope' }).octoprint.status({ baseUrl: fakeUrl, apiKey: 'KEY' }), e => e.status === 401);
});

test('bambu studio hand-off: builds the open-in-slicer URL and refuses non-downloadable links', () => {
  assert.equal(slicerOpenUrl('https://x.example/a b.3mf'), 'bambustudio://open?file=' + encodeURIComponent('https://x.example/a%20b.3mf'));
  assert.match(slicerOpenUrl('https://x.example/a.stl', 'orcaslicer'), /^orcaslicer:\/\/open\?file=/);
  assert.throws(() => slicerOpenUrl('blob:https://x/1'), /http\(s\)/); assert.throws(() => slicerOpenUrl('nope'), /valid URL/); assert.throws(() => slicerOpenUrl('https://x/a', 'cura'), /unknown slicer/);
});
