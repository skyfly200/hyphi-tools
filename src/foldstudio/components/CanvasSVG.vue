<script setup>
import { ref, computed, onMounted, onUnmounted } from 'vue';
import {
  state, gridGeom, snapPoint, drawCrease, clearSelection, drawAngleCrease, angleCreaseEnd,
} from '../store.js';
import { closestOnSegment } from '../lib/geometry.js';
import { edgeMidpoint, faceCentroid, formatId } from '../lib/ids.js';
import { EDGE_COLOR as STROKE, EDGE_DASH } from '../../lib/foldPalette.js';

const SIZE = 720;
const MARGIN = 80;
const INNER = SIZE - MARGIN * 2;

const svgRef = ref(null);
const cursor = ref(null);
const drawStart = ref(null);
const angleAnchor = ref(null);
// Rubber-band box select state (Select tool only). Stored in model space.
const boxSel = ref(null); // { start: [x,y], end: [x,y], additive: bool }

// View transform applied to the contents <g>: translate(tx ty) scale(s).
// All viewBox-space; model coords run through the same xToPx mapping below
// and then through this transform. eventToModel inverses both.
const view = ref({ s: 1, tx: 0, ty: 0 });
function clampScale(s) { return Math.max(0.4, Math.min(8, s)); }

// Convert a pointer event to viewBox px (independent of scale).
function eventToViewbox(ev) {
  const rect = svgRef.value.getBoundingClientRect();
  return {
    x: ((ev.clientX - rect.left) / rect.width) * SIZE,
    y: ((ev.clientY - rect.top) / rect.height) * SIZE,
  };
}

// Convert a pointer event to model-space coords, accounting for the view
// transform so picking still hits where the user expects after zoom/pan.
function eventToModel(ev) {
  const v = eventToViewbox(ev);
  const px = (v.x - view.value.tx) / view.value.s;
  const py = (v.y - view.value.ty) / view.value.s;
  return [(px - MARGIN) / INNER, 1 - (py - MARGIN) / INNER];
}

function pickEdgeIndex(p) {
  const m = state.model;
  let best = -1, bd = 0.01;
  for (let i = 0; i < m.edges.length; i++) {
    const e = m.edges[i];
    const A = m.vertices[e.v1], B = m.vertices[e.v2];
    const { point } = closestOnSegment(p, A, B);
    const d = Math.hypot(point[0] - p[0], point[1] - p[1]);
    if (d < bd) { bd = d; best = i; }
  }
  return best;
}

function pickVertexIndex(p) {
  const m = state.model;
  let best = -1, bd = 0.025;
  for (let i = 0; i < m.vertices.length; i++) {
    const v = m.vertices[i];
    const d = Math.hypot(v[0] - p[0], v[1] - p[1]);
    if (d < bd) { bd = d; best = i; }
  }
  return best;
}

// Multi-pointer state for pinch-zoom + two-finger pan.
const activePointers = new Map();
let gestureStart = null; // { dist, midV, view: {s,tx,ty} }

function recordPointer(ev) {
  activePointers.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
}
function releasePointer(ev) {
  activePointers.delete(ev.pointerId);
  if (activePointers.size < 2) gestureStart = null;
}
function pointerCentroidViewbox() {
  const rect = svgRef.value.getBoundingClientRect();
  let sx = 0, sy = 0, n = 0;
  for (const p of activePointers.values()) { sx += p.x; sy += p.y; n++; }
  if (!n) return { x: 0, y: 0 };
  return {
    x: ((sx / n - rect.left) / rect.width) * SIZE,
    y: ((sy / n - rect.top) / rect.height) * SIZE,
  };
}
function pointerSpread() {
  if (activePointers.size < 2) return 0;
  const pts = [...activePointers.values()];
  let sx = 0, sy = 0;
  for (const p of pts) { sx += p.x; sy += p.y; }
  const cx = sx / pts.length, cy = sy / pts.length;
  let s = 0;
  for (const p of pts) s += Math.hypot(p.x - cx, p.y - cy);
  return s / pts.length;
}

function onPointerMove(ev) {
  if (activePointers.has(ev.pointerId)) {
    activePointers.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
  }
  if (activePointers.size >= 2) {
    if (!gestureStart) {
      gestureStart = {
        dist: pointerSpread() || 1,
        midV: pointerCentroidViewbox(),
        view: { ...view.value },
      };
    } else {
      const k = (pointerSpread() || gestureStart.dist) / gestureStart.dist;
      const newS = clampScale(gestureStart.view.s * k);
      const midV = pointerCentroidViewbox();
      // Anchor the pinch center: keep the model point under midV stationary.
      const newTx = midV.x - (gestureStart.midV.x - gestureStart.view.tx) * (newS / gestureStart.view.s);
      const newTy = midV.y - (gestureStart.midV.y - gestureStart.view.ty) * (newS / gestureStart.view.s);
      view.value = { s: newS, tx: newTx, ty: newTy };
    }
    cursor.value = null;
    return;
  }
  const raw = eventToModel(ev);
  if (boxSel.value) {
    boxSel.value = { ...boxSel.value, end: raw };
    cursor.value = null;
    return;
  }
  cursor.value = snapPoint(raw);
}

function cancelBoxSelect() { boxSel.value = null; }

function finishBoxSelect() {
  const b = boxSel.value;
  boxSel.value = null;
  if (!b) return;
  const minX = Math.min(b.start[0], b.end[0]);
  const maxX = Math.max(b.start[0], b.end[0]);
  const minY = Math.min(b.start[1], b.end[1]);
  const maxY = Math.max(b.start[1], b.end[1]);
  // Tiny box = a stray click; treat as deselect.
  if (Math.abs(maxX - minX) < 0.01 && Math.abs(maxY - minY) < 0.01) {
    if (!b.additive) clearSelection();
    return;
  }
  if (!b.additive) clearSelection();
  const mode = state.selectMode;
  if (mode !== 'edges') {
    state.model.vertices.forEach((v, i) => {
      if (v[0] >= minX && v[0] <= maxX && v[1] >= minY && v[1] <= maxY) {
        state.selection.vertices.add(i);
      }
    });
  }
  if (mode !== 'vertices') {
    state.model.edges.forEach((e, i) => {
      const a = state.model.vertices[e.v1], q = state.model.vertices[e.v2];
      // Edge selected if either endpoint sits inside the box.
      const aIn = a[0] >= minX && a[0] <= maxX && a[1] >= minY && a[1] <= maxY;
      const qIn = q[0] >= minX && q[0] <= maxX && q[1] >= minY && q[1] <= maxY;
      if (aIn && qIn) state.selection.edges.add(i);
    });
  }
}

function onWheel(ev) {
  if (activePointers.size > 0) return;
  ev.preventDefault();
  const k = Math.exp(-ev.deltaY * 0.0015);
  const newS = clampScale(view.value.s * k);
  const v = eventToViewbox(ev);
  const ratio = newS / view.value.s;
  const newTx = v.x - (v.x - view.value.tx) * ratio;
  const newTy = v.y - (v.y - view.value.ty) * ratio;
  view.value = { s: newS, tx: newTx, ty: newTy };
}

function resetView() {
  view.value = { s: 1, tx: 0, ty: 0 };
}

function onPointerDown(ev) {
  recordPointer(ev);
  if (ev.button !== 0) return;
  // Block draw/select while a 2-finger gesture is in progress.
  if (activePointers.size >= 2) { drawStart.value = null; angleAnchor.value = null; return; }
  const p = snapPoint(eventToModel(ev));
  if (state.tool === 'draw') {
    if (!drawStart.value) drawStart.value = p;
    else {
      drawCrease(drawStart.value, p);
      drawStart.value = null;
    }
  } else if (state.tool === 'select' || state.tool === 'mirror') {
    // Mirror is always edge-only (axis must be an edge). Select honors the
    // user's selectMode: 'edges' / 'vertices' / 'both' (vertex priority).
    const mode = state.tool === 'mirror' ? 'edges' : state.selectMode;
    const wantV = mode !== 'edges';
    const wantE = mode !== 'vertices';
    const vIdx = wantV ? pickVertexIndex(p) : -1;
    const eIdx = (wantE && vIdx < 0) ? pickEdgeIndex(p) : -1;
    const additive = ev.shiftKey || state.multiSelect || state.tool === 'mirror';
    if (vIdx >= 0) {
      if (additive) {
        if (state.selection.vertices.has(vIdx)) state.selection.vertices.delete(vIdx);
        else state.selection.vertices.add(vIdx);
      } else {
        clearSelection();
        state.selection.vertices.add(vIdx);
      }
    } else if (eIdx >= 0) {
      if (additive) {
        if (state.selection.edges.has(eIdx)) state.selection.edges.delete(eIdx);
        else state.selection.edges.add(eIdx);
      } else {
        clearSelection();
        state.selection.edges.add(eIdx);
      }
    } else if (state.tool === 'select') {
      // Empty space: start a rubber-band box select.
      boxSel.value = { start: p, end: p, additive };
    }
  } else if (state.tool === 'angle') {
    if (!angleAnchor.value) angleAnchor.value = p;
    else {
      drawAngleCrease({
        anchor: angleAnchor.value,
        angle: +state.toolOptions.angle.angle,
        length: +state.toolOptions.angle.length,
        mode: state.toolOptions.angle.mode,
      });
      angleAnchor.value = null;
    }
  }
}

function onKey(ev) {
  if (ev.key === 'Escape') {
    drawStart.value = null;
    angleAnchor.value = null;
    clearSelection();
  }
}

onMounted(() => window.addEventListener('keydown', onKey));
onUnmounted(() => window.removeEventListener('keydown', onKey));

const xToPx = x => MARGIN + x * INNER;
const yToPx = y => MARGIN + (1 - y) * INNER;

// Label visibility lists. Hover-only restricts to the nearest item under
// the current pointer-snap target; otherwise every item of the chosen type
// gets labelled.
const visibleVertexLabels = computed(() => {
  const m = state.model;
  if (!state.labels.hoverOnly) return m.vertices.map((_, i) => i);
  const p = cursor.value;
  if (!p) return [];
  let best = -1, bd = 0.04;
  for (let i = 0; i < m.vertices.length; i++) {
    const v = m.vertices[i];
    const d = Math.hypot(v[0] - p[0], v[1] - p[1]);
    if (d < bd) { bd = d; best = i; }
  }
  return best >= 0 ? [best] : [];
});
const visibleEdgeLabels = computed(() => {
  const m = state.model;
  if (!state.labels.hoverOnly) return m.edges.map((_, i) => i);
  const p = cursor.value;
  if (!p) return [];
  let best = -1, bd = 0.04;
  for (let i = 0; i < m.edges.length; i++) {
    const e = m.edges[i];
    const A = m.vertices[e.v1], B = m.vertices[e.v2];
    const { point } = closestOnSegment(p, A, B);
    const d = Math.hypot(point[0] - p[0], point[1] - p[1]);
    if (d < bd) { bd = d; best = i; }
  }
  return best >= 0 ? [best] : [];
});
const visibleFaceLabels = computed(() => {
  const m = state.model;
  if (!state.labels.hoverOnly) return m.faces.map((_, i) => i);
  const p = cursor.value;
  if (!p) return [];
  let best = -1, bd = 0.05;
  for (let i = 0; i < m.faces.length; i++) {
    const c = faceCentroid(m, m.faces[i]);
    const d = Math.hypot(c[0] - p[0], c[1] - p[1]);
    if (d < bd) { bd = d; best = i; }
  }
  return best >= 0 ? [best] : [];
});

// First selected edge index (insertion order via Set iteration). Used as
// the visual "axis" indicator when Mirror tool is set to axis = 'edge'.
const axisEdgeIdx = computed(() => {
  if (state.tool !== 'mirror') return -1;
  if (state.toolOptions.mirror.axis !== 'edge') return -1;
  if (!state.selection.edges.size) return -1;
  return state.selection.edges.values().next().value;
});

const ghostLine = computed(() => {
  if (state.tool === 'draw' && drawStart.value && cursor.value) {
    return { a: drawStart.value, b: cursor.value };
  }
  if (state.tool === 'angle' && angleAnchor.value) {
    const { end } = angleCreaseEnd({
      anchor: angleAnchor.value,
      angle: +state.toolOptions.angle.angle,
      length: +state.toolOptions.angle.length,
      mode: state.toolOptions.angle.mode,
    });
    return { a: angleAnchor.value, b: end };
  }
  return null;
});
</script>

<template>
  <div class="canvas-wrap">
    <svg ref="svgRef"
         :viewBox="`0 0 ${SIZE} ${SIZE}`"
         class="surface"
         @pointermove="onPointerMove"
         @pointerdown="onPointerDown"
         @pointerup="(ev) => { finishBoxSelect(); releasePointer(ev); }"
         @pointercancel="(ev) => { cancelBoxSelect(); releasePointer(ev); }"
         @pointerleave="(ev) => { releasePointer(ev); cursor = null }"
         @wheel.prevent="onWheel"
         style="touch-action: none">

      <!-- Workspace background fills the visible SVG regardless of zoom. -->
      <rect x="0" y="0" :width="SIZE" :height="SIZE" fill="var(--canvas-bg)" />

      <!-- Everything else lives inside this <g>; pinch / wheel zoom + pan
           operates on this transform. -->
      <g :transform="`translate(${view.tx} ${view.ty}) scale(${view.s})`">
      <!-- Paper -->
      <rect :x="MARGIN" :y="MARGIN" :width="INNER" :height="INNER" fill="var(--paper)" stroke="var(--paper-stroke)" />

      <!-- Grid -->
      <g v-if="state.grid.visible" class="grid">
        <line v-for="(ln, i) in gridGeom.lines" :key="i"
              :x1="xToPx(ln[0][0])" :y1="yToPx(ln[0][1])"
              :x2="xToPx(ln[1][0])" :y2="yToPx(ln[1][1])"
              stroke="var(--grid-line)" stroke-width="0.6" opacity="0.45" />
        <circle v-for="(n, i) in gridGeom.nodes" :key="'n'+i"
                :cx="xToPx(n[0])" :cy="yToPx(n[1])" r="1.2" fill="var(--grid-node)" />
      </g>

      <!-- Faces (subtle fill if computed) -->
      <g class="faces">
        <polygon v-for="(f, i) in state.model.faces" :key="i"
                 :points="f.map(vi => `${xToPx(state.model.vertices[vi][0])},${yToPx(state.model.vertices[vi][1])}`).join(' ')"
                 fill="rgba(123,92,250,0.04)" stroke="none" />
      </g>

      <!-- Selection halo: drawn behind the edge strokes in a single bright
           color so the selection state reads the same regardless of the
           edge's own (sometimes faint) M/V/B/F/U color. -->
      <g class="sel-halo">
        <line v-for="i in [...state.selection.edges]" :key="i"
              :x1="xToPx(state.model.vertices[state.model.edges[i].v1][0])"
              :y1="yToPx(state.model.vertices[state.model.edges[i].v1][1])"
              :x2="xToPx(state.model.vertices[state.model.edges[i].v2][0])"
              :y2="yToPx(state.model.vertices[state.model.edges[i].v2][1])"
              stroke="#ff6b35" stroke-width="6" stroke-linecap="round"
              opacity="0.45" />
      </g>

      <!-- Edges -->
      <g class="edges">
        <line v-for="(e, i) in state.model.edges" :key="i"
              :x1="xToPx(state.model.vertices[e.v1][0])"
              :y1="yToPx(state.model.vertices[e.v1][1])"
              :x2="xToPx(state.model.vertices[e.v2][0])"
              :y2="yToPx(state.model.vertices[e.v2][1])"
              :stroke="STROKE[e.assignment] || '#333'"
              :stroke-width="1.8"
              :stroke-dasharray="EDGE_DASH[e.assignment] || null"
              stroke-linecap="round" />
      </g>

      <!-- Axis-edge marker for Mirror tool with axis = 'edge' -->
      <g v-if="axisEdgeIdx >= 0">
        <line :x1="xToPx(state.model.vertices[state.model.edges[axisEdgeIdx].v1][0])"
              :y1="yToPx(state.model.vertices[state.model.edges[axisEdgeIdx].v1][1])"
              :x2="xToPx(state.model.vertices[state.model.edges[axisEdgeIdx].v2][0])"
              :y2="yToPx(state.model.vertices[state.model.edges[axisEdgeIdx].v2][1])"
              stroke="#ff6b35" stroke-width="6" stroke-dasharray="6 3"
              opacity="0.55" stroke-linecap="round" />
      </g>

      <!-- Vertices -->
      <g class="vertices">
        <circle v-for="(v, i) in state.model.vertices" :key="i"
                :cx="xToPx(v[0])" :cy="yToPx(v[1])"
                :r="state.selection.vertices.has(i) ? 5 : 2.5"
                :fill="state.selection.vertices.has(i) ? '#ff6b35' : 'var(--vertex, #222)'"
                :stroke="state.selection.vertices.has(i) ? '#ff6b35' : 'none'"
                stroke-width="1.5" />
      </g>

      <!-- Ghost / preview line -->
      <line v-if="ghostLine"
            :x1="xToPx(ghostLine.a[0])" :y1="yToPx(ghostLine.a[1])"
            :x2="xToPx(ghostLine.b[0])" :y2="yToPx(ghostLine.b[1])"
            :stroke="STROKE[state.assignment]" stroke-width="1.5"
            stroke-dasharray="4 4" opacity="0.7" />

      <!-- Cursor snap indicator -->
      <circle v-if="cursor" :cx="xToPx(cursor[0])" :cy="yToPx(cursor[1])"
              r="5" fill="none" stroke="#ff6b35" stroke-width="1.2" />

      <!-- Rubber-band box select -->
      <rect v-if="boxSel"
            :x="xToPx(Math.min(boxSel.start[0], boxSel.end[0]))"
            :y="yToPx(Math.max(boxSel.start[1], boxSel.end[1]))"
            :width="Math.abs(boxSel.end[0] - boxSel.start[0]) * INNER"
            :height="Math.abs(boxSel.end[1] - boxSel.start[1]) * INNER"
            fill="rgba(123,92,250,0.10)" stroke="#7b5cfa"
            stroke-width="1.2" stroke-dasharray="4 3" />

      <!-- Validation issue markers -->
      <g class="issues">
        <circle v-for="(iss, i) in state.validation.issues" :key="i"
                :cx="xToPx(state.model.vertices[iss.vertex][0])"
                :cy="yToPx(state.model.vertices[iss.vertex][1])"
                r="7" fill="none" stroke="#e23b3b" stroke-width="1.5" />
      </g>

      <!-- Labels -->
      <g v-if="state.labels.type === 'vertices'" class="labels">
        <text v-for="i in visibleVertexLabels" :key="i"
              :x="xToPx(state.model.vertices[i][0]) + 5"
              :y="yToPx(state.model.vertices[i][1]) - 5"
              font-size="10" fill="#7b5cfa" font-family="DM Mono, monospace">
          {{ formatId('v', i, state.labels.oneBased) }}
        </text>
      </g>
      <g v-if="state.labels.type === 'edges'" class="labels">
        <text v-for="i in visibleEdgeLabels" :key="i"
              :x="xToPx(edgeMidpoint(state.model, state.model.edges[i])[0])"
              :y="yToPx(edgeMidpoint(state.model, state.model.edges[i])[1])"
              font-size="9" fill="#0a8a4a" font-family="DM Mono, monospace"
              text-anchor="middle">
          {{ formatId('e', i, state.labels.oneBased) }}
        </text>
      </g>
      <g v-if="state.labels.type === 'faces'" class="labels">
        <text v-for="i in visibleFaceLabels" :key="i"
              :x="xToPx(faceCentroid(state.model, state.model.faces[i])[0])"
              :y="yToPx(faceCentroid(state.model, state.model.faces[i])[1])"
              font-size="11" fill="#ff6b35" font-family="DM Mono, monospace"
              text-anchor="middle" font-weight="600">
          {{ formatId('f', i, state.labels.oneBased) }}
        </text>
      </g>
      </g><!-- /transformed content -->
    </svg>
    <button v-if="view.s !== 1 || view.tx !== 0 || view.ty !== 0"
            class="reset-view" @click="resetView"
            title="Reset zoom + pan">⤢ 1:1</button>
  </div>
</template>

<style scoped>
.canvas-wrap { display: flex; align-items: center; justify-content: center; padding: 12px; flex: 1; min-width: 0; min-height: 0; overflow: hidden; position: relative; }
.surface { width: auto; height: auto; max-width: 100%; max-height: 100%; aspect-ratio: 1 / 1; background: var(--bg); cursor: crosshair; display: block; }
.reset-view { position: absolute; right: 16px; bottom: 16px; background: rgba(20,20,30,0.85); color: #fff; border: 1px solid var(--bd); border-radius: 6px; padding: 5px 8px; font: 500 0.7rem 'DM Mono', monospace; cursor: pointer; }
.reset-view:hover { border-color: var(--ac2); }
</style>
