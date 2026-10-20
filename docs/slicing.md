# Slicing automation (`@hyphi/slicer`)

A repeatable slicing process plus a way to inspect the result.

- **Profiles** (`slicer-profiles/*.json`, resolved by `resolveProfile`): nozzle, layer height, walls, skin, infill, speeds, material. One file drives the built-in slicer, the nozzle analysis and (via `toPrusaIni`) PrusaSlicer. `validateProfile` rejects impossible combinations (layer > 80 % of the nozzle, etc.).
- **Built-in preview slicer** (`generateGcode`): cuts layers with the manifold kernel, plans walls, top/bottom skin (only where the part is exposed) and rectilinear infill, writes Marlin-style G-code with Orca-style `;TYPE:` comments. Not a production slicer: no gap fill, bridging, overhang handling, seam control or pressure advance; single colour only.
- **G-code analysis** (`parseGcode`, `analyzeGcode`): reads G-code from this slicer, PrusaSlicer, OrcaSlicer/Bambu Studio or Cura; per-feature length, filament, time and extrusion width (from E, layer height and filament diameter); flags many lines far narrower than the nozzle and many moves shorter than the nozzle. Time is move length ÷ feed rate (no acceleration model).
- **Nozzle analysis** (`analyzeNozzles`): for each candidate nozzle, the share of cross-section area narrower than one extrusion line (cannot be printed) and narrower than two (single wall). Layer height is taken as half the nozzle and an optional `maxLayerHeightMm` (FacetFold passes the hinge thickness) rules out nozzles whose layers are taller than the thinnest vertical feature. The recommendation is the largest nozzle that loses ≤ 0.5 % and keeps single-line areas ≤ 8 %.
- **Viewer** (FacetFold → G-code view): ribbons at true extrusion width, layer slider, colour by feature type or by width relative to the nozzle (red < 70 %). Any G-code file can be opened.
- **CLI**: `node scripts/slice.mjs part.stl --profile slicer-profiles/petg-0.4-standard.json --nozzles [--engine prusa]` slices (built-in, or `prusa-slicer --export-gcode` with the same profile) and prints the analysis as JSON.

## What it already found

