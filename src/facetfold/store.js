// FacetFold state + build pipeline.
// net (pure JS) -> verification through @hyphi/folding -> manifold bodies -> report.

import { reactive, markRaw } from 'vue';
import wasmUrl from 'manifold-3d/manifold.wasm?url';
import { POLYHEDRA, EXTRA_POLYHEDRA, ensureOutward } from '@hyphi/polyhedra';
import { loadKernel, meshOf } from './lib/kernel.js';
import { buildNet, DEFAULT_PARAMS, defaultHingeKeys, analyzeEdges } from './lib/net.js';
import { verifyNet } from './lib/verify.js';
import { buildPlate } from './lib/solid.js';
import { faceMountSpec, tieSlotSpecs, truncateVertex } from './lib/lighting.js';
import { buildReport, pieceSTL, minHingeWidthMm } from './lib/export.js';
import { plateSvg, heightmapPGM, PROCESSES } from './lib/surface.js';
import { panelProfile } from './lib/panel.js';

export const SOLIDS = { ...Object.fromEntries(Object.entries(POLYHEDRA).map(([k, v]) => [k, { id: k, label: v.label, build: v.build }])),
  ...Object.fromEntries(Object.entries(EXTRA_POLYHEDRA).map(([k, v]) => [k, { id: k, label: v.label, build: v.build }])) };

export const state = reactive({
  theme: 'dark',
  solidId: 'cube',
  params: { ...DEFAULT_PARAMS },
  customHinges: null,                  // null = default spanning tree; otherwise array of edge keys that are hinges
  port: { enabled: false, vertex: 0, depthMm: 8, holeMm: 5, tieSlots: true },
  mounts: [],                          // { face, type:'round'|'rect', diameterMm, widthMm, heightMm }
  snap: { enabled: true, bumpRadiusMm: 0.8, bumpHeightMm: 0.35, spacingMm: 18 },
  process: 'fdm04',
  bedMm: [256, 256],
  bedFinish: 'smooth',                 // smooth | textured (describes the build sheet; no geometry)
  surfaces: {},                        // face id -> { kind, pitchMm, angleDeg, depthMm, intent }
  selectedFace: 0,
  fold: 1,                             // 0 flat … 1 closed
  view: 'folded',                      // folded | plate
  ui: { sidebar: true, inspector: true },
  status: 'Loading geometry kernel…', busy: true, error: null,
  version: 0,                          // bumps when geometry changes so views redraw
  report: null, issues: [],
  faceCount: 0, edgeList: [], vertexCount: 0,
});

export const raw = markRaw({ net: null, verify: null, plate: null, K: null, meshes: null, solid: null });
let runId = 0, timer = null;

const shortest = s => Math.min(...s.faces.flatMap(f => f.map((v, i) => Math.hypot(...[0, 1, 2].map(k => s.vertices[v][k] - s.vertices[f[(i + 1) % f.length]][k])))));

function currentSolid() {
  let s = ensureOutward(SOLIDS[state.solidId].build());
  state.vertexCount = s.vertices.length;
  if (state.port.enabled) {
    const k = state.params.edgeLengthMm / shortest(s);
    const scaled = { vertices: s.vertices.map(v => v.map(x => x * k)), faces: s.faces };
    const v = Math.min(state.port.vertex, scaled.vertices.length - 1);
    const cut = truncateVertex(scaled, v, state.port.depthMm);
    return { solid: cut.solid, portFace: cut.portFace, scaled: true };
  }
  return { solid: s, portFace: null, scaled: false };
}

