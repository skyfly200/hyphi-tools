// Reactive store for FoldStudio. Single instance shared across components.
// Keeping it as a plain reactive() rather than Pinia since this is one tool.

import { reactive, computed, ref, watch } from 'vue';
import {
  emptyModel, cloneModel, addEdgeWithSplits, deleteEdges, setEdgeAssignment,
  History, repeatTransform, repairPlanarGraph, pruneIsolatedVertices,
  cleanupRedundant, addOrFindVertex,
} from './lib/model.js';
import { buildGrid } from './lib/grid.js';
import { buildTemplate } from './lib/templates.js';
import { computeFaces, validateFlatFoldability, validateTwoColorable } from './lib/rabbitear.js';
import {
  matRotateAround, matTranslate, matReflectLine, applyMatrix, segmentIntersection,
} from './lib/geometry.js';
import {
  loadPrefs, savePrefs,
  listProjects as listProjectsRaw,
  saveProject as saveProjectRaw,
  loadProject as loadProjectRaw,
  deleteProject as deleteProjectRaw,
  renameProject as renameProjectRaw,
} from './lib/persistence.js';

const persisted = (typeof localStorage !== 'undefined' && loadPrefs()) || null;

// Migration: older prefs used grid.type (string) — fold it into grid.types[].
if (persisted?.grid && !persisted.grid.types) {
  persisted.grid.types = [persisted.grid.type || 'square'];
  delete persisted.grid.type;
}
// Default the new powers-of-2 snap on for older prefs.
if (persisted?.grid && persisted.grid.snapPow2 === undefined) {
  persisted.grid.snapPow2 = true;
}
// Promote old grid.snap (single bool) to the new state.snap (target flags).
if (persisted && !persisted.snap) {
  const enabled = persisted.grid?.snap !== false;
  persisted.snap = { enabled, vertices: enabled, grid: enabled, midpoints: false };
}
// Backfill the global enabled flag for prefs saved before it existed.
if (persisted?.snap && persisted.snap.enabled === undefined) {
  persisted.snap.enabled = true;
}
// Older prefs had independent labels.{vertices,edges,faces} bools — collapse
// to the single labels.type radio. Vertex wins if multiple were true.
if (persisted?.labels && persisted.labels.type === undefined) {
  const L = persisted.labels;
  persisted.labels = {
    type: L.vertices ? 'vertices' : L.edges ? 'edges' : L.faces ? 'faces' : 'off',
    oneBased: !!L.oneBased,
    hoverOnly: false,
  };
}
// Backfill new tool options (e.g. corner relief) for older prefs.
if (persisted?.toolOptions && !persisted.toolOptions.relief) {
  persisted.toolOptions.relief = { radius: 0.04 };
}