With the default FacetFold hinge (0.1 mm flexure), a 0.2 mm first layer never prints the hinge. The slicer reports this as a warning and the nozzle table marks 0.4+ mm nozzles unsuitable; set the layer height and first layer to about 0.1 mm (a 0.4 mm nozzle can print that; in practice slight over-extrusion makes the printed hinge a little thicker than modelled, which helped on the author's printers) or thicken the hinge. Hinge strain is estimated from the modelled thickness, so a thicker printed hinge means the real strain is higher than reported.

## Limits

Rough time and filament estimates; not verified against a real printer; the slicer runs on the main thread (seconds for a typical net); the 3MF multi-colour files are not sliced here, so colour changes are the external slicer's job.

## Hosted / cloud slicing

`@hyphi/slicer/server` is a dependency-free Node HTTP job server; `@hyphi/slicer` exports `createSlicingClient` (browser or Node).

```
SLICER_API_KEYS=<secret>[,<secret2>] SLICER_CORS_ORIGINS=https://your-app.example node scripts/slice-server.mjs
docker build -f Dockerfile.slicer -t hyphi-slicer . && docker run -p 8787:8787 -e SLICER_API_KEYS=<secret> hyphi-slicer
node scripts/slice.mjs part.stl --profile slicer-profiles/petg-0.4-standard.json --server https://slicer.example.com --key <secret> --nozzles
```

API (JSON, bearer key): `POST /v1/jobs` (raw STL + `X-Slice-Options` JSON header, or JSON with base64 `stl`) → `202 {id}`; `GET /v1/jobs/:id` (status, progress, summary, queue position); `GET /v1/jobs/:id/gcode`; `DELETE /v1/jobs/:id` (cancel/discard); `GET /v1/profiles`; `GET /health` (open).

- **Engines:** `builtin` (worker thread) always; `prusa` when `PRUSA_SLICER` points at a PrusaSlicer CLI (profile passed as ini); `orca` when `ORCA_SLICER` points at an OrcaSlicer CLI. Both run as child processes, then the G-code is analysed. The Docker image includes neither.
- **OrcaSlicer:** run as `orca-slicer --datadir <per-job dir> --slice 0 --load-settings "machine.json;process.json" --load-filaments filament.json --outputdir <dir> in.stl`. The JSON files come from `toOrcaProfiles`; set `ORCA_BASE_DIR` to a folder holding `machine.json`, `process.json` and `filament.json` exported from your own Orca and only the keys we control (layer height, walls, infill, line width, speeds, temperatures, nozzle, bed) are overridden, so your printer definition and G-code macros stay intact. `ORCA_XVFB=1` wraps it in `xvfb-run -a` for headless Linux (some Orca builds need a display). The same engine works locally: `ORCA_SLICER=/path/to/orca-slicer node scripts/slice.mjs part.stl --engine orca`. The key names and flags follow Orca's documentation, but I could not run Orca here, so the first slice on your install is the real test.
- **Safety:** refuses to start without API keys (`SLICER_ALLOW_ANON=1` for local development); constant-time key comparison; jobs are visible only to the key that made them; body-size, triangle, layer-count, per-client active-job and per-job timeout limits; CORS only for listed origins; no shell is ever used. It speaks plain HTTP, so run it behind TLS.
- **FacetFold:** Slicing → "Slice on → hosted slicing server" sends the selected piece's STL and your settings, shows queue/progress, supports Cancel, and loads the returned G-code into the viewer. The key can optionally be remembered in the browser (stored unencrypted).
- **Not provided:** I have not deployed a server anywhere; you host it. No accounts, billing, persistence across restarts (jobs are in memory and expire after an hour), or multi-node scaling. Verified here with local integration tests, including a stand-in external slicer script; the real PrusaSlicer engine and the Docker image have not been run.

## Printers

`PRINTERS` knows the Bambu Lab A1 mini (180 × 180 mm bed, nozzles 0.2/0.4/0.6/0.8, Orca preferred) and the Prusa i3 MK3S/MK3S+ (250 × 210 mm, 0.25/0.4/0.6, PrusaSlicer preferred). A profile's `"printer"` sets the bed and enables checks (stock nozzle sizes, temperature limits). Ready-made profiles in `slicer-profiles/`: `a1mini-petg-0.4`, `a1mini-petg-0.2-detail`, `mk3s-petg-0.4`, `mk3s-petg-0.25-detail`. In FacetFold, choosing a printer sets the plate bed (so nets are checked against 180 × 180 or 250 × 210) and the nozzle list. Bed sizes and temperature limits are the published figures from memory and should be checked against your machines. The built-in slicer's G-code is preview-only for the A1 mini, which needs Bambu's own start sequence; print Orca's output there.

## Materials and plates

Materials: PLA, PETG, TPU, PVB (generic starting temperatures and fan; check your spool and your printer's own profile). TPU runs at 40 % of the default speeds with short retraction. Plates: textured, smooth, holographic. PETG is restricted to the textured plate (from your experience, encoded in `MATERIAL_PLATES`), and selecting another plate raises a warning. The plate describes the bed-side faces' finish: textured prints copy the texture, holographic prints pick up the diffraction pattern, so designed surface relief on those faces is flagged as hidden or mixed. Hinge strain bands depend on the material: PLA and PVB are treated as brittle (assumed, not measured), TPU as elastic far beyond a single fold. Profiles for both printers in all four materials are in `slicer-profiles/` (`*-petg-0.4-hinge` uses 0.1 mm layers on the 0.4 mm nozzle).

## Recovering settings from a print that worked

Slicers embed their whole configuration in the files they write, so a known-good G-code or project can be turned back into a profile:

- **PrusaSlicer:** G-code (`; prusaslicer_config = begin … end`) or `.3mf` (`Metadata/Slic3r_PE.config`).
- **OrcaSlicer / Bambu Studio:** G-code (`; CONFIG_BLOCK_START … END`), or a project / `.gcode.3mf` (`Metadata/project_settings.config`). Bed temperature is taken from the plate in use.
- **Cura:** partial (`;SETTING_` block).
- **Nothing embedded:** layer height, first layer, speeds per feature, temperatures, fan and retraction are measured from the toolpaths and `M104/M140/M106` commands. Nozzle size, wall/skin counts, infill % and material cannot be measured.
- **Cross-check:** measured outer-wall width is compared with the configured width; a difference (for example from over-extrusion or a flow ratio) is reported.

Use it from FacetFold (Slicing → import settings, then Save profile) or `node scripts/import-settings.mjs good.gcode --out slicer-profiles/my-good-petg.json`. Key names are matched per slicer version, not guaranteed for all; values given as a percentage of another setting (for example a first-layer speed of 50 %) are skipped and reported. Start G-code and printer macros are not imported.
