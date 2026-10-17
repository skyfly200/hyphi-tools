// Reactive state + actions for the Fold Steps workspace.
//
// Persisted recipe lives in `state.model.foldform` (copied by cloneModel, so undo/redo,
// project save and FOLD export all carry it):
//   { version, units, physical, classification, groups:[{id,name,creaseIds}], steps:[...],
//     configurations:[{id,label,angles:{connId:rad}}] }
// Everything solved (poses, samples, diagnostics) is derived and never persisted.
// Heavy solving runs in the folding Web Worker; cheap forward kinematics / meshing for
// display stays on the main thread against a locally compiled copy.

import { reactive, markRaw, watch } from 'vue';
import { state, pushHistory } from './store.js';
import { ensureIds } from './lib/model.js';
import {
  compileAssembly, evaluatePoses, foldStudioToAssembly, expandHingeWidths, SolverClient,
  validateSequence, SEQUENCE_VERSION, solveConfiguration, rad, deg, targetConnectionIds,
} from '../folding/index.js';
import { checkCollisions, envelope, measureFeatures } from '../folding/collision/validation.js';
import { lilyPreset } from '../folding/presets/lily.js';
import { buildMesh, meshStats, exportGLB, exportSTL, buildAnimationBundle } from '../folding/export/index.js';

export const DEFAULT_PHYSICAL = Object.freeze({ sheetMm: 100, panelThicknessMm: 0.3, hingeThicknessMm: 0.1, hingeWidthMm: 0 });

export const fs = reactive({
  open: false,
  leftTab: 'steps',            // steps | classify
  rightTab: 'step',            // step | connection | diagnostics | measure | export
  physical: { ...DEFAULT_PHYSICAL },
  classification: {},
  groups: [],
  steps: [],
  configurations: [],
  selected: { stepId: null, connId: null, regionId: null },
  groupPick: [],               // crease IDs shift-picked for "create group"
  issues: [],                  // adapter + compile issues
  ambiguous: [],               // unresolved U edges { edgeId, crease }
  autoGroups: {},              // creaseId -> [connIds]
  connections: [],             // display records { id, crease, kind, assignment, authoredAngleDeg, regionA, regionB }
  regions: [],
  summary: null,               // compile summary from the worker
  geometryHash: null,
  angles: [],                  // current displayed configuration (radians, order = summary.variableConnIds)
  status: 'preview',           // preview | geometryValidated | collisionChecked | stale
  solving: false, progress: 0, message: '',
  results: {},                 // stepId -> { status, completed, samples, failure, signature }
  playback: { playing: false, t: 0 },
  collisions: [],
  collisionMethod: null,
  diagnostics: null,
  measure: { a: null, b: null, result: null },
  envelope: null,
  view: { thickness: false, showHinges: true, showCollisions: true, showFlat: true },
  version: 0,                  // bumps whenever angles change so views redraw
});

// Non-reactive engine handles (kept out of Vue's proxies on purpose).
export const raw = markRaw({ compiled: null, assembly: null, adapter: null, client: null, display: null });

function client() { if (!raw.client) raw.client = new SolverClient(); return raw.client; }

// ── persistence ────────────────────────────────────────────────────────────
export function readFromModel() {
  const f = state.model.foldform || {};
  fs.physical = { ...DEFAULT_PHYSICAL, ...(f.physical || {}) };
  fs.classification = { ...(f.classification || {}) };
  fs.groups = (f.groups || []).map(g => ({ ...g }));
  fs.steps = JSON.parse(JSON.stringify(f.steps || []));
  fs.configurations = JSON.parse(JSON.stringify(f.configurations || []));
}

let persistTimer = null;
export function persist({ immediate = false, history = true } = {}) {
  const write = () => {
    state.model.foldform = {
      version: SEQUENCE_VERSION, units: 'mm',
      physical: { ...fs.physical }, classification: { ...fs.classification },
      groups: fs.groups.map(g => ({ ...g })), steps: JSON.parse(JSON.stringify(fs.steps)),
      configurations: JSON.parse(JSON.stringify(fs.configurations)),
      geometryHash: fs.geometryHash,
    };
    if (history) pushHistory();
  };
  clearTimeout(persistTimer);
  if (immediate) write(); else persistTimer = setTimeout(write, 400);
}