export const state = reactive({
  model: emptyModel(),
  tool: 'draw',          // draw | select | mirror | repeat | angle
  theme: persisted?.theme || 'dark',  // 'dark' | 'light'
  // When false the Maekawa / Kawasaki checks are skipped so a half-done
  // pattern doesn't surface a bunch of distracting red rings.
  validateFold: persisted?.validateFold ?? true,
  // Same idea for the face two-colorability check (separate toggle).
  validateTwoColor: persisted?.validateTwoColor ?? true,
  twoColor: { ok: true, coloring: [], conflicts: [] },
  // What the Select tool can pick: 'edges' | 'vertices' | 'both'.
  selectMode: persisted?.selectMode || 'both',
  // Sticky-additive flag: when on, every click toggles into the selection
  // even without shift. Useful on touch devices.
  multiSelect: persisted?.multiSelect || false,
  // Global auto-symmetry: when drawing or placing an angle crease, the
  // crease is duplicated by rotating around (0.5, 0.5). n = 1 disables it;
  // 2 = half, 4 = quarter, 8 = eighth, 16 = sixteenth, 32 = 32nds.
  symmetry: persisted?.symmetry || 1,
  assignment: persisted?.assignment || 'V',
  grid: persisted?.grid || { types: ['square'], density: 8, snap: true, visible: true, extend: false, snapPow2: true },
  // Only one label type can be active at a time. 'off' / 'vertices' /
  // 'edges' / 'faces'. hoverOnly restricts the display to whatever the
  // pointer is closest to.
  labels: persisted?.labels || { type: 'off', oneBased: false, hoverOnly: false },
  selection: { edges: new Set(), vertices: new Set() },
  view: { zoom: 1, pan: [0, 0] },
  validation: { ok: true, issues: [] },
  status: 'Ready',
  currentProject: null,
  projects: listProjectsRaw(),
  ui: { mobileSidebar: false, mobileInspector: false },
  // Master toggle + per-target flags. Global toggle wins when off.
  snap: persisted?.snap || { enabled: true, vertices: true, grid: true, midpoints: false },
  toolOptions: persisted?.toolOptions || {
    mirror: { axis: 'y', flipMV: false },
    repeat: { kind: 'rotational', count: 4, angle: 90, dx: 0.1, dy: 0, cx: 0.5, cy: 0.5 },
    // length is in paper-units. mode: 'fixed' | 'edge' | 'paper'
    angle: { angle: 45, length: 0.5, mode: 'fixed' },
    // Corner-relief cutout radius in paper-units.
    relief: { radius: 0.04 },
  },
});

// Persist preferences whenever they change.
watch(
  () => ({
    assignment: state.assignment,
    grid: { ...state.grid },
    labels: { ...state.labels },
    snap: { ...state.snap },
    selectMode: state.selectMode,
    multiSelect: state.multiSelect,
    symmetry: state.symmetry,
    theme: state.theme,
    validateFold: state.validateFold,
    validateTwoColor: state.validateTwoColor,
    toolOptions: JSON.parse(JSON.stringify(state.toolOptions)),
  }),
  prefs => savePrefs(prefs),
  { deep: true }
);

export function refreshProjects() {
  state.projects = listProjectsRaw();
}

export function saveCurrentProject(name) {
  const target = name || state.currentProject;
  if (!target) throw new Error('project name required');
  saveProjectRaw(target, state.model);
  state.currentProject = target;
  refreshProjects();
  state.status = `Saved "${target}"`;
}

export function loadSavedProject(name) {
  const m = loadProjectRaw(name);
  if (!m) { state.status = `Project "${name}" not found`; return; }
  loadModel(m);
  state.currentProject = name;
  state.status = `Loaded "${name}"`;
}

export function deleteSavedProject(name) {
  deleteProjectRaw(name);
  if (state.currentProject === name) state.currentProject = null;
  refreshProjects();
}

export function renameSavedProject(oldName, newName) {
  const trimmed = (newName || '').trim();
  if (!trimmed || trimmed === oldName) return false;
  const ok = renameProjectRaw(oldName, trimmed);
  if (!ok) {
    state.status = `Couldn't rename — "${trimmed}" may already exist`;
    return false;
  }
  if (state.currentProject === oldName) state.currentProject = trimmed;
  refreshProjects();
  state.status = `Renamed to "${trimmed}"`;
  return true;
}

// Set per-edge foldAngle for currently-selected edges. Pass null to clear
// (revert to assignment default).
export function setEdgeFoldAngle(angle) {
  const idxs = [...state.selection.edges];
  if (!idxs.length) return;
  for (const i of idxs) {
    const e = state.model.edges[i];
    if (!e) continue;
    if (angle === null || angle === undefined) delete e.foldAngle;
    else e.foldAngle = angle;
  }
  pushHistory();
}

const history = new History(state.model);

