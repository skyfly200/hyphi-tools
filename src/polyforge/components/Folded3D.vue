<script setup>
// Folded visualization (Three.js). Animates the unfolded net folding
// up into the polyhedron with a real depth buffer, so thin bridge
// strips crossing panels resolve correctly instead of glitching the
// way a 2D painter's-algorithm sort did.
//
// Fold mechanics (unchanged, verified): the unfolder's foldEdges form
// a spanning tree; folding rotates each subtree rigidly about its
// shared-edge axis by t × (π − dihedral), composed up the tree. We
// compute per-vertex world positions with that math and feed them
// straight into BufferGeometry — Three.js only handles projection,
// lighting, and occlusion.

import { ref, computed, watch, onMounted, onBeforeUnmount } from 'vue';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { state, geometry, currentLED } from '../store.js';
import {
  centroid2D, panelOutline, ledPositions,
  bridgesForNet, offsetPolyline, bridgeTraceCount, computeBridgeWidthMm,
} from '../lib/layout.js';

const containerRef = ref(null);
const foldT = ref(1); // 0 = flat, 1 = fully folded

// ── fold math (reused from the SVG version) ─────────────────────
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

const foldTree = computed(() => {
  const net = geometry.value.net;
  const parentEdge = new Map();
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
  return { chains };
});

const foldSign = computed(() => (foldError(1, +1) <= foldError(1, -1) ? +1 : -1));

function foldError(t, sign) {
  const net = geometry.value.net;
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
  for (const pts of byVert.values())
    for (let i = 1; i < pts.length; i++)
      err += Math.hypot(pts[i][0]-pts[0][0], pts[i][1]-pts[0][1], pts[i][2]-pts[0][2]);
  return err;
}

function transformPoint(p, fi, t, sign) {
  const { chains } = foldTree.value;
  const chain = chains.get(fi) || [];
  const theta = sign * t * (Math.PI - geometry.value.poly.dihedralDeg * Math.PI / 180);
  const cosT = Math.cos(theta), sinT = Math.sin(theta);
  let q = p;
  for (let i = chain.length - 1; i >= 0; i--) {
    const e = chain[i];
    const a = [e.a0[0], e.a0[1], 0];
    const d = [e.a1[0]-e.a0[0], e.a1[1]-e.a0[1], 0];
    const l = Math.hypot(d[0], d[1]) || 1;
    q = rotAboutAxis(q, a, [d[0]/l, d[1]/l, 0], cosT, sinT);
  }
  return q;
}

function panelPoints(face) {
  const s = state.params.edgeLengthMm;
  const shape = panelOutline(face.polygon2D, state.params.panel, s);
  if (shape.kind === 'circle') {
    return Array.from({ length: 40 }, (_, i) => {
      const a = (2 * Math.PI * i) / 40;
      return [shape.cx + Math.cos(a) * shape.r, shape.cy + Math.sin(a) * shape.r];
    });
  }
  return shape.points;
}

// Split a bridge centerline at the fold-edge line so each half rides
// its own face's transform (the two halves stay joined on the crease).
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
    } else B.push(p);
  }
  return crossed ? { A, B } : { A: center, B: [] };
}

// Half-strips: { face, left[], right[] } in flat-net normalized units.
function bridgeHalves() {
  if (!state.prefs.showBridges) return [];
  const net = geometry.value.net;
  const s = state.params.edgeLengthMm;
  const w = computeBridgeWidthMm(
    bridgeTraceCount(currentLED.value?.wireCount || 3), state.params.designRules);
  const bridges = bridgesForNet(net, state.params.panel, w, s);
  const foldByPair = new Map();
  for (const e of net.foldEdges) foldByPair.set(`${e.faceA}-${e.faceB}`, e);

  const halves = [];
  for (const b of bridges) {
    const e = foldByPair.get(`${b.faceA}-${b.faceB}`);
    if (!e) continue;
    const half = b.width / 2;
    const sp = splitAtFold(b.centerline, e.a0, e.a1);
    if (sp.A.length >= 2) halves.push({ face: b.faceA, left: offsetPolyline(sp.A, half), right: offsetPolyline(sp.A, -half) });
    if (sp.B.length >= 2) halves.push({ face: b.faceB, left: offsetPolyline(sp.B, half), right: offsetPolyline(sp.B, -half) });
  }
  return halves;
}

// ── Three.js scene ──────────────────────────────────────────────
let renderer, scene, camera, controls, raf;
let panelMesh, bridgeMesh, ledGroup, lightRig;
let needsRebuild = true;

function cssVar(name, fallback) {
  const host = containerRef.value;
  const v = host ? getComputedStyle(host).getPropertyValue(name).trim() : '';
  return v || fallback;
}