// ── building the assembly ──────────────────────────────────────────────────
export async function rebuild() {
  ensureIds(state.model);
  const r = foldStudioToAssembly(state.model, {
    sheetMm: fs.physical.sheetMm, classification: fs.classification,
    thicknessMm: fs.physical.panelThicknessMm,
  });
  let asm = r.assembly;
  const extra = [];
  const w = fs.physical.hingeWidthMm;
  if (w > 0) {
    // Finite-width hinges apply to ideal hinges only; thickness of the band is the hinge thickness.
    const e = expandHingeWidths(asm, { defaultWidthMm: w, hingeThicknessMm: fs.physical.hingeThicknessMm });
    asm = e.assembly; extra.push(...e.issues);
  }
  const compiled = compileAssembly(asm);
  raw.assembly = asm; raw.adapter = r; raw.compiled = compiled;
  fs.issues = [...r.issues, ...extra, ...compiled.issues];
  fs.ambiguous = r.issues.filter(i => i.code === 'ambiguousEdge');
  fs.autoGroups = r.groups;
  fs.geometryHash = compiled.hash;
  fs.regions = asm.regions.map((g, i) => {
    const pts = (g.polygons || [g.polygon]).flat();
    const cx = pts.reduce((a, p) => a + p[0], 0) / pts.length, cy = pts.reduce((a, p) => a + p[1], 0) / pts.length;
    const faces = g.source?.faceCount ?? 1;
    // Human label: stable ordinal + where the panel sits on the sheet (mm, origin bottom-left).
    return { id: g.id, faces, cx, cy, label: `Panel ${i + 1} · ${faces > 1 ? faces + ' faces' : '1 face'} · (${cx.toFixed(0)}, ${cy.toFixed(0)}) mm` };
  });
  fs.connections = asm.connections.map(c => ({
    id: c.id, crease: c.source?.crease ?? c.id, kind: c.type, assignment: c.source?.assignment ?? '',
    authoredAngleDeg: c.meta?.authoredFoldAngleDeg ?? null, a: c.a, b: c.b, widthMm: c.widthMm ?? null, lengthMm: c.lengthMm ?? null,
  }));
  fs.summary = compiled.ok ? { variableConnIds: compiled.variableConnIds, closureConnIds: compiled.closureConnIds, anchor: compiled.anchor, regionCount: asm.regions.length, loops: compiled.closureConnIds.length } : null;
  if (!fs.angles.length || fs.angles.length !== compiled.variableConnIds.length) fs.angles = new Array(compiled.variableConnIds.length).fill(0);
  if (compiled.ok) {
    client().bumpRevision();
    try { await client().compile(asm); } catch { /* worker unavailable → inline fallback handled by client */ }
  }
  markStale();
  fs.version++;
}

function markStale() {
  for (const st of fs.steps) {
    const res = fs.results[st.id];
    if (res && res.signature !== stepSignature(st)) res.stale = true;
  }
  if (fs.status !== 'preview') fs.status = Object.values(fs.results).some(r => r.stale) ? 'stale' : fs.status;
}

export function stepSignature(step) {
  return JSON.stringify([fs.geometryHash, step, derivedGroups()]);
}

export function derivedGroups() {
  const groups = [];
  for (const g of fs.groups) {
    const ids = (g.creaseIds || []).flatMap(cid => fs.autoGroups[cid] || []);
    groups.push({ id: g.id, name: g.name, connectionIds: ids });
  }
  return groups;
}

export async function openWorkspace() {
  ensureIds(state.model);
  readFromModel();
  fs.open = true;
  await rebuild();
  if (!fs.selected.stepId && fs.steps.length) fs.selected.stepId = fs.steps[0].id;
}
export function closeWorkspace() { fs.open = false; fs.playback.playing = false; }

// ── classification (resolves ambiguous U edges) ────────────────────────────
export async function classify(creaseIds, kind) {
  for (const id of creaseIds) {
    if (kind === null) delete fs.classification[id]; else fs.classification[id] = kind;
  }
  persist({ immediate: true });
  await rebuild();
}
export async function classifyAllAmbiguous(kind) {
  await classify(fs.ambiguous.map(i => i.crease), kind);
}

