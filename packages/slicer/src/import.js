// Recover slicing settings from files you already have: G-code (slicers embed their full config as comments),
// slicer project / G-code 3MF files, and, as a fallback and cross-check, the toolpaths themselves.
//   PrusaSlicer  .gcode  "; prusaslicer_config = begin … end"      .3mf  Metadata/Slic3r_PE.config
//   OrcaSlicer / Bambu Studio  .gcode  "; CONFIG_BLOCK_START … END" .3mf / .gcode.3mf  Metadata/project_settings.config (JSON)
//   Cura  .gcode  ";SETTING_3 …" block (partial)
// Everything is best effort: key names are matched, not guaranteed for every slicer version.

import { resolveProfile, PRINTERS, MATERIALS } from './profile.js';
import { parseGcode, analyzeGcode } from './gcode.js';

/** Read the entries of a ZIP (stored or deflate). Returns { name: Uint8Array }. Async (uses DecompressionStream). */
export async function readZip(bytes) {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes), dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  let e = u8.length - 22; while (e >= 0 && dv.getUint32(e, true) !== 0x06054b50) e--;
  if (e < 0) throw new Error('not a ZIP file');
  const n = dv.getUint16(e + 10, true); let p = dv.getUint32(e + 16, true); const out = {};
  for (let i = 0; i < n; i++) {
    if (dv.getUint32(p, true) !== 0x02014b50) throw new Error('corrupt ZIP directory');
    const method = dv.getUint16(p + 10, true), csize = dv.getUint32(p + 20, true), nameLen = dv.getUint16(p + 28, true), extraLen = dv.getUint16(p + 30, true), cmtLen = dv.getUint16(p + 32, true), off = dv.getUint32(p + 42, true);
    const name = new TextDecoder().decode(u8.subarray(p + 46, p + 46 + nameLen)); p += 46 + nameLen + extraLen + cmtLen;
    const ds = off + 30 + dv.getUint16(off + 26, true) + dv.getUint16(off + 28, true), raw = u8.subarray(ds, ds + csize);
    if (method === 0) out[name] = raw;
    else if (method === 8) { const s = new Blob([raw]).stream().pipeThrough(new DecompressionStream('deflate-raw')); out[name] = new Uint8Array(await new Response(s).arrayBuffer()); }
    else throw new Error(`unsupported ZIP compression (${method}) for ${name}`);
  }
  return out;
}

const text = u8 => new TextDecoder().decode(u8);
function kvLines(lines, prefix = ';') {
  const out = {};
  for (const l of lines) { const m = /^\s*;?\s*([A-Za-z0-9_.\[\]]+)\s*=\s*(.*)$/.exec(l.startsWith(prefix) ? l.slice(prefix.length) : l); if (m) out[m[1]] = m[2].trim(); }
  return out;
}

/**
 * Find the embedded settings in a G-code text or a 3MF (bytes).
 * @returns {Promise<{ source: 'prusa'|'orca'|'cura'|'none', settings: object, gcode?: string, from: string }>}
 */
export async function extractSettings(input, filename = '') {
  const isZip = typeof input !== 'string' && input.length > 3 && input[0] === 0x50 && input[1] === 0x4b;
  if (isZip) {
    const z = await readZip(input), names = Object.keys(z);
    const pick = re => names.find(n => re.test(n));
    const gc = pick(/\.gcode$/i), gcode = gc ? text(z[gc]) : undefined;
    const proj = pick(/Metadata\/project_settings\.config$/i), pe = pick(/Metadata\/Slic3r_PE\.config$/i);
    if (proj) { let j; try { j = JSON.parse(text(z[proj])); } catch { throw new Error('project_settings.config is not valid JSON'); } return { source: 'orca', settings: flatten(j), gcode, from: `${filename || '3mf'}:${proj}` }; }
    if (pe) return { source: 'prusa', settings: kvLines(text(z[pe]).split(/\r?\n/)), gcode, from: `${filename || '3mf'}:${pe}` };
    if (gcode) return extractSettings(gcode, `${filename}:${gc}`);
    throw new Error('this 3MF has no slicer settings (no project_settings.config, Slic3r_PE.config or G-code)');
  }
  const t = input, lines = t.split(/\r?\n/);
  const b = lines.findIndex(l => /^;\s*CONFIG_BLOCK_START/.test(l)), eIdx = lines.findIndex(l => /^;\s*CONFIG_BLOCK_END/.test(l));
  if (b >= 0 && eIdx > b) return { source: 'orca', settings: kvLines(lines.slice(b + 1, eIdx)), gcode: t, from: filename || 'gcode' };
  const pb = lines.findIndex(l => /^;\s*(prusaslicer|slic3r|superslicer)_config\s*=\s*begin/i.test(l)), pe = lines.findIndex(l => /^;\s*(prusaslicer|slic3r|superslicer)_config\s*=\s*end/i.test(l));
  if (pb >= 0 && pe > pb) return { source: 'prusa', settings: kvLines(lines.slice(pb + 1, pe)), gcode: t, from: filename || 'gcode' };
  const cura = lines.filter(l => /^;SETTING_\d+/.test(l)).map(l => l.replace(/^;SETTING_\d+\s*/, '')).join('').replace(/^"|"$/g, '');
  if (cura) { const s = {}; for (const m of cura.matchAll(/([a-z_]+)\s*=\s*([^\\\n]*?)(?=\s*\\n|$)/g)) s[m[1]] = m[2].trim(); return { source: 'cura', settings: s, gcode: t, from: filename || 'gcode' }; }
  return { source: 'none', settings: {}, gcode: t, from: filename || 'gcode' };
}

