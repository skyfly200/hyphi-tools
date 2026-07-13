<script setup>
import { ref, computed, onMounted, onBeforeUnmount, watch } from 'vue';
import { state, geometry, currentLED, currentConnector, requiredWireCount } from '../store.js';
import {
  mountingHolePositions,
  ledPositions as ledPositionsLib,
  panelOutline,
  bridgesForNet,
  bridgeTraceCount,
  computeBridgeWidthMm,
  chainOrderFromConnector,
  planRouting,
} from '../lib/layout.js';

const containerRef = ref(null);
const width = ref(800);
const height = ref(600);

// Flip a key whenever any meaningful param changes so the canvas can
// flash a "refreshed" pulse. Watching a stringified signature instead
// of deep-watching state keeps reactivity cheap.
const refreshTick = ref(0);
const flashing = ref(false);
let flashTimer = null;
watch(
  () => JSON.stringify({
    p: state.params.polyhedronId,
    e: state.params.edgeLengthMm,
    led: state.params.ledId,
    lpf: state.params.ledsPerFace,
    c: state.params.connectorId,
    cf: state.params.connectorFaceIdx,
    cp: state.params.connectorPlacement,
    s: state.params.panelShape,
    r: state.rootFace,
    dr: state.params.designRules,
    sp: state.params.solderPad,
    mh: state.params.mountingHole,
    pn: state.params.panel,
    cf: state.params.connectorFaceIdx,
    rt: state.params.routing,
  }),
  () => {
    refreshTick.value++;
    flashing.value = true;
    if (flashTimer) clearTimeout(flashTimer);
    flashTimer = setTimeout(() => { flashing.value = false; }, 360);
  }
);
onBeforeUnmount(() => { if (flashTimer) clearTimeout(flashTimer); });

function measure() {
  if (!containerRef.value) return;
  const rect = containerRef.value.getBoundingClientRect();
  width.value = Math.max(200, rect.width);
  height.value = Math.max(200, rect.height);
}

let ro = null;
onMounted(() => {
  measure();
  ro = new ResizeObserver(measure);
  ro.observe(containerRef.value);
});
onBeforeUnmount(() => { if (ro) ro.disconnect(); });

// Auto-fit the net into the viewport with a comfortable margin.
const viewBox = computed(() => {
  const b = geometry.value.net.bbox;
  const scale = state.params.edgeLengthMm;
  const w = Math.max(0.001, b.width * scale);
  const h = Math.max(0.001, b.height * scale);
  const pad = Math.max(w, h) * 0.12 + 10;
  const vw = w + pad * 2;
  const vh = h + pad * 2;
  return { vx: -vw / 2, vy: -vh / 2, vw, vh };
});

function pathForFace(poly) {
  if (!poly || poly.length === 0) return '';
  const s = state.params.edgeLengthMm;
  let d = `M ${poly[0][0] * s} ${-poly[0][1] * s}`;
  for (let i = 1; i < poly.length; i++) {
    d += ` L ${poly[i][0] * s} ${-poly[i][1] * s}`;
  }
  return d + ' Z';
}

function centroidPx(poly) {
  const s = state.params.edgeLengthMm;
  let x = 0, y = 0;
  for (const p of poly) { x += p[0]; y += p[1]; }
  return [x / poly.length * s, -y / poly.length * s];
}

function ledPositions(face) {
  const s = state.params.edgeLengthMm;
  const pts = ledPositionsLib(face.polygon2D, currentLED.value, state.params.ledsPerFace, s);
  return pts.map(([x, y]) => [x * s, -y * s]);
}