// ── recipes ────────────────────────────────────────────────────────────────
/** Load the origami-lily recipe (classification, groups, step 1) and solve it. */
export async function applyLilyPreset() {
  ensureIds(state.model);
  const p = lilyPreset(state.model);
  fs.classification = { ...fs.classification, ...p.classification };
  fs.groups = p.groups.map(g => ({ ...g }));
  fs.steps = p.steps.map(s => JSON.parse(JSON.stringify(s)));
  fs.results = {}; fs.selected.stepId = fs.steps[0]?.id ?? null; fs.leftTab = 'steps'; fs.rightTab = 'step';
  persist({ immediate: true });
  await rebuild();
  await solveAll();
  setPosition(timeline().total);
  return p.summary;
}

// ── steps ──────────────────────────────────────────────────────────────────
let seq = 0;
const newId = p => `${p}-${Date.now().toString(36)}-${(seq++).toString(36)}`;

export function addStep(title) {
  const step = { id: newId('step'), title: title || `Step ${fs.steps.length + 1}`, instruction: '', notes: '', durationSeconds: 2,
    defaultConnectionMode: 'free', easing: 'smoothstep', anchors: [], controls: [], branchHint: [] };
  fs.steps.push(step); fs.selected.stepId = step.id; persist(); return step;
}
export function removeStep(id) {
  const i = fs.steps.findIndex(s => s.id === id); if (i < 0) return;
  fs.steps.splice(i, 1); delete fs.results[id];
  if (fs.selected.stepId === id) fs.selected.stepId = fs.steps[Math.min(i, fs.steps.length - 1)]?.id ?? null;
  persist();
}
export function moveStep(id, dir) {
  const i = fs.steps.findIndex(s => s.id === id), j = i + dir;
  if (i < 0 || j < 0 || j >= fs.steps.length) return;
  [fs.steps[i], fs.steps[j]] = [fs.steps[j], fs.steps[i]];
  markStale(); persist();
}
export function duplicateStep(id) {
  const i = fs.steps.findIndex(s => s.id === id); if (i < 0) return;
  const copy = JSON.parse(JSON.stringify(fs.steps[i])); copy.id = newId('step'); copy.title += ' (copy)';
  fs.steps.splice(i + 1, 0, copy); fs.selected.stepId = copy.id; persist();
}
export function touchStep() { markStale(); persist(); }
export const regionLabel = id => fs.regions.find(r => r.id === id)?.label || id;
export const selectedStep = () => fs.steps.find(s => s.id === fs.selected.stepId) || null;

export function addControl(stepId, target, mode = 'drive') {
  const s = fs.steps.find(x => x.id === stepId); if (!s) return;
  s.controls.push({ target, mode, quantity: 'angle', toDegrees: mode === 'drive' ? 30 : undefined });
  touchStep();
}
export function removeControl(stepId, idx) { const s = fs.steps.find(x => x.id === stepId); s?.controls.splice(idx, 1); touchStep(); }

export function addGroup(name, creaseIds) {
  const g = { id: newId('group'), name: name || `Group ${fs.groups.length + 1}`, creaseIds: [...creaseIds] };
  fs.groups.push(g); persist(); return g;
}
export function removeGroup(id) { fs.groups = fs.groups.filter(g => g.id !== id); persist(); }

// ── solving & playback ─────────────────────────────────────────────────────
// Plain JSON copy: reactive proxies cannot be structured-cloned into the worker.
function doc() { return JSON.parse(JSON.stringify({ version: SEQUENCE_VERSION, groups: derivedGroups(), steps: fs.steps, geometryHash: fs.geometryHash })); }

export function sequenceIssues() {
  if (!raw.compiled?.ok) return [];
  return validateSequence(doc(), raw.compiled).issues;
}

