// FacetFold state + build pipeline.
// net (pure JS) -> verification through @hyphi/folding -> manifold bodies -> report.

import { reactive, markRaw } from 'vue';
import wasmUrl from 'manifold-3d/manifold.wasm?url';
import { POLYHEDRA, EXTRA_POLYHEDRA, ensureOutward } from '@hyphi/polyhedra';
import { loadKernel, meshOf } from './lib/kernel.js';
import { buildNet, DEFAULT_PARAMS, defaultHingeKeys, analyzeEdges } from './lib/net.js';
import { verifyNet } from './lib/verify.js';
import { buildPlate, splitByColor, artDiagnostics } from './lib/solid.js';
import { parseSvg, textShapes, loadFont, resolveLayer } from './lib/art.js';
import openSansUrl from '@fontsource/open-sans/files/open-sans-latin-700-normal.woff?url';
import montserratUrl from '@fontsource/montserrat/files/montserrat-latin-700-normal.woff?url';
import { assignColors, colorChangeEstimate, DEFAULT_PALETTE } from './lib/colors.js';
import { faceMountSpec, tieSlotSpecs, truncateVertex } from './lib/lighting.js';
import { buildReport, pieceSTL, minHingeWidthMm, export3MF } from './lib/export.js';
import { plateSvg, heightmapPGM, PROCESSES } from './lib/surface.js';
import { panelProfile } from './lib/panel.js';
import { PRINTERS, createSlicingClient, resolveProfile, validateProfile, generateGcode, parseGcode, analyzeGcode, analyzeNozzles, buildRibbons } from '@hyphi/slicer';

export const SOLIDS = { ...Object.fromEntries(Object.entries(POLYHEDRA).map(([k, v]) => [k, { id: k, label: v.label, build: v.build }])),
  ...Object.fromEntries(Object.entries(EXTRA_POLYHEDRA).map(([k, v]) => [k, { id: k, label: v.label, build: v.build }])) };

function lsGet(k) { try { return localStorage.getItem(k); } catch { return null; } }
function lsSet(k, v) { try { v ? localStorage.setItem(k, v) : localStorage.removeItem(k); } catch { /* storage unavailable */ } }
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
  colors: { mode: 'single', count: 3, palette: DEFAULT_PALETTE.map(c => ({ ...c })), manual: {}, hingeMode: 'parent', hingeSlot: 0, extruders: 4, active: 0 },
  art: { layers: [], info: {}, customFontName: null, nextId: 1 },
  slicing: { profile: { printer: 'generic', nozzleMm: 0.4, layerHeightMm: 0.2, firstLayerHeightMm: 0.2, walls: 2, topLayers: 4, bottomLayers: 4, infillPct: 15, material: 'PETG' }, where: 'local', server: { url: lsGet('ff.slicer.url') || '', key: lsGet('ff.slicer.key') || '', remember: !!lsGet('ff.slicer.key'), engine: 'builtin', engines: ['builtin'], info: '' }, progress: '', piece: 0, busy: false, error: null, nozzleTable: null, result: null, layer: 0, layerMax: 0, colorBy: 'type', stale: false },
  selectedFace: 0,
  fold: 1,                             // 0 flat … 1 closed
  view: 'folded',                      // folded | plate
  ui: { sidebar: true, inspector: true },
  status: 'Loading geometry kernel…', busy: true, error: null,
  version: 0,                          // bumps when geometry changes so views redraw
  report: null, issues: [],
  faceCount: 0, edgeList: [], vertexCount: 0,
});

export const raw = markRaw({ slice: null, fonts: {}, shapeCache: new Map(), net: null, verify: null, plate: null, K: null, meshes: null, solid: null, bodies: [], faceColors: [] });
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