// SVG path for the rendered panel outline of a single face. Handles
// the three panel shapes, including rounded corners on the face shape
// via per-segment arc trimming.
function panelPathFor(face) {
  const s = state.params.edgeLengthMm;
  const shape = panelOutline(face.polygon2D, state.params.panel, s);
  if (shape.kind === 'circle') {
    return { d: '', cx: shape.cx * s, cy: -shape.cy * s, r: shape.r * s, isCircle: true };
  }
  const pts = shape.points.map(([x, y]) => [x * s, -y * s]);
  if (!pts.length) return { d: '', isCircle: false };
  const rPx = (shape.cornerRadius || 0) * s;
  if (rPx <= 0.01) {
    let d = `M ${pts[0][0]} ${pts[0][1]}`;
    for (let i = 1; i < pts.length; i++) d += ` L ${pts[i][0]} ${pts[i][1]}`;
    return { d: d + ' Z', isCircle: false };
  }
  // Rounded corners: for each vertex, replace the sharp meeting of
  // the incoming and outgoing edge with an arc inset by `r` along
  // each edge. Capped by half the shorter incident edge so the radius
  // can't blow past the geometry.
  let d = '';
  const n = pts.length;
  for (let i = 0; i < n; i++) {
    const prev = pts[(i - 1 + n) % n];
    const curr = pts[i];
    const next = pts[(i + 1) % n];
    const e1 = [prev[0] - curr[0], prev[1] - curr[1]];
    const e2 = [next[0] - curr[0], next[1] - curr[1]];
    const l1 = Math.hypot(e1[0], e1[1]) || 1;
    const l2 = Math.hypot(e2[0], e2[1]) || 1;
    const r = Math.min(rPx, l1 / 2, l2 / 2);
    const start = [curr[0] + (e1[0] / l1) * r, curr[1] + (e1[1] / l1) * r];
    const end   = [curr[0] + (e2[0] / l2) * r, curr[1] + (e2[1] / l2) * r];
    if (i === 0) d += `M ${start[0]} ${start[1]}`;
    else d += ` L ${start[0]} ${start[1]}`;
    // sweep 0 for inward corners on a CCW polygon.
    d += ` A ${r} ${r} 0 0 1 ${end[0]} ${end[1]}`;
  }
  return { d: d + ' Z', isCircle: false };
}

function onFaceClick(fi) {
  state.selectedFace = state.selectedFace === fi ? null : fi;
}
function onFaceEnter(fi) { state.hoverFace = fi; }
function onFaceLeave() { state.hoverFace = null; }

const ledBox = computed(() => {
  const l = currentLED.value;
  if (!l) return null;
  return { w: l.body.w + l.keepout * 2, h: l.body.h + l.keepout * 2 };
});

const isPadOnly = computed(() => currentConnector.value?.id === 'PAD_ONLY');

// For named connectors (JST, Molex, etc) the keepout rectangle uses
// the catalog body + keepout. PAD_ONLY uses the user's pad params:
// strip length = pitch * (n - 1) + onePadW, plus user-specified keepout
// around the whole strip. h = padH/diameter + keepout * 2.
const connBox = computed(() => {
  const c = currentConnector.value;
  if (!c) return null;
  if (c.id === 'PAD_ONLY') {
    const sp = state.params.solderPad;
    const n = requiredWireCount.value;
    const onePadW = sp.shape === 'circle' ? sp.padDiaMm : sp.padWMm;
    const onePadH = sp.shape === 'circle' ? sp.padDiaMm : sp.padHMm;
    return {
      w: sp.pitchMm * (n - 1) + onePadW + sp.keepoutMm * 2,
      h: onePadH + sp.keepoutMm * 2,
    };
  }
  return { w: c.body.w + c.keepout * 2, h: c.body.h + c.keepout * 2 };
});

// Per-pad positions for PAD_ONLY rendering.
const padPositions = computed(() => {
  if (!isPadOnly.value) return [];
  const pos = connPos();
  if (!pos) return [];
  const sp = state.params.solderPad;
  const n = requiredWireCount.value;
  const stripW = sp.pitchMm * (n - 1);
  const x0 = pos[0] - stripW / 2;
  return Array.from({ length: n }, (_, i) => [x0 + sp.pitchMm * i, pos[1]]);
});

function holePositionsPx(face) {
  const s = state.params.edgeLengthMm;
  const pts = mountingHolePositions(face.polygon2D, state.params.mountingHole, s);
  return pts.map(([x, y]) => [x * s, -y * s]);
}

