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

// Add an edge, splitting at intersections with existing edges so the
// planar graph remains valid. Removes degenerate / duplicate edges.
export function addEdgeWithSplits(model, p1, p2, assignment) {
  const a = addOrFindVertex(model, p1);
  const b = addOrFindVertex(model, p2);
  if (a === b) return;
  // Collect all intersection points on the new segment.
  const A = model.vertices[a], B = model.vertices[b];
  const splits = [{ t: 0, vIdx: a }, { t: 1, vIdx: b }];

  // Also: if any existing vertex lies on segment AB, treat as split.
  for (let i = 0; i < model.vertices.length; i++) {
    if (i === a || i === b) continue;
    const P = model.vertices[i];
    // closest distance to segment
    const dx = B[0] - A[0], dy = B[1] - A[1];
    const L2 = dx * dx + dy * dy || 1;
    const t = ((P[0] - A[0]) * dx + (P[1] - A[1]) * dy) / L2;
    if (t > EPS && t < 1 - EPS) {
      const px = A[0] + dx * t, py = A[1] + dy * t;
      if (Math.hypot(P[0] - px, P[1] - py) < EPS * 10) {
        splits.push({ t, vIdx: i });
      }
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