function flatten(j) { const o = {}; for (const [k, v] of Object.entries(j)) o[k] = Array.isArray(v) ? v.join(',') : typeof v === 'object' && v ? JSON.stringify(v) : String(v); return o; }
const first = v => (v == null ? undefined : String(v).split(/[,;]/)[0].trim());
const num = v => { const x = parseFloat(first(v)); return Number.isFinite(x) ? x : undefined; };
const pct = v => { const x = parseFloat(String(v)); return Number.isFinite(x) ? x : undefined; };

const MAP = {
  prusa: { nozzleMm: ['nozzle_diameter'], filamentDiameterMm: ['filament_diameter'], layerHeightMm: ['layer_height'], firstLayerHeightMm: ['first_layer_height'], walls: ['perimeters'], topLayers: ['top_solid_layers'], bottomLayers: ['bottom_solid_layers'],
    infillPct: ['fill_density'], nozzleC: ['temperature'], bedC: ['bed_temperature'], fanPct: ['max_fan_speed'], retractMm: ['retract_length'], skirtLoops: ['skirts'], skirtDistanceMm: ['skirt_distance'],
    'speed.outerWall': ['external_perimeter_speed'], 'speed.innerWall': ['perimeter_speed'], 'speed.infill': ['infill_speed'], 'speed.solid': ['solid_infill_speed'], 'speed.first': ['first_layer_speed'], 'speed.travel': ['travel_speed'], lineWidthMm: ['perimeter_extrusion_width', 'extrusion_width'], flowMultiplier: ['extrusion_multiplier'] },
  orca: { nozzleMm: ['nozzle_diameter'], filamentDiameterMm: ['filament_diameter'], layerHeightMm: ['layer_height'], firstLayerHeightMm: ['initial_layer_print_height'], walls: ['wall_loops'], topLayers: ['top_shell_layers'], bottomLayers: ['bottom_shell_layers'],
    infillPct: ['sparse_infill_density'], nozzleC: ['nozzle_temperature'], retractMm: ['retraction_length'], skirtLoops: ['skirt_loops'], skirtDistanceMm: ['skirt_distance'], fanPct: ['fan_max_speed'],
    'speed.outerWall': ['outer_wall_speed'], 'speed.innerWall': ['inner_wall_speed'], 'speed.infill': ['sparse_infill_speed'], 'speed.solid': ['internal_solid_infill_speed'], 'speed.first': ['initial_layer_speed'], 'speed.travel': ['travel_speed'], lineWidthMm: ['outer_wall_line_width', 'line_width'], flowMultiplier: ['filament_flow_ratio'] },
  cura: { nozzleMm: ['machine_nozzle_size'], layerHeightMm: ['layer_height'], firstLayerHeightMm: ['layer_height_0'], infillPct: ['infill_sparse_density'], nozzleC: ['material_print_temperature'], bedC: ['material_bed_temperature'], retractMm: ['retraction_amount'], lineWidthMm: ['line_width'],
    'speed.outerWall': ['speed_wall_0'], 'speed.innerWall': ['speed_wall_x'], 'speed.infill': ['speed_infill'], 'speed.travel': ['speed_travel'], 'speed.first': ['speed_layer_0'] },
};

