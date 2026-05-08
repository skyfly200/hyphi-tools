// Crease pattern model with command-stack undo/redo.
// Internal representation:
//   vertices: [[x,y], ...]        (model space, typically [0,1]^2)
//   edges:    [{ v1, v2, assignment, foldAngle? }]
//   faces:    [[v0, v1, ...], ...]   (recomputed from topology)
// Assignments: 'M' | 'V' | 'B' | 'F' | 'U'

import { eq, segmentIntersection, dist, EPS, applyMatrix } from './geometry.js';

export const ASSIGNMENTS = ['M', 'V', 'B', 'F', 'U'];

export function emptyModel() {
  // Default paper: unit square with boundary edges.
  return {
    vertices: [[0, 0], [1, 0], [1, 1], [0, 1]],
    edges: [
      { v1: 0, v2: 1, assignment: 'B' },
      { v1: 1, v2: 2, assignment: 'B' },
      { v1: 2, v2: 3, assignment: 'B' },
      { v1: 3, v2: 0, assignment: 'B' },
    ],
    faces: [],
  };
}

export function cloneModel(m) {
  return {
    vertices: m.vertices.map(v => [v[0], v[1]]),
    edges: m.edges.map(e => ({ ...e })),
    faces: m.faces.map(f => [...f]),
  };
}

// Find existing vertex within EPS, else add. Returns index.
export function addOrFindVertex(model, p, eps = EPS) {
  for (let i = 0; i < model.vertices.length; i++) {
    if (eq(model.vertices[i], p, eps)) return i;
  }
  model.vertices.push([p[0], p[1]]);
  return model.vertices.length - 1;
}

// Distance/parameter of point P projected onto segment CD. Returns
// { t, dist } where t is the (clamped) parameter and dist is perpendicular
// distance. Used to detect "vertex lies on edge" without hitting endpoints.
function projectParam(P, C, D) {
  const dx = D[0] - C[0], dy = D[1] - C[1];
  const L2 = dx * dx + dy * dy || 1;
  const t = ((P[0] - C[0]) * dx + (P[1] - C[1]) * dy) / L2;
  const px = C[0] + dx * t, py = C[1] + dy * t;
  return { t, dist: Math.hypot(P[0] - px, P[1] - py) };
}

// Split any existing edge whose interior contains the given vertex. Mutates
// model.edges in place. Used to fix the case where a new crease lands on the
// interior of a pre-existing edge (T-junction).
function splitEdgesAtVertex(model, vIdx, tol = EPS * 50) {
  const P = model.vertices[vIdx];
  const replacements = [];
  for (let ei = 0; ei < model.edges.length; ei++) {
    const e = model.edges[ei];
    if (e.v1 === vIdx || e.v2 === vIdx) continue;
    const { t, dist } = projectParam(P, model.vertices[e.v1], model.vertices[e.v2]);
    if (t > EPS && t < 1 - EPS && dist < tol) {
      replacements.push(ei);
    }
  }
  if (!replacements.length) return;
  const drop = new Set(replacements);
  const add = [];
  for (const ei of replacements) {
    const e = model.edges[ei];
    add.push({ v1: e.v1, v2: vIdx, assignment: e.assignment });
    add.push({ v1: vIdx, v2: e.v2, assignment: e.assignment });
  }
  model.edges = model.edges.filter((_, i) => !drop.has(i));
  for (const e of add) model.edges.push(e);
}

