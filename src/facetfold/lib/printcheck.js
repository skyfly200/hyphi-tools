// Checks that tie the design (hinge strips) to how it will be printed (nozzle, layers), and the flat-sheet preset
// recovered from a print that is known to work.

/**
 * A hinge strip is laid by the first layer(s). It needs at least one extrusion line of width to exist at all, and
 * about 1.5 lines to be reliable; its thickness has to land on the layer stack (a multiple of the first layer height).
 */
export function hingePrintIssues({ hingeWidthMm, hingeThicknessMm }, { lineWidthMm, firstLayerHeightMm, layerHeightMm }) {
  const issues = [], w = hingeWidthMm, t = hingeThicknessMm;
  if (w < lineWidthMm * 0.95) issues.push({ level: 'error', code: 'hingeNarrow', message: `hinge width ${w} mm is narrower than one extrusion line (${lineWidthMm} mm): the strip will not print. Widen it to at least ${(lineWidthMm * 1.5).toFixed(2)} mm.` });
  else if (w < lineWidthMm * 1.5) issues.push({ level: 'warning', code: 'hingeThin', message: `hinge width ${w} mm is under 1.5 extrusion lines (${lineWidthMm} mm): it prints as a single line and may be uneven. ≥ ${(lineWidthMm * 1.5).toFixed(2)} mm is more reliable.` });
  const stack = [firstLayerHeightMm, firstLayerHeightMm + layerHeightMm, firstLayerHeightMm + 2 * layerHeightMm];
  if (!stack.some(z => Math.abs(z - t) <= 0.25 * layerHeightMm)) issues.push({ level: 'warning', code: 'hingeThickness', message: `hinge thickness ${t} mm does not land on the layer stack (${stack.map(z => z.toFixed(2)).join(' / ')} mm). Set the first layer to ${t} mm, or the thickness to a layer boundary.` });
  return issues;
}

/**
 * Settings from a Bambu Studio project that printed an origami lily sheet: 0.1 mm hinge = the first layer, 0.2 mm panels
 * on top, hinge gaps about 0.74 mm, 0.4 mm nozzle, PLA on the A1 mini's smooth/high-temp plate.
 */
export const FLAT_SHEET_PRESET = Object.freeze({
  id: 'flat-sheet', label: 'Flat sheet / origami (proven: A1 mini, PLA, 0.4 mm)',
  params: { panelThicknessMm: 0.3, hingeWidthMm: 0.75, hingeThicknessMm: 0.1, seamClearanceMm: 0.15 },
  snap: { enabled: false },
  plate: 'smooth',
  slicing: { printer: 'bambu-a1-mini', nozzleMm: 0.4, layerHeightMm: 0.2, firstLayerHeightMm: 0.1, walls: 2, topLayers: 5, bottomLayers: 3, infillPct: 15, material: 'PLA', lineWidthMm: 0.42, flowMultiplier: 0.98, nozzleC: 220, bedC: 60 },
});

export const PRESETS = Object.freeze({ [FLAT_SHEET_PRESET.id]: FLAT_SHEET_PRESET });
