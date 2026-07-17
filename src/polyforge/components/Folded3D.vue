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
import { state, geometry, currentLED, currentConnector } from '../store.js';
import {
  centroid2D, panelOutline, ledPositions,
  bridgesForNet, offsetVariablePolyline, bridgeTraceCount, computeBridgeWidthMm,
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

// Split a centerline + its per-point width profile at the fold-edge
// line, interpolating width at the crossing so the two folded halves
// share an identical seam edge.
function splitProfileAtFold(center, prof, a0, a1) {
  const dx = a1[0] - a0[0], dy = a1[1] - a0[1];
  const sd = (p) => dx * (p[1] - a0[1]) - dy * (p[0] - a0[0]);
  const A = { pts: [], w: [] }, B = { pts: [], w: [] };
  let crossed = false;
  for (let i = 0; i < center.length; i++) {
    const p = center[i], w = prof[i];
    if (!crossed) {
      A.pts.push(p); A.w.push(w);
      if (i < center.length - 1) {
        const s0 = sd(p), s1 = sd(center[i + 1]);
        if ((s0 <= 0) !== (s1 <= 0) && s0 !== s1) {
          const t = s0 / (s0 - s1);
          const cp = [p[0] + (center[i + 1][0] - p[0]) * t, p[1] + (center[i + 1][1] - p[1]) * t];
          const cw = w + (prof[i + 1] - w) * t;
          A.pts.push(cp); A.w.push(cw); B.pts.push(cp); B.w.push(cw);
          crossed = true;
        }
      }
    } else { B.pts.push(p); B.w.push(w); }
  }
  return crossed ? { A, B } : { A, B: { pts: [], w: [] } };
}

// Half-strips: { face, left[], right[] } in flat-net normalized units.
// bridgesForNet already trims to the panel edges and carries the flared
// width profile; we just split each bridge at its crease so each half
// rides its own face's fold transform.
function bridgeHalves() {
  if (!state.prefs.showBridges) return [];
  const net = geometry.value.net;
  const s = state.params.edgeLengthMm;
  const panel = state.params.panel;
  const w = computeBridgeWidthMm(
    bridgeTraceCount(currentLED.value?.wireCount || 3), state.params.designRules);
  const bridges = bridgesForNet(net, panel, w, s);
  const foldByPair = new Map();
  for (const e of net.foldEdges) foldByPair.set(`${e.faceA}-${e.faceB}`, e);

  const halves = [];
  for (const b of bridges) {
    const e = foldByPair.get(`${b.faceA}-${b.faceB}`);
    if (!e) continue;
    const sp = splitProfileAtFold(b.centerline, b.widthProfile, e.a0, e.a1);
    if (sp.A.pts.length >= 2) halves.push({ face: b.faceA, left: offsetVariablePolyline(sp.A.pts, sp.A.w, +1), right: offsetVariablePolyline(sp.A.pts, sp.A.w, -1) });
    if (sp.B.pts.length >= 2) halves.push({ face: b.faceB, left: offsetVariablePolyline(sp.B.pts, sp.B.w, +1), right: offsetVariablePolyline(sp.B.pts, sp.B.w, -1) });
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
  m.traverse?.(o => { o.geometry?.dispose?.(); if (Array.isArray(o.material)) o.material.forEach(x => x.dispose()); else o.material?.dispose?.(); });
  m.geometry?.dispose?.();
  if (Array.isArray(m.material)) m.material.forEach(x => x.dispose());
  else m.material?.dispose?.();
}

// ── geometry emit helpers (all fold-transform their vertices) ────
// Every point is a flat-net coordinate [x, y, z] where z is the
// signed height above the net plane; transformPoint carries it
// through the fold rotations (axes lie in z=0, so height rides along
// the face normal after folding).

// Extrude a convex outline into a prism between zBot and zTop.
function emitConvexPrism(outline2D, fi, zBot, zTop, t, sign, out) {
  const top = outline2D.map(p => transformPoint([p[0], p[1], zTop], fi, t, sign));
  const bot = outline2D.map(p => transformPoint([p[0], p[1], zBot], fi, t, sign));
  const tri = (a, b, c) => { pushV(out, a); pushV(out, b); pushV(out, c); };
  for (let k = 1; k < top.length - 1; k++) tri(top[0], top[k], top[k + 1]);   // top
  for (let k = 1; k < bot.length - 1; k++) tri(bot[0], bot[k + 1], bot[k]);   // bottom (reversed)
  const n = outline2D.length;
  for (let i = 0; i < n; i++) {                                                // walls
    const j = (i + 1) % n;
    tri(top[i], bot[i], bot[j]); tri(top[i], bot[j], top[j]);
  }
}

// Extrude a ribbon (left/right rails) into a prism — used for bridges,
// whose outline is not convex so a fan won't do.
function emitRibbonPrism(left2D, right2D, fi, zBot, zTop, t, sign, out) {
  const n = Math.min(left2D.length, right2D.length);
  if (n < 2) return;
  const lT = [], rT = [], lB = [], rB = [];
  for (let i = 0; i < n; i++) {
    lT.push(transformPoint([left2D[i][0], left2D[i][1], zTop], fi, t, sign));
    rT.push(transformPoint([right2D[i][0], right2D[i][1], zTop], fi, t, sign));
    lB.push(transformPoint([left2D[i][0], left2D[i][1], zBot], fi, t, sign));
    rB.push(transformPoint([right2D[i][0], right2D[i][1], zBot], fi, t, sign));
  }
  const tri = (a, b, c) => { pushV(out, a); pushV(out, b); pushV(out, c); };
  for (let i = 0; i < n - 1; i++) {
    tri(lT[i], rT[i], lT[i + 1]); tri(rT[i], rT[i + 1], lT[i + 1]);           // top
    tri(lB[i], lB[i + 1], rB[i]); tri(rB[i], lB[i + 1], rB[i + 1]);           // bottom
    tri(lT[i], lT[i + 1], lB[i]); tri(lB[i], lT[i + 1], lB[i + 1]);           // left wall
    tri(rT[i], rB[i], rT[i + 1]); tri(rB[i], rB[i + 1], rT[i + 1]);           // right wall
  }
  // end caps
  tri(lT[0], lB[0], rT[0]); tri(rT[0], lB[0], rB[0]);
  const e = n - 1;
  tri(lT[e], rT[e], lB[e]); tri(rT[e], rB[e], lB[e]);
}

// Axis-aligned (in the flat-net plane) box for component bodies.
function emitBox(cx, cy, fi, zBot, zTop, w, h, t, sign, out) {
  const hw = w / 2, hh = h / 2;
  const c = [
    [cx-hw, cy-hh], [cx+hw, cy-hh], [cx+hw, cy+hh], [cx-hw, cy+hh],
  ];
  emitConvexPrism(c, fi, zBot, zTop, t, sign, out);
}

function pushV(arr, v) { arr.push(v[0], v[1], v[2]); }

// Rebuild all geometry for the current fold + params.
function rebuild() {
  if (!scene) return;
  const t = foldT.value, sign = foldSign.value;
  const net = geometry.value.net;
  const s = state.params.edgeLengthMm;
  const panel = state.params.panel;
  const led = currentLED.value;

  // Thicknesses in normalized units.
  const boardH = (state.params.designRules.boardThicknessMm ?? 1.6) / s;
  const flexH  = (state.params.designRules.flexThicknessMm ?? 0.2) / s;

  const panelTris = [];
  const bridgeTris = [];
  const ledBodyTris = [];
  const ledDomeTris = [];
  const connTris = [];

  // Panels as prisms (front = +z, back = −z).
  for (let fi = 0; fi < net.faces.length; fi++) {
    const face = net.faces[fi];
    if (!face) continue;
    emitConvexPrism(panelPoints(face), fi, -boardH / 2, boardH / 2, t, sign, panelTris);
  }

  // Bridges as thin flex prisms, centered on the net plane.
  for (const h of bridgeHalves()) {
    emitRibbonPrism(h.left, h.right, h.face, -flexH / 2, flexH / 2, t, sign, bridgeTris);
  }

  // Component models: LED package (dark body + emissive top) sitting on
  // the FRONT of each panel. Connector body on the BACK of its face.
  if (state.prefs.showLEDs && led) {
    const bw = led.body.w / s, bh = led.body.h / s;
    const bodyH = (led.body.w >= 4 ? 1.4 : 0.8) / s;     // taller for 5050
    const domeH = 0.35 / s;
    const front = boardH / 2;
    for (let fi = 0; fi < net.faces.length; fi++) {
      const face = net.faces[fi];
      if (!face) continue;
      for (const p of ledPositions(face.polygon2D, led, state.params.ledsPerFace, s, panel)) {
        emitBox(p[0], p[1], fi, front, front + bodyH, bw, bh, t, sign, ledBodyTris);
        emitBox(p[0], p[1], fi, front + bodyH, front + bodyH + domeH, bw * 0.62, bh * 0.62, t, sign, ledDomeTris);
      }
    }
  }
  const conn = currentConnector.value;
  if (state.prefs.showConnector && conn) {
    const fi = state.params.connectorFaceIdx;
    const face = net.faces[fi];
    if (face) {
      const c = centroid2D(face.polygon2D);
      const cw = conn.body.w / s, ch = conn.body.h / s;
      const bodyH = 2.0 / s;
      const back = -boardH / 2;
      emitBox(c[0], c[1], fi, back - bodyH, back, cw, ch, t, sign, connTris);
    }
  }

  // Recenter everything on the origin.
  const allArrays = [panelTris, bridgeTris, ledBodyTris, ledDomeTris, connTris];
  let cx = 0, cy = 0, cz = 0, count = 0;
  for (const arr of allArrays) for (let i = 0; i < arr.length; i += 3) { cx += arr[i]; cy += arr[i+1]; cz += arr[i+2]; count++; }
  count = Math.max(1, count); cx /= count; cy /= count; cz /= count;
  for (const arr of allArrays) for (let i = 0; i < arr.length; i += 3) { arr[i]-=cx; arr[i+1]-=cy; arr[i+2]-=cz; }

  disposeMesh(panelMesh); disposeMesh(bridgeMesh); disposeMesh(ledGroup);
  panelMesh = bridgeMesh = ledGroup = null;

  const paper  = new THREE.Color(cssVar('--paper', '#1e1e2a'));
  const accent = new THREE.Color(cssVar('--ac2', '#7b5cfa'));
  const ledCol = new THREE.Color(cssVar('--led', '#7b5cfa'));

  const mkMesh = (tris, mat) => {
    if (!tris.length) return null;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(tris, 3));
    g.computeVertexNormals();
    return new THREE.Mesh(g, mat);
  };

  panelMesh = mkMesh(panelTris, new THREE.MeshStandardMaterial({
    color: paper, roughness: 0.72, metalness: 0.02, flatShading: true }));
  if (panelMesh) scene.add(panelMesh);

  bridgeMesh = mkMesh(bridgeTris, new THREE.MeshStandardMaterial({
    color: accent, roughness: 0.5, metalness: 0.1 }));
  if (bridgeMesh) scene.add(bridgeMesh);

  // Component meshes grouped so they dispose together.
  ledGroup = new THREE.Group();
  const bodyMesh = mkMesh(ledBodyTris, new THREE.MeshStandardMaterial({ color: 0x161821, roughness: 0.6 }));
  const domeMesh = mkMesh(ledDomeTris, new THREE.MeshStandardMaterial({ color: 0xf4f4f8, emissive: ledCol, emissiveIntensity: 0.85, roughness: 0.25 }));
  const connMesh = mkMesh(connTris, new THREE.MeshStandardMaterial({ color: 0x2b2f3a, roughness: 0.55, metalness: 0.2 }));
  for (const m of [bodyMesh, domeMesh, connMesh]) if (m) ledGroup.add(m);
  scene.add(ledGroup);

  // Frame the camera once to the model extent.
  if (panelMesh && !rebuild._framed) {
    const box = new THREE.Box3().setFromObject(panelMesh);
    const sphere = box.getBoundingSphere(new THREE.Sphere());
    const fitDist = sphere.radius / Math.sin((camera.fov * Math.PI / 180) / 2);
    camera.position.setLength(fitDist * 1.15);
    rebuild._framed = true;
  }
  controls.target.set(0, 0, 0);
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