export async function solveAll() {
  if (!raw.compiled?.ok) { fs.message = 'Resolve geometry issues first'; return; }
  const v = validateSequence(doc(), raw.compiled);
  if (!v.ok) { fs.message = v.issues.find(i => i.level === 'error').message; return; }
  fs.solving = true; fs.progress = 0; fs.message = 'Solving…';
  const c = client();
  let r;
  try {
    const { requestId, promise } = c.solveSequence({ doc: doc(), initialAngles: new Array(raw.compiled.variableConnIds.length).fill(0) },
      { onProgress: m => { fs.progress = m.progress; fs.message = `Solving ${stepTitle(m.stepId)}…`; } });
    fs.solveRequest = requestId;
    r = await promise;
  } catch (e) {
    fs.solving = false; fs.solveRequest = null; fs.message = `Solver error: ${e.message}`; return;
  }
  fs.solving = false; fs.solveRequest = null;
  if (r.stale) { fs.message = 'Discarded: the design changed while solving'; return; }
  const results = {};
  for (const s of r.steps || []) {
    const st = fs.steps.find(x => x.id === s.stepId);
    results[s.stepId] = { status: s.status, completed: s.completed, samples: s.samples, failure: s.failure || null, signature: st ? stepSignature(st) : null, stale: false };
  }
  fs.results = results;
  fs.message = r.status === 'converged' ? 'Sequence solved' : `Stopped at "${stepTitle(r.failedStep)}": ${r.steps.at(-1)?.failure?.message || r.status}`;
  fs.diagnostics = { status: r.status, failedStep: r.failedStep ?? null, issues: r.issues || [], failure: r.steps?.at(-1)?.failure ?? null };
  fs.status = r.status === 'converged' ? 'geometryValidated' : 'preview';
  setPosition(fs.playback.t);
}
export function cancelSolve() { if (fs.solveRequest) client().cancel(fs.solveRequest); }

const stepTitle = id => fs.steps.find(s => s.id === id)?.title || id || '';

export function timeline() {
  let t = 0; const out = [];
  for (const s of fs.steps) { const d = Math.max(0.1, Number(s.durationSeconds) || 2); out.push({ id: s.id, title: s.title, start: t, end: t + d }); t += d; }
  return { segments: out, total: t };
}

/** Show the configuration at global timeline position t (seconds). */
export function setPosition(t) {
  const { segments, total } = timeline();
  fs.playback.t = Math.max(0, Math.min(total, t));
  const n = raw.compiled?.variableConnIds.length ?? 0;
  let angles = new Array(n).fill(0), exact = true;
  for (const seg of segments) {
    const res = fs.results[seg.id];
    if (!res?.samples?.length) { break; }
    if (fs.playback.t >= seg.end - 1e-9) { angles = res.samples.at(-1).angles; continue; }
    if (fs.playback.t <= seg.start) { angles = res.samples[0].angles; break; }
    const p = (fs.playback.t - seg.start) / (seg.end - seg.start);
    const S = res.samples; let k = 0;
    while (k + 1 < S.length && S[k + 1].progress < p) k++;
    const a = S[k], b = S[Math.min(k + 1, S.length - 1)];
    const u = b.progress === a.progress ? 0 : (p - a.progress) / (b.progress - a.progress);
    if (raw.compiled.closureConnIds.length) angles = u < 0.5 ? a.angles : b.angles;          // closed loops can't be lerped in angle space
    else angles = a.angles.map((v, i) => v + (b.angles[i] - v) * u);
    exact = u === 0 || u === 1;
    break;
  }
  fs.angles = angles;
  if (fs.status !== 'stale') fs.status = exact ? (fs.status === 'collisionChecked' ? 'collisionChecked' : 'geometryValidated') : 'preview';
  if (!Object.keys(fs.results).length) fs.status = 'preview';
  fs.collisions = []; 
  fs.version++;
}

let raf = 0, last = 0;
export function play() {
  const { total } = timeline(); if (!total) return;
  if (fs.playback.t >= total) fs.playback.t = 0;
  fs.playback.playing = true; last = performance.now();
  const tick = now => {
    if (!fs.playback.playing) return;
    const dt = (now - last) / 1000; last = now;
    const nt = fs.playback.t + dt;
    if (nt >= total) { setPosition(total); fs.playback.playing = false; return; }
    setPosition(nt); raf = requestAnimationFrame(tick);
  };
  raf = requestAnimationFrame(tick);
}
export function pause() { fs.playback.playing = false; cancelAnimationFrame(raf); }

