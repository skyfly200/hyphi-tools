// Slicing profiles. A profile is plain JSON so the same file drives the built-in slicer, the analysis
// and (via `toPrusaIni`) an external slicer, which is what makes a slicing process repeatable.

export const NOZZLES = Object.freeze([0.2, 0.25, 0.4, 0.6, 0.8]);

/**
 * Printers we know about. Bed sizes are the manufacturers' published build volumes.
 * `previewOnly`: the built-in slicer's G-code uses generic Marlin start/end code, so it is for viewing and analysis; print
 * from the external slicer's output instead (Bambu printers need Bambu's own start sequence and normally take a 3MF).
 */
export const PRINTERS = Object.freeze({
  'bambu-a1-mini': { label: 'Bambu Lab A1 mini', bed: { x: 180, y: 180 }, maxZ: 180, nozzles: [0.2, 0.4, 0.6, 0.8], previewOnly: true, preferred: 'orca', orcaPrinter: 'Bambu Lab A1 mini', maxNozzleC: 300, maxBedC: 80 },
  'prusa-mk3s': { label: 'Prusa i3 MK3S/MK3S+', bed: { x: 250, y: 210 }, maxZ: 210, nozzles: [0.25, 0.4, 0.6], previewOnly: false, preferred: 'prusa', prusaPrinter: 'Original Prusa i3 MK3S & MK3S+', maxNozzleC: 300, maxBedC: 120 },
  generic: { label: 'Generic 256 × 256', bed: { x: 256, y: 256 }, maxZ: 256, nozzles: NOZZLES_ALL(), previewOnly: false, preferred: 'builtin' },
});
function NOZZLES_ALL() { return [0.2, 0.25, 0.4, 0.6, 0.8]; }

/**
 * Generic starting values per filament. Check your spool's label and your printer's own profile; these are not tuned.
 * speedScale slows the default speeds (TPU needs to go slowly); retractMm is short for direct-drive extruders.
 */
export const MATERIALS = Object.freeze({
  PLA: { nozzleC: 210, bedC: 60, fanPct: 100, flowMultiplier: 1, speedScale: 1, retractMm: 0.8 },
  PETG: { nozzleC: 240, bedC: 80, fanPct: 40, flowMultiplier: 0.97, speedScale: 1, retractMm: 0.8 },
  'PETG-translucent': { nozzleC: 245, bedC: 80, fanPct: 30, flowMultiplier: 0.97, speedScale: 1, retractMm: 0.8 },
  TPU: { nozzleC: 225, bedC: 50, fanPct: 50, flowMultiplier: 1, speedScale: 0.4, retractMm: 0.4 },
  PVB: { nozzleC: 210, bedC: 55, fanPct: 100, flowMultiplier: 1, speedScale: 0.9, retractMm: 0.8 },
});

/** Build plates. `finish` describes what the outer (bed-side) faces of a print will look like. */
export const PLATES = Object.freeze({
  textured: { label: 'Textured', finish: 'diffuse matte — the texture is copied onto the bed-side faces' },
  smooth: { label: 'Smooth', finish: 'smooth and glossy' },
  holographic: { label: 'Holographic', finish: 'the bed-side faces pick up the diffraction pattern, visible as rainbow colours' },
});

/** Which plates a material works on, as reported from experience (not derived). Materials not listed are unrestricted. */
export const MATERIAL_PLATES = Object.freeze({ PETG: ['textured'], 'PETG-translucent': ['textured'] });

export const DEFAULT_PROFILE = Object.freeze({
  name: 'default-0.4',
  plate: 'textured',
  nozzleMm: 0.4,
  filamentDiameterMm: 1.75,
  material: 'PETG',
  layerHeightMm: 0.2,
  firstLayerHeightMm: 0.2,
  lineWidthFactor: 1.125,       // extrusion width = nozzle × this
  walls: 2,
  topLayers: 4,
  bottomLayers: 4,
  infillPct: 15,
  skirtLoops: 1,
  skirtDistanceMm: 3,
  speed: { first: 20, outerWall: 40, innerWall: 60, infill: 80, solid: 60, travel: 150 },   // mm/s
  retractMm: 0.8,
  retractSpeed: 30,
  bed: { x: 256, y: 256 },
  originAtCentre: false,
  startGcode: 'G28\nG90\nM83',
  endGcode: 'M104 S0\nM140 S0\nM107\nG91\nG1 Z5 F600\nG90',
});

