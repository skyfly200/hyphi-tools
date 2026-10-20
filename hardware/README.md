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
  scripts/                          pipeline scripts
  docs/                             how-tos
```

## Phases

| Phase | Goal | Status |
|-------|------|--------|
| 0 | Migrate GlowFlora Home (V2 prototype) from EasyEDA to KiCad, install JLCPCB tooling, draft the spec | **in progress** |
| 1 | Spec-to-netlist proof (SKiDL) on one subcircuit: the MT9700 current-limit section | not started |
| 2 | Board-to-enclosure generator (Build123d) reading outline + component heights | not started |
| 3 | CI gates: `kicad-cli` ERC/DRC, Gerber/BOM/CPL export, LCSC pricing, cost rollup | not started |
| 4 | Generative variants from one spec | not started |

## Phase 0 quick start

1. Follow [docs/phase0-migration.md](docs/phase0-migration.md) to install KiCad 9
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