export function saveWaypoint(label) {
  const ids = raw.compiled.variableConnIds, angles = {};
  ids.forEach((id, i) => { angles[id] = fs.angles[i]; });
  fs.configurations.push({ id: newId('cfg'), label: label || `Waypoint ${fs.configurations.length + 1}`, angles });
  persist();
}

// ── validation / measurement ───────────────────────────────────────────────
/** connId -> 'drive' | 'hold' | 'free' for the selected step (unlisted = free). */
export function connectionModes() {
  const m = new Map();
  const step = selectedStep();
  if (!step || !raw.compiled?.ok) return m;
  const groups = new Map(derivedGroups().map(g => [g.id, g]));
  for (const ctl of step.controls || []) for (const id of targetConnectionIds(ctl.target, groups, raw.compiled) || []) m.set(id, ctl.mode);
  return m;
}

export function poses() { return evaluatePoses(raw.compiled, fs.angles); }

export function runCollisionCheck({ thicknessAware = false } = {}) {
  if (!raw.compiled?.ok) return;
  const r = checkCollisions(raw.compiled, poses(), { thicknessAware });
  fs.collisions = r.collisions; fs.collisionMethod = r.method;
  if (!r.collisions.length && fs.status !== 'stale') fs.status = 'collisionChecked';
  fs.envelope = envelope(raw.compiled, poses());
  fs.version++;
  return r;
}

export function measure(a, b) {
  if (!raw.compiled?.ok || !a || !b) return null;
  const r = measureFeatures(raw.compiled, poses(), a, b);
  fs.measure = { a, b, result: r };
  return r;
}

// ── exports ────────────────────────────────────────────────────────────────
function download(name, data, mime) {
  const blob = new Blob([data], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href = url; a.download = name;
  document.body.appendChild(a); a.click();
  setTimeout(() => { document.body.removeChild(a); URL.revokeObjectURL(url); }, 0);
}
const base = () => state.currentProject || 'fold-assembly';

export function exportCurrent(kind) {
  const c = raw.compiled; if (!c?.ok) return { ok: false, message: 'Assembly has issues' };
  const mesh = buildMesh(c, fs.angles, { thickness: true });
  if (kind === 'glb') download(`${base()}.glb`, exportGLB(mesh, { geometryHash: c.hash }), 'model/gltf-binary');
  else if (kind === 'stl') { const r = exportSTL(mesh); download(`${base()}.stl`, r.bytes, 'model/stl'); return { ok: true, stats: r.stats, note: r.note }; }
  else if (kind === 'json') {
    const ids = c.variableConnIds, angles = {}; ids.forEach((id, i) => { angles[id] = fs.angles[i]; });
    download(`${base()}-configuration.json`, JSON.stringify({ units: 'mm', geometryHash: c.hash, status: fs.status, angles, collisions: fs.collisions, collisionMethod: fs.collisionMethod, stats: meshStats(mesh) }, null, 2), 'application/json');
  }
  return { ok: true, stats: meshStats(mesh) };
}

export function exportBundle() {
  const c = raw.compiled; if (!c?.ok) return { ok: false, message: 'Assembly has issues' };
  const d = doc();
  const steps = fs.steps.map(s => ({ stepId: s.id, samples: fs.results[s.id]?.samples || [] }));
  if (steps.some(s => !s.samples.length)) return { ok: false, message: 'Solve every step before exporting an animation' };
  const bundle = buildAnimationBundle(c, { steps }, d, { assembly: raw.assembly });
  for (const [name, text] of Object.entries(bundle)) download(`${base()}-bundle-${name}`, text, 'application/json');
  return { ok: true, files: Object.keys(bundle) };
}

// Re-solve a single configuration at the displayed progress (used after scrubbing).
export function solveHere() {
  if (!raw.compiled?.ok) return null;
  const r = solveConfiguration(raw.compiled, { initial: fs.angles, constraints: [] });
  if (r.geometryValid) { fs.angles = r.angles; fs.status = 'geometryValidated'; fs.version++; }
  return r;
}

// Keep the persisted recipe fresh if the pattern changes underneath the workspace.
watch(() => state.model.edges.length + ':' + state.model.vertices.length, () => { if (fs.open) rebuild(); });

export { deg, rad };
