<script setup>
// Folded visualization: animates the unfolded net folding back up
// into the polyhedron. Pure SVG — orthographic projection with
// painter's-algorithm depth sort, which is exact for convex solids.
//
// Mechanics: the unfolder's foldEdges form a spanning tree rooted at
// the root face (faceA is always the earlier-placed parent). Folding
// rotates each subtree rigidly about its shared-edge axis by
// t × (π − dihedral). Composing rotations up the tree gives every
// face's world transform; t=0 is the flat net, t=1 the assembled
// solid.

import { ref, computed, onMounted, onBeforeUnmount } from 'vue';
import { state, geometry, currentLED } from '../store.js';
import {
  centroid2D, panelOutline, ledPositions,
  bridgesForNet, offsetPolyline, bridgeTraceCount, computeBridgeWidthMm,
} from '../lib/layout.js';

const containerRef = ref(null);
const width = ref(800);
const height = ref(600);
const foldT = ref(1);      // 0 = flat, 1 = fully folded
const yaw = ref(-0.5);
const pitch = ref(-0.9);

function measure() {
  if (!containerRef.value) return;
  const r = containerRef.value.getBoundingClientRect();
  width.value = Math.max(200, r.width);
  height.value = Math.max(200, r.height);
}
let ro = null;
onMounted(() => { measure(); ro = new ResizeObserver(measure); ro.observe(containerRef.value); });
onBeforeUnmount(() => { if (ro) ro.disconnect(); });

// ── drag to rotate ──────────────────────────────────────────────
let dragging = false, lastX = 0, lastY = 0;
function onPointerDown(e) { dragging = true; lastX = e.clientX; lastY = e.clientY; e.target.setPointerCapture?.(e.pointerId); }
function onPointerMove(e) {
  if (!dragging) return;
  yaw.value   += (e.clientX - lastX) * 0.008;
  pitch.value += (e.clientY - lastY) * 0.008;
  pitch.value = Math.max(-Math.PI, Math.min(Math.PI, pitch.value));
  lastX = e.clientX; lastY = e.clientY;
}
function onPointerUp() { dragging = false; }

// ── fold math ───────────────────────────────────────────────────

// Rotate point p (3D) about the axis through `a` with unit direction
// `u` by angle θ (Rodrigues).
function rotAboutAxis(p, a, u, cosT, sinT) {
  const px = p[0]-a[0], py = p[1]-a[1], pz = p[2]-a[2];
  const dot = px*u[0] + py*u[1] + pz*u[2];
  const cx = u[1]*pz - u[2]*py;
  const cy = u[2]*px - u[0]*pz;
  const cz = u[0]*py - u[1]*px;
  return [
    a[0] + px*cosT + cx*sinT + u[0]*dot*(1-cosT),
    a[1] + py*cosT + cy*sinT + u[1]*dot*(1-cosT),
    a[2] + pz*cosT + cz*sinT + u[2]*dot*(1-cosT),
  ];
}

// Per-face chain of fold rotations (child-edge first, root-most last),
// derived once per geometry.
const foldTree = computed(() => {
  const net = geometry.value.net;
  const parentEdge = new Map(); // child face → fold edge
  for (const e of net.foldEdges) parentEdge.set(e.faceB, e);
  const chains = new Map();
  function chainFor(fi) {
    if (chains.has(fi)) return chains.get(fi);
    const e = parentEdge.get(fi);
    const chain = e ? [...chainFor(e.faceA), e] : [];
    chains.set(fi, chain);
    return chain;
  }
  for (let fi = 0; fi < net.faces.length; fi++) if (net.faces[fi]) chainFor(fi);
  return { parentEdge, chains };
});

// Determine the fold-direction sign once per geometry: try both signs
// at t=1 and keep whichever brings duplicated vertices together.
const foldSign = computed(() => {
  const err = (sign) => foldError(1, sign);
  return err(+1) <= err(-1) ? +1 : -1;
});

function foldError(t, sign) {
  const net = geometry.value.net;
  // Same original 3D vertex appears on multiple unfolded faces; when
  // fully folded those copies must coincide.
  const byVert = new Map();
  for (let fi = 0; fi < net.faces.length; fi++) {
    const face = net.faces[fi];
    if (!face) continue;
    face.polygon2D.forEach((p, i) => {
      const w = transformPoint([p[0], p[1], 0], fi, t, sign);
      const vid = face.vertIdx[i];
      if (!byVert.has(vid)) byVert.set(vid, []);
      byVert.get(vid).push(w);
    });
  }
  let err = 0;
  for (const pts of byVert.values()) {
    for (let i = 1; i < pts.length; i++) {
      err += Math.hypot(pts[i][0]-pts[0][0], pts[i][1]-pts[0][1], pts[i][2]-pts[0][2]);
    }
  }
  return err;
}

// Apply face fi's fold chain to a flat-net 3D point.
function transformPoint(p, fi, t, sign) {
  const { chains } = foldTree.value;
  const chain = chains.get(fi) || [];
  const theta = sign * t * (Math.PI - geometry.value.poly.dihedralDeg * Math.PI / 180);
  const cosT = Math.cos(theta), sinT = Math.sin(theta);
  let q = p;
  // Child-most rotation applies last in the chain array; walk from the
  // end (own edge) toward the root so subtrees move rigidly.
  for (let i = chain.length - 1; i >= 0; i--) {
    const e = chain[i];
    const a = [e.a0[0], e.a0[1], 0];
    const d = [e.a1[0]-e.a0[0], e.a1[1]-e.a0[1], 0];
    const l = Math.hypot(d[0], d[1]) || 1;
    q = rotAboutAxis(q, a, [d[0]/l, d[1]/l, 0], cosT, sinT);
  }
  return q;
}

// Panel outline per face as a flat point list (tessellating circles).
function panelPoints(face) {
  const s = state.params.edgeLengthMm;
  const shape = panelOutline(face.polygon2D, state.params.panel, s);
  if (shape.kind === 'circle') {
    return Array.from({ length: 28 }, (_, i) => {
      const a = (2 * Math.PI * i) / 28;
      return [shape.cx + Math.cos(a) * shape.r, shape.cy + Math.sin(a) * shape.r];
    });
  }
  return shape.points;
}

// Bridge half-strips: each bridge crosses the fold edge between two
// panels, so it can't ride a single face transform. We split the
// bridge centerline at the crease line, then attach each half to its
// own face. Because the centroid→centroid centerline is perpendicular
// to the shared edge (regular polygons, mirror-symmetric across the
// edge), the two halves meet cleanly on the crease as it folds.
const bridgeHalves = computed(() => {
  if (!state.prefs.showBridges) return [];
  const net = geometry.value.net;
  const s = state.params.edgeLengthMm;
  const w = computeBridgeWidthMm(bridgeTraceCount(currentLED.value?.wireCount || 3), state.params.designRules);
  const bridges = bridgesForNet(net, state.params.panel, w, s);
  const foldByPair = new Map();
  for (const e of net.foldEdges) foldByPair.set(`${e.faceA}-${e.faceB}`, e);

  const halves = [];
  for (const b of bridges) {
    const e = foldByPair.get(`${b.faceA}-${b.faceB}`);
    if (!e) continue;
    const split = splitAtFold(b.centerline, e.a0, e.a1);
    const half = b.width / 2;
    if (split.A.length >= 2) {
      const strip = [...offsetPolyline(split.A, half), ...offsetPolyline(split.A, -half).reverse()];
      halves.push({ face: b.faceA, pts: strip });
    }
    if (split.B.length >= 2) {
      const strip = [...offsetPolyline(split.B, half), ...offsetPolyline(split.B, -half).reverse()];
      halves.push({ face: b.faceB, pts: strip });
    }
  }
  return halves;
});

// Split a centerline polyline at the (infinite) fold-edge line through
// a0→a1. Returns { A, B } where A is the portion on the start side
// (face A's centroid) and B the far side, sharing the exact crossing
// point so the two folded halves stay joined at the crease.
function splitAtFold(center, a0, a1) {
  const dx = a1[0] - a0[0], dy = a1[1] - a0[1];
  const sd = (p) => dx * (p[1] - a0[1]) - dy * (p[0] - a0[0]);
  const A = [], B = [];
  let crossed = false;
  for (let i = 0; i < center.length; i++) {
    const p = center[i];
    if (!crossed) {
      A.push(p);
      if (i < center.length - 1) {
        const s0 = sd(p), s1 = sd(center[i + 1]);
        if ((s0 <= 0) !== (s1 <= 0) && s0 !== s1) {
          const t = s0 / (s0 - s1);
          const cp = [p[0] + (center[i + 1][0] - p[0]) * t, p[1] + (center[i + 1][1] - p[1]) * t];
          A.push(cp); B.push(cp);
          crossed = true;
        }
      }
    } else {
      B.push(p);
    }
  }
  if (!crossed) return { A: center, B: [] };
  return { A, B };
}

