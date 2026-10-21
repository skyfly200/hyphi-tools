# Phase 0: EasyEDA to KiCad migration

First target: Smart Sprout Nano MVP (EasyEDA Pro). GlowFlora Home V1.0 follows; its BOM
lives in the wiki at `hyphi-wiki/docs/glowflora/bom.md` and is mirrored into
[`products/glowflora-home/product.yaml`](../products/glowflora-home/product.yaml).

## Which tool does what

Two different jobs, two different tools:

| Job | Tool |
|-----|------|
| Import the whole schematic + board | **KiCad's built-in EasyEDA importer** (KiCad 8+, Std and Pro) |
| Clean per-part symbols, footprints, STEP models by LCSC number | **easyeda2kicad** (`scripts/fetch_parts.py` wraps it) |
| Assign LCSC numbers, check Basic/Extended, export JLCPCB BOM + CPL | **kicad-jlcpcb-tools** plugin |
| Parametric part search offline | **jlcparts** (the plugin downloads its database) |

easyeda2kicad converts components, not projects, so the board itself goes
through KiCad's importer.

**EasyEDA Pro v3 caveat (checked 2026-10-21).** Pro 3.x saves projects as
`.epro2`, and KiCad 9.0.6 fails to import that
([KiCad issue 22239](https://gitlab.com/kicad/code/kicad/-/issues/22239)).
Try the newest KiCad 9 first. EasyEDA's "Altium" export does not help: it is
Altium's ASCII format, and KiCad's Altium importer reads only binary files (all
ten Smart Sprout boards failed). That ASCII export does carry the BOM, LCSC
numbers, outline and placements, so `scripts/altium_to_spec.py` turns it into a
`product.yaml` either way.

## 1. Install KiCad 9

Download from <https://www.kicad.org/download/>. KiCad 8 works too, but use
9 so `kicad-cli` matches what CI will run in Phase 3.

## 2. Install kicad-jlcpcb-tools

1. KiCad → **Plugin and Content Manager** → **Manage** (bottom left).
2. **Add** a repository with URL
   `https://raw.githubusercontent.com/Bouni/bouni-kicad-repository/main/repository.json`
3. Switch the repository dropdown to it, find **KiCAD JLCPCB tools**, **Install**, **Apply**.
4. In PCB Editor, the JLCPCB icon appears on the toolbar. First launch offers to
   download the parts database (a few hundred MB, from jlcparts). Accept.

## 3. Export from EasyEDA

- **EasyEDA Standard:** open the project, then for the schematic and the PCB
  each: Document → Export → **EasyEDA Source** (`.json`).
- **EasyEDA Pro:** File → Export → **EasyEDA Pro** project (`.epro` / `.zip`).

Commit the raw exports to `products/glowflora-home/easyeda/` so the migration
is reproducible.

## 4. Import into KiCad

1. KiCad project manager → File → **Import Non-KiCad Project** → **EasyEDA (JLCEDA) Std** or **Pro**.
2. Pick the exported files; save the project to `products/glowflora-home/kicad/`.
3. Open the schematic, run **ERC**. Expect warnings on power flags and imported
   symbol pin types; fix them rather than suppressing.
4. Open the board, run **DRC** with the JLCPCB rules below.

## 5. Swap in clean library parts

Imported footprints are embedded copies. Replace them with the project library:

```sh
python3 hardware/scripts/fetch_parts.py hardware/products/glowflora-home/product.yaml
```

Then in KiCad: Preferences → Manage Symbol/Footprint Libraries → **Project**
tab → add `hardware/libs/hyphi/hyphi.kicad_sym` and `hardware/libs/hyphi/hyphi.pretty`
(nickname `hyphi`). Use **Tools → Change Symbols / Update Footprints** to point
each part at `hyphi:*`.

## 6. Tag LCSC numbers

Open the JLCPCB tools plugin. For every part, confirm the LCSC number matches
`product.yaml`. The plugin shows **Basic** vs **Extended**: each Extended part
type adds about $3 to assembly, so swap where a Basic equivalent exists and
record the tier back in the spec.

## 7. First-order checks (rotations)

KiCad and JLCPCB disagree on zero-rotation for some packages (SOT-23-5,
electrolytics, 5050 LEDs are the usual suspects). The plugin has a rotation
correction table; on the first KiCad order:

1. Generate fabrication files from the plugin.
2. In the JLCPCB order flow, check every part's orientation in the placement preview.
3. Record each correction under `parts[].rotation_offset` in `product.yaml` so it
   is applied every build.

## JLCPCB rules (from the wiki's PCB page)

2 layers, 1 oz, min trace 0.1 mm (prefer 0.2 mm+), via 0.5 / 0.3 mm, pad
clearance 0.1 mm, ENIG, black mask.

## Done when

- [ ] Raw EasyEDA exports committed
- [ ] KiCad project opens, ERC and DRC clean (or each remaining item explained)
- [ ] All footprints point at `hyphi:*`
- [ ] Every part has a confirmed LCSC number and tier in `product.yaml`
- [ ] Plugin-generated Gerbers + BOM + CPL match the last EasyEDA order
