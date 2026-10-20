#!/usr/bin/env node
// Repeatable slicing: one profile file in, G-code + analysis out.
//   node scripts/slice.mjs part.stl --profile slicer-profiles/petg-0.4-standard.json [--out part.gcode]
//        [--server https://slicer.example.com --key $SLICER_KEY]   (slice on a hosted server instead of locally)
//        [--engine builtin|prusa|orca] [--nozzles]   (--nozzles: recommend a nozzle from the geometry first)
// builtin = the preview slicer in @hyphi/slicer; prusa = `prusa-slicer --export-gcode` with the same profile
// (production-quality G-code). Either way the result goes through the same G-code analysis.
import { readFileSync, writeFileSync } from 'node:fs';
import { loadKernel } from '../src/facetfold/lib/kernel.js';
import { runExternalSlicer } from '@hyphi/slicer/external';
import { createSlicingClient, resolveProfile, validateProfile, parseSTL, meshToManifold, generateGcode, parseGcode, analyzeGcode, analyzeNozzles } from '@hyphi/slicer';

const args = process.argv.slice(2), flag = n => args.includes(`--${n}`), opt = n => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : undefined; };
const stl = args.find(a => !a.startsWith('--') && /\.stl$/i.test(a));
if (!stl) { console.error('usage: slice.mjs part.stl [--profile p.json] [--out out.gcode] [--engine builtin|prusa|orca] [--nozzles]'); process.exit(2); }
const prof = resolveProfile({ ...(opt('profile') ? JSON.parse(readFileSync(opt('profile'), 'utf8')) : {}), ...(opt('nozzle') ? { nozzleMm: +opt('nozzle') } : {}) });
const issues = validateProfile(prof);
issues.forEach(i => console.error(`${i.level}: ${i.message}`));
if (issues.some(i => i.level === 'error')) process.exit(1);
const out = opt('out') || stl.replace(/\.stl$/i, '') + '.gcode';

if (opt('server')) {
  const key = opt('key') || process.env.SLICER_KEY || '', ac = new AbortController();
  process.on('SIGINT', () => ac.abort());
  const r = await createSlicingClient({ baseUrl: opt('server'), apiKey: key }).slice({ stl: readFileSync(stl), profile: prof, engine: opt('engine') || 'builtin', nozzles: flag('nozzles') },
    { signal: ac.signal, onProgress: j => process.stderr.write(`\r${j.status} ${Math.round((j.progress || 0) * 100)}%   `) });
  process.stderr.write('\n'); writeFileSync(out, r.gcode);
  console.log(JSON.stringify({ profile: prof.name, engine: `server:${opt('engine') || 'builtin'}`, gcode: out, ...r.summary }, null, 2)); process.exit(0);
}
const K = await loadKernel(), model = meshToManifold(K, parseSTL(readFileSync(stl)));
const summary = { profile: prof.name, engine: opt('engine') || 'builtin' };
if (flag('nozzles')) { const a = analyzeNozzles(K, model, { lineWidthFactor: prof.lineWidthFactor }); summary.nozzles = a.table; summary.recommendedNozzle = a.recommended; if (a.recommended.nozzleMm !== prof.nozzleMm) console.error(`note: profile uses a ${prof.nozzleMm} mm nozzle; analysis recommends ${a.recommended.nozzleMm} mm (${a.recommended.reason})`); }
if (summary.engine === 'prusa' || summary.engine === 'orca') {
  const path = process.env[summary.engine === 'prusa' ? 'PRUSA_SLICER' : 'ORCA_SLICER'] || (summary.engine === 'prusa' ? 'prusa-slicer' : 'orca-slicer');
  try { writeFileSync(out, await runExternalSlicer(summary.engine, { stl: readFileSync(stl), profile: prof, config: { path, wrapper: process.env.ORCA_XVFB === '1' ? ['xvfb-run', '-a'] : undefined } })); }
  catch (e) { console.error(e.message); process.exit(1); }
} else { const g = generateGcode(K, model, prof); writeFileSync(out, g.gcode); summary.fitsBed = g.stats.fitsBed; summary.lostVolumeMm3 = +g.stats.lostAreaMm2.toFixed(2); }
summary.gcode = out; summary.analysis = analyzeGcode(parseGcode(readFileSync(out, 'utf8')), { nozzleMm: prof.nozzleMm, filamentDiameterMm: prof.filamentDiameterMm });
console.log(JSON.stringify(summary, null, 2));