// Auto-derived bridge width based on trace count + design rules.
const bridgeWidthMm = computed(() => {
  const tc = bridgeTraceCount(requiredWireCount.value);
  return computeBridgeWidthMm(tc, state.params.designRules);
});

// Bridge polygons in canvas pixel space.
const bridgePolys = computed(() => {
  const s = state.params.edgeLengthMm;
  const list = bridgesForNet(
    geometry.value.net,
    state.params.panel,
    bridgeWidthMm.value,
    s,
  );
  return list.map(b => ({
    points: b.points.map(([x, y]) => `${x * s},${-y * s}`).join(' '),
    midX: b.midpoint[0] * s,
    midY: -b.midpoint[1] * s,
  }));
});

// Routed copper traces (in mm space). One polyline per signal.
const routedTraces = computed(() => {
  if (!state.params.routing?.enabled) return [];
  const plan = planRouting({
    net: geometry.value.net,
    connectorFaceIdx: state.params.connectorFaceIdx,
    led: currentLED.value,
    ledsPerFace: state.params.ledsPerFace,
    connector: currentConnector.value,
    panel: state.params.panel,
    wireCount: requiredWireCount.value,
    designRules: state.params.designRules,
    edgeLengthMm: state.params.edgeLengthMm,
  });
  return plan.traces.map(t => ({
    ...t,
    d: t.points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p[0]} ${p[1]}`).join(' '),
  }));
});

// Chain order: face index → chain position (0 = closest to connector).
const chainIndexByFace = computed(() => {
  const order = chainOrderFromConnector(geometry.value.net, state.params.connectorFaceIdx);
  const m = new Map();
  order.forEach((fi, i) => m.set(fi, i));
  return m;
});

function chainLabelFor(fi, ledIndexWithinFace = 0) {
  const lpf = state.params.ledsPerFace;
  const ci = chainIndexByFace.value.get(fi);
  if (ci == null) return '';
  return `D${ci * lpf + ledIndexWithinFace + 1}`;
}

function connPos() {
  const idx = state.params.connectorFaceIdx;
  const face = geometry.value.net.faces[idx];
  if (!face) return null;
  return centroidPx(face.polygon2D);
}
</script>

<template>
  <div ref="containerRef" class="canvas-host" :class="{ flashing }">
    <div class="refresh-toast" :class="{ visible: flashing }">refreshed</div>

    <!-- Layers pane: floating panel for toggling overlays without
         leaving the canvas. Collapsible so it doesn't eat screen space.
         The panel itself is always visible (it IS the face); only the
         supplementary overlays can be hidden. -->
    <div class="layers" :class="{ open: state.prefs.layersOpen }">
      <button class="layers-head" type="button"
              @click="state.prefs.layersOpen = !state.prefs.layersOpen">
        <span class="icon">{{ state.prefs.layersOpen ? '▾' : '▸' }}</span>
        Layers
      </button>
      <div v-if="state.prefs.layersOpen" class="layers-body">
        <label><input type="checkbox" v-model="state.prefs.showFaceGuide" /> <span>Face boundary</span></label>
        <label><input type="checkbox" v-model="state.prefs.showBridges" /> <span>Bridges</span></label>
        <label><input type="checkbox" v-model="state.prefs.showTraces" /> <span>Copper traces</span></label>
        <label><input type="checkbox" v-model="state.prefs.showFoldLines" /> <span>Fold lines</span></label>
        <label><input type="checkbox" v-model="state.prefs.showLEDs" /> <span>LED footprints</span></label>
        <label><input type="checkbox" v-model="state.prefs.showConnector" /> <span>Connector (back)</span></label>
        <label><input type="checkbox" v-model="state.prefs.showMountingHoles" /> <span>Mounting holes</span></label>
        <label><input type="checkbox" v-model="state.prefs.showFaceLabels" /> <span>Face labels</span></label>
        <label><input type="checkbox" v-model="state.prefs.showChainLabels" /> <span>Chain order (D1, D2…)</span></label>
      </div>
    </div>
    <svg :width="width" :height="height"
         :viewBox="`${viewBox.vx} ${viewBox.vy} ${viewBox.vw} ${viewBox.vh}`"
         preserveAspectRatio="xMidYMid meet">
      <!-- Bridges: flex strips connecting adjacent panels along the
           fold edges. Rendered first so they read as continuous board
           material underneath the panels. -->
      <g v-if="state.prefs.showBridges" class="bridges">
        <polygon v-for="(b, i) in bridgePolys" :key="`br-${i}`"
                 :points="b.points" />
      </g>

      <!-- Geometric face polygon — faint guide so the user can still
           see the unfolding boundary even when the panel shape is
           an inscribed circle or hexagon. Off by default for full-face
           panels (it's identical to the panel and just looks like a
           double stroke). -->
      <g v-if="state.prefs.showFaceGuide" class="face-guides">
        <template v-for="(face, fi) in geometry.net.faces" :key="`fg-${fi}`">
          <path v-if="face" :d="pathForFace(face.polygon2D)" />
        </template>
      </g>

      <!-- Panels — the actual board outline. This is what the face
           IS, both visually and for hit-testing. -->
      <g class="faces">
        <template v-for="(face, fi) in geometry.net.faces" :key="`f-${fi}`">
          <template v-if="face">
            <circle v-if="panelPathFor(face).isCircle"
                    :class="{
                      face: true,
                      hover: state.hoverFace === fi,
                      selected: state.selectedFace === fi,
                      root: state.rootFace === fi,
                    }"
                    :cx="panelPathFor(face).cx"
                    :cy="panelPathFor(face).cy"
                    :r="panelPathFor(face).r"
                    @click="onFaceClick(fi)"
                    @mouseenter="onFaceEnter(fi)"
                    @mouseleave="onFaceLeave" />
            <path v-else
                  :class="{
                    face: true,
                    hover: state.hoverFace === fi,
                    selected: state.selectedFace === fi,
                    root: state.rootFace === fi,
                  }"
                  :d="panelPathFor(face).d"
                  @click="onFaceClick(fi)"
                  @mouseenter="onFaceEnter(fi)"
                  @mouseleave="onFaceLeave" />
          </template>
        </template>
      </g>

      <!-- Fold lines -->
      <g v-if="state.prefs.showFoldLines" class="folds">
        <line v-for="(e, i) in geometry.net.foldEdges" :key="`fold-${i}`"
              :x1="e.a0[0] * state.params.edgeLengthMm"
              :y1="-e.a0[1] * state.params.edgeLengthMm"
              :x2="e.a1[0] * state.params.edgeLengthMm"
              :y2="-e.a1[1] * state.params.edgeLengthMm" />
      </g>

      <!-- LED footprints -->
      <g v-if="state.prefs.showLEDs && ledBox" class="leds">
        <template v-for="(face, fi) in geometry.net.faces" :key="`led-face-${fi}`">
          <template v-if="face">
            <rect v-for="([x, y], i) in ledPositions(face)" :key="`led-${fi}-${i}`"
                  :x="x - ledBox.w / 2" :y="y - ledBox.h / 2"
                  :width="ledBox.w" :height="ledBox.h"
                  rx="0.3" />
          </template>
        </template>
      </g>

      <!-- Routed copper traces — only meaningful when routing is on -->
      <g v-if="state.prefs.showTraces && state.params.routing.enabled" class="traces">
        <path v-for="(t, i) in routedTraces" :key="`trace-${i}`"
              :d="t.d" :stroke="t.color" fill="none"
              :stroke-width="state.params.designRules.traceWidthMm" />
      </g>

      <!-- LED chain-position labels (D1, D2, ...) — order follows the
           data chain starting from the connector face. -->
      <g v-if="state.prefs.showChainLabels && ledBox" class="chain-labels">
        <template v-for="(face, fi) in geometry.net.faces" :key="`chain-${fi}`">
          <template v-if="face">
            <text v-for="([x, y], i) in ledPositions(face)" :key="`chain-${fi}-${i}`"
                  :x="x" :y="y + ledBox.h / 2 + 2"
                  text-anchor="middle" dominant-baseline="hanging">
              {{ chainLabelFor(fi, i) }}
            </text>
          </template>
        </template>
      </g>

      <!-- Connector keepout -->
      <g v-if="state.prefs.showConnector && connBox" class="conn">
        <rect v-if="connPos()"
              :x="connPos()[0] - connBox.w / 2"
              :y="connPos()[1] - connBox.h / 2"
              :width="connBox.w" :height="connBox.h" rx="0.6" />
      </g>

      <!-- Individual solder pads (only when PAD_ONLY is selected) -->
      <g v-if="state.prefs.showConnector && isPadOnly" class="pads">
        <template v-if="state.params.solderPad.shape === 'circle'">
          <circle v-for="([x, y], i) in padPositions" :key="`pad-${i}`"
                  :cx="x" :cy="y"
                  :r="state.params.solderPad.padDiaMm / 2" />
        </template>
        <template v-else>
          <rect v-for="([x, y], i) in padPositions" :key="`pad-${i}`"
                :x="x - state.params.solderPad.padWMm / 2"
                :y="y - state.params.solderPad.padHMm / 2"
                :width="state.params.solderPad.padWMm"
                :height="state.params.solderPad.padHMm"
                rx="0.15" />
        </template>
      </g>

      <!-- Mounting holes -->
      <g v-if="state.params.mountingHole.enabled && state.prefs.showMountingHoles" class="holes">
        <template v-for="(face, fi) in geometry.net.faces" :key="`mh-${fi}`">
          <template v-if="face">
            <circle v-for="([x, y], i) in holePositionsPx(face)" :key="`mh-${fi}-${i}`"
                    :cx="x" :cy="y"
                    :r="state.params.mountingHole.diameterMm / 2" />
          </template>
        </template>
      </g>

      <!-- Face labels -->
      <g v-if="state.prefs.showFaceLabels" class="labels">
        <template v-for="(face, fi) in geometry.net.faces" :key="`lbl-${fi}`">
          <text v-if="face"
                :x="centroidPx(face.polygon2D)[0]"
                :y="centroidPx(face.polygon2D)[1]"
                text-anchor="middle" dominant-baseline="central">
            {{ fi }}
          </text>
        </template>
      </g>
    </svg>
  </div>
</template>

<style scoped>
.canvas-host { width: 100%; height: 100%; background: var(--canvas-bg); display: flex; align-items: stretch; justify-content: stretch; position: relative; box-shadow: inset 0 0 0 0 transparent; transition: box-shadow 0.32s ease; }
.canvas-host.flashing { box-shadow: inset 0 0 0 2px var(--ac2); }
.refresh-toast {
  position: absolute; top: 12px; left: 50%; transform: translateX(-50%) translateY(-8px);
  background: var(--ac2); color: #fff;
  font: 500 0.7rem 'DM Mono', monospace;
  padding: 4px 10px; border-radius: 999px;
  opacity: 0; pointer-events: none;
  transition: opacity 0.18s ease, transform 0.18s ease;
  z-index: 5;
  box-shadow: 0 2px 8px rgba(0,0,0,0.25);
}
.refresh-toast.visible { opacity: 1; transform: translateX(-50%) translateY(0); }

/* Layers panel — floats over the canvas in the top-right corner. */
.layers {
  position: absolute; top: 12px; right: 12px; z-index: 6;
  background: var(--s); border: 1px solid var(--bd); border-radius: 8px;
  box-shadow: 0 2px 12px rgba(0, 0, 0, 0.25);
  min-width: 168px;
  user-select: none;
}
.layers-head {
  display: flex; align-items: center; gap: 6px;
  width: 100%;
  background: transparent; color: var(--t);
  border: none; border-bottom: 1px solid transparent;
  padding: 7px 10px;
  font: 500 0.74rem 'DM Sans', sans-serif;
  cursor: pointer; text-align: left;
}
.layers.open .layers-head { border-bottom-color: var(--bd); }
.layers-head:hover { color: var(--ac2); }
.layers-head .icon { color: var(--sub); width: 10px; display: inline-block; }
.layers-body { display: flex; flex-direction: column; padding: 6px 8px 8px; gap: 4px; }
.layers-body label {
  display: flex; align-items: center; gap: 7px;
  padding: 4px 4px;
  font: 400 0.74rem 'DM Sans', sans-serif;
  color: var(--t);
  cursor: pointer; border-radius: 4px;
}
.layers-body label:hover { background: var(--acd); }
.layers-body input { accent-color: var(--ac2); }
@media (max-width: 700px) {
  .layers { top: 8px; right: 8px; min-width: 0; }
  .layers-head { padding: 6px 8px; }
}
svg { width: 100%; height: 100%; display: block; }
.face { fill: var(--paper); stroke: var(--paper-stroke); stroke-width: 0.6; cursor: pointer; transition: fill 0.18s ease, stroke 0.18s ease, stroke-width 0.18s ease; }
.face.hover { fill: var(--acd); }
.face.selected { stroke: var(--ac2); stroke-width: 1.2; }
.face.root { stroke: var(--ac); stroke-width: 1.4; }
/* Face guide = original unfolded polygon, shown as a faint dashed
   outline beneath the panel so you can see where the underlying
   geometry sits relative to an inset / inscribed-shape panel. */
.face-guides path { fill: none; stroke: var(--sub); stroke-width: 0.3; stroke-dasharray: 1.5 1.2; opacity: 0.55; pointer-events: none; }
/* Bridges share the panel fill so the assembled net reads as a
   single continuous flex sheet. Thin border picks up the panel
   stroke color. */
.bridges polygon { fill: var(--paper); stroke: var(--paper-stroke); stroke-width: 0.4; pointer-events: none; }
/* Routed copper traces: stroke color comes from the trace's signal,
   width is the per-trace designRules.traceWidthMm so the preview
   matches what KiCad will fabricate. */
.traces path { fill: none; stroke-linecap: round; stroke-linejoin: round; opacity: 0.85; pointer-events: none; }
.chain-labels text { font: 500 2.8px 'DM Mono', monospace; fill: var(--led); pointer-events: none; opacity: 0.9; }
.folds line { stroke: var(--fold); stroke-width: 0.5; stroke-dasharray: 2 1.5; opacity: 0.85; pointer-events: none; transition: x1 0.18s ease, y1 0.18s ease, x2 0.18s ease, y2 0.18s ease; }
.leds rect { fill: rgba(123,92,250,0.18); stroke: var(--led); stroke-width: 0.25; pointer-events: none; transition: x 0.18s ease, y 0.18s ease, width 0.18s ease, height 0.18s ease; }
/* Connector + pads live on the BACK side of the PCB — dashed stroke
   and lower opacity to read as "hidden / on the other layer". */
.conn rect { fill: rgba(63,191,127,0.10); stroke: var(--conn); stroke-width: 0.4; stroke-dasharray: 1.2 0.8; opacity: 0.75; pointer-events: none; transition: x 0.18s ease, y 0.18s ease, width 0.18s ease, height 0.18s ease; }
.pads rect, .pads circle { fill: var(--conn); stroke: var(--conn); stroke-width: 0.1; opacity: 0.55; pointer-events: none; transition: x 0.18s ease, y 0.18s ease, cx 0.18s ease, cy 0.18s ease, r 0.18s ease, width 0.18s ease, height 0.18s ease; }
.holes circle { fill: var(--canvas-bg); stroke: var(--t); stroke-width: 0.2; pointer-events: none; opacity: 0.85; transition: cx 0.18s ease, cy 0.18s ease, r 0.18s ease; }
.labels text { font: 500 4px 'DM Mono', monospace; fill: var(--sub); pointer-events: none; }
</style>