// Workspace bounds in model space (paper is [0,1]²; workspace adds a ring
// around the paper so users have room to drag/select near the edges).
export const WORKSPACE_PAD = 0.12;
export const workspaceRange = computed(() => state.grid.extend
  ? [-WORKSPACE_PAD, 1 + WORKSPACE_PAD, -WORKSPACE_PAD, 1 + WORKSPACE_PAD]
  : [0, 1, 0, 1]
);
export const gridGeom = computed(() => buildGrid(state.grid.types, state.grid.density, workspaceRange.value));

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
  const counts = `${state.model.vertices.length}v ${state.model.edges.length}e ${state.model.faces.length}f`;
  if (!state.validateFold && !state.validateTwoColor) {
    state.validation = { ok: true, issues: [] };
    state.twoColor = { ok: true, coloring: [], conflicts: [] };
    state.status = `Validation off · ${counts}`;
    return;
  }
  validationTimer = setTimeout(() => {
    state.validation = state.validateFold
      ? validateFlatFoldability(state.model)
      : { ok: true, issues: [] };
    state.twoColor = state.validateTwoColor
      ? validateTwoColorable(state.model)
      : { ok: true, coloring: [], conflicts: [] };
    const flatOK = state.validation.ok;
    const twoOK = state.twoColor.ok;
    const bits = [];
    if (state.validateFold)     bits.push(flatOK ? 'flat-foldable' : `${state.validation.issues.length} flat issue(s)`);
    if (state.validateTwoColor) bits.push(twoOK ? '2-colorable' : `${state.twoColor.conflicts.length} colouring conflict(s)`);
    state.status = `${bits.join(' · ')} · ${counts}`;
  }, 80);
}

// Rerun whenever either toggle flips.
watch(() => state.validateFold, () => runValidation());
watch(() => state.validateTwoColor, () => runValidation());