function initThree() {
  const host = containerRef.value;
  const w = host.clientWidth || 800, h = host.clientHeight || 600;

  renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio?.(Math.min(2, window.devicePixelRatio || 1));
  renderer.setSize(w, h);
  host.appendChild(renderer.domElement);

  scene = new THREE.Scene();

  camera = new THREE.PerspectiveCamera(38, w / h, 0.01, 100);
  camera.position.set(1.6, 1.2, 2.4);

  controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.09;
  controls.rotateSpeed = 0.9;

  lightRig = new THREE.Group();
  const key = new THREE.DirectionalLight(0xffffff, 1.6); key.position.set(2, 3, 2);
  const fill = new THREE.DirectionalLight(0xffffff, 0.5); fill.position.set(-2, -1, -1.5);
  lightRig.add(key, fill);
  scene.add(lightRig);
  scene.add(new THREE.AmbientLight(0xffffff, 0.55));

  const ro = new ResizeObserver(onResize);
  ro.observe(host);
  onResize._ro = ro;

  animate();
}

function onResize() {
  if (!renderer || !containerRef.value) return;
  const w = containerRef.value.clientWidth, h = containerRef.value.clientHeight;
  if (!w || !h) return;
  renderer.setSize(w, h);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}

function disposeMesh(m) {
  if (!m) return;
  scene.remove(m);
  m.geometry?.dispose?.();
  if (Array.isArray(m.material)) m.material.forEach(x => x.dispose());
  else m.material?.dispose?.();
}

// Rebuild all geometry for the current fold + params.
function rebuild() {
  if (!scene) return;
  const t = foldT.value, sign = foldSign.value;
  const net = geometry.value.net;

  // Collect every world vertex first so we can recenter the model.
  const panelTris = []; // flat [x,y,z, ...]
  const bridgeTris = [];
  const ledCenters = [];
  const acc = []; // for centering

  const push = (arr, v) => { arr.push(v[0], v[1], v[2]); acc.push(v); };

  // Panels — fan-triangulate each convex outline.
  for (let fi = 0; fi < net.faces.length; fi++) {
    const face = net.faces[fi];
    if (!face) continue;
    const pts = panelPoints(face).map(p => transformPoint([p[0], p[1], 0], fi, t, sign));
    for (let k = 1; k < pts.length - 1; k++) {
      push(panelTris, pts[0]); push(panelTris, pts[k]); push(panelTris, pts[k + 1]);
    }
    if (state.prefs.showLEDs) {
      const lp = ledPositions(face.polygon2D, currentLED.value, state.params.ledsPerFace, state.params.edgeLengthMm);
      for (const p of lp) ledCenters.push(transformPoint([p[0], p[1], 0], fi, t, sign));
    }
  }

  // Bridges — quad-strip each half.
  for (const h of bridgeHalves()) {
    const L = h.left.map(p => transformPoint([p[0], p[1], 0], h.face, t, sign));
    const R = h.right.map(p => transformPoint([p[0], p[1], 0], h.face, t, sign));
    const n = Math.min(L.length, R.length);
    for (let i = 0; i < n - 1; i++) {
      push(bridgeTris, L[i]); push(bridgeTris, R[i]);   push(bridgeTris, L[i + 1]);
      push(bridgeTris, R[i]); push(bridgeTris, R[i + 1]); push(bridgeTris, L[i + 1]);
    }
  }

  // Center the model on the origin so OrbitControls orbits its middle.
  let cx = 0, cy = 0, cz = 0;
  for (const v of acc) { cx += v[0]; cy += v[1]; cz += v[2]; }
  const n = Math.max(1, acc.length);
  cx /= n; cy /= n; cz /= n;
  const recenter = (arr) => { for (let i = 0; i < arr.length; i += 3) { arr[i]-=cx; arr[i+1]-=cy; arr[i+2]-=cz; } };
  recenter(panelTris); recenter(bridgeTris);
  for (const v of ledCenters) { v[0]-=cx; v[1]-=cy; v[2]-=cz; }

  disposeMesh(panelMesh); disposeMesh(bridgeMesh);
  if (ledGroup) { for (const c of [...ledGroup.children]) { c.geometry?.dispose?.(); c.material?.dispose?.(); } disposeMesh(ledGroup); ledGroup = null; }

  const paper = new THREE.Color(cssVar('--paper', '#1e1e2a'));
  const accent = new THREE.Color(cssVar('--ac2', '#7b5cfa'));
  const ledCol = new THREE.Color(cssVar('--led', '#7b5cfa'));

  const pg = new THREE.BufferGeometry();
  pg.setAttribute('position', new THREE.Float32BufferAttribute(panelTris, 3));
  pg.computeVertexNormals();
  panelMesh = new THREE.Mesh(pg, new THREE.MeshStandardMaterial({
    color: paper, roughness: 0.72, metalness: 0.02, side: THREE.DoubleSide, flatShading: true,
  }));
  scene.add(panelMesh);

  if (bridgeTris.length) {
    const bg = new THREE.BufferGeometry();
    bg.setAttribute('position', new THREE.Float32BufferAttribute(bridgeTris, 3));
    bg.computeVertexNormals();
    bridgeMesh = new THREE.Mesh(bg, new THREE.MeshStandardMaterial({
      color: accent, roughness: 0.5, metalness: 0.1, side: THREE.DoubleSide,
      polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1,
    }));
    scene.add(bridgeMesh);
  }

  if (ledCenters.length) {
    ledGroup = new THREE.Group();
    const l = currentLED.value;
    const r = l ? Math.max(l.body.w, l.body.h) / (2 * state.params.edgeLengthMm) : 0.02;
    const geo = new THREE.SphereGeometry(r, 12, 10);
    const mat = new THREE.MeshStandardMaterial({ color: ledCol, emissive: ledCol, emissiveIntensity: 0.4, roughness: 0.4 });
    for (const c of ledCenters) {
      const m = new THREE.Mesh(geo, mat);
      m.position.set(c[0], c[1], c[2]);
      ledGroup.add(m);
    }
    scene.add(ledGroup);
  }

  // Frame the camera to the model extent (once per rebuild is fine —
  // OrbitControls keeps the user's orbit, we only reset target).
  const box = new THREE.Box3().setFromObject(panelMesh);
  const sphere = box.getBoundingSphere(new THREE.Sphere());
  controls.target.set(0, 0, 0);
  const fitDist = sphere.radius / Math.sin((camera.fov * Math.PI / 180) / 2);
  if (!rebuild._framed) { camera.position.setLength(fitDist * 1.15); rebuild._framed = true; }
}

