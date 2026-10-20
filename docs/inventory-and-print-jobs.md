# Inventory, print jobs and flat-sheet preset

## Flat-sheet preset (FacetFold)
Preset → "Flat sheet / origami": panel 0.3 mm, hinge 0.1 × 0.75 mm, snap detents off, A1 mini, PLA, 0.4 mm nozzle, 0.1 mm first layer + 0.2 mm layers, smooth plate. Recovered from the printed lily project. The report now also checks hinge width against the extrusion line (under one line cannot print, under 1.5 lines is flagged) and the hinge thickness against the layer stack. Wall overhangs smaller than 0.2 mm (about half a line) are no longer warned about.
Known gap: the PLA strain bands are conservative (0.1 mm single-layer hinges that fold well in practice report "likely cracks" at 90°). They need calibrating against how far your lily hinges actually fold.

## Print jobs
- **OctoPrint** (`createOctoPrintClient`, FacetFold → Print jobs): upload only by default. Starting a print needs the "bed is clear" confirmation, an operational idle printer, and a plain file name. An https page cannot call a plain-http OctoPrint (mixed content) and OctoPrint needs its CORS setting on, so the slicing server has a bridge: `OCTOPRINT_HOSTS=octopi.local:80 node scripts/slice-server.mjs`. Only listed hosts are reachable (no open proxy). The MK3S can be driven this way through OctoPrint.
- **Bambu Studio / Orca hand-off** (`slicerOpenUrl`): opens a model from a public link via the slicer's URL scheme. Direct LAN or cloud printing to the A1 mini is not implemented. It would need a sliced `.gcode.3mf`, an FTPS upload and an MQTT command using the printer's serial and access code, and I would not ship that untested.
- Tested against a stand-in OctoPrint server, not a real one.

## Inventory (`@hyphi/inventory`)
Definitions plus an append-only ledger:
- **Parts:** design id + parameter hash (a changed parameter is a new version), material, colour, filament grams each, reorder level.
- **Assemblies:** bills of materials of parts and sub-assemblies (cycles rejected).
- **Events:** printed (ok or failed, with printer and spool), assembled (consumes parts), scrapped, shipped, adjusted. Stock is computed from the events.
- **Reports:** shortages and print plans for N assemblies (with filament grams by material), how many assemblies the stock allows, low-stock list, failure rates, spool remaining.
- **Storage:** adapters for memory, browser localStorage (FacetFold uses this) and a JSON file; export/import as JSON.
- **Not built:** shared storage across devices, a BOM editor UI, QR labels. For multiple people or machines the ledger maps onto four database tables (parts, assemblies, spools, events); Supabase would fit, but I did not touch your project.