// Add an edge, splitting at intersections with existing edges so the
// planar graph remains valid. Removes degenerate / duplicate edges.
export function addEdgeWithSplits(model, p1, p2, assignment) {
  const a = addOrFindVertex(model, p1);
  const b = addOrFindVertex(model, p2);
  if (a === b) return;
  // If either endpoint lies on the interior of an existing edge (T-junction),
  // split that edge before we go further so the planar graph stays consistent.
  splitEdgesAtVertex(model, a);
  splitEdgesAtVertex(model, b);

  // Collect all intersection points on the new segment.
  const A = model.vertices[a], B = model.vertices[b];
  const splits = [{ t: 0, vIdx: a }, { t: 1, vIdx: b }];

  // If any existing vertex lies on segment AB, treat as split (and split any
  // existing edge that passes through it but is missing the vertex).
  for (let i = 0; i < model.vertices.length; i++) {
    if (i === a || i === b) continue;
    const P = model.vertices[i];
    const { t, dist } = projectParam(P, A, B);
    if (t > EPS && t < 1 - EPS && dist < EPS * 50) {
      splits.push({ t, vIdx: i });
      splitEdgesAtVertex(model, i);
    }
  }

  // Intersect with every existing edge.
  const oldEdges = model.edges.slice();
  const edgesToRemove = new Set();
  const edgesToAdd = [];
  for (let ei = 0; ei < oldEdges.length; ei++) {
    const e = oldEdges[ei];
    const C = model.vertices[e.v1], D = model.vertices[e.v2];
    const ix = segmentIntersection(A, B, C, D);
    if (!ix) continue;
    const newV = addOrFindVertex(model, ix.point);
    splits.push({ t: ix.t, vIdx: newV });
    // Split existing edge at u
    edgesToRemove.add(ei);
    edgesToAdd.push({ v1: e.v1, v2: newV, assignment: e.assignment });
    edgesToAdd.push({ v1: newV, v2: e.v2, assignment: e.assignment });
  }
  // Apply existing-edge splits.
  if (edgesToRemove.size) {
    model.edges = model.edges.filter((_, i) => !edgesToRemove.has(i));
    for (const e of edgesToAdd) model.edges.push(e);
  }

  // Sort splits by t and emit consecutive edges.
  splits.sort((a, b) => a.t - b.t);
  for (let i = 0; i + 1 < splits.length; i++) {
    const v1 = splits[i].vIdx, v2 = splits[i + 1].vIdx;
    if (v1 === v2) continue;
    if (!findEdge(model, v1, v2)) {
      model.edges.push({ v1, v2, assignment });
    }
  }
  dedupe(model);
}

export function findEdge(model, v1, v2) {
  for (const e of model.edges) {
    if ((e.v1 === v1 && e.v2 === v2) || (e.v1 === v2 && e.v2 === v1)) return e;
  }
  return null;
}

// Walk every vertex and split any edge whose interior contains it (T-junctions).
// Useful for repairing imported patterns or ones built before the splitter was
// fixed. Idempotent.
export function repairPlanarGraph(model) {
  for (let v = 0; v < model.vertices.length; v++) {
    splitEdgesAtVertex(model, v);
  }
  dedupe(model);
}

// Drop redundant nodes and edges:
//   - duplicate edges (kept by dedupe)
//   - vertices unused by any edge (pruneIsolatedVertices)
//   - degree-2 vertices whose two edges share an assignment AND lie nearly
//     colinear — those vertices add no information; merge into one edge.
// Idempotent: keeps iterating until no change.
export function cleanupRedundant(model, angleTolDeg = 1.0) {
  let totalRemoved = 0;
  // Always run dedupe + prune first so degree counts are accurate.
  dedupe(model);
  pruneIsolatedVertices(model);

  let changed = true;
  while (changed) {
    changed = false;
    const adj = Array.from({ length: model.vertices.length }, () => []);
    model.edges.forEach((e, i) => { adj[e.v1].push(i); adj[e.v2].push(i); });

    for (let v = 0; v < model.vertices.length; v++) {
      if (adj[v].length !== 2) continue;
      const e1 = model.edges[adj[v][0]];
      const e2 = model.edges[adj[v][1]];
      if (!e1 || !e2) continue;
      if (e1.assignment !== e2.assignment) continue;
      const other1 = e1.v1 === v ? e1.v2 : e1.v1;
      const other2 = e2.v1 === v ? e2.v2 : e2.v1;
      if (other1 === other2) continue;

      const P = model.vertices[v];
      const A = model.vertices[other1], B = model.vertices[other2];
      const aA = Math.atan2(A[1] - P[1], A[0] - P[0]);
      const aB = Math.atan2(B[1] - P[1], B[0] - P[0]);
      let diff = Math.abs(aA - aB) * 180 / Math.PI;
      if (diff > 180) diff = 360 - diff;
      // If the two outgoing rays are 180° apart the vertex is a no-op.
      if (Math.abs(diff - 180) > angleTolDeg) continue;

      // Drop the two edges, add a single edge between the outer endpoints.
      const dropIdx = new Set([adj[v][0], adj[v][1]]);
      const angleA = e1.foldAngle, angleB = e2.foldAngle;
      const merged = { v1: other1, v2: other2, assignment: e1.assignment };
      if (Number.isFinite(angleA) && angleA === angleB) merged.foldAngle = angleA;
      model.edges = model.edges.filter((_, i) => !dropIdx.has(i));
      model.edges.push(merged);
      pruneIsolatedVertices(model);
      totalRemoved++;
      changed = true;
      break; // restart loop — vertex indices have shifted
    }
  }
  return totalRemoved;
}

