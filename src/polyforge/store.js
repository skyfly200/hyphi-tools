// PolyForge reactive store. Single source of truth for the Vue app.
import { reactive, computed, watch } from 'vue';
import { POLYHEDRA, buildEdges } from './lib/polyhedra.js';
import { LEDS } from './lib/leds.js';
import { CONNECTORS } from './lib/connectors.js';
import { unfold } from './lib/unfold.js';
import { savePatch, loadPatch, deletePatch, listPatches, exportPatchJSON, parsePatchJSON } from './lib/patches.js';

const PREFS_KEY = 'polyforge.prefs.v1';

const DEFAULT_PARAMS = {
  polyhedronId: 'tetra',
  edgeLengthMm: 60,         // physical edge length of the assembled fixture
  ledId: 'WS2812B',
  ledsPerFace: 1,
  connectorId: 'PAD_ONLY',
  connectorFaceIdx: 0,      // face that hosts the wire entry connector
  connectorPlacement: 'edge',
  // Panel shape clips each face's exported outline. 'face' keeps the
  // raw face polygon (with optional rounded corners); 'circle' and
  // 'hexagon' inscribe a smaller shape inside the face.
  panel: {
    shape: 'face',          // 'face' | 'circle' | 'hexagon'
    cornerRadiusMm: 0,      // 'face' only: round the polygon corners
    insetMm: 0,             // pull the boundary inward by this much
    scale: 0.95,            // 'circle' / 'hexagon': fraction of face's inscribed radius
    // Flex bridges between adjacent panels. Each bridge runs from
    // panel centroid to panel centroid across the fold edge so it
    // always reaches both panels, however far the boundary is inset.
    // Width is auto-derived from design rules + signal count.
    bridge: {
      enabled: true,
      style: 'straight',    // 'straight' | 's-curve'
      curveAmplitudeMm: 3,  // s-curve lateral control-point offset
    },
  },
  // Copper routing through the bridges.
  routing: {
    enabled: true,
    // signalsPerFace is informational — for chained 3-wire LEDs each
    // bridge carries VCC + GND + DIN-forward + DOUT-back.
  },
  // Solder-pad parameters used only when connectorId === 'PAD_ONLY'.
  // Pads sit in a row at the configured pitch; the strip length scales
  // automatically with the LED's wireCount.
  solderPad: {
    shape: 'rect',          // 'rect' | 'circle'
    padWMm: 1.6,            // rect: pad width (along the row); circle: ignored
    padHMm: 2.2,            // rect: pad height (across the row); circle: ignored
    padDiaMm: 1.6,          // circle: pad diameter
    pitchMm: 2.54,          // center-to-center spacing between pads
    keepoutMm: 0.4,         // clearance around the whole strip
  },
  mountingHole: {
    enabled: false,
    position: 'corners',    // 'center' | 'corners'
    diameterMm: 3.2,        // typical M3 clearance
    marginMm: 4,            // inset from face corner toward centroid (corners mode)
  },
  // Design rules JSON — what KiCad / fab needs to know. Driven by the
  // sidebar form, but the user can paste a JSON object directly.
  designRules: {
    traceWidthMm: 0.25,
    clearanceMm: 0.2,
    edgeMarginMm: 0.5,
    signalsPerTrace: 1,
    // Flex vendors quote ~6–10 × stack thickness for static bends;
    // 3mm is a safe default for a 0.11mm 1-layer polyimide stack
    // with copper + coverlay.
    minBendRadiusMm: 3,
    // Physical stack thickness — used for the 3D preview and the fold
    // sim. Rigid LED panels are thicker than the flex hinge material.
    boardThicknessMm: 1.6,
    flexThicknessMm: 0.2,
  },
};

const DEFAULT_PREFS = {
  showFoldLines: true,
  showLEDs: true,
  showConnector: true,
  showFaceLabels: true,
  showMountingHoles: true,
  // Faint outline showing the original (unfolded) face polygon
  // even when the panel shape clips inward. Useful when you want to
  // see how the panel sits inside the face boundary.
  showFaceGuide: false,
  showBridges: true,
  showChainLabels: false,
  showTraces: true,
  view: 'net', // 'net' | 'folded'
  layersOpen: true,
  theme: 'dark',
};

function loadPrefs() {
  try {
    const raw = localStorage.getItem(PREFS_KEY);
    if (!raw) return { ...DEFAULT_PREFS };
    return { ...DEFAULT_PREFS, ...JSON.parse(raw) };
  } catch { return { ...DEFAULT_PREFS }; }
}

function savePrefs(prefs) {
  try { localStorage.setItem(PREFS_KEY, JSON.stringify(prefs)); } catch {}
}

export const state = reactive({
  params: { ...DEFAULT_PARAMS, designRules: { ...DEFAULT_PARAMS.designRules } },
  prefs: loadPrefs(),
  currentPatch: '',
  patchList: listPatches(),
  rootFace: 0,
  hoverFace: null,
  selectedFace: null,
  ui: {
    mobileSidebar: false,
    mobileInspector: false,
    designRulesText: JSON.stringify(DEFAULT_PARAMS.designRules, null, 2),
    designRulesError: '',
  },
});

