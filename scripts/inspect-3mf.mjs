#!/usr/bin/env node
// Open a slicer project 3MF: recover its settings, read its model with the build transforms, re-slice it with the
// built-in slicer and run the nozzle analysis. Cross-checks our first-layer time against the project's own estimate.
//   node scripts/inspect-3mf.mjs project.3mf [--gcode-out out.gcode]
import { readFileSync, writeFileSync } from 'node:fs';
import { importProfile, read3MFModel, readZip, meshToManifold, generateGcode, analyzeNozzles, parseGcode, analyzeGcode } from '@hyphi/slicer';
import { loadKernelNode } from '@hyphi/slicer/kernel-node';

const file = process.argv[2]; if (!file) { console.error('usage: inspect-3mf.mjs project.3mf [--gcode-out out.gcode]'); process.exit(2); }
const bytes = new Uint8Array(readFileSync(file)), imp = await importProfile(bytes, file.split('/').pop()), model = await read3MFModel(bytes);
const K = await loadKernelNode(), man = meshToManifold(K, model), bb = man.boundingBox();
const out = { settings: { source: imp.source, profile: imp.profile, notes: imp.notes } };
out.model = { triangles: model.indices.length / 3, sizeMm: bb.max.map((v, i) => +(v - bb.min[i]).toFixed(3)), min: bb.min.map(v => +v.toFixed(3)), volumeMm3: +man.volume().toFixed(1), genus: man.genus() };
const prof = { ...imp.resolved, originAtCentre: false };
const g = generateGcode(K, man, prof, { place: 'none' });
const a = analyzeGcode(parseGcode(g.gcode), { nozzleMm: prof.nozzleMm, filamentDiameterMm: prof.filamentDiameterMm });
out.reslice = { layers: g.stats.layers, estTimeS: Math.round(g.stats.timeS), filamentM: +(g.stats.filamentMm / 1000).toFixed(2), unprintedVolumeMm3: +g.stats.lostAreaMm2.toFixed(2), features: a.features, issues: a.issues };
const thinnest = g.layers.length ? Math.min(...g.layers.map(l => l.h)) : prof.layerHeightMm;
out.nozzles = analyzeNozzles(K, man, { lineWidthFactor: prof.lineWidthFactor, maxLayerHeightMm: thinnest }).table.map(r => ({ nozzleMm: r.nozzleMm, lostPct: r.lostPct, thinPct: r.thinPct, layerOk: r.layerOk }));
const z = await readZip(bytes), pj = z['Metadata/plate_1.json'];
if (pj) { const j = JSON.parse(new TextDecoder().decode(pj)); out.projectEstimate = { firstLayerTimeS: j.first_layer_time, nozzleMm: j.nozzle_diameter, bed: j.bed_type, bbox: j.bbox_all }; }
if (process.argv.includes('--gcode-out')) writeFileSync(process.argv[process.argv.indexOf('--gcode-out') + 1], g.gcode);
console.log(JSON.stringify(out, null, 1));
