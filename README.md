# Hyphi Tools

Browser-based design tools for Hyphi's LED art, origami and print work, plus
the hardware pipeline for Hyphi boards. The web app is a single Vite build:
a React router shell, with the larger editors written in Vue and mounted
inside it. Everything runs client-side; there is no backend.

## Tools

| Route | Tool | What it does | Exports |
|-------|------|--------------|---------|
| `/qr` | **QRForge** | Styled QR codes: colors, dot shapes, logos, frames, many payload types (URL, Wi-Fi, vCard, SMS, ...), UTM campaign tags on URLs | PNG, JPG, SVG, multi-part STL zip for multi-material printing |
| `/fold` | **FoldPress** | Turns a `.fold` or SVG crease pattern into a pair of press plates for pre-creasing paper | STL |
| `/foldform` | **FoldForm** | Living-hinge origami models: rigid panels with flexible fold lines, optional SVG artwork as a multi-color design layer | STL zip (model plus front/back design layers) |
| `/foldstudio` | **FoldStudio** | Crease pattern editor on a dynamic grid with mirror, repeat and angle-defined creases; checks flat-foldability | FOLD |
| `/foldstudio/docs` | FoldStudio docs | User guide for FoldStudio | |
| `/polyforge` | **PolyForge** | Parametric polyhedral LED fixtures: pick a solid, set design rules, place LEDs and connectors, unfold to a flat PCB | DXF and KiCad board for fab, GLB/STL of the folded model, patch JSON |
| `/harness` | **Harness Calculator** | Plans LED stem wiring harnesses (core bends, power taps, data links, tip forks, wire twist) and builds a precut wire list | CSV cut list, GLB of the 3D view |

The home page (`/`) links to each tool, plus the link shortener at
[l.hyphi.art](https://l.hyphi.art), which lives in the `hyphi-links` repo.

FOLD-based tools hand designs to each other ("Open in ...") through
`sessionStorage`, and save projects and preferences to `localStorage`, so
nothing leaves the browser.

## Development

Needs Node 18+ (developed on Node 22).

```sh
npm install
npm run dev       # Vite dev server
npm run build     # production build into dist/
npm run preview   # serve the built dist/
```

Netlify builds with `npm run build`, publishes `dist/`, and rewrites every
path to `index.html` so client-side routes work (see `netlify.toml`).

## Layout

```
src/
  main.jsx, App.jsx        React entry and routes
  Home.jsx                 landing page / tool index
  QRForge.jsx              React tools (single-file components)
  FoldPress.jsx
  FoldForm.jsx
  FoldStudioDocs.jsx
  FoldStudio.jsx           React wrappers that mount a Vue app ("Vue islands")
  PolyForge.jsx
  HarnessCalculator.jsx
  foldstudio/              FoldStudio Vue app: components/, lib/ (geometry, FOLD I/O, faces, persistence)
  polyforge/               PolyForge Vue app: components/, lib/ (polyhedra, unfold, LEDs, DXF, KiCad, zip)
  harness/                 Harness Calculator Vue app (Vuetify) and 3D view
  lib/                     shared helpers: FOLD handoff, FoldForm persistence, crease palette
QRForge/                   earlier standalone drafts of the QR generator (not part of the build)
hardware/                  KiCad/Blender hardware pipeline (Python, not part of the web build)
```

To add a tool, create its component in `src/`, add a `<Route>` in
`src/App.jsx`, and add a card to the `TOOLS` list in `src/Home.jsx`. For a
Vue tool, follow the pattern in `src/PolyForge.jsx`: a React component that
owns a host `div` and dynamically imports a `mount.js` that mounts the Vue app
into it, so Vue only loads on that route.

## Hardware pipeline

`hardware/` holds the spec-driven KiCad pipeline for Hyphi boards (migrating
off EasyEDA): one `product.yaml` per product, a parts library builder
(`fetch_parts.py`, using `easyeda2kicad`) and a headless Blender renderer
(`render.py`). It's Python and runs separately from the web app. See
[hardware/README.md](hardware/README.md) for phases and setup.
