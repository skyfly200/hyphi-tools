# @hyphi/folding

Rigid-panel folding and assembly engine, built on `@hyphi/solver-core`. Framework-free (no Vue / DOM / Three.js).

| Area | Modules |
|---|---|
| Model | `compileAssembly` — regions, connections (`idealHinge`, `circularBand`, `segmentedBand`, `rigidJoin`), spanning tree, closure loops, geometry hash |
| Kinematics | `evaluatePoses` (tree fast path), `closureResiduals` (loops) |
| Solving | `solveConfiguration`, `solveStepContinuation`, `solveSequence` (drive / hold / free, branch hints, caching) |
| Bends | length-preserving circular & segmented bands, surface grids, distortion and strain estimates |
| Collision | triangle-distance collision (intersect / thickness-aware), swept path checks, sections, envelope, obstacles |
| Hinges | `expandHingeWidths` — ideal crease → finite-width printed band, junction warnings |
| Worker | `SolverClient` (progress, cancel, stale-discard) |
| Export | stable-topology meshes, GLB (m), STL (mm), animation bundle, Blender importer (`tools/blender`) |
| Adapters | `@hyphi/folding/adapters/net` — polyhedron nets (`@hyphi/polyhedra`). App-specific adapters (FoldStudio) live in the apps |

Import map: `@hyphi/folding`, `/collision`, `/export`, `/bends`, `/bends/surface`, `/hinges`, `/worker`, `/worker.js`.

## Minimal use

```js
import { compileAssembly, evaluatePoses, solveConfiguration, rad } from '@hyphi/folding';

const asm = { units: 'mm', anchor: 'A',
  regions: [{ id: 'A', polygon: [[0,0],[10,0],[10,10],[0,10]] }, { id: 'B', polygon: [[10,0],[20,0],[20,10],[10,10]] }],
  connections: [{ id: 'h', type: 'idealHinge', a: 'A', b: 'B', edge: { p0: [10,0], p1: [10,10] } }] };
const c = compileAssembly(asm);                       // c.ok, c.issues, c.hash
const poses = evaluatePoses(c, [rad(90)]);            // valley is positive
const r = solveConfiguration(c, { constraints: [{ type: 'drive', connId: 'h', valueRad: rad(45) }] });
```

## Conventions

Millimetres and radians internally; right-handed; flat material coordinates in XY. Valley is positive, mountain
negative (FOLD). Reversing a connection's edge endpoints never reverses the fold. Results state their own validation
level (geometry valid / collision checked) — a successful solve is never a manufacturing guarantee.

See `docs/folding-engine-spec.md` for the design spec and status.