function guessMaterial(t) { const s = String(t || '').toUpperCase(); return ['PETG', 'PLA', 'TPU', 'PVB'].find(m => s.includes(m)) || (s.includes('PCTG') ? 'PETG' : undefined); }
function guessPlate(s) { const t = String(s || '').toLowerCase(); return /textured/.test(t) ? 'textured' : /smooth|cool|engineering|high temp|glass/.test(t) ? 'smooth' : /holo/.test(t) ? 'holographic' : undefined; }
function guessPrinter(set) {
  const area = String(set.bed_shape || set.printable_area || ''), m = [...area.matchAll(/(\d+(?:\.\d+)?)x(\d+(?:\.\d+)?)/g)].map(x => [+x[1], +x[2]]), bed = m.length ? { x: Math.max(...m.map(p => p[0])), y: Math.max(...m.map(p => p[1])) } : null;
  const name = `${set.printer_model || ''} ${set.printer_settings_id || ''} ${set.printer_notes || ''}`.toLowerCase();
  for (const [id, pr] of Object.entries(PRINTERS)) if (id !== 'generic' && ((/a1 ?mini/.test(name) && id === 'bambu-a1-mini') || (/mk3/.test(name) && id === 'prusa-mk3s') || (bed && bed.x === pr.bed.x && bed.y === pr.bed.y))) return { id, bed };
  return { id: undefined, bed };
}

/**
 * Turn extracted settings into a @hyphi/slicer profile.
 * @returns {{ profile, found: {key,from,value}[], notes: string[], source }}
 */
export function profileFromSettings({ source, settings }, { name = 'imported' } = {}) {
  const map = MAP[source] || {}, p = { speed: {} }, found = [], notes = [];
  const set = (key, value, from) => { if (value === undefined || Number.isNaN(value)) return; if (key.startsWith('speed.')) p.speed[key.slice(6)] = value; else p[key] = value; found.push({ key, from, value }); };
  for (const [key, srcKeys] of Object.entries(map)) {
    const k = srcKeys.find(sk => settings[sk] !== undefined && settings[sk] !== ''); if (!k) continue;
    const raw = settings[k];
    if (key.startsWith('speed.') && String(raw).includes('%')) { notes.push(`${k} is "${raw}" (relative to another speed); skipped`); continue; }
    if (key === 'lineWidthMm' && !(num(raw) > 0)) continue;
    if (key === 'infillPct') set(key, pct(raw), k);
    else if (key === 'lineWidthMm') { const x = num(raw); if (x && !String(raw).includes('%')) set(key, x, k); else if (x) notes.push(`${k} is "${raw}" (a percentage of the nozzle); line width left at the default`); }
    else if (key === 'fanPct' && source === 'orca') set(key, num(raw), k);
    else set(key, num(raw), k);
  }
  const mat = guessMaterial(settings.filament_type || settings.material_type || settings.filament_settings_id); if (mat) { p.material = mat; found.push({ key: 'material', from: 'filament_type', value: mat }); }
  if (source === 'orca') {   // bed temperature depends on the plate in use
    const plate = guessPlate(settings.curr_bed_type), bedKeys = { textured: 'textured_plate_temp', smooth: 'cool_plate_temp' };
    const bk = (plate && bedKeys[plate]) || 'hot_plate_temp'; if (settings[bk] !== undefined) set('bedC', num(settings[bk]), bk);
    if (plate) { p.plate = plate; found.push({ key: 'plate', from: 'curr_bed_type', value: plate }); }
  }
  const pr = guessPrinter(settings); if (pr.id) { p.printer = pr.id; found.push({ key: 'printer', from: 'bed shape / printer name', value: pr.id }); } else if (pr.bed) { p.bed = pr.bed; found.push({ key: 'bed', from: 'bed shape', value: `${pr.bed.x}×${pr.bed.y}` }); }
  if (!found.length) notes.push('no recognisable settings in this file');
  const profile = { name, ...p }; if (!Object.keys(profile.speed).length) delete profile.speed;
  return { profile, found, notes, source };
}

