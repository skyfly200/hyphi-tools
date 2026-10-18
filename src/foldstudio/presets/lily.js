// Origami-lily recipe for the 100 mm FoldStudio pattern (tests/foldstudio/fixtures/lily.fold).
//
// Selects creases by GEOMETRY (not by edge index), so it keeps working if the pattern
// is re-exported. Decisions encoded here came from the designer:
//   * the 24 slanted `U` edges are guide creases            -> rigid joins
//   * the 8 horizontal/vertical `U` edges are real creases  -> folds (held flat in phases 1)
//   * midlines (V, horizontal/vertical) fold the sheet in half both ways
// Phase 1 (verified): all midlines and the two main diagonals fold together on a single
// symmetric branch (diagonal angle ≈ −2.3 × midline angle), reaching the fully collapsed
// preliminary base at midline = 90°. Phase 2 (outer folds inward) is NOT reachable with
// rigid panels in this file; it needs the creases still missing from the pattern.

import { ensureIds, cloneModel, creaseIdOf } from '../lib/model.js';

const near = (a, b, eps = 1e-6) => Math.abs(a - b) < eps;

/** @returns { classification, groups, steps, summary } for a model that may or may not have edge IDs yet */
export function lilyPreset(model, { halfFoldDegrees = 40 } = {}) {
  const m = ensureIds(cloneModel(model));
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const [x, y] of m.vertices) { minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y); }
  const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2;
  const classification = {}, midlines = [], mainDiagonals = [], axisU = [];
  for (const e of m.edges) {
    const a = m.vertices[e.v1], b = m.vertices[e.v2];
    const axis = near(a[0], b[0]) || near(a[1], b[1]);
    const crease = creaseIdOf(m, e);
    if (e.assignment === 'U') {
      classification[crease] = axis ? 'fold' : 'join';
      if (axis) axisU.push(crease);
    } else if (e.assignment === 'V' && axis) midlines.push(crease);
    // main diagonals: the lines y − cy = ±(x − cx) through the sheet centre (M inner part and V outer part)
    else if ((e.assignment === 'M' || e.assignment === 'V') && !axis) {
      const onDiag = (p) => near(Math.abs(p[0] - cx), Math.abs(p[1] - cy));
      if (onDiag(a) && onDiag(b)) mainDiagonals.push(crease);
    }
  }
  const groups = [
    { id: 'lily-midlines', name: 'Midlines (fold in half)', creaseIds: midlines },
    { id: 'lily-main-diagonals', name: 'Main diagonals', creaseIds: mainDiagonals },
    { id: 'lily-guide-folds', name: 'Held-flat real creases (H/V U)', creaseIds: axisU },
  ];
  const steps = [{
    id: 'lily-1-half-fold', title: '1 · Fold in half both ways, part way',
    instruction: 'Fold both midlines (valley) part way. The two main diagonals fold inward (mountain) with them, giving a diamond / star-like tent. Everything else stays flat.',
    notes: 'Verified single symmetric branch: diagonal ≈ −2.3 × midline angle. Midline 90° = fully collapsed preliminary base. The 8 horizontal/vertical U creases are held flat until the pattern has the creases needed for the next phase.',
    durationSeconds: 2.5, easing: 'smoothstep', defaultConnectionMode: 'free', anchors: [],
    controls: [
      { target: { groupId: 'lily-midlines' }, mode: 'drive', quantity: 'angle', toDegrees: halfFoldDegrees },
      { target: { groupId: 'lily-guide-folds' }, mode: 'hold' },
    ],
    // from flat, nudge onto the symmetric branch: diagonals ≈ −2.3 × midline
    branchHint: [
      { target: { groupId: 'lily-midlines' }, degrees: 2 },
      { target: { groupId: 'lily-main-diagonals' }, degrees: -4.6 },
    ],
  }];
  return { classification, groups, steps, summary: { midlines: midlines.length, mainDiagonals: mainDiagonals.length, guideFolds: axisU.length, guideJoins: Object.values(classification).filter(x => x === 'join').length } };
}
