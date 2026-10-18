# FacetFold — printable folding polyhedra

A separate tool from the origami system (FoldStudio). Pick a solid, get one flat net to print **outer face down**,
with living hinges, snap-together seams, and mounts for lighting and wiring. Route: `/facetfold`.

Library code: `src/facetfold/lib/` (pure JS + the manifold geometry kernel). UI: `src/facetfold/`. Depends on
`@hyphi/polyhedra` and `@hyphi/folding` (which sits on `@hyphi/solver-core`).

## How it works

1. **Net** (`net.js`). The solid is unfolded into a spanning tree of hinges; the other edges are seams. Coordinates are
   a top view of the bed (outer faces down, so the net is a mirror of the usual picture). Pieces are shelf-packed.
2. **Hinge spacing.** A flexure strip of flat length `w` folded through exterior angle φ wraps a rounded corner, which
   puts each panel's bottom edge `a = w·tan(φ/2)/φ` from the ideal edge. Panels are spaced so that folding every hinge by φ
   lands each panel exactly on its ideal face — seams then close without accumulated error.
3. **Panels** (`panel.js`). Each face prints as a frustum: bottom polygon inset by the hinge/seam trim, top polygon inset
   further by `t·tan(φ/2)` (the mitre line). Every wall leans inward going up: **no overhangs, no supports**. If a wall would
   lean outward, you get a warning.
4. **Verification** (`verify.js`). The net is folded through `@hyphi/folding` (panels as rigid regions, hinges as
   length-preserving bands). Reported: panels vs the ideal solid, seam gaps, closed-state collisions, and a swept
   closing-path check. A sabotage test proves the verifier detects a 0.3 mm spacing error.
5. **Geometry** (`solid.js`, `kernel.js`). Built with manifold-3d (WASM): guaranteed-manifold booleans. Each connected
   piece of the net is one body: panels + hinge strips (first layer(s), thickness `t_h`) + features.

## Features

| Feature | Notes |
|---|---|
| **Vertex cable port** | A vertex is truncated; the new small face hosts a gland hole with an inner collar and lugs. Optional cable-tie slots on neighbouring faces. |
| **Face mount** | Round or rectangular opening with an inner retaining collar. Checked against the room in the panel. |
| **Snap detents** | A 45° cone on one seam wall, a clearance dimple on the mating wall, 1–3 per seam. Sized to the wall; thin walls get none (warning). Alignment is checked in the folded pose. |
| **Surface patterns** | Linear, crosshatch, radial, concentric, chirp, hex-dimple, stipple on the bed-side skin. Carved as geometry only when the chosen printer can resolve them. Also exported as a true-scale SVG and a 16-bit PGM heightmap. |
| **Textured build sheet** | Describes the sheet in the report. Print outer-down on a textured PEI sheet for a diffuse skin on translucent PETG. No geometry. |
| **Net editing** | Toggle any edge between hinge and seam to split the net across the bed or rearrange it (cycles are rejected). |
| **Exports** | STL per piece (mm), plate SVG, face heightmap PGM, report JSON. |

## Multi-colour printing

Every panel prints at the same layers, so colours can't be separated by height. Each colour becomes its own **body**,
all in the same plate coordinates, and the slicer assigns each body an extruder or AMS slot.

- **Modes:** single colour; *neighbours differ* (DSATUR graph colouring with N colours; it warns when the solid needs
  more, e.g. a cube needs 3, a dodecahedron 4); cycle through colours; or paint faces one by one.
- **Disjoint bodies:** panels keep their holes, collars and detents; hinge strips have their overlap into the panels
  removed, so no two bodies share volume. Tests check pairwise overlap < 1e-6 mm³ and that the bodies' volumes add up to
  the single-colour piece.
- **Hinge strips** take the parent face's colour, the child's, or a dedicated material slot.
- **Exports:** one STL per colour (same frame), and a 3MF (core spec, mm) with one object per body, a base-material colour
  each, and a Bambu/Orca-style extruder map as best-effort metadata. The 3MF's structure is checked independently
  (zip, XML, index ranges), **but it has not been opened in a slicer from here** — check colours and extruders on import.
  If a slicer ignores the metadata, load the per-colour STLs as one multi-part object and assign extruders there.
- **Cost:** the report estimates colour changes (colours × layers) and errors if more colours are used than extruder/AMS
  slots. The estimate is rough; real purge depends on the slicer.

## Honest limits

- **Holographic diffraction cannot be printed directly.** Visible colour separation needs a groove period below about
  3 µm; FDM resolves ~0.5–1 mm, resin ~50–100 µm. The tool carves what the printer can resolve and tells you
  plainly when a request is below that. For true diffraction, export the vector/heightmap for an imprint master or a
  holographic film. The calculator shows the grating equation numbers.
- **Hinge life.** Outer-fibre strain is `(t_h/2)·φ/w`. The defaults (0.1 mm × 1.5 mm) give about 5% at 90° — enough to
  yield, so hinges are designed to fold **once**. The report flags worse cases. These are estimates, not material data.
- **Snap force, light transmission and print quality are not predicted.** Print a test piece.
- **Detents need thickness.** At 1.6 mm panels and a 90° fold there is no room for one; use ≥ 2 mm.
- The folded preview poses rigid panels; it does not draw the bending hinge strip.
- STL is never marked print-ready; slicers still need to check it.
- Only convex solids with planar convex faces are supported. The catalogue covers Platonic solids, prisms, antiprisms,
  pyramids, bipyramids and several Archimedean solids.

## Defaults

Edge 40 mm, panel 2.4 mm, hinge 0.1 × 1.5 mm, seam clearance 0.15 mm, bed 256 × 256 mm.

## Notes on shared code

`POLYHEDRA.tetra` is stored wound inward (kept so existing PolyForge designs don't mirror). FacetFold calls
`ensureOutward()` first.