export function dedupe(model) {
  const seen = new Map();
  const keep = [];
  for (const e of model.edges) {
    if (e.v1 === e.v2) continue;
    const k = e.v1 < e.v2 ? `${e.v1}-${e.v2}` : `${e.v2}-${e.v1}`;
    if (seen.has(k)) {
      const prior = keep[seen.get(k)];
      // Prefer non-flat assignment; M/V wins over B wins over F wins over U.
      const rank = a => ({ M: 4, V: 4, B: 3, F: 2, U: 1 }[a] || 0);
      if (rank(e.assignment) > rank(prior.assignment)) prior.assignment = e.assignment;
      continue;
    }
    seen.set(k, keep.length);
    keep.push({ ...e });
  }
  model.edges = keep;
}

export function deleteEdges(model, indices) {
  const set = new Set(indices);
  model.edges = model.edges.filter((_, i) => !set.has(i));
  pruneIsolatedVertices(model);
}

export function setEdgeAssignment(model, indices, assignment) {
  for (const i of indices) {
    if (model.edges[i]) model.edges[i].assignment = assignment;
  }
}

export function pruneIsolatedVertices(model) {
  const used = new Set();
  for (const e of model.edges) { used.add(e.v1); used.add(e.v2); }
  if (used.size === model.vertices.length) return;
  const remap = new Map();
  const newVerts = [];
  for (let i = 0; i < model.vertices.length; i++) {
    if (used.has(i)) {
      remap.set(i, newVerts.length);
      newVerts.push(model.vertices[i]);
    }
  }
  model.vertices = newVerts;
  for (const e of model.edges) {
    e.v1 = remap.get(e.v1);
    e.v2 = remap.get(e.v2);
  }
}

// Apply an affine matrix to selected edges, creating new vertices/edges.
// `times` performs N successive applications; useful for rotational/translational repeat.
export function repeatTransform(model, edgeIndices, matrix, times) {
  const sourceEdges = edgeIndices.map(i => model.edges[i]).filter(Boolean);
  let acc = matrix;
  const compose = m1 => m1; // matrix already composed; we apply per step using matMul if chained.
  // For repeats we apply matrix N times: copy 1 = M, copy 2 = M^2, etc.
  // We do it iteratively by applying M to the previous copy's coords.
  let prevCoords = sourceEdges.map(e => [model.vertices[e.v1], model.vertices[e.v2]]);
  for (let step = 0; step < times; step++) {
    const next = prevCoords.map(([p1, p2]) => [applyMatrix(matrix, p1), applyMatrix(matrix, p2)]);
    for (let i = 0; i < next.length; i++) {
      addEdgeWithSplits(model, next[i][0], next[i][1], sourceEdges[i].assignment);
    }
    prevCoords = next;
  }
}

// History as an array of full snapshots. Simple, predictable, plenty fast for
// hand-edited crease patterns.
export class History {
  constructor(initial) {
    this.stack = [cloneModel(initial)];
    this.index = 0;
    this.limit = 100;
  }
  current() { return this.stack[this.index]; }
  push(model) {
    this.stack.length = this.index + 1;
    this.stack.push(cloneModel(model));
    if (this.stack.length > this.limit) {
      this.stack.shift();
    } else {
      this.index++;
    }
  }
  undo() {
    if (this.index > 0) { this.index--; return cloneModel(this.current()); }
    return null;
  }
  redo() {
    if (this.index < this.stack.length - 1) { this.index++; return cloneModel(this.current()); }
    return null;
  }
  canUndo() { return this.index > 0; }
  canRedo() { return this.index < this.stack.length - 1; }
}
