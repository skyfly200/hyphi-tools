// Reactive store for FoldStudio. Single instance shared across components.
// Keeping it as a plain reactive() rather than Pinia since this is one tool.

import { reactive, computed, ref } from 'vue';
import {
  emptyModel, cloneModel, addEdgeWithSplits, deleteEdges, setEdgeAssignment,
  History, repeatTransform,
} from './lib/model.js';
import { buildGrid } from './lib/grid.js';
import { computeFaces, validateFlatFoldability } from './lib/rabbitear.js';
import {
  matRotateAround, matTranslate, matReflectLine, applyMatrix,
} from './lib/geometry.js';

export const state = reactive({
  model: emptyModel(),
  tool: 'draw',          // draw | select | mirror | repeat | angle
  assignment: 'V',       // current paint assignment
  grid: { type: 'square', density: 8, snap: true, visible: true },
  labels: { vertices: false, edges: false, faces: false, oneBased: false },
  selection: { edges: new Set(), vertices: new Set() },
  view: { zoom: 1, pan: [0, 0] },
  validation: { ok: true, issues: [] },
  status: 'Ready',
});

const history = new History(state.model);

export const gridGeom = computed(() => buildGrid(state.grid.type, state.grid.density));

export function pushHistory() {
  history.push(state.model);
  refreshFaces();
  runValidation();
}

export function undo() {
  const m = history.undo();
  if (m) { state.model = m; refreshFaces(); runValidation(); }
}
export function redo() {
  const m = history.redo();
  if (m) { state.model = m; refreshFaces(); runValidation(); }
}

export function refreshFaces() {
  state.model.faces = computeFaces(state.model);
}

let validationTimer = null;
export function runValidation() {
  clearTimeout(validationTimer);
  validationTimer = setTimeout(() => {
    state.validation = validateFlatFoldability(state.model);
    state.status = state.validation.ok
      ? `Flat-foldable · ${state.model.vertices.length}v ${state.model.edges.length}e ${state.model.faces.length}f`
      : `${state.validation.issues.length} issue(s) · ${state.model.vertices.length}v ${state.model.edges.length}e`;
  }, 80);
}

export function snapPoint(p) {
  if (!state.grid.snap) return p;
  const { nodes } = gridGeom.value;
  const tol = 0.6 / state.grid.density;
  let best = null, bd = tol;
  for (const n of nodes) {
    const d = Math.hypot(n[0] - p[0], n[1] - p[1]);
    if (d < bd) { bd = d; best = n; }
  }
  // Also snap to existing vertices.
  for (const v of state.model.vertices) {
    const d = Math.hypot(v[0] - p[0], v[1] - p[1]);
    if (d < bd) { bd = d; best = v; }
  }
  return best ? [best[0], best[1]] : p;
}

export function drawCrease(p1, p2) {
  addEdgeWithSplits(state.model, p1, p2, state.assignment);
  pushHistory();
}

export function deleteSelection() {
  if (state.selection.edges.size === 0) return;
  deleteEdges(state.model, [...state.selection.edges]);
  state.selection.edges.clear();
  pushHistory();
}

export function assignSelection(letter) {
  // Always update the active paint so the toolbar highlight reflects the
  // current draw color. If edges are selected, also reassign them.
  state.assignment = letter;
  if (state.selection.edges.size > 0) {
    setEdgeAssignment(state.model, [...state.selection.edges], letter);
    pushHistory();
  }
}

export function selectAll() {
  state.selection.edges = new Set(state.model.edges.map((_, i) => i));
}
export function clearSelection() {
  state.selection.edges.clear();
  state.selection.vertices.clear();
}

export function mirrorSelection({ axis = 'x', line = null, flipMV = false }) {
  const indices = [...state.selection.edges];
  if (indices.length === 0) return;
  let A, B;
  if (axis === 'x') { A = [0, 0.5]; B = [1, 0.5]; }
  else if (axis === 'y') { A = [0.5, 0]; B = [0.5, 1]; }
  else if (line) { A = line[0]; B = line[1]; }
  else return;
  const M = matReflectLine(A, B);
  const flipMap = { M: 'V', V: 'M' };
  const sourceEdges = indices.map(i => state.model.edges[i]).filter(Boolean);
  for (const e of sourceEdges) {
    const p1 = applyMatrix(M, state.model.vertices[e.v1]);
    const p2 = applyMatrix(M, state.model.vertices[e.v2]);
    const a = flipMV && flipMap[e.assignment] ? flipMap[e.assignment] : e.assignment;
    addEdgeWithSplits(state.model, p1, p2, a);
  }
  pushHistory();
}

export function repeatSelection({ kind = 'rotational', count = 4, angle = 90, dx = 0, dy = 0, cx = 0.5, cy = 0.5 }) {
  const indices = [...state.selection.edges];
  if (indices.length === 0) return;
  const matrix = kind === 'rotational'
    ? matRotateAround(angle * Math.PI / 180, cx, cy)
    : matTranslate(dx, dy);
  repeatTransform(state.model, indices, matrix, count);
  pushHistory();
}

// Place a crease defined by anchor + angle (deg) + length, optionally
// extending until the first intersection with an existing edge or the boundary.
export function drawAngleCrease({ anchor, angle, length, extend = false }) {
  const a = angle * Math.PI / 180;
  const dir = [Math.cos(a), Math.sin(a)];
  let end = [anchor[0] + dir[0] * length, anchor[1] + dir[1] * length];
  if (extend) {
    // Extend to bounding-box edge of [0,1]^2
    const ts = [];
    if (Math.abs(dir[0]) > 1e-9) {
      ts.push((0 - anchor[0]) / dir[0]);
      ts.push((1 - anchor[0]) / dir[0]);
    }
    if (Math.abs(dir[1]) > 1e-9) {
      ts.push((0 - anchor[1]) / dir[1]);
      ts.push((1 - anchor[1]) / dir[1]);
    }
    const positive = ts.filter(t => t > 1e-6).sort((a, b) => a - b);
    if (positive.length) {
      const t = positive[0];
      end = [anchor[0] + dir[0] * t, anchor[1] + dir[1] * t];
    }
  }
  addEdgeWithSplits(state.model, anchor, end, state.assignment);
  pushHistory();
}

export function loadModel(newModel) {
  state.model = cloneModel(newModel);
  state.selection.edges.clear();
  state.selection.vertices.clear();
  history.push(state.model);
  refreshFaces();
  runValidation();
}

export function resetPaper() {
  loadModel(emptyModel());
}

// Initial validation
refreshFaces();
runValidation();
