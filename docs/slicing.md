# Slicing automation (`@hyphi/slicer`)

A repeatable slicing process plus a way to inspect the result.

- **Profiles** (`slicer-profiles/*.json`, resolved by `resolveProfile`): nozzle, layer height, walls, skin, infill, speeds, material. One file drives the built-in slicer, the nozzle analysis and (via `toPrusaIni`) PrusaSlicer. `validateProfile` rejects impossible combinations (layer > 80 % of the nozzle, etc.).
- **Built-in preview slicer** (`generateGcode`): cuts layers with the manifold kernel, plans walls, top/bottom skin (only where the part is exposed) and rectilinear infill, writes Marlin-style G-code with Orca-style `;TYPE:` comments. Not a production slicer: no gap fill, bridging, overhang handling, seam control or pressure advance; single colour only.
- **G-code analysis** (`parseGcode`, `analyzeGcode`): reads G-code from this slicer, PrusaSlicer, OrcaSlicer/Bambu Studio or Cura; per-feature length, filament, time and extrusion width (from E, layer height and filament diameter); flags many lines far narrower than the nozzle and many moves shorter than the nozzle. Time is move length ÷ feed rate (no acceleration model).
- **Nozzle analysis** (`analyzeNozzles`): for each candidate nozzle, the share of cross-section area narrower than one extrusion line (cannot be printed) and narrower than two (single wall). Layer height is taken as half the nozzle and an optional `maxLayerHeightMm` (FacetFold passes the hinge thickness) rules out nozzles whose layers are taller than the thinnest vertical feature. The recommendation is the largest nozzle that loses ≤ 0.5 % and keeps single-line areas ≤ 8 %.
- **Viewer** (FacetFold → G-code view): ribbons at true extrusion width, layer slider, colour by feature type or by width relative to the nozzle (red < 70 %). Any G-code file can be opened.
- **CLI**: `node scripts/slice.mjs part.stl --profile slicer-profiles/petg-0.4-standard.json --nozzles [--engine prusa]` slices (built-in, or `prusa-slicer --export-gcode` with the same profile) and prints the analysis as JSON.

## What it already found

With the default FacetFold hinge (0.1 mm flexure), a 0.2 mm first layer never prints the hinge. The slicer reports this as a warning and the nozzle table marks 0.4+ mm nozzles unsuitable; use a 0.2 mm nozzle with 0.1 mm layers, or a thicker hinge.

## Limits

Rough time and filament estimates; not verified against a real printer; the slicer runs on the main thread (seconds for a typical net); the 3MF multi-colour files are not sliced here, so colour changes are the external slicer's job.
