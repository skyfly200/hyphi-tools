import test, { before } from 'node:test';
import assert from 'node:assert/strict';
import { deflateRawSync } from 'node:zlib';
import { loadKernelNode } from '../src/kernel-node.js';
import { extractSettings, profileFromSettings, importProfile, measureGcode, readZip, generateGcode, resolveProfile } from '../src/index.js';
import { buildZip } from '../../../src/lib/zip.js';

let K;
before(async () => { K = await loadKernelNode(); });

const PRUSA = `G1 X1 Y1 E0.1\n; prusaslicer_config = begin\n; bed_shape = 0x0,250x0,250x210,0x210\n; bed_temperature = 85\n; layer_height = 0.15\n; first_layer_height = 0.2\n; perimeters = 3\n; top_solid_layers = 5\n; bottom_solid_layers = 4\n; fill_density = 20%\n; nozzle_diameter = 0.4\n; filament_diameter = 1.75\n; filament_type = PETG\n; temperature = 245\n; retract_length = 0.7\n; perimeter_speed = 45\n; external_perimeter_speed = 25\n; infill_speed = 70\n; first_layer_speed = 50%\n; extrusion_width = 0.45\n; printer_model = MK3S\n; prusaslicer_config = end\n`;
const ORCA = `; header\n; CONFIG_BLOCK_START\n; layer_height = 0.2\n; initial_layer_print_height = 0.2\n; wall_loops = 2\n; top_shell_layers = 5\n; sparse_infill_density = 15%\n; nozzle_diameter = 0.4\n; filament_diameter = 1.75\n; filament_type = PETG\n; nozzle_temperature = 250\n; curr_bed_type = Textured PEI Plate\n; textured_plate_temp = 75\n; cool_plate_temp = 60\n; outer_wall_speed = 30\n; printable_area = 0x0,180x0,180x180,0x180\n; printer_model = Bambu Lab A1 mini\n; filament_flow_ratio = 0.95\n; CONFIG_BLOCK_END\n`;

test('prusa gcode: the embedded config becomes a profile, percent-relative speeds are skipped, printer is recognised', async () => {
  const r = await importProfile(PRUSA, 'part.gcode');
  assert.equal(r.source, 'prusa');
  const p = r.profile;
  assert.equal(p.layerHeightMm, 0.15); assert.equal(p.walls, 3); assert.equal(p.topLayers, 5); assert.equal(p.infillPct, 20); assert.equal(p.nozzleC, 245); assert.equal(p.bedC, 85);
  assert.equal(p.material, 'PETG'); assert.equal(p.printer, 'prusa-mk3s'); assert.equal(p.lineWidthMm, 0.45);
  assert.equal(p.speed.outerWall, 25); assert.equal(p.speed.innerWall, 45); assert.equal(p.speed.first, undefined);
  assert.ok(r.notes.some(n => /first_layer_speed/.test(n)));
  assert.equal(r.resolved.layerHeightMm, 0.15);
});

test('orca gcode: plate-dependent bed temperature, plate and printer recognised', async () => {
  const r = await importProfile(ORCA, 'a1.gcode');
  assert.equal(r.source, 'orca');
  assert.equal(r.profile.bedC, 75); assert.equal(r.profile.plate, 'textured'); assert.equal(r.profile.printer, 'bambu-a1-mini'); assert.equal(r.profile.flowMultiplier, 0.95); assert.equal(r.profile.speed.outerWall, 30);
});