/** Fill defaults from the material table and check that the numbers make physical sense. */
export function resolveProfile(p = {}) {
  const pr = PRINTERS[p.printer];
  const m = { ...DEFAULT_PROFILE, ...(pr ? { bed: pr.bed } : {}), ...p, speed: { ...DEFAULT_PROFILE.speed, ...(p.speed || {}) }, bed: { ...DEFAULT_PROFILE.bed, ...(pr ? pr.bed : {}), ...(p.bed || {}) } };
  const mat = MATERIALS[m.material] || MATERIALS.PETG;
  if (!p.speed) m.speed = Object.fromEntries(Object.entries(DEFAULT_PROFILE.speed).map(([k, v]) => [k, k === 'travel' ? v : Math.max(5, Math.round(v * mat.speedScale))]));
  m.retractMm = p.retractMm ?? mat.retractMm;
  m.nozzleC ??= mat.nozzleC; m.bedC ??= mat.bedC; m.fanPct ??= mat.fanPct; m.flowMultiplier ??= mat.flowMultiplier;
  m.lineWidthMm = p.lineWidthMm ?? +(m.nozzleMm * m.lineWidthFactor).toFixed(4);
  return m;
}

/** Layer height must sit in roughly 25–80 % of the nozzle diameter to extrude and bond reliably. */
export function validateProfile(p) {
  const issues = [], n = p.nozzleMm;
  const warn = (code, message, level = 'warning') => issues.push({ level, code, message });
  if (p.layerHeightMm > 0.8 * n) warn('layerTooTall', `layer height ${p.layerHeightMm} mm exceeds 80% of the ${n} mm nozzle`, 'error');
  else if (p.layerHeightMm < 0.25 * n) warn('layerTooThin', `layer height ${p.layerHeightMm} mm is under 25% of the ${n} mm nozzle; extrusion will be unreliable`);
  if (p.firstLayerHeightMm > 0.8 * n) warn('firstLayerTall', 'first layer taller than 80% of the nozzle');
  if (p.lineWidthMm < n * 0.9 || p.lineWidthMm > n * 1.6) warn('lineWidth', `line width ${p.lineWidthMm} mm is outside 0.9–1.6 × the nozzle`);
  if (p.walls < 1) warn('walls', 'at least one wall is required', 'error');
  if (p.bed.x < 1 || p.bed.y < 1) warn('bed', 'bed size is invalid', 'error');
  if (!MATERIALS[p.material]) warn('material', `unknown material "${p.material}"`);
  if (!PLATES[p.plate]) warn('plate', `unknown build plate "${p.plate}"`);
  const ok = MATERIAL_PLATES[p.material];
  if (ok && PLATES[p.plate] && !ok.includes(p.plate)) warn('plateForMaterial', `${p.material} only works on the ${ok.join(' / ')} plate; ${p.plate} is selected`);
  if (PLATES[p.plate]) warn('plateFinish', `${PLATES[p.plate].label} plate: ${PLATES[p.plate].finish}`, 'info');
  const pr = PRINTERS[p.printer];
  if (p.printer && !pr) warn('printer', `unknown printer "${p.printer}"`);
  if (pr) {
    if (!pr.nozzles.includes(n)) warn('nozzleForPrinter', `${n} mm is not a stock nozzle size for the ${pr.label} (${pr.nozzles.join(', ')})`);
    if (p.nozzleC > pr.maxNozzleC) warn('nozzleTemp', `${p.nozzleC} °C exceeds the ${pr.label} limit of ${pr.maxNozzleC} °C`, 'error');
    if (p.bedC > pr.maxBedC) warn('bedTemp', `${p.bedC} °C exceeds the ${pr.label} bed limit of ${pr.maxBedC} °C`, 'error');
    if (pr.previewOnly) warn('previewOnly', `the built-in slicer's G-code is for preview/analysis only on the ${pr.label} (it needs the printer's own start sequence); print the ${pr.preferred} engine's output`, 'info');
  }
  return issues;
}

