// One slicing job in a worker thread (keeps the HTTP server responsive and lets a job be terminated).
// mode 'builtin': STL -> built-in slicer -> G-code.   mode 'analyze': G-code text already produced by an external engine.
import { parentPort, workerData } from 'node:worker_threads';
import { loadKernelNode } from '../kernel-node.js';
import { parseSTL, meshToManifold } from '../index.js';
import { resolveProfile, validateProfile } from '../profile.js';
import { generateGcode, parseGcode, analyzeGcode } from '../gcode.js';
import { analyzeNozzles } from '../analyze.js';

const { mode, stl, gcode, profile, nozzles, limits } = workerData;
const post = m => parentPort.postMessage(m);
try {
  const prof = resolveProfile(profile), issues = validateProfile(prof);
  let text = gcode, stats = null, nozzleTable = null;
  if (mode === 'builtin' || nozzles) {
    const K = await loadKernelNode(), tri = parseSTL(stl);
    if (tri.indices.length / 3 > limits.maxTriangles) throw new Error(`model has ${tri.indices.length / 3} triangles; the limit is ${limits.maxTriangles}`);
    const man = meshToManifold(K, tri), bb = man.boundingBox();
    if (nozzles) nozzleTable = analyzeNozzles(K, man, { lineWidthFactor: prof.lineWidthFactor });
    if (mode === 'builtin') {
      const layers = Math.ceil((bb.max[2] - bb.min[2]) / prof.layerHeightMm);
      if (layers > limits.maxLayers) throw new Error(`${layers} layers exceeds the limit of ${limits.maxLayers}`);
      let last = 0;
      const g = generateGcode(K, man, prof, { onProgress: p => { if (p - last > 0.02) { last = p; post({ type: 'progress', progress: p }); } } });
      text = g.gcode; stats = { timeS: g.stats.timeS, filamentMm: g.stats.filamentMm, layers: g.stats.layers, fitsBed: g.stats.fitsBed, lostVolumeMm3: g.stats.lostAreaMm2 };
    }
  }
  const analysis = analyzeGcode(parseGcode(text), { nozzleMm: prof.nozzleMm, filamentDiameterMm: prof.filamentDiameterMm });
  post({ type: 'done', gcode: text, summary: { engine: mode === 'builtin' ? 'builtin' : 'external', profileIssues: issues, stats, analysis, nozzleTable } });
} catch (e) { post({ type: 'error', message: String(e.message || e) }); }
