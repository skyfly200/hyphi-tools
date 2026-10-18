# @hyphi/solver-core

A small, dependency-free constraint solver for design tools. It is **domain-agnostic**: nothing here knows
about origami, panels, or geometry. `@hyphi/folding` is built on it; so can a generative-design system.

## What it gives you

| Piece | Purpose |
|---|---|
| `ConstraintSystem` | Named variables + constraints in four **groups**, solved with Levenberg–Marquardt, validated in physical units |
| `continuation` / `continuationGenerator` | Slide a parameter 0→1, re-solving from the previous answer; adaptive step; stops with a diagnosis instead of forcing a result |
| `createService` / `WorkerClient` | Web Worker plumbing: progress, cancel between batches, revision-stamped requests, stale-result discard, in-process fallback |
| `constraints.*` | Ready-made 2D/3D builders: distance, fixed, coincident, angle, parallel, minimum distance |
| `levenbergMarquardt`, `lsSolve`, `numericalRank` | The numerical pieces, if you want them directly |

## Core ideas

**Groups never excuse each other.**

| Group | Meaning | Weight |
|---|---|---|
| `structural` | must hold (closure, rigid links, model equations) | 1000 |
| `user` | targets you are driving toward (drags, dimensions) | 1 |
| `limit` | one-sided bounds; residual is the *excess* (≥ 0). Reported as warnings | 1 |
| `soft` | preferences | 1e-3 |

If targets conflict with structure, the **targets lose** and the result says so
(`status: 'incompatibleTargets'`, `valid: true`, `worst: [...]`). Nothing is silently stretched.

**Residuals are in physical units.** Give each constraint a `tolerance` in its own unit and a `scale`
(a characteristic size) for the numerics. A low total cost is never taken as proof: every constraint is
re-checked against its own tolerance.

**Status vocabulary:** `converged`, `incompatibleTargets`, `singularConfiguration` (structure not satisfied),
`iterationLimit`, `cancelled`. Warnings: `underconstrained` (with `rank` and `variables`), `limitViolation`.

## Example

```js
import { ConstraintSystem, constraints as C, continuation } from '@hyphi/solver-core';

const sys = new ConstraintSystem();
C.addPoints2D(sys, { A: [0, 0], B: [1, 0.2], C: [3.5, 1.8], D: [4, 0] });
sys.addConstraint(C.fixed2D('A', 'A', [0, 0]));
sys.addConstraint(C.fixed2D('D', 'D', [4, 0]));
sys.addConstraint(C.distance2D('crank',   'A', 'B', 1));
sys.addConstraint(C.distance2D('coupler', 'B', 'C', 3));
sys.addConstraint(C.distance2D('rocker',  'D', 'C', 2.5));

const closed = sys.solve();                 // { status, values, constraints, groupMax, warnings, worst, ... }

// Drive the crank and track the mechanism along ONE branch:
const run = continuation({
  start: closed.x,
  solveAt: (s, guess) => {
    sys.removeConstraint('theta');
    sys.addConstraint({ id: 'theta', group: 'user', unit: 'rad',
      residual: v => Math.atan2(v.get('B.y'), v.get('B.x')) - (0.2 + s * 1.2) });
    return sys.solve({ initial: guess });
  },
});
run.completed;  run.samples;  run.failure;  // failure.message explains where and why it stopped
```

### Shared derived data

Residuals that all need the same expensive intermediate (forward kinematics, a mesh, a spline) should share it:

```js
sys.setContext(v => computePoses(v.values));            // called ONCE per objective evaluation
sys.addConstraint({ id: 'closure', group: 'structural', residual: (v, ctx) => ctx.closure });
```

### In a worker

```js
import { createService, createInlineTransport, WorkerClient } from '@hyphi/solver-core';

// worker.js
const service = createService({
  async solveSequence(payload, ctx) {
    for (...) { ctx.post({ progress }); await ctx.yield(); if (ctx.isCancelled()) return { cancelled: true }; }
  },
});
self.onmessage = e => service.handle(e.data, m => self.postMessage(m));

// main thread
const client = new WorkerClient(() => new Worker(new URL('./worker.js', import.meta.url), { type: 'module' }));
const { requestId, promise } = client.request('solveSequence', payload, { onProgress });
client.cancel(requestId);        // lands between batches
client.bumpRevision();           // after an edit: in-flight work resolves { stale: true }
```

Send **plain JSON** to a worker. Framework reactive proxies (Vue, MobX…) cannot be structured-cloned.

## Using it for generative / parametric design

Map your design graph onto the system:

1. **Variables** = the free numbers of the design (positions, angles, radii, parameters). Give each a `scale`.
2. **Structural constraints** = what must always be true of the model.
3. **User constraints** = what the person is currently asking for (a dragged handle, a typed dimension).
4. On every edit: change only the *user* constraints, `solve({ initial: previousSolution })`, and read `status`.
   Warm starts keep interaction fast and stable.
5. Show the result honestly: `incompatibleTargets` → highlight `worst`; `underconstrained` → tell the user how many
   degrees of freedom remain; `limitViolation` → surface the named constraints.
6. For "slide a control and animate" behaviour use `continuation`, with `firstGuess` or a small perturbation to choose
   a branch when starting from a singular configuration (flat, collinear, collapsed).

Suggested per-constraint tolerances: lengths 1e-3 × your smallest feature; angles 1e-3 rad.

## Limits (read these)

- **Local solver.** LM finds a nearby solution, not the global one. Multi-solution problems need a starting point,
  a branch hint, or continuation. A good starting point is part of the design.
- **Finite-difference Jacobian:** `n` extra residual evaluations per iteration. Fine for tens to low hundreds of
  variables. Supplying analytic Jacobians is the planned upgrade if you outgrow it.
- **Inequalities are penalties** (the `limit` group), reported but not guaranteed. Do not call them collision avoidance.
- **No symbolic simplification, no global search, no sparse linear algebra.**
- The implicit "stay near the start" preference (`preferInitial`, default 1e-4) biases answers by about
  `weight² × distance moved`; keep it well below your tolerances. It only matters in null spaces.

## Types

`npm run types` emits `types/*.d.ts` from the JSDoc. The package `exports` map points `types` at them.