/** PrusaSlicer-style ini for the external-slicer path (also read by OrcaSlicer's CLI import of ini). */
export function toPrusaIni(prof) {
  const p = resolveProfile(prof);
  const lines = {
    nozzle_diameter: p.nozzleMm, filament_diameter: p.filamentDiameterMm, layer_height: p.layerHeightMm, first_layer_height: p.firstLayerHeightMm,
    perimeters: p.walls, top_solid_layers: p.topLayers, bottom_solid_layers: p.bottomLayers, fill_density: `${p.infillPct}%`,
    extrusion_width: p.lineWidthMm, perimeter_extrusion_width: p.lineWidthMm, infill_extrusion_width: p.lineWidthMm, first_layer_extrusion_width: p.lineWidthMm,
    temperature: p.nozzleC, first_layer_temperature: p.nozzleC, bed_temperature: p.bedC, first_layer_bed_temperature: p.bedC,
    retract_length: p.retractMm, skirts: p.skirtLoops, skirt_distance: p.skirtDistanceMm, bed_shape: `0x0,${p.bed.x}x0,${p.bed.x}x${p.bed.y},0x${p.bed.y}`,
    perimeter_speed: p.speed.innerWall, external_perimeter_speed: p.speed.outerWall, infill_speed: p.speed.infill, solid_infill_speed: p.speed.solid, travel_speed: p.speed.travel,
    use_relative_e_distances: 1,
  };
  return Object.entries(lines).map(([k, v]) => `${k} = ${v}`).join('\n') + '\n';
}

const s = v => String(v);
/**
 * OrcaSlicer machine / process / filament JSON from a profile. `bases` ({machine, process, filament} objects, e.g. exported
 * from your own Orca install) are used as the starting point and only the keys below are overridden, so your printer
 * definition, gcode macros and plate settings stay yours. With no bases a minimal generic Marlin-style set is produced.
 * Key names follow OrcaSlicer's profile format; check one slice on your install (not verified against a real Orca here).
 */
export function toOrcaProfiles(prof, bases = {}) {
  const p = resolveProfile(prof), w = s(p.lineWidthMm), sp = p.speed, name = p.name;
  const machine = { ...(bases.machine || { gcode_flavor: 'marlin2', machine_start_gcode: p.startGcode, machine_end_gcode: p.endGcode }), type: 'machine', name: `${name}-machine`, from: 'User',
    nozzle_diameter: [s(p.nozzleMm)], printable_area: [`0x0`, `${p.bed.x}x0`, `${p.bed.x}x${p.bed.y}`, `0x${p.bed.y}`], retraction_length: [s(p.retractMm)], use_relative_e_distances: '1' };
  const process = { ...(bases.process || {}), type: 'process', name: `${name}-process`, from: 'User',
    layer_height: s(p.layerHeightMm), initial_layer_print_height: s(p.firstLayerHeightMm), wall_loops: s(p.walls), top_shell_layers: s(p.topLayers), bottom_shell_layers: s(p.bottomLayers),
    sparse_infill_density: `${p.infillPct}%`, line_width: w, outer_wall_line_width: w, inner_wall_line_width: w, sparse_infill_line_width: w, internal_solid_infill_line_width: w, top_surface_line_width: w, initial_layer_line_width: w,
    skirt_loops: s(p.skirtLoops), skirt_distance: s(p.skirtDistanceMm), outer_wall_speed: s(sp.outerWall), inner_wall_speed: s(sp.innerWall), sparse_infill_speed: s(sp.infill), internal_solid_infill_speed: s(sp.solid), initial_layer_speed: s(sp.first), travel_speed: s(sp.travel) };
  const filament = { ...(bases.filament || {}), type: 'filament', name: `${name}-${p.material}`, from: 'User', filament_diameter: [s(p.filamentDiameterMm)],
    nozzle_temperature: [s(p.nozzleC)], nozzle_temperature_initial_layer: [s(p.nozzleC)], hot_plate_temp: [s(p.bedC)], hot_plate_temp_initial_layer: [s(p.bedC)], textured_plate_temp: [s(p.bedC)], textured_plate_temp_initial_layer: [s(p.bedC)], cool_plate_temp: [s(p.bedC)], cool_plate_temp_initial_layer: [s(p.bedC)], eng_plate_temp: [s(p.bedC)], eng_plate_temp_initial_layer: [s(p.bedC)],
    fan_min_speed: [s(p.fanPct)], fan_max_speed: [s(p.fanPct)], filament_flow_ratio: [s(p.flowMultiplier)] };
  return { machine, process, filament };
}