export function snapPoint(p) {
  if (!state.snap.enabled) return p;
  const tol = 0.6 / state.grid.density;
  let best = null, bd = tol;
  const consider = (q) => {
    const d = Math.hypot(q[0] - p[0], q[1] - p[1]);
    if (d < bd) { bd = d; best = q; }
  };
  if (state.snap.grid) {
    for (const n of gridGeom.value.nodes) consider(n);
  }
  if (state.snap.vertices) {
    for (const v of state.model.vertices) consider(v);
  }
  if (state.snap.midpoints) {
    for (const e of state.model.edges) {
      const a = state.model.vertices[e.v1], b = state.model.vertices[e.v2];
      consider([(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]);
    }
  }
  return best ? [best[0], best[1]] : p;
}

// Apply state.symmetry around (0.5, 0.5): adds n-1 rotated copies of the
// given crease in addition to the original.
function emitWithSymmetry(p1, p2, assignment) {
  const n = Math.max(1, Math.floor(state.symmetry) || 1);
  addEdgeWithSplits(state.model, p1, p2, assignment);
  if (n < 2) return;
  const cx = 0.5, cy = 0.5;
  for (let i = 1; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const c = Math.cos(a), s = Math.sin(a);
    const rot = ([x, y]) => [cx + (x - cx) * c - (y - cy) * s, cy + (x - cx) * s + (y - cy) * c];
    addEdgeWithSplits(state.model, rot(p1), rot(p2), assignment);
  }
}

export function drawCrease(p1, p2) {
  emitWithSymmetry(p1, p2, state.assignment);
  pushHistory();
}

// Flip M↔V on every edge (or just the selection if there is one). Useful
// for converting a preliminary base into a waterbomb base and vice versa.
export function invertCreases() {
  const flip = { M: 'V', V: 'M' };
  const indices = state.selection.edges.size
    ? [...state.selection.edges]
    : state.model.edges.map((_, i) => i);
  let changed = 0;
  for (const i of indices) {
    const e = state.model.edges[i];
    if (!e || !flip[e.assignment]) continue;
    e.assignment = flip[e.assignment];
    if (Number.isFinite(e.foldAngle)) e.foldAngle = -e.foldAngle;
    changed++;
  }
  if (changed) {
    pushHistory();
    state.status = `Inverted ${changed} M/V crease${changed === 1 ? '' : 's'}`;
  }
}

export function cleanup() {
  const before = state.model.vertices.length;
  repairPlanarGraph(state.model);
  const removed = cleanupRedundant(state.model);
  const after = state.model.vertices.length;
  state.selection.edges.clear();
  state.selection.vertices.clear();
  pushHistory();
  state.status = removed > 0
    ? `Cleanup removed ${before - after} redundant vertex/vertices and merged ${removed} edge pair(s).`
    : 'Already clean — no redundant vertices found.';
}

export function deleteSelection() {
  const edgeSet = new Set(state.selection.edges);
  const vertSet = new Set(state.selection.vertices);
  if (!edgeSet.size && !vertSet.size) return;
  // Single pass: drop explicitly-selected edges plus any edge touching a
  // selected vertex, then prune leftover orphan vertices.
  state.model.edges = state.model.edges.filter((e, i) => {
    if (edgeSet.has(i)) return false;
    if (vertSet.has(e.v1) || vertSet.has(e.v2)) return false;
    return true;
  });
  pruneIsolatedVertices(state.model);
  state.selection.edges.clear();
  state.selection.vertices.clear();
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
  state.selection.vertices = new Set(state.model.vertices.map((_, i) => i));
}
export function clearSelection() {
  state.selection.edges.clear();
  state.selection.vertices.clear();
}

export function mirrorSelection({ axis = 'x', line = null, flipMV = false }) {
  const indices = [...state.selection.edges];
  if (indices.length === 0) {
    state.status = 'Select edges to mirror first';
    return;
  }
  let A, B, sourceIndices = indices;
  if (axis === 'x') { A = [0, 0.5]; B = [1, 0.5]; }
  else if (axis === 'y') { A = [0.5, 0]; B = [0.5, 1]; }
  else if (axis === 'edge') {
    if (indices.length < 2) {
      state.status = 'Select an axis edge plus at least one edge to mirror';
      return;
    }
    // First selected edge is the axis; the rest get mirrored across it.
    const axisEdge = state.model.edges[indices[0]];
    A = state.model.vertices[axisEdge.v1];
    B = state.model.vertices[axisEdge.v2];
    sourceIndices = indices.slice(1);
  }
  else if (line) { A = line[0]; B = line[1]; }
  else return;

  const M = matReflectLine(A, B);
  const flipMap = { M: 'V', V: 'M' };
  const sourceEdges = sourceIndices.map(i => state.model.edges[i]).filter(Boolean);
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

// Place a crease defined by anchor + angle (deg). `mode` controls the length:
//   'fixed' — use the literal length value (paper-units)
//   'paper' — extend until the ray exits the paper [0,1]² boundary
//   'edge'  — extend until the first intersection with any existing edge,
//             falling back to the paper boundary if nothing is hit first.
// Helper that resolves the length for the active mode and returns the end
// point and effective length used.
export function angleCreaseEnd({ anchor, angle, length, mode = 'fixed' }) {
  const a = angle * Math.PI / 180;
  const dir = [Math.cos(a), Math.sin(a)];
  // Start with the explicit length so we always have a fallback.
  let t = length;
  if (mode === 'paper' || mode === 'edge') {
    const tBoundary = nearestBoundaryT(anchor, dir);
    let tEdge = Infinity;
    if (mode === 'edge') {
      const far = tBoundary > 0 ? tBoundary + 0.01 : 10;
      const B = [anchor[0] + dir[0] * far, anchor[1] + dir[1] * far];
      for (const e of state.model.edges) {
        const C = state.model.vertices[e.v1], D = state.model.vertices[e.v2];
        const ix = segmentIntersection(anchor, B, C, D);
        if (ix && ix.t > 1e-6 && ix.t * far < tEdge) tEdge = ix.t * far;
      }
    }
    const candidate = Math.min(tBoundary || Infinity, tEdge);
    if (Number.isFinite(candidate) && candidate > 1e-6) t = candidate;
  }
  return {
    end: [anchor[0] + dir[0] * t, anchor[1] + dir[1] * t],
    length: t,
  };
}

function nearestBoundaryT(anchor, dir) {
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
  return positive[0] || 0;
}

export function drawAngleCrease(opts) {
  const { anchor } = opts;
  const { end } = angleCreaseEnd(opts);
  emitWithSymmetry(anchor, end, state.assignment);
  pushHistory();
}

// Cut a small polygon hole around a fold junction. For every crease that
// meets at the vertex, place a polygon vertex along the crease direction
// at the configured radius, reconnect the crease to that polygon vertex,
// and link the polygon vertices with B-assignment edges to form the
// cutout boundary. The original junction vertex is pruned afterward.
export function applyCornerRelief(vIdx, opts) {
  const radius = Math.max(1e-4, opts?.radius || 0.04);
  const v = state.model.vertices[vIdx];
  if (!v) return;

  const incident = [];
  state.model.edges.forEach((e, i) => {
    const other = e.v1 === vIdx ? e.v2 : e.v2 === vIdx ? e.v1 : -1;
    if (other < 0) return;
    const Q = state.model.vertices[other];
    incident.push({
      idx: i,
      other,
      angle: Math.atan2(Q[1] - v[1], Q[0] - v[0]),
      assignment: e.assignment,
      foldAngle: e.foldAngle,
    });
  });
  if (incident.length < 2) {
    state.status = 'Corner relief needs at least 2 creases at the vertex';
    return;
  }
  // Refuse if any incident crease is shorter than the requested radius —
  // would invert the segment.
  for (const inc of incident) {
    const other = state.model.vertices[inc.other];
    const L = Math.hypot(other[0] - v[0], other[1] - v[1]);
    if (L <= radius + 1e-6) {
      state.status = `Radius too large for crease v${vIdx}→v${inc.other} (length ${L.toFixed(3)})`;
      return;
    }
  }
  incident.sort((a, b) => a.angle - b.angle);

  // Drop the existing incident edges in one pass.
  const drop = new Set(incident.map(i => i.idx));
  state.model.edges = state.model.edges.filter((_, i) => !drop.has(i));

  // Place polygon vertices, then add reconnections + perimeter.
  const polyIdx = incident.map(inc => addOrFindVertex(state.model, [
    v[0] + Math.cos(inc.angle) * radius,
    v[1] + Math.sin(inc.angle) * radius,
  ]));
  for (let i = 0; i < incident.length; i++) {
    const inc = incident[i];
    const e = { v1: polyIdx[i], v2: inc.other, assignment: inc.assignment };
    if (Number.isFinite(inc.foldAngle)) e.foldAngle = inc.foldAngle;
    state.model.edges.push(e);
  }
  for (let i = 0; i < polyIdx.length; i++) {
    state.model.edges.push({
      v1: polyIdx[i],
      v2: polyIdx[(i + 1) % polyIdx.length],
      assignment: 'B',
    });
  }
  pruneIsolatedVertices(state.model);
  pushHistory();
  state.status = `Corner relief: cut radius ${radius.toFixed(3)} around junction (${incident.length} creases)`;
}

export function loadModel(newModel) {
  state.model = cloneModel(newModel);
  // Imported / older patterns can have T-junctions where a vertex sits on the
  // interior of an unsplit edge — repair so face computation works.
  repairPlanarGraph(state.model);
  state.selection.edges.clear();
  state.selection.vertices.clear();
  history.push(state.model);
  refreshFaces();
  runValidation();
}

export function resetPaper() {
  loadModel(emptyModel());
}

// Start a new project from a template id. Clears the current project name.
export function newFromTemplate(id = 'blank') {
  loadModel(buildTemplate(id));
  state.currentProject = null;
  state.status = `New project from ${id}`;
}

// Initial validation
refreshFaces();
runValidation();
