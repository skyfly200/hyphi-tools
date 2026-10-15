# Specification: Shared Folding and Assembly Engine for `hyphi-tools`

**Proposed document:** `docs/folding-engine-spec.md`  
**Status:** Partially implemented — see §0  
**Primary applications:** FoldStudio/FoldForm and PolyForge  
**Goal:** Turn flat designs into dimension-controlled 3D assemblies through editable, replayable folding sequences.

## 0. Implementation status

Verified against the repository (Vue 3 + React, Vite, Three.js; no test runner existed before this work).
Run the suite with `npm test` (Node's built-in runner, no extra dependencies).

| Milestone | State | Where |
|---|---|---|
| M0 Metadata foundation | **Done** — stable vertex/edge IDs, logical crease IDs, split/merge/dedupe/cleanup preserve metadata, merge aliases, undo/redo carries `foldform`, FOLD round-trip of IDs and `foldform:*` keys | `src/foldstudio/lib/model.js`, `fold-io.js`, `store.js` |
| M1 Extract kinematics | **Core done**; PolyForge adapter verified numerically equal to the legacy `Folded3D.vue` math. `Folded3D.vue` itself is **not yet switched** to the engine | `src/folding/kinematics.js`, `adapters/polyforge.js` |
| M2 Finite-length bend | **Done** — circular band derived from length + angle (not fitted afterwards), stable straight limit | `src/folding/bends/circular.js` |
| M3 Constraint solver | **Done** — LM with Householder QR, loop closure, drive/hold/point targets, angle + min-radius limits, rank/under-constraint warning, physical-unit validation, structured failure codes, Web Worker with cancel + stale-response discard | `src/folding/solver/`, `worker-*.js` |
| M4 Sequence engine | **Done** — schema validation, groups, branch hints, start-closure projection, continuation with adaptive increments, default-free semantics, geometry-hash cache | `src/folding/sequence.js` |
| M5 FoldStudio integration | **Adapter + workspace** — M/V → hinges, F/J → rigid joins, `U` edges reported until classified | `adapters/foldstudio.js` |
| M6 Flexible surfaces | **Done (single-axis bends)** — segmented bands with curvature profile (petal curl), surface grid + stretch diagnostics, strain estimate. Twist and doubly-curved petals are not supported and reported as unsupported | `bends/circular.js`, `bends/surface.js` |
| M7 Collision / thickness / sections | **Done (geometric)** — triangle-distance collision (intersect and thickness-aware, hinge-local exclusion), swept path check that reports its method, sections, envelope, radial extents, measurements, unit-checked obstacles, finite-width hinges with junction warnings | `collision/`, `hinges.js` |
| M8 Export, importer | **Done** — mesh builder (stable topology, material UVs), GLB (m), STL (mm), FOLD folded frame, adaptive animation bundle, Blender importer script (shape keys, markers, optional rigid empties). **The importer has not been run inside Blender**; its parsing/scale path is tested with plain Python | `export/`, `tools/blender/` |


Known limits: solving is geometric only (no stress, fatigue or print-anisotropy prediction); panels are rigid; hinge
bands that cross at a vertex have no valid band geometry and are reported as `hingeJunction`; a flat degree-4 vertex has
several kinematic branches, so steps from a flat state need a `branchHint`; collision results over a path are only as
good as their reported sampling resolution; the lily has not yet been folded end to end because its `U` edges need
author classification and its sequence has not been authored.

---

## 1. Summary

Implement a shared, browser-based geometry engine supporting:

- Rigid panels connected by ideal creases or finite-width flexible bands.
- Independent controls for each folding operation.
- Constraint solving for coupled folds, closed loops, and assembly mates.
- Length-preserving flexible PCB bends.
- Curved origami petals.
- Persistent folding instructions alongside design files.
- Validated animation, dimensional inspection, and Blender export.

**Retain forward kinematics for simple panel trees. Use numerical constraint solving only where geometry requires it.**

The engine is a **geometric assembly tool**, not initially a material-accurate mechanical simulator. It must distinguish:

1. Geometrically valid configurations.
2. Collision-checked configurations.
3. Physically calibrated configurations.

A successful geometric solve must never be presented as proof that a printed hinge or flexible PCB can survive the bend.

---

## 2. Repository integration

### 2.1 Inspected implementation

The following existing files inform this proposal:

| File | Current responsibility |
|---|---|
| `package.json` | Vite application with Vue and Three.js, among other dependencies |
| `src/polyforge/components/Folded3D.vue` | Tree-based folding transforms, bridge geometry, rendering, GLB/STL export |
| `src/foldstudio/lib/model.js` | Crease graph editing, splitting, cleanup, snapshot undo/redo |

Other integration paths below are proposed and should be verified against the repository before implementation.

### 2.2 Important existing behavior

PolyForge currently:

- Builds transform chains from `net.foldEdges`.
- Applies a common folding progress value.
- Computes bridge geometry after panel positions have been established.
- Uses normalized geometry with dimensions converted relative to edge length.

FoldStudio currently:

- Stores vertices and edges primarily through array indices.
- Reconstructs split edges without preserving all metadata.
- Merges edges primarily according to assignment and collinearity.
- Clones only the current graph fields in `cloneModel()`.

These behaviors require adaptation before persistent folding sequences are safe.

### 2.3 Proposed directory structure

```text
src/folding/
  model.js
  ids.js
  units.js
  topology.js
  compile.js
  kinematics.js
  bends/
    circular.js
    segmented.js
    surface.js
  constraints/
    hinge.js
    closure.js
    targets.js
    limits.js
  solver/
    backend.js
    levenberg-marquardt.js
    continuation.js
    diagnostics.js
  collision/
    broadphase.js
    narrowphase.js
    validation.js
  sequence.js
  cache.js
  validation.js
  serialization.js
  solver.worker.js
  worker-client.js
  adapters/
    foldstudio.js
    polyforge.js
  export/
    static.js
    animation.js
    blender.js

src/components/folding/            (not yet built; the app uses per-tool Vue folders, e.g. src/foldstudio/components)
  FoldingWorkspace.vue
  StepList.vue
  StepInspector.vue
  ConnectionInspector.vue
  DiagnosticsPanel.vue
  Timeline.vue
  MeasurementPanel.vue

tests/folding/
  fixtures/
  unit/
  integration/
```

Use the repository’s existing JavaScript conventions initially, with JSDoc types. Do not require a repository-wide TypeScript migration.

The geometry engine must not depend on Vue, DOM APIs, or Three.js objects.

---

## 3. Scope and non-goals

### Required capabilities

| Area | Requirement |
|---|---|
| Topology | Panels, connections, groups, stable identifiers |
| Geometry | Rigid motion, ideal hinges, finite-length bend bands |
| Solving | Coupled angles, closure, point targets, pose targets |
| Sequencing | Drive, hold, free, anchors, guides, waypoints |
| Inspection | Dimensions, sections, contact warnings, clearance |
| Persistence | Versioned project data and FOLD extensions |
| Animation | Solver-generated samples and deterministic playback |
| Export | Static models, animation data, Blender import |
| Compatibility | Existing projects continue to load |

### Explicit non-goals for the initial release

- Cloth simulation.
- Automatic discovery of a complete origami folding sequence.
- Guaranteed solution of every crease pattern.
- Stress, fatigue, fracture, or print-anisotropy prediction.
- Automatically converting an impossible finite-thickness fold into a manufacturable design.
- Full CAD boundary-representation or native STEP export.

Unsupported geometry must produce a useful diagnostic rather than silent stretching.

---

## 4. Shared model

### 4.1 Units and conventions

Adopt:

- Internal physical geometry in **millimetres**.
- Internal angles in **radians**.
- Display and authored sequence angles in **degrees**.
- A right-handed coordinate system.
- Flat material coordinates in the XY plane.
- A documented quaternion layout, such as `[x, y, z, w]`.

FOLD angle semantics:

- Flat: $0^\circ$.
- Valley: positive.
- Mountain: negative.

Each connection must have a stable, documented axis orientation so reversing an edge’s endpoint order does not accidentally reverse authored motion.

Separate:

- Material coordinates.
- Assembly/world coordinates.
- Camera/display transforms.

**Recentring a viewport must never change exported mating coordinates or constraint targets.**

### 4.2 Main entities

| Entity | Purpose |
|---|---|
| `Region` | A rigid panel or explicitly bendable material region |
| `Connection` | Relationship between two regions |
| `AttachmentFrame` | Local position and orientation for a connection or mate |
| `Feature` | Material point, edge, connector frame, measurement reference |
| `Group` | Named collection of connections or features |
| `Sequence` | Ordered folding operations |
| `Configuration` | Solved positions and bend variables |
| `Obstacle` | Housing or other external clearance geometry |

A rigid panel stores:

- Stable ID.
- Flat polygon geometry.
- Local material frame.
- Thickness and thickness offset.
- Source-face mapping.
- Optional component geometry.
- Rendering metadata.

A connection stores:

- Stable ID.
- Type.
- Attached regions.
- Local attachment frames.
- Source crease or bridge mapping.
- Geometric parameters.
- Angle or curvature limits.
- Manufacturing metadata.

### 4.3 Connection types

| Type | Behavior |
|---|---|
| `rigidJoin` | Fixed relative transform |
| `idealHinge` | Rotation about a shared line |
| `circularBand` | Finite-length, constant-curvature planar bend |
| `segmentedBand` | Fixed-length strip with bend and optional twist |
| `assemblyMate` | Selected relative position/orientation constraints |

Material adjacency and assembly mating are different concepts. A pair of panel edges that should eventually touch must not automatically become a permanent hinge.

### 4.4 Stable IDs and topology edits

Persistent sequence references must never depend solely on array indices.

Implement:

- Stable vertex, crease, region, connection, and feature IDs.
- Parent–child mappings when a crease splits.
- Source provenance for generated geometry.
- Geometry revision and content hash.
- Explicit stale-reference detection.

Editing rules:

| Operation | Required behavior |
|---|---|
| Split crease | Preserve metadata and reference children through the logical crease ID |
| Merge edges | Require compatible physical and sequence metadata |
| Delete crease | Flag dependent steps and constraints |
| Change assignment | Preserve ID; mark affected solutions stale |
| Repeat geometry | Generate new IDs with provenance |
| Undo/redo | Restore geometry, IDs, metadata, and sequence edits |
| Rebuild faces | Preserve region identity where unambiguous |

If identity cannot be resolved reliably, request reassignment rather than guessing.

**Update `cloneModel()`, splitting, merging, and cleanup before implementing the sequence editor.** Shallow copying nested metadata is insufficient.

---

## 5. Compile designs into mechanisms

### FoldStudio adapter

The adapter must:

1. Convert material coordinates into millimetres.
2. Validate planar topology and face winding.
3. Identify genuine creases versus computational subdivisions.
4. Combine triangles belonging to a single rigid panel.
5. Create panel and connection records.
6. Preserve mappings back to authored vertices and edges.

Support FOLD `J` join edges where appropriate. Do not reinterpret every `U` edge as either a fold or a join automatically.

Ambiguous edges require an authoring classification:

- Fold.
- Rigid join.
- Bendable-region subdivision.
- Boundary.

### PolyForge adapter

The adapter must:

1. Convert normalized panel geometry into millimetres.
2. Preserve the existing panel tree as an initial mechanism.
3. Identify bonded bridge portions and free spans.
4. Store free-span material length and attachment frames.
5. Attach components and connector references to panel-local coordinates.

The design’s actual bridge path determines free length. Sample count must not determine length.

### Compiler output

`compileAssembly()` returns:

- Mechanism graph.
- Kinematic traversal.
- Solver variables.
- Constraints.
- Source mappings.
- Validation issues.
- Geometry hash.

Recompile only when topology or physical geometry changes—not on every timeline update.

---

## 6. Kinematics and constraint solving

### 6.1 Tree fast path

For an acyclic assembly with fully specified joint variables:

- Evaluate connection transforms.
- Propagate region poses from the anchored root.
- Return the configuration without numerical optimization.

This preserves the efficiency of PolyForge’s existing tree implementation.

### 6.2 Coupled mechanisms

For loops and constrained targets:

- Choose a spanning tree for pose propagation.
- Use connection variables as generalized coordinates where practical.
- Add non-tree closure constraints.
- Solve free variables to satisfy closure and user targets.

Do not add redundant constraints merely because every panel has a pose.

Floating components require explicit treatment: either anchor each component or expose a deliberate free-body transform.

### 6.3 Supported constraints

Initial constraint types:

- Hinge or connection closure.
- Driven angle.
- Held angle.
- Point position.
- Panel or connector orientation.
- Full attachment-frame pose.
- Relative pose between features.
- Connection limits.

Later:

- Minimum separation.
- Selected contact.
- Curvature bounds.
- Surface metric preservation.

“Hold” captures a value at the start of a step. It does not silently update after each solve.

### 6.4 Numerical backend

Initial backend:

- Levenberg–Marquardt.
- `ml-matrix` or equivalent QR/SVD support.
- Finite-difference Jacobians for initial validation.
- Replaceable backend interface.

Requirements:

- Avoid explicit matrix inversion and fragile normal-equation-only implementations.
- Normalize residuals.
- Use local rotation increments rather than optimizing unconstrained quaternion components.
- Detect numerical rank deficiency.
- Set iteration and time budgets.
- Support cancellation.
- Report individual residuals.

The solver must separate:

- Structural constraint residuals.
- User-driving residuals.
- Soft shape preferences.

Soft objectives must not permit structural errors to pass validation.

Inequality constraints require explicit handling. A penalty term alone must not be described as guaranteed collision avoidance.

<details>
<summary><strong>Constraint equations and normalization</strong></summary>

For generalized coordinates $q$ and step progress $s$, the prototype objective is:

$$
E(q,s)=\sum_i w_i\|r_i(q,s)\|^2
$$

Use characteristic scales for length and angle residuals:

$$
\hat r_\text{length}=\frac{r_\text{length}}{L_\text{scale}}
$$

$$
\hat r_\text{angle}=\frac{r_\text{angle}}{\theta_\text{scale}}
$$

Validation must use physical errors in millimetres and radians, not only the normalized objective.

For ideal hinges, compare corresponding world-space hinge endpoints and the relative rotation about the hinge axis.

Use unwrapped angle state for continuation. Account for periodicity when comparing orientations.

</details>

### 6.5 Solver result

Return structured status, such as:

```json
{
  "status": "converged",
  "geometryValid": true,
  "collisionStatus": "notChecked",
  "iterations": 18,
  "maxClosureErrorMm": 0.004,
  "maxDrivenAngleErrorDeg": 0.03,
  "warnings": []
}
```

Supported failure categories:

- `invalidTopology`
- `staleReferences`
- `unanchoredComponent`
- `underconstrained`
- `incompatibleTargets`
- `iterationLimit`
- `singularConfiguration`
- `collisionDetected`
- `cancelled`

Conflict diagnostics may initially identify the largest residuals. Do not claim a mathematically minimal conflicting constraint set unless implemented.

---

## 7. Finite-width bends and flexible PCBs

### 7.1 Circular band

The circular-band model must preserve its neutral-surface free length.

For length $L$, bend angle $\theta$, and radius $R$:

$$
L=R|\theta|
$$

Implement a stable straight-limit calculation near zero angle.

The connection transform must be derived from:

- Free length.
- Bend angle.
- Attachment frames.
- Bend direction.

**Do not position both panels first and then draw an arbitrary arc between them.**

If both ends are prescribed and incompatible with a circular band, report incompatibility or offer an explicit switch to a segmented model.

### 7.2 Segmented band

Represent the free span using:

- Fixed-length segments.
- Transported local frames.
- Bend variables.
- Optional twist variables.
- Endpoint attachment constraints.

Support:

- Minimum radius.
- Bend-angle bounds.
- Twist enable/disable.
- Preferred shape.
- Smoothness objective.

Discretization uses material arc length, not source sample index.

Run refinement checks to ensure the displayed shape is not dominated by segment count.

### 7.3 Surface limitations

A centreline model does not establish that a wide strip is unstretched across its width.

For wide PCB bridges and petals:

- Generate and validate a surface representation.
- Report longitudinal and transverse distortion.
- Restrict unsupported twisting in the initial implementation.
- Introduce a refined surface model when centreline approximations are insufficient.

### 7.4 Material metadata

Store optional:

- Layer stack.
- Neutral-axis offset.
- Static versus repeated-flex use.
- Fabricator-specified minimum radius.
- Printed material and orientation.
- Preferred bend direction.

A simple strain estimate may be displayed:

$$
\varepsilon\approx\frac{y}{R}
$$

Label it as an estimate, not a reliability certification.

### 7.5 Printed origami hinges

Support panel and hinge thickness separately.

For the lily:

- Sheet side: $100\text{ mm}$.
- Panel thickness: $0.3\text{ mm}$.
- Hinge thickness: $0.1\text{ mm}$.
- Hinge width: user parameter.

Record whether relief is:

- Symmetric.
- Front-only.
- Back-only.

Intersecting hinge bands need explicit junction geometry or warnings. Do not assume arbitrary crease patterns can be thickened without overlap.

---

## 8. Petal curvature

Petal deformation belongs in the same system, but computational bend subdivisions must remain separate from manufactured creases.

Support:

- Bendable-region selection.
- Fixed root attachment.
- Controlled curvature.
- Optional longitudinal fold ridge.
- Material-length preservation checks.
- Surface distortion diagnostics.

Initial implementation may support cylindrical or segmented developable bending only.

If complex shaping requires stretching or cannot be represented by the selected model, report that limitation.

---

## 9. Folding sequence and notation

### 9.1 Step definition

Every step contains:

- Stable ID and title.
- Instruction text.
- Start configuration reference.
- Duration for playback.
- Active controls.
- Anchors and temporary guides.
- Optional intermediate waypoints.
- Validation settings.
- Optional annotation image references.

Connection modes:

| Mode | Meaning |
|---|---|
| `drive` | Follow a prescribed angle or bend value |
| `hold` | Preserve the value at step start |
| `free` | Solve as part of the mechanism |

Unspecified connections default to `free`, not `hold`.

Mountain/valley direction may change during a sequence. Final assignment is not the complete motion history.

### 9.2 Instruction notation

Support both readable prose and machine-readable controls.

Example UI notation:

```text
Step 04 — Open petal A
Anchor: base panel
Drive: petal-root-A → 60°
Hold: body-fold-A
Free: remaining creases
Guide: petal tip toward target point
```

Angles in such examples are illustrative until calculated or calibrated.

### 9.3 Persistence

Store:

- Source design.
- Stable ID mappings.
- Physical metadata.
- Sequence.
- Saved configurations.
- Solver settings and version.
- Validation results.

For FOLD export:

- Use standard geometry fields.
- Use `file_frames` for compatible saved configurations.
- Add versioned `foldform:` properties.
- Preserve unknown imported properties where practical.

Maintain a full native project representation when finite-width bands or assembly features cannot be represented faithfully in standard FOLD fields.

<details>
<summary><strong>Proposed sequence schema</strong></summary>

```json
{
  "foldform:version": 1,
  "foldform:units": "mm",
  "foldform:geometryHash": "sha256:...",
  "foldform:physical": {
    "panelThicknessMm": 0.3,
    "hingeThicknessMm": 0.1
  },
  "foldform:groups": [
    {
      "id": "group-petal-a",
      "connectionIds": ["hinge-a", "hinge-b"]
    }
  ],
  "foldform:steps": [
    {
      "id": "step-open-petal-a",
      "title": "Open petal A",
      "startConfigurationId": "configuration-03",
      "durationSeconds": 2,
      "defaultConnectionMode": "free",
      "anchors": [
        {
          "regionId": "panel-base",
          "mode": "holdStartPose"
        }
      ],
      "controls": [
        {
          "target": {
            "groupId": "group-petal-a"
          },
          "mode": "drive",
          "quantity": "angle",
          "from": "start",
          "toDegrees": 60,
          "easing": "smoothstep"
        }
      ],
      "notes": "Illustrative target; verify against the physical sample."
    }
  ]
}
```

Schema validation must reject unresolved references, incompatible control quantities, and ambiguous duplicate controls.

</details>

---

## 10. Animation and continuation

### 10.1 Solving a step

For each step:

1. Resolve its start configuration.
2. Capture held values and anchor poses.
3. Advance progress by a small increment.
4. Update driving constraints.
5. Solve using the preceding valid state.
6. Validate structural errors and enabled collision checks.
7. Accept the sample or reduce the increment.
8. Stop with diagnostics if minimum increment is reached.

Use adaptive increments based on solver difficulty and geometric change.

Near-flat singularities may require:

- A deliberate small starting fold.
- A branch hint.
- A waypoint.
- A temporary guide.

Branch hints should choose between valid solutions, not permanently bias the mesh away from closure.

### 10.2 Playback

Playback uses cached, validated samples.

Do not solve synchronously inside the render loop.

Random-access scrubbing must:

- Use a nearby cached configuration.
- Solve a refinement if needed.
- Distinguish provisional preview from validated state.

Vertex interpolation may be used for display previews, but must not be exported as validated motion without error checks.

### 10.3 Cache invalidation

Invalidate affected samples when changing:

- Geometry.
- Thickness or hinge width.
- Constraints.
- Step order.
- Bend model.
- Solver-relevant settings.

Camera changes do not invalidate solving.

---

## 11. Worker interface and application state

Run solving and expensive validation in a Web Worker.

Suggested interface:

```javascript
compileAssembly(project)
solveConfiguration(compiled, request)
solveStep(compiled, sequence, stepId, options)
validateConfiguration(compiled, configuration, options)
cancel(requestId)
```

Worker messages include:

- Request ID.
- Project revision.
- Geometry hash.
- Operation.
- Payload.

Responses include:

- Progress.
- Configuration.
- Diagnostics.
- Matching request and revision identifiers.

Discard stale responses after edits.

Use `Float64Array` for calculations; convert to rendering buffers as needed.

Implement cooperative cancellation through bounded solver batches. Provide worker termination as a fallback.

Do not serialize the entire reactive store for every timeline change.

---

## 12. UI requirements

### Shared folding workspace

Layout:

- 2D design.
- 3D assembly.
- Step list.
- Timeline.
- Selected-connection inspector.
- Diagnostics panel.

Required actions:

- Select connection in either view.
- Create or edit groups.
- Set drive/hold/free.
- Anchor panel.
- Add target point or connector pose.
- Save waypoint.
- Duplicate and reorder steps.
- Solve step.
- Bake sequence.
- Inspect failed constraints.

### Visual diagnostics

Display:

- Driven, held, and free connections using distinct styling.
- Target versus solved position.
- Closure gaps.
- Collision locations.
- Minimum-radius violations.
- Stale step references.
- Validation level.

Always show whether the displayed model is:

- Preview.
- Geometry validated.
- Collision checked.
- Stale.

### Dimensional inspection

Support:

- Feature-to-feature distance.
- Overall envelope.
- Section plane.
- Base interior and exterior sections.
- Connector pose measurements.
- Clearance against imported obstacles.

Imported obstacle geometry must have explicit units and a known placement transform.

---

## 13. Collision and clearance

Implement in two stages.

### Stage A: Detection

- Broad-phase bounding volumes.
- Narrow-phase panel/component intersection checks.
- Thickness-aware geometry.
- Explicit treatment of intentional attachment contact.

Do not exclude all adjacent regions wholesale: adjacent panels can collide away from their hinge.

### Stage B: Constraint-aware avoidance

- Minimum-separation constraints.
- Swept-motion checks between accepted samples.
- Adaptive temporal refinement.
- Selected intentional contact.

Passing collision tests at discrete frames does not guarantee a collision-free path. Report the checking method and resolution.

For base-fitting parts, provide:

- Selected configuration envelope.
- Sequence swept envelope.
- Section geometry.
- User-defined clearance allowance.

These are nominal geometric outputs. Manufacturing tolerances remain separate inputs.

---

## 14. Export and Blender integration

### Static exports

Support:

- GLB.
- STL.
- FOLD configurations where representable.
- JSON configuration and diagnostics.
- Section polylines or meshes.

Requirements:

- GLB uses metres as required by glTF.
- STL documents its millimetre convention.
- Preserve assembly origin and orientation.
- Preserve stable feature IDs in metadata where supported.
- Keep material-coordinate UVs stable through folding.

Do not label arbitrary STL output “print-ready” without checking manifoldness and intersections.

### Animation exports

Support:

- Rigid-panel transform animation.
- Sampled band and petal geometry.
- A native animation bundle.

Suggested bundle:

```text
assembly.json
mesh-topology.json
configurations.json
diagnostics.json
```

A Blender import script reconstructs:

- Meshes.
- Materials and UVs.
- Rigid transforms.
- Shape keys or mesh samples for flexible regions.
- Timeline labels and instructions.

Topology must remain fixed within a baked mesh animation segment.

Adaptive sampling should be dense enough to keep interpolation error below configured thresholds.

---

## 15. Validation and tests

Add a test runner, such as Vitest, and browser integration tests where useful.

| Fixture | Acceptance |
|---|---|
| Single ideal hinge | Known rotation; no panel distortion |
| Three-panel tree | Matches analytical forward kinematics |
| Circular band | Preserves free length and endpoint tangency |
| Straight band limit | Stable near zero angle |
| Incompatible band endpoints | Reports failure; no silent stretching |
| Coupled crease vertex | Closure remains within tolerance |
| Closed mechanism loop | Consistent non-tree closure |
| Singular starting state | Controlled failure or successful branch initialization |
| Split/merge operations | IDs and metadata behave correctly |
| Undo/redo | Restores sequence and geometry |
| Worker cancellation | No stale result applied |
| Save/load | Sequence and configurations round-trip |
| Export scale | Blender dimensions match source millimetres |
| Collision path | Detects a collision between endpoint samples |
| Lily fixture | Intermediate configurations recorded and reviewed |
| PCB fixture | Connector targets and bridge length checked |

### Initial validation tolerances

Suggested defaults for small assemblies:

- Closure error: at most $0.01\text{ mm}$.
- Driven-angle error: at most $0.1^\circ$.
- Length preservation error: at most $10^{-4}$ relative.

These are **numerical acceptance thresholds**, not manufacturing accuracy guarantees. Make them configurable.

Benchmark and record:

- Compile time.
- Solve time.
- Variable count.
- Iterations.
- Cache memory.
- Browser and hardware.

Target smooth cached playback. Interactive solve speed should be benchmarked before setting hard promises for arbitrary models.

---

## 16. Implementation milestones

| Milestone | Deliverable | Exit criterion |
|---|---|---|
| **M0 — Metadata foundation** | IDs, units, schema, edit-safe metadata, tests | Split/merge/save/undo do not corrupt references |
| **M1 — Extract kinematics** | Shared core and PolyForge adapter | Existing folding behavior preserved |
| **M2 — Finite-length bend** | Circular-band model and independent controls | Two-panel PCB benchmark passes |
| **M3 — Constraint solver** | Targets, loop closure, diagnostics, worker | Closed-loop and incompatibility fixtures pass |
| **M4 — Sequence editor** | Steps, guides, waypoints, continuation, cache | Sequence saves and replays deterministically |
| **M5 — FoldStudio integration** | Crease classification, panel compilation | Verified intermediate lily configurations |
| **M6 — Flexible surfaces** | Segmented bands and controlled petals | Length/distortion checks pass |
| **M7 — Collision and thickness** | Contact checks, physical hinge geometry, sections | Base and PCB clearance benchmarks pass |
| **M8 — Export and polish** | Blender importer, animation bundle, migration | Scale-correct round-trip and documentation |

### First end-to-end vertical slice

Build **two rigid panels connected by one finite-width PCB bridge**, with:

- Adjustable free length.
- Adjustable bend angle.
- Panel thickness.
- One anchored panel.
- One saved folding step.
- Validated playback.
- GLB export.

This exercises the shared architecture without beginning with the lily’s hardest topology.

---

## 17. Project acceptance

The implementation is complete when:

- PolyForge and FoldStudio use the shared engine rather than separate folding mathematics.
- Existing projects retain a usable legacy path.
- Steps are editable and stored with the design.
- Simple trees use forward kinematics.
- Coupled mechanisms use explicit constraint solving.
- Flexible bands preserve their designed length.
- Failed solves produce actionable diagnostics.
- Preview, geometric validation, and collision validation remain visibly distinct.
- Blender exports preserve physical scale and assembly coordinates.
- The lily’s base and PCB connector geometry can be measured against real samples.

**Core principle: preserve the designed material geometry, solve the assembly around it, and never hide an impossible configuration by stretching the model.**