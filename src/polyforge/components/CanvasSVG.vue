<script setup>
import { ref, computed, onMounted, onBeforeUnmount, watch } from 'vue';
import { state, geometry, currentLED, currentConnector, requiredWireCount } from '../store.js';

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
  const [cx, cy] = centroidPx(face.polygon2D);
  const n = state.params.ledsPerFace;
  if (n === 0 || !currentLED.value) return [];
  if (n === 1) return [[cx, cy]];
  const led = currentLED.value;
  const r = Math.max(led.body.w, led.body.h) * 0.9;
  return Array.from({ length: n }, (_, i) => {
    const a = (2 * Math.PI * i) / n - Math.PI / 2;
    return [cx + Math.cos(a) * r, cy + Math.sin(a) * r];
  });
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
    <svg :width="width" :height="height"
         :viewBox="`${viewBox.vx} ${viewBox.vy} ${viewBox.vw} ${viewBox.vh}`"
         preserveAspectRatio="xMidYMid meet">
      <!-- Faces -->
      <g class="faces">
        <template v-for="(face, fi) in geometry.net.faces" :key="`f-${fi}`">
          <path v-if="face"
                :d="pathForFace(face.polygon2D)"
                :class="{
                  face: true,
                  hover: state.hoverFace === fi,
                  selected: state.selectedFace === fi,
                  root: state.rootFace === fi,
                }"
                @click="onFaceClick(fi)"
                @mouseenter="onFaceEnter(fi)"
                @mouseleave="onFaceLeave" />
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
svg { width: 100%; height: 100%; display: block; }
.face { fill: var(--paper); stroke: var(--paper-stroke); stroke-width: 0.6; cursor: pointer; transition: fill 0.18s ease, stroke 0.18s ease, stroke-width 0.18s ease; }
.face.hover { fill: var(--acd); }
.face.selected { stroke: var(--ac2); stroke-width: 1.2; }
.face.root { stroke: var(--ac); stroke-width: 1.4; }
.folds line { stroke: var(--fold); stroke-width: 0.5; stroke-dasharray: 2 1.5; opacity: 0.85; pointer-events: none; transition: x1 0.18s ease, y1 0.18s ease, x2 0.18s ease, y2 0.18s ease; }
.leds rect { fill: rgba(123,92,250,0.18); stroke: var(--led); stroke-width: 0.25; pointer-events: none; transition: x 0.18s ease, y 0.18s ease, width 0.18s ease, height 0.18s ease; }
.conn rect { fill: rgba(63,191,127,0.18); stroke: var(--conn); stroke-width: 0.4; pointer-events: none; transition: x 0.18s ease, y 0.18s ease, width 0.18s ease, height 0.18s ease; }
.pads rect, .pads circle { fill: var(--conn); stroke: var(--conn); stroke-width: 0.1; pointer-events: none; transition: x 0.18s ease, y 0.18s ease, cx 0.18s ease, cy 0.18s ease, r 0.18s ease, width 0.18s ease, height 0.18s ease; }
.labels text { font: 500 4px 'DM Mono', monospace; fill: var(--sub); pointer-events: none; }
</style>