export const FONTS = [{ id: 'open-sans', label: 'Open Sans Bold', url: openSansUrl }, { id: 'montserrat', label: 'Montserrat Bold', url: montserratUrl }];
async function getFont(id) {
  if (raw.fonts[id]) return raw.fonts[id];
  const f = FONTS.find(x => x.id === id); if (!f) throw new Error('font not loaded — upload it again');
  raw.fonts[id] = loadFont(await (await fetch(f.url)).arrayBuffer());
  return raw.fonts[id];
}
export async function uploadFont(file) {
  try { raw.fonts.custom = loadFont(await file.arrayBuffer()); state.art.customFontName = file.name; state.error = null; scheduleRebuild(0); }
  catch (e) { state.art.customFontName = null; state.error = e.message; }
}
async function shapesFor(L) {
  const key = L.type === 'text' ? JSON.stringify(['t', L.text, L.font, L.sizeMm, L.align, state.art.customFontName]) : JSON.stringify(['s', L.svg, L.widthMm]);
  if (raw.shapeCache.has(key)) return raw.shapeCache.get(key);
  const r = L.type === 'text' ? textShapes(await getFont(L.font), L.text, { sizeMm: L.sizeMm, align: L.align }) : parseSvg(L.svg, { widthMm: L.widthMm });
  if (raw.shapeCache.size > 40) raw.shapeCache.clear();
  raw.shapeCache.set(key, r); return r;
}
export function addArt(type, extra = {}) {
  const id = state.art.nextId++;
  const base = { id, face: state.selectedFace, type, slot: Math.min(1, state.colors.palette.length - 1), dx: 0, dy: 0, rotDeg: 0, scale: 1, depthMm: 0.8, through: false, side: 'outer', slotMap: {}, open: true };
  state.art.layers.push(type === 'text' ? { ...base, text: 'HELLO', font: 'open-sans', sizeMm: 10, align: 'center', ...extra } : { ...base, svg: '', widthMm: 20, ...extra });
  scheduleRebuild(0); return id;
}
export function removeArt(id) { state.art.layers = state.art.layers.filter(l => l.id !== id); delete state.art.info[id]; scheduleRebuild(0); }
export function copyArtToAllFaces(id) {
  const L = state.art.layers.find(l => l.id === id); if (!L) return;
  for (let f = 0; f < state.faceCount; f++) if (f !== L.face) state.art.layers.push({ ...JSON.parse(JSON.stringify(L)), id: state.art.nextId++, face: f });
  scheduleRebuild(0);
}
export async function setSvgFromFile(id, file) { const L = state.art.layers.find(l => l.id === id); if (L) { L.svg = await file.text(); L.slotMap = {}; scheduleRebuild(0); } }

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
    // artwork layers (SVG / text) -> inlay groups per face
    const artByFace = {}, artInfo = {}, C = state.colors;
    for (const L of state.art.layers) {
      if (L.face >= net.faces.length) continue;
      try {
        const sh = await shapesFor(L);
        const groups = resolveLayer(sh.shapes, net.faces[L.face], { placement: { dx: L.dx, dy: L.dy, rotDeg: L.rotDeg, scale: L.scale }, slotMap: L.slotMap, defaultSlot: L.slot, palette: C.palette });
        (artByFace[L.face] ||= []).push({ groups, depthMm: L.through ? 'through' : L.depthMm, side: L.side });
        artInfo[L.id] = { colors: sh.colors, warnings: sh.warnings, widthMm: sh.widthMm, heightMm: sh.heightMm, slots: groups.map(g => g.slot) };
      } catch (e) { artInfo[L.id] = { error: e.message }; }
    }
    if (id !== runId) return;
    state.art.info = artInfo;
    const hasArt = Object.keys(artByFace).length > 0;
    // multi-colour: one disjoint body per colour (empty when printing one colour with no artwork)
    const assign = assignColors(net, { mode: C.mode, count: C.count, manual: C.manual });
    const hingeMode = C.hingeMode === 'own' ? { slot: C.hingeSlot } : C.hingeMode;
    const pieceCache = new Map();
    const bodies = C.mode === 'single' && !hasArt ? [] : splitByColor(raw.K, plate, net, assign.colors, hingeMode, artByFace, pieceCache);
    const artIssues = hasArt ? artDiagnostics(raw.K, net, plate.profiles, artByFace, state.process) : [];
    const meshes = {
      facePieces: new Map([...pieceCache].filter(([f]) => artByFace[f]).map(([f, ps]) => [f, ps.map(p => ({ color: p.color, mesh: meshOf(p.manifold) }))])),
      bodies: bodies.map(b => ({ piece: b.piece, color: b.color, mesh: meshOf(b.manifold) })),
      panels: new Map([...plate.panels].map(([fid, m]) => [fid, meshOf(m)])),
      strips: plate.strips.map(s => (s ? meshOf(s) : null)),
      components: plate.components.map(m => meshOf(m)),
    };
    state.slicing.stale = !!raw.slice;
    raw.bodies = markRaw(bodies); raw.faceColors = assign.colors; raw.net = markRaw(net); raw.verify = markRaw(verify); raw.plate = markRaw(plate); raw.meshes = markRaw(meshes); raw.solid = markRaw(cur);
    const report = buildReport(net, verify, plate, { bedMm: state.bedMm, process: state.process });
    report.bedFinish = state.bedFinish;
    report.issues.push(...artIssues);
    for (const [lid, inf] of Object.entries(artInfo)) {
      if (inf.error) report.issues.push({ level: 'error', code: 'artError', message: `artwork layer ${lid}: ${inf.error}` });
      for (const w of inf.warnings || []) report.issues.push({ level: 'warning', code: 'artWarning', message: `artwork layer ${lid}: ${w}` });
    }
    if (C.mode !== 'single' || hasArt) {
      const hingeSlots = net.hinges.map(h => (C.hingeMode === 'own' ? C.hingeSlot : C.hingeMode === 'child' ? assign.colors[h.child] : assign.colors[h.parent]));
      const est = colorChangeEstimate(net, [...assign.colors, ...bodies.map(b => b.color)], hingeSlots);
      report.colors = { mode: C.mode, ...est, extruders: C.extruders, bodies: bodies.length, artLayers: state.art.layers.length };
      report.issues.push(...assign.issues);
      if (est.colorsUsed > C.extruders) report.issues.push({ level: 'error', code: 'tooManyColors', message: `${est.colorsUsed} colours are in use but only ${C.extruders} extruder/AMS slots are available. Reduce the colours or raise the slot count.` });
      else if (est.changes > 400) report.issues.push({ level: 'warning', code: 'manyChanges', message: `about ${est.changes} colour changes (${est.colorsUsed} colours × ${est.layers} layers): expect long print time and a lot of purge waste. Fewer colours, or colours confined to fewer faces, helps.` });
    }
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
export function exportColorSTLs() {
  if (!raw.bodies.length) return exportSTLs();
  raw.bodies.forEach(b => { const nm = state.colors.palette[b.color]?.name ?? `color${b.color}`; const r = pieceSTL(b.manifold, `${base()}-piece${b.piece + 1}-${nm}`); download(`${base()}-piece${b.piece + 1}-${nm}.stl`, r.bytes, 'model/stl'); });
}
export function export3MFFile() { if (raw.bodies.length) download(`${base()}.3mf`, export3MF(raw.bodies, state.colors.palette, { name: base() }).bytes, 'model/3mf'); }
export function setFaceColor(face, color) { state.colors.manual[face] = color; if (state.colors.mode !== 'manual') state.colors.mode = 'manual'; scheduleRebuild(0); }
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