export async function rebuild() {
  const id = ++runId;
  state.busy = true; state.error = null;
  try {
    raw.K = raw.K || await loadKernel({ wasmUrl });
    const cur = currentSolid();
    const params = { ...state.params };
    if (cur.scaled) params.edgeLengthMm = shortest(cur.solid);        // already in mm: scale factor 1
    const keys = state.customHinges ? new Set(state.customHinges) : undefined;
    const net = buildNet(cur.solid, params, { hingeKeys: keys });
    state.faceCount = net.faces.length;
    state.edgeList = net.edges.map(e => ({ key: e.key, kind: e.kind, phiDeg: (e.phi * 180) / Math.PI, lengthMm: e.lengthMm, faces: e.faces }));
    if (state.selectedFace >= net.faces.length) state.selectedFace = 0;

    const verify = verifyNet(net);
    const features = { snap: { ...state.snap }, process: state.process, mounts: [], tieSlots: [], surfaces: {} };
    if (cur.portFace !== null) {
      features.mounts.push(faceMountSpec(net, cur.portFace, { type: 'round', diameterMm: state.port.holeMm }));
      if (state.port.tieSlots) features.tieSlots.push(...tieSlotSpecs(net, cur.portFace));
    }
    for (const m of state.mounts) if (m.face < net.faces.length) features.mounts.push(faceMountSpec(net, m.face, m));
    for (const [f, s] of Object.entries(state.surfaces)) if (Number(f) < net.faces.length && s.kind !== 'none') features.surfaces[f] = { ...s };

    const plate = buildPlate(raw.K, net, features);
    if (id !== runId) { return; }                                    // a newer edit superseded this build
    const meshes = {
      panels: new Map([...plate.panels].map(([fid, m]) => [fid, meshOf(m)])),
      strips: plate.strips.map(s => (s ? meshOf(s) : null)),
      components: plate.components.map(m => meshOf(m)),
    };
    raw.net = markRaw(net); raw.verify = markRaw(verify); raw.plate = markRaw(plate); raw.meshes = markRaw(meshes); raw.solid = markRaw(cur);
    const report = buildReport(net, verify, plate, { bedMm: state.bedMm, process: state.process });
    report.bedFinish = state.bedFinish;
    state.report = JSON.parse(JSON.stringify(report, (k, v) => (typeof v === 'number' && !Number.isFinite(v) ? null : v)));
    state.issues = report.issues;
    state.status = verify.ok ? 'Folds onto the ideal solid' : 'Verification found problems';
    state.version++;
  } catch (e) {
    if (id === runId) { state.error = e.message; state.status = 'Build failed'; }
  } finally { if (id === runId) state.busy = false; }
}

export function scheduleRebuild(ms = 180) { clearTimeout(timer); state.busy = true; timer = setTimeout(rebuild, ms); }

// ── edits ──
export function toggleHinge(key) {
  const keys = new Set(state.customHinges ?? (raw.net ? raw.net.hinges.map(h => h.key) : []));
  if (keys.has(key)) keys.delete(key); else keys.add(key);
  state.customHinges = [...keys]; scheduleRebuild(0);
}
export function resetHinges() { state.customHinges = null; scheduleRebuild(0); }
export function addMount() { state.mounts.push({ face: state.selectedFace, type: 'round', diameterMm: 5, widthMm: 8, heightMm: 5, collarWallMm: 1.2, collarHeightMm: 3, lugs: 3, offset: [0, 0] }); scheduleRebuild(0); }
export function removeMount(i) { state.mounts.splice(i, 1); scheduleRebuild(0); }
export function setSurface(face, spec) { if (!spec || spec.kind === 'none') delete state.surfaces[face]; else state.surfaces[face] = spec; scheduleRebuild(0); }
export function applySurfaceToAll(spec) { for (let f = 0; f < state.faceCount; f++) setSurfaceQuiet(f, spec); scheduleRebuild(0); }
function setSurfaceQuiet(f, spec) { if (!spec || spec.kind === 'none') delete state.surfaces[f]; else state.surfaces[f] = { ...spec }; }
export function suggestHingeWidth() { if (raw.net) { state.params.hingeWidthMm = Math.ceil(minHingeWidthMm(raw.net) * 10) / 10; scheduleRebuild(0); } }

// ── downloads ──
function download(name, data, mime) {
  const url = URL.createObjectURL(new Blob([data], { type: mime }));
  const a = document.createElement('a'); a.href = url; a.download = name; document.body.appendChild(a); a.click();
  setTimeout(() => { document.body.removeChild(a); URL.revokeObjectURL(url); }, 0);
}
const base = () => `facetfold-${state.solidId}`;
export function exportSTLs() {
  if (!raw.plate) return;
  raw.plate.components.forEach((m, i) => { const r = pieceSTL(m, `${base()}-piece${i + 1}`); download(`${base()}-piece${i + 1}.stl`, r.bytes, 'model/stl'); });
}
export function exportPlateSvg() { if (raw.net) download(`${base()}-plate.svg`, plateSvg(raw.net, raw.plate.profiles, state.surfaces), 'image/svg+xml'); }
export function exportHeightmap(face) {
  if (!raw.net) return; const f = raw.net.faces[face], spec = state.surfaces[face]; if (!spec) return;
  const pr = panelProfile(raw.net, f); if (!pr.bottom) return;
  const r = heightmapPGM(f, pr.bottom, spec, 50); download(`${base()}-face${face}-heightmap.pgm`, r.bytes, 'image/x-portable-graymap');
}
export function exportReport() { if (state.report) download(`${base()}-report.json`, JSON.stringify(state.report, null, 2), 'application/json'); }
export { PROCESSES };
