<script setup>
import { ref, computed, onMounted, onUnmounted } from 'vue';
import {
  state, gridGeom, snapPoint, drawCrease, clearSelection, drawAngleCrease, angleCreaseEnd,
} from '../store.js';
import { closestOnSegment } from '../lib/geometry.js';
import { edgeMidpoint, faceCentroid, formatId } from '../lib/ids.js';

const SIZE = 720;
const MARGIN = 80;
const INNER = SIZE - MARGIN * 2;
const STROKE = { M: '#e23b3b', V: '#3a7bd5', B: '#111', F: '#999', U: '#777' };

const svgRef = ref(null);
const cursor = ref(null);
const drawStart = ref(null);
const angleAnchor = ref(null);

// Convert a pointer event into model-space coords [0..1] (paper space).
// The paper is inset by MARGIN inside the SVG so users can click slightly
// outside it to grab edge-adjacent vertices/lines.
function eventToModel(ev) {
  const rect = svgRef.value.getBoundingClientRect();
  const px = ((ev.clientX - rect.left) / rect.width) * SIZE;
  const py = ((ev.clientY - rect.top) / rect.height) * SIZE;
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

function onPointerMove(ev) {
  const raw = eventToModel(ev);
  cursor.value = snapPoint(raw);
}

function onPointerDown(ev) {
  if (ev.button !== 0) return;
  const p = snapPoint(eventToModel(ev));
  if (state.tool === 'draw') {
    if (!drawStart.value) drawStart.value = p;
    else {
      drawCrease(drawStart.value, p);
      drawStart.value = null;
    }
  } else if (state.tool === 'select' || state.tool === 'mirror') {
    const idx = pickEdgeIndex(p);
    if (idx >= 0) {
      // Mirror tool always toggles (no shift required) so the user can build
      // a multi-edge selection on touch devices where shift isn't available.
      const additive = ev.shiftKey || state.tool === 'mirror';
      if (additive) {
        if (state.selection.edges.has(idx)) state.selection.edges.delete(idx);
        else state.selection.edges.add(idx);
      } else {
        clearSelection();
        state.selection.edges.add(idx);
      }
    } else if (!ev.shiftKey && state.tool === 'select') clearSelection();
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
         @pointerleave="cursor = null">

      <!-- Workspace background -->
      <rect x="0" y="0" :width="SIZE" :height="SIZE" fill="#1a1a24" />
      <!-- Paper -->
      <rect :x="MARGIN" :y="MARGIN" :width="INNER" :height="INNER" fill="#fff" stroke="#ddd" />

      <!-- Grid -->
      <g v-if="state.grid.visible" class="grid">
        <line v-for="(ln, i) in gridGeom.lines" :key="i"
              :x1="xToPx(ln[0][0])" :y1="yToPx(ln[0][1])"
              :x2="xToPx(ln[1][0])" :y2="yToPx(ln[1][1])"
              stroke="#eef0f5" stroke-width="0.6" />
        <circle v-for="(n, i) in gridGeom.nodes" :key="'n'+i"
                :cx="xToPx(n[0])" :cy="yToPx(n[1])" r="1.2" fill="#dfe3ee" />
      </g>

      <!-- Faces (subtle fill if computed) -->
      <g class="faces">
        <polygon v-for="(f, i) in state.model.faces" :key="i"
                 :points="f.map(vi => `${xToPx(state.model.vertices[vi][0])},${yToPx(state.model.vertices[vi][1])}`).join(' ')"
                 fill="rgba(123,92,250,0.04)" stroke="none" />
      </g>

      <!-- Edges -->
      <g class="edges">
        <line v-for="(e, i) in state.model.edges" :key="i"
              :x1="xToPx(state.model.vertices[e.v1][0])"
              :y1="yToPx(state.model.vertices[e.v1][1])"
              :x2="xToPx(state.model.vertices[e.v2][0])"
              :y2="yToPx(state.model.vertices[e.v2][1])"
              :stroke="STROKE[e.assignment] || '#333'"
              :stroke-width="state.selection.edges.has(i) ? 3.5 : 1.8"
              :stroke-dasharray="e.assignment === 'F' ? '5 4' : null"
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
                :cx="xToPx(v[0])" :cy="yToPx(v[1])" r="2.5"
                :fill="state.selection.vertices.has(i) ? '#ff6b35' : '#222'" />
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

      <!-- Validation issue markers -->
      <g class="issues">
        <circle v-for="(iss, i) in state.validation.issues" :key="i"
                :cx="xToPx(state.model.vertices[iss.vertex][0])"
                :cy="yToPx(state.model.vertices[iss.vertex][1])"
                r="7" fill="none" stroke="#e23b3b" stroke-width="1.5" />
      </g>

      <!-- Labels -->
      <g v-if="state.labels.vertices" class="labels">
        <text v-for="(v, i) in state.model.vertices" :key="i"
              :x="xToPx(v[0]) + 5" :y="yToPx(v[1]) - 5"
              font-size="10" fill="#7b5cfa" font-family="DM Mono, monospace">
          {{ formatId('v', i, state.labels.oneBased) }}
        </text>
      </g>
      <g v-if="state.labels.edges" class="labels">
        <text v-for="(e, i) in state.model.edges" :key="i"
              :x="xToPx(edgeMidpoint(state.model, e)[0])"
              :y="yToPx(edgeMidpoint(state.model, e)[1])"
              font-size="9" fill="#0a8a4a" font-family="DM Mono, monospace"
              text-anchor="middle">
          {{ formatId('e', i, state.labels.oneBased) }}
        </text>
      </g>
      <g v-if="state.labels.faces" class="labels">
        <text v-for="(f, i) in state.model.faces" :key="i"
              :x="xToPx(faceCentroid(state.model, f)[0])"
              :y="yToPx(faceCentroid(state.model, f)[1])"
              font-size="11" fill="#ff6b35" font-family="DM Mono, monospace"
              text-anchor="middle" font-weight="600">
          {{ formatId('f', i, state.labels.oneBased) }}
        </text>
      </g>
    </svg>
  </div>
</template>

<style scoped>
.canvas-wrap { display: flex; align-items: center; justify-content: center; padding: 12px; flex: 1; min-width: 0; min-height: 0; overflow: hidden; }
.surface { width: auto; height: auto; max-width: 100%; max-height: 100%; aspect-ratio: 1 / 1; background: var(--bg); cursor: crosshair; display: block; }
</style>