// ---- slicing automation: nozzle analysis, preview slicing, G-code analysis and viewing ----
const tick = () => new Promise(r => setTimeout(r, 20));
const pieceManifold = () => raw.plate?.components?.[Math.min(state.slicing.piece, (raw.plate?.components?.length || 1) - 1)];
const sliceProfile = () => resolveProfile({ ...state.slicing.profile, name: `facetfold-${state.slicing.profile.nozzleMm}`, bed: { x: state.bedMm[0], y: state.bedMm[1] } });
export function setPrinter(id) {
  const pr = PRINTERS[id]; if (!pr) return;
  state.slicing.profile.printer = id; state.bedMm = [pr.bed.x, pr.bed.y];
  if (!pr.nozzles.includes(state.slicing.profile.nozzleMm)) state.slicing.profile.nozzleMm = pr.nozzles.includes(0.4) ? 0.4 : pr.nozzles[0];
  if (pr.preferred !== 'builtin') state.slicing.server.engine = state.slicing.server.engines.includes(pr.preferred) ? pr.preferred : state.slicing.server.engine;
  scheduleRebuild(0);
}
async function guarded(fn) {
  if (state.slicing.busy) return;
  state.slicing.busy = true; state.slicing.error = null; await tick();
  try { await fn(); } catch (e) { state.slicing.error = e.message; } finally { state.slicing.busy = false; }
}
export const runNozzleAnalysis = () => guarded(() => {
  const m = pieceManifold(); if (!m) throw new Error('nothing built yet');
  const a = analyzeNozzles(raw.K, m, { lineWidthFactor: sliceProfile().lineWidthFactor, maxLayerHeightMm: raw.net?.hinges.length ? raw.net.params.hingeThicknessMm : Infinity });
  state.slicing.nozzleTable = { ...a, piece: state.slicing.piece };
});
function show(gcode, parsed, profile, extra = {}) {
  const analysis = analyzeGcode(parsed, { nozzleMm: profile.nozzleMm, filamentDiameterMm: profile.filamentDiameterMm });
  const ribbons = buildRibbons(parsed, { filamentDiameterMm: profile.filamentDiameterMm });
  raw.slice = markRaw({ gcode, parsed, ribbons, profile });
  state.slicing.result = { analysis, ...extra };
  state.slicing.layerMax = Math.max(0, parsed.layers.length - 1); state.slicing.layer = state.slicing.layerMax; state.slicing.stale = false;
  state.view = 'gcode'; state.version++;
}
function hingeIssue(prof) {          // a hinge thinner than the first layer is never printed
  const th = raw.net?.params.hingeThicknessMm;
  return th && prof.firstLayerHeightMm > th * 1.25 ? { level: 'warning', code: 'hingeVsLayer', message: `hinge flexure is ${th} mm but the first layer is ${prof.firstLayerHeightMm} mm — hinges will not print; use a first layer of about ${th} mm (a 0.2 mm nozzle with 0.1 mm layers) or thicken the hinge` } : null;
}
const serverClient = () => {
  const S = state.slicing.server; if (!S.url) throw new Error('enter the slicing server URL');
  lsSet('ff.slicer.url', S.url); lsSet('ff.slicer.key', S.remember ? S.key : '');
  return createSlicingClient({ baseUrl: S.url, apiKey: S.key });
};
export async function checkServer() {
  const S = state.slicing.server; S.info = '';
  try { const h = await serverClient().health(); S.engines = h.engines; if (!h.engines.includes(S.engine)) S.engine = 'builtin'; S.info = `reachable · engines: ${h.engines.join(', ')} · ${h.running} running, ${h.queued} queued`; }
  catch (e) { S.info = e.message; }
}
export function cancelSlice() { raw.abort?.abort(); }
const runRemote = () => guarded(async () => {
  const m = pieceManifold(); if (!m) throw new Error('nothing built yet');
  const prof = sliceProfile(), client = serverClient(), ac = new AbortController(); raw.abort = ac;
  try {
    const r = await client.slice({ stl: pieceSTL(m, 'piece').bytes, profile: prof, engine: state.slicing.server.engine }, { signal: ac.signal,
      onProgress: j => { state.slicing.progress = j.status === 'queued' ? `queued (#${j.queuePosition})` : j.status === 'running' ? `slicing on server ${Math.round((j.progress || 0) * 100)}%` : j.status; } });
    const parsed = parseGcode(r.gcode);
    show(r.gcode, parsed, prof, { engine: `hosted server (${r.summary.engine})`, profileIssues: [...(r.summary.profileIssues || []), ...(hingeIssue(prof) ? [hingeIssue(prof)] : [])], fitsBed: r.summary.stats?.fitsBed ?? null, lostVolumeMm3: r.summary.stats?.lostVolumeMm3 });
  } finally { raw.abort = null; state.slicing.progress = ''; }
});
export const runSlice = () => state.slicing.where === 'server' ? runRemote() : runLocalSlice();
const runLocalSlice = () => guarded(() => {
  const m = pieceManifold(); if (!m) throw new Error('nothing built yet');
  const prof = sliceProfile(), issues = validateProfile(prof);
  if (issues.some(i => i.level === 'error')) throw new Error(issues.filter(i => i.level === 'error').map(i => i.message).join('; '));
  const hi = hingeIssue(prof); if (hi) issues.push(hi);
  const g = generateGcode(raw.K, m, prof);
  const parsed = parseGcode(g.gcode);
  show(g.gcode, parsed, prof, { engine: 'built-in preview slicer', profileIssues: issues, fitsBed: g.stats.fitsBed, lostVolumeMm3: g.stats.lostAreaMm2, estTimeS: g.stats.timeS });
});
export const loadGcode = file => guarded(async () => {
  const text = await file.text(), prof = sliceProfile();
  show(text, parseGcode(text), prof, { engine: `loaded ${file.name}`, profileIssues: [], fitsBed: null });
});
export function downloadGcode() { if (raw.slice) download(`${base()}-piece${state.slicing.piece + 1}.gcode`, new TextEncoder().encode(raw.slice.gcode), 'text/x.gcode'); }
export { PROCESSES };
