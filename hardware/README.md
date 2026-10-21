# Hyphi Hardware

Spec-driven KiCad pipeline for Hyphi boards. One `product.yaml` per product is
the source of truth; scripts turn it into libraries, netlists, layouts,
enclosures and build receipts. Deliberately semi-automated: scripts do the
repeatable parts, a human routes the critical nets and signs off.

```
hardware/
  products/<product>/product.yaml   spec: outline, parts (LCSC), placement, enclosure, variants
  products/<product>/kicad/         KiCad project (imported or generated)
  libs/hyphi/                       project symbol/footprint/3D library (built from specs)
  scripts/                          pipeline scripts (fetch_parts.py, altium_to_spec.py, check_board.py, render.py)
  docs/                             how-tos
```

## Phases

| Phase | Goal | Status |
|-------|------|--------|
| 0 | Migrate GlowFlora Home (V2 prototype) from EasyEDA to KiCad, install JLCPCB tooling, draft the spec | **in progress** |
| 1 | Spec-to-netlist proof (SKiDL) on one subcircuit: the MT9700 current-limit section | not started |
| 2 | Board-to-enclosure: Build123d for the printable shell (STEP/STL), Blender for organic parts and renders, both reading the spec and the KiCad board export | render script ready |
| 3 | CI gates: `kicad-cli` ERC/DRC, Gerber/BOM/CPL export, LCSC pricing, cost rollup | not started |
| 4 | Generative variants from one spec | not started |

## Products

| Product | Spec | Source |
|---------|------|--------|
| Smart Sprout Nano MVP | [product.yaml](products/smart-sprout-nano-mvp/product.yaml) | spec generated from the EasyEDA Pro Altium export; [KiCad project](products/smart-sprout-nano-mvp/kicad/) imported in KiCad 10; `check_board.py` passes |
| GlowFlora Home | [product.yaml](products/glowflora-home/product.yaml) | hand-seeded from the wiki BOM |

To draft a spec for another board from an EasyEDA Pro Altium export:

```sh
python3 hardware/scripts/altium_to_spec.py "<export>/Smart Sprout/<board folder>" \
  --id <product-id> --name "<Product Name>" --out hardware/products/<product-id>/product.yaml
```

Check a KiCad board still matches its spec (outline, layer count, every
part's position, rotation and side; no KiCad install needed):

```sh
python3 hardware/scripts/check_board.py hardware/products/<id>/product.yaml hardware/products/<id>/kicad/<id>.kicad_pcb
```

## Phase 0 quick start

1. Follow [docs/phase0-migration.md](docs/phase0-migration.md) to install KiCad 10
   and the plugins and import the EasyEDA project.
2. Build the project parts library from the spec:

   ```sh
   pip install easyeda2kicad pyyaml
   python3 hardware/scripts/fetch_parts.py hardware/products/glowflora-home/product.yaml
   ```

   This runs `easyeda2kicad` for every LCSC part in the spec and writes
   symbols, footprints and STEP models into `hardware/libs/hyphi/`. It needs
   internet access to the EasyEDA/LCSC API.
3. `python3 hardware/scripts/fetch_parts.py --check <product.yaml>` validates the
   spec and prints the Basic/Extended part split without downloading anything.

## Blender

KiCad stays the source of the board; Blender consumes it. The split:

- **Build123d** makes anything that must fit and print (shell, battery bay,
  switch and USB openings), because its dimensions come straight from the spec.
- **Blender** handles organic or decorative geometry (petals, diffusers, the
  sculpted parts of a GlowFlora) and every render, so photos and geometry come
  from the same files.

Render the board (and any Blender-authored models listed under `render.models`):

```sh
kicad-cli pcb export glb --subst-models --include-tracks --include-pads \
  -o hardware/products/glowflora-home/kicad/glowflora-home.glb \
  hardware/products/glowflora-home/kicad/glowflora-home.kicad_pcb
pip install bpy pyyaml
python3 hardware/scripts/render.py hardware/products/glowflora-home/product.yaml --variant default
```

PNGs land in `products/<product>/build/renders/`. A variant can override any
`render` field, for example a different enclosure model or camera list.