function animate() {
  raf = requestAnimationFrame(animate);
  if (needsRebuild) { rebuild(); needsRebuild = false; }
  if (lightRig && camera) lightRig.quaternion.copy(camera.quaternion); // headlight
  controls?.update();
  renderer?.render(scene, camera);
}

// Rebuild whenever the fold or any shape-affecting param changes.
watch(
  () => JSON.stringify({
    t: foldT.value,
    p: state.params.polyhedronId,
    e: state.params.edgeLengthMm,
    led: state.params.ledId, lpf: state.params.ledsPerFace,
    cf: state.params.connectorFaceIdx, r: state.rootFace,
    panel: state.params.panel, dr: state.params.designRules,
    b: state.prefs.showBridges, sl: state.prefs.showLEDs,
    theme: state.prefs.theme,
  }),
  () => { needsRebuild = true; },
);

onMounted(() => { initThree(); needsRebuild = true; });
onBeforeUnmount(() => {
  cancelAnimationFrame(raf);
  onResize._ro?.disconnect();
  disposeMesh(panelMesh); disposeMesh(bridgeMesh);
  controls?.dispose();
  renderer?.dispose();
  if (renderer?.domElement?.parentNode) renderer.domElement.parentNode.removeChild(renderer.domElement);
});
</script>

<template>
  <div ref="containerRef" class="folded-host">
    <div class="fold-ctl">
      <span class="lbl">flat</span>
      <input type="range" min="0" max="1" step="0.01" v-model.number="foldT" />
      <span class="lbl">folded</span>
      <span class="pct">{{ Math.round(foldT * 100) }}%</span>
    </div>
    <div class="hint3d">drag to rotate · scroll to zoom</div>
  </div>
</template>

<style scoped>
.folded-host { width: 100%; height: 100%; background: var(--canvas-bg); position: relative; overflow: hidden; touch-action: none; }
.folded-host :deep(canvas) { display: block; }
.fold-ctl {
  position: absolute; bottom: 14px; left: 50%; transform: translateX(-50%);
  display: flex; align-items: center; gap: 8px; z-index: 2;
  background: var(--s); border: 1px solid var(--bd); border-radius: 999px;
  padding: 7px 14px; box-shadow: 0 2px 12px rgba(0,0,0,0.25);
}
.fold-ctl input { width: min(220px, 40vw); accent-color: var(--ac2); }
.fold-ctl .lbl { font: 400 0.68rem 'DM Mono', monospace; color: var(--sub); }
.fold-ctl .pct { font: 500 0.72rem 'DM Mono', monospace; color: var(--t); min-width: 4ch; text-align: right; }
.hint3d { position: absolute; top: 10px; left: 12px; z-index: 2; font: 400 0.68rem 'DM Mono', monospace; color: var(--sub); opacity: 0.7; pointer-events: none; }
</style>