watch(() => state.prefs, p => savePrefs(p), { deep: true });

// Recompute the geometry whenever the polyhedron or root face changes.
// The unfolded net coords are in normalized-edge-length units; the UI
// multiplies by params.edgeLengthMm when drawing.
export const geometry = computed(() => {
  const poly = POLYHEDRA[state.params.polyhedronId] || POLYHEDRA.tetra;
  const built = poly.build();
  const edges = buildEdges(built.faces);
  const net = unfold(built, state.rootFace);
  return { poly, built, edges, net };
});

export const currentLED = computed(() => LEDS[state.params.ledId] || null);
export const currentConnector = computed(() => CONNECTORS[state.params.connectorId] || null);

// Wire count is driven by the LED — 3 wires for single-data parts
// (WS2812 family, SK6812, SK6805), 4 wires for clocked parts (APA102).
// The connector list filters by this, and PAD_ONLY auto-scales.
export const requiredWireCount = computed(() => currentLED.value?.wireCount || 3);

export function compatibleConnectors() {
  const want = requiredWireCount.value;
  return Object.values(CONNECTORS).filter(c => c.id === 'PAD_ONLY' || c.pins === want);
}

// When LED changes (and thus the required wire count), if the current
// connector no longer fits, fall back to the first compatible one.
watch(requiredWireCount, () => {
  const c = CONNECTORS[state.params.connectorId];
  if (!c) return;
  if (c.id === 'PAD_ONLY') return;
  if (c.pins === requiredWireCount.value) return;
  const next = compatibleConnectors().find(x => x.id !== 'PAD_ONLY');
  if (next) state.params.connectorId = next.id;
});

export function setPolyhedron(id) {
  if (!POLYHEDRA[id]) return;
  state.params.polyhedronId = id;
  state.rootFace = 0;
  state.params.connectorFaceIdx = 0;
  state.hoverFace = null;
  state.selectedFace = null;
}

export function setDesignRulesFromText(text) {
  state.ui.designRulesText = text;
  try {
    const obj = JSON.parse(text);
    if (obj && typeof obj === 'object') {
      state.params.designRules = { ...state.params.designRules, ...obj };
      state.ui.designRulesError = '';
    } else {
      state.ui.designRulesError = 'Design rules must be a JSON object.';
    }
  } catch (e) {
    state.ui.designRulesError = e.message || 'Invalid JSON.';
  }
}

export function syncDesignRulesTextFromParams() {
  state.ui.designRulesText = JSON.stringify(state.params.designRules, null, 2);
  state.ui.designRulesError = '';
}

export function paramsForPatch() {
  return JSON.parse(JSON.stringify(state.params));
}

export function applyPatchObject(patch) {
  if (!patch || typeof patch !== 'object') return;
  // Merge defensively — unknown fields are dropped, missing fields keep
  // their defaults. Design rules merge so old patches without newer
  // fields still resolve sanely.
  const params = { ...DEFAULT_PARAMS, ...patch };
  params.designRules = { ...DEFAULT_PARAMS.designRules, ...(patch.designRules || {}) };
  params.solderPad = { ...DEFAULT_PARAMS.solderPad, ...(patch.solderPad || {}) };
  params.mountingHole = { ...DEFAULT_PARAMS.mountingHole, ...(patch.mountingHole || {}) };
  // Migrate the older flat panelShape string into the new panel block.
  params.panel = { ...DEFAULT_PARAMS.panel, ...(patch.panel || {}) };
  params.panel.bridge = { ...DEFAULT_PARAMS.panel.bridge, ...(patch.panel?.bridge || {}) };
  // Older patches saved manual bridge dimensions — strip them so the
  // auto-derived centroid-to-centroid geometry takes effect.
  delete params.panel.bridge.widthMm;
  delete params.panel.bridge.marginMm;
  params.routing = { ...DEFAULT_PARAMS.routing, ...(patch.routing || {}) };
  if (patch.panelShape && !patch.panel) params.panel.shape = patch.panelShape;
  delete params.panelShape;
  if (!POLYHEDRA[params.polyhedronId]) params.polyhedronId = 'tetra';
  if (!LEDS[params.ledId]) params.ledId = 'WS2812B';
  if (!CONNECTORS[params.connectorId]) params.connectorId = 'PAD_ONLY';
  state.params = params;
  state.rootFace = 0;
  state.hoverFace = null;
  state.selectedFace = null;
  syncDesignRulesTextFromParams();
}

export function savePatchAs(name) {
  if (!name) return false;
  const ok = savePatch(name, paramsForPatch());
  if (ok) {
    state.currentPatch = name;
    state.patchList = listPatches();
  }
  return ok;
}

export function loadPatchByName(name) {
  const patch = loadPatch(name);
  if (!patch) return false;
  applyPatchObject(patch);
  state.currentPatch = name;
  return true;
}

export function deletePatchByName(name) {
  deletePatch(name);
  state.patchList = listPatches();
  if (state.currentPatch === name) state.currentPatch = '';
}

export function exportCurrentPatchJSON() {
  return exportPatchJSON(paramsForPatch());
}

export function importPatchJSON(text) {
  const obj = parsePatchJSON(text);
  applyPatchObject(obj);
}