// ── projection ──────────────────────────────────────────────────
const scene = computed(() => {
  const net = geometry.value.net;
  const t = foldT.value;
  const sign = foldSign.value;
  const cy = Math.cos(yaw.value), sy = Math.sin(yaw.value);
  const cp = Math.cos(pitch.value), sp = Math.sin(pitch.value);

  function view(p) {
    // yaw about Y (screen-x axis rotation of the model), pitch about X
    const x1 = p[0]*cy + p[2]*sy;
    const z1 = -p[0]*sy + p[2]*cy;
    const y2 = p[1]*cp - z1*sp;
    const z2 = p[1]*sp + z1*cp;
    return [x1, y2, z2];
  }

  const polys = [];
  let ledDots = [];

  // Bridges first into the shared poly list so they depth-sort against
  // the panels. Each half rides its own face's fold transform.
  for (const h of bridgeHalves.value) {
    const world = h.pts.map(p => view(transformPoint([p[0], p[1], 0], h.face, t, sign)));
    const zMean = world.reduce((a, p) => a + p[2], 0) / world.length;
    polys.push({
      fi: `bridge-${h.face}`,
      kind: 'bridge',
      zMean,
      pts: world.map(p => `${p[0].toFixed(4)},${(-p[1]).toFixed(4)}`).join(' '),
    });
  }

  for (let fi = 0; fi < net.faces.length; fi++) {
    const face = net.faces[fi];
    if (!face) continue;
    const world = panelPoints(face).map(p => view(transformPoint([p[0], p[1], 0], fi, t, sign)));
    const zMean = world.reduce((a, p) => a + p[2], 0) / world.length;
    polys.push({
      fi,
      kind: 'panel',
      zMean,
      pts: world.map(p => `${p[0].toFixed(4)},${(-p[1]).toFixed(4)}`).join(' '),
    });
    if (state.prefs.showLEDs) {
      const lp = ledPositions(face.polygon2D, currentLED.value, state.params.ledsPerFace, state.params.edgeLengthMm);
      for (const p of lp) {
        const w = view(transformPoint([p[0], p[1], 0], fi, t, sign));
        ledDots.push({ x: w[0], y: -w[1], z: w[2], fi });
      }
    }
  }
  polys.sort((a, b) => a.zMean - b.zMean); // back to front
  ledDots.sort((a, b) => a.z - b.z);
  return { polys, ledDots };
});

const viewBox = computed(() => {
  // The net's flat bbox is the worst case extent; the folded solid is
  // strictly smaller, so one static box avoids zoom jumps mid-fold.
  const b = geometry.value.net.bbox;
  const ext = Math.max(b.width, b.height) * 1.15 + 0.4;
  return `${-ext / 2} ${-ext / 2} ${ext} ${ext}`;
});

const ledR = computed(() => {
  const l = currentLED.value;
  const s = state.params.edgeLengthMm;
  return l ? Math.max(l.body.w, l.body.h) / (2 * s) : 0.02;
});
</script>

<template>
  <div ref="containerRef" class="folded-host"
       @pointerdown="onPointerDown" @pointermove="onPointerMove"
       @pointerup="onPointerUp" @pointercancel="onPointerUp">
    <svg :width="width" :height="height" :viewBox="viewBox"
         preserveAspectRatio="xMidYMid meet">
      <g class="panels3d">
        <polygon v-for="p in scene.polys" :key="`p3-${p.fi}`"
                 :points="p.pts"
                 :class="{
                   bridge: p.kind === 'bridge',
                   conn: p.kind === 'panel' && p.fi === state.params.connectorFaceIdx,
                   root: p.kind === 'panel' && p.fi === state.rootFace,
                 }" />
      </g>
      <g v-if="state.prefs.showLEDs" class="leds3d">
        <circle v-for="(d, i) in scene.ledDots" :key="`l3-${i}`"
                :cx="d.x" :cy="d.y" :r="ledR" />
      </g>
    </svg>

    <div class="fold-ctl">
      <span class="lbl">flat</span>
      <input type="range" min="0" max="1" step="0.01" v-model.number="foldT" />
      <span class="lbl">folded</span>
      <span class="pct">{{ Math.round(foldT * 100) }}%</span>
    </div>
    <div class="hint3d">drag to rotate</div>
  </div>
</template>

<style scoped>
.folded-host { width: 100%; height: 100%; background: var(--canvas-bg); position: relative; cursor: grab; touch-action: none; }
.folded-host:active { cursor: grabbing; }
svg { width: 100%; height: 100%; display: block; }
.panels3d polygon { fill: var(--paper); stroke: var(--paper-stroke); stroke-width: 0.012; fill-opacity: 0.92; }
.panels3d polygon.root { stroke: var(--ac); stroke-width: 0.02; }
.panels3d polygon.conn { stroke: var(--conn); stroke-width: 0.02; }
.panels3d polygon.bridge { fill: var(--ac2); fill-opacity: 0.55; stroke: var(--ac2); stroke-width: 0.008; }
.leds3d circle { fill: var(--led); opacity: 0.9; }
.fold-ctl {
  position: absolute; bottom: 14px; left: 50%; transform: translateX(-50%);
  display: flex; align-items: center; gap: 8px;
  background: var(--s); border: 1px solid var(--bd); border-radius: 999px;
  padding: 7px 14px;
  box-shadow: 0 2px 12px rgba(0,0,0,0.25);
}
.fold-ctl input { width: min(220px, 40vw); accent-color: var(--ac2); }
.fold-ctl .lbl { font: 400 0.68rem 'DM Mono', monospace; color: var(--sub); }
.fold-ctl .pct { font: 500 0.72rem 'DM Mono', monospace; color: var(--t); min-width: 4ch; text-align: right; }
.hint3d { position: absolute; top: 10px; left: 12px; font: 400 0.68rem 'DM Mono', monospace; color: var(--sub); opacity: 0.7; pointer-events: none; }
</style>