test('3mf: deflated Orca/Bambu project settings (JSON arrays) and a stored Prusa Slic3r_PE.config', async () => {
  const json = JSON.stringify({ layer_height: '0.1', nozzle_diameter: ['0.4'], nozzle_temperature: ['245'], filament_type: ['PETG'], curr_bed_type: 'Textured PEI Plate', textured_plate_temp: ['78'], wall_loops: '2', printable_area: ['0x0', '180x0', '180x180', '0x180'] });
  // hand-built deflated zip
  const name = Buffer.from('Metadata/project_settings.config'), data = Buffer.from(json), comp = deflateRawSync(data);
  const lh = Buffer.alloc(30); lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(8, 8); lh.writeUInt32LE(comp.length, 18); lh.writeUInt32LE(data.length, 22); lh.writeUInt16LE(name.length, 26);
  const cd = Buffer.alloc(46); cd.writeUInt32LE(0x02014b50, 0); cd.writeUInt16LE(8, 10); cd.writeUInt32LE(comp.length, 20); cd.writeUInt32LE(data.length, 24); cd.writeUInt16LE(name.length, 28);
  const local = Buffer.concat([lh, name, comp]), cdir = Buffer.concat([cd, name]), eocd = Buffer.alloc(22); eocd.writeUInt32LE(0x06054b50, 0); eocd.writeUInt16LE(1, 8); eocd.writeUInt16LE(1, 10); eocd.writeUInt32LE(cdir.length, 12); eocd.writeUInt32LE(local.length, 16);
  const zip = new Uint8Array(Buffer.concat([local, cdir, eocd]));
  assert.ok((await readZip(zip))['Metadata/project_settings.config']);
  const r = await importProfile(zip, 'proj.3mf');
  assert.equal(r.source, 'orca'); assert.equal(r.profile.layerHeightMm, 0.1); assert.equal(r.profile.bedC, 78); assert.equal(r.profile.printer, 'bambu-a1-mini'); assert.equal(r.profile.nozzleC, 245);
  const stored = buildZip({ 'Metadata/Slic3r_PE.config': '; layer_height = 0.3\n; perimeters = 2\n; nozzle_diameter = 0.6\n' });
  const r2 = await importProfile(new Uint8Array(stored), 'p.3mf');
  assert.equal(r2.source, 'prusa'); assert.equal(r2.profile.nozzleMm, 0.6); assert.equal(r2.profile.layerHeightMm, 0.3);
  await assert.rejects(() => importProfile(new Uint8Array(buildZip({ 'a.txt': 'x' })), 'x.3mf'), /no slicer settings/);
});

test('no embedded config: settings are measured from toolpaths, and an extrusion wider than configured is called out', async () => {
  const prof = resolveProfile({ layerHeightMm: 0.12, firstLayerHeightMm: 0.12, nozzleC: 233, bedC: 71, fanPct: 60, retractMm: 0.6, speed: { outerWall: 28 } });
  const g = generateGcode(K, K.Manifold.cube([12, 12, 2]), prof).gcode;
  const m = measureGcode(g, { nozzleMm: 0.4 });
  assert.equal(m.layerHeightMm, 0.12); assert.equal(m.nozzleC, 233); assert.equal(m.bedC, 71); assert.equal(m.fanPct, 60); assert.equal(m.retractMm, 0.6); assert.equal(m.speedMmS.outer, 28);
  assert.ok(Math.abs(m.outerWidthMm - prof.lineWidthMm) < 0.02);
  const r = await importProfile(g, 'ours.gcode');
  assert.equal(r.source, 'none'); assert.equal(r.profile.layerHeightMm, 0.12); assert.equal(r.profile.speed.outerWall, 28);
  assert.ok(r.notes.some(n => /measured from the toolpaths/.test(n)));
  // over-extruded file: same toolpaths with 25 % more E
  const fat = g.replace(/^(G1 X\S+ Y\S+) E(\S+)/gm, (_, a, e) => `${a} E${(+e * 1.25).toFixed(5)}`);
  const rf = await importProfile(`; CONFIG_BLOCK_START\n; nozzle_diameter = 0.4\n; layer_height = 0.12\n; CONFIG_BLOCK_END\n${fat}`, 'fat.gcode');
  assert.ok(rf.notes.some(n => /wide in the G-code/.test(n)), rf.notes.join('|'));
});

test('files without settings are reported, not guessed', async () => {
  const ex = await extractSettings('G1 X1 Y1 E0.1\n', 'plain.gcode'); assert.equal(ex.source, 'none');
  assert.ok(profileFromSettings({ source: 'orca', settings: {} }).notes.some(n => /no recognisable/.test(n)));
});