/** What the toolpaths actually say (works on any G-code): used when there is no embedded config, and to cross-check it. */
export function measureGcode(gcodeText, { nozzleMm, filamentDiameterMm = 1.75 } = {}) {
  const parsed = parseGcode(gcodeText), a = analyzeGcode(parsed, { nozzleMm: nozzleMm || 0.4, filamentDiameterMm });
  const hs = parsed.layers.map(l => +l.h.toFixed(3)).filter(h => h > 0), counts = {}; hs.slice(1).forEach(h => { counts[h] = (counts[h] || 0) + 1; });
  const layerHeightMm = +Object.entries(counts).sort((x, y) => y[1] - x[1])[0]?.[0] || undefined;
  const med = xs => { const s = xs.slice().sort((p, q) => p - q); return s.length ? s[Math.floor(s.length / 2)] : undefined; };
  const speeds = {}; for (const l of parsed.layers) for (const m of l.moves) if (m.extrude) (speeds[m.type] ||= []).push(m.f / 60);
  const temps = (re) => [...gcodeText.matchAll(re)].map(m => +m[1]).filter(x => x > 0);
  const nozzle = temps(/^M10[49]\s.*?S(\d+(?:\.\d+)?)/gm), bed = temps(/^M1[49]0\s.*?S(\d+(?:\.\d+)?)/gm), fan = temps(/^M106\s.*?S(\d+(?:\.\d+)?)/gm);
  const retracts = []; let lastE = 0; for (const m of gcodeText.matchAll(/^G1\s+E(-\d+(?:\.\d+)?)/gm)) retracts.push(-m[1]);
  void lastE;
  return { layers: parsed.layers.length, layerHeightMm, firstLayerHeightMm: hs[0] ? +hs[0] : undefined, outerWidthMm: a.features.outer?.widthMedianMm, innerWidthMm: a.features.inner?.widthMedianMm,
    speedMmS: Object.fromEntries(Object.entries(speeds).map(([k, v]) => [k, Math.round(med(v))])), nozzleC: nozzle.length ? nozzle[nozzle.length > 1 ? 1 : 0] : undefined, bedC: bed[0], fanPct: fan.length ? Math.round((Math.max(...fan) / 255) * 100) : undefined, retractMm: retracts.length ? +med(retracts).toFixed(2) : undefined };
}

/**
 * One call: file → profile + what was found + measurements + cross-checks (e.g. extrusion wider than configured).
 */
export async function importProfile(input, filename = '') {
  const ex = await extractSettings(input, filename), res = profileFromSettings(ex, { name: (filename.replace(/\.[^.]+$/, '').replace(/[^\w.-]+/g, '-') || 'imported') });
  const measured = ex.gcode ? measureGcode(ex.gcode, { nozzleMm: res.profile.nozzleMm, filamentDiameterMm: res.profile.filamentDiameterMm }) : null;
  const notes = [...res.notes];
  if (measured) {
    if (ex.source === 'none') {                    // nothing embedded: fall back to measurement
      Object.assign(res.profile, Object.fromEntries(Object.entries({ layerHeightMm: measured.layerHeightMm, firstLayerHeightMm: measured.firstLayerHeightMm, nozzleC: measured.nozzleC, bedC: measured.bedC, fanPct: measured.fanPct, retractMm: measured.retractMm }).filter(([, v]) => v !== undefined)));
      res.profile.speed = { outerWall: measured.speedMmS.outer, innerWall: measured.speedMmS.inner, infill: measured.speedMmS.sparse, solid: measured.speedMmS.solid, first: undefined };
      Object.keys(res.profile.speed).forEach(k => res.profile.speed[k] === undefined && delete res.profile.speed[k]);
      notes.push('no embedded settings: values measured from the toolpaths and temperature/fan commands (nozzle size, wall/skin counts, infill % and material cannot be measured)');
    }
    const cfgW = res.profile.lineWidthMm ?? (res.profile.nozzleMm ? res.profile.nozzleMm * 1.125 : undefined);
    if (measured.outerWidthMm && cfgW && Math.abs(measured.outerWidthMm / cfgW - 1) > 0.06) notes.push(`outer-wall lines are ${measured.outerWidthMm} mm wide in the G-code vs ${cfgW.toFixed(3)} mm configured/default (${((measured.outerWidthMm / cfgW - 1) * 100).toFixed(0)}%): the extrusion width or flow differs from the plain defaults`);
  }
  return { ...res, notes, measured, from: ex.from, resolved: resolveProfile(res.profile), materials: Object.keys(MATERIALS) };
}
