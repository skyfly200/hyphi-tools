# Shared packages

```
@hyphi/solver-core    generic constraint solving        (no dependencies)
   ▲
@hyphi/folding        rigid panels, bands, collision, export   (+ polygon-clipping)
@hyphi/polyhedra      polyhedra + net unfolding         (no dependencies)

apps (src/): FoldStudio · PolyForge · FacetFold (docs/facetfold.md) · FoldForm · …
```

Apps depend on packages; packages never import from `src/`. Rule of thumb: if a file names a specific app's data
model (FoldStudio's `model.edges`, a Vue store), it belongs in that app (e.g. `src/foldstudio/lib/foldingAdapter.js`).

## Working in the monorepo

npm workspaces (`packages/*`). `npm install` links `node_modules/@hyphi/*` to the sources — no build step; Vite and
Node import the source files directly.

| Command | |
|---|---|
| `npm test` | every app test and every package test |
| `npm run types` | emit `.d.ts` into `packages/*/types` (generated, git-ignored) |

## Using a package from another project

1. **As a workspace member:** copy or symlink `packages/<name>` into the other repo's workspaces.
2. **As a tarball:** `npm pack -w packages/solver-core` → `npm i ../hyphi-solver-core-0.1.0.tgz` (run `npm run types` first so the tarball carries declarations).
3. **As a git dependency:** `npm i github:skyfly200/hyphi-tools#<ref>` does not select a subfolder; prefer (1) or (2) until packages are published.

Packages are `private` and `0.x`: the API can still change. Breaking changes will be noted in the package README.

## Choosing what to depend on

- A generative / parametric design tool needing constraints, warm-started solving, animation by continuation and a
  worker: **only `@hyphi/solver-core`**.
- Anything that folds, hinges or assembles rigid parts: add **`@hyphi/folding`**.

## @hyphi/slicer

Planar FDM slicing automation: profiles, a preview slicer on the manifold kernel, a G-code writer/parser/analyser, geometry-based nozzle analysis and an STL reader. See [slicing.md](slicing.md).
