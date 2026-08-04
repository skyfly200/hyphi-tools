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
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';
import { STLExporter } from 'three/examples/jsm/exporters/STLExporter.js';
import { state, geometry, currentLED, currentConnector, requiredWireCount } from '../store.js';
import {
  centroid2D, panelOutline, ledPositions, insidePanelShape,
  bridgesForNet, bridgeTraceCount, computeBridgeWidthMm,
  connectorTabGeometry,
} from '../lib/layout.js';
import { resolveTabSpec } from '../lib/connectors.js';

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

// Transform a flat-net point that sits on a bridge, applying a PARTIAL
// rotation about that bridge's own crease. faceA is the bridge's parent
// face; `f` blends 0 → parent-face orientation, 1 → child-face
// orientation. Ramping f across the free gap makes the bridge sweep a
// smooth arc (the bend radius) instead of a hard crease. All other
// creases up faceA's chain use the full fold angle.
function transformBridgePoint(p, faceA, e, f, t, sign) {
  const { chains } = foldTree.value;
  const dihedral = geometry.value.poly.dihedralDeg * Math.PI / 180;
  const thetaFull = sign * t * (Math.PI - dihedral);
  // partial rotation about this bridge's crease
  const a = [e.a0[0], e.a0[1], 0];
  const d = [e.a1[0] - e.a0[0], e.a1[1] - e.a0[1], 0];
  const l = Math.hypot(d[0], d[1]) || 1;
  const th = thetaFull * f;
  let q = rotAboutAxis(p, a, [d[0] / l, d[1] / l, 0], Math.cos(th), Math.sin(th));
  // then faceA's own chain at the full angle
  const chain = chains.get(faceA) || [];
  const cF = Math.cos(thetaFull), sF = Math.sin(thetaFull);
  for (let i = chain.length - 1; i >= 0; i--) {
    const ce = chain[i];
    const ca = [ce.a0[0], ce.a0[1], 0];
    const cd = [ce.a1[0] - ce.a0[0], ce.a1[1] - ce.a0[1], 0];
    const cl = Math.hypot(cd[0], cd[1]) || 1;
    q = rotAboutAxis(q, ca, [cd[0] / cl, cd[1] / cl, 0], cF, sF);
  }
  return q;
}

// Per-bridge data for the curved 3D render: the (trimmed) centerline,
// its width profile, the parent face + crease, and a per-point blend f
// that is 0 where the strip is bonded to face A, 1 where bonded to
// face B, and ramps linearly across the free gap (→ constant-curvature
// arc = the flex bend radius).
function curvedBridges() {
  if (!state.prefs.showBridges) return [];
  const net = geometry.value.net;
  const s = state.params.edgeLengthMm;
  const panel = state.params.panel;
  const w = computeBridgeWidthMm(
    bridgeTraceCount(currentLED.value?.wireCount || 3), state.params.designRules);
  const bridges = bridgesForNet(net, panel, w, s);
  const foldByPair = new Map();
  for (const e of net.foldEdges) foldByPair.set(`${e.faceA}-${e.faceB}`, e);

  const out = [];
  for (const b of bridges) {
    const e = foldByPair.get(`${b.faceA}-${b.faceB}`);
    if (!e || b.centerline.length < 2) continue;
    const shA = panelOutline(net.faces[b.faceA].polygon2D, panel, s);
    const shB = panelOutline(net.faces[b.faceB].polygon2D, panel, s);
    const c = b.centerline;
    const nrm = c.map((p, i) => {
      const a = c[Math.max(0, i - 1)], bb = c[Math.min(c.length - 1, i + 1)];
      const dx = bb[0] - a[0], dy = bb[1] - a[1];
      const ll = Math.hypot(dx, dy) || 1;
      return [-dy / ll, dx / ll];
    });
    let exitA = 0;
    for (let i = 0; i < c.length; i++) { if (insidePanelShape(c[i], shA)) exitA = i; else break; }
    let entryB = c.length - 1;
    for (let i = c.length - 1; i >= 0; i--) { if (insidePanelShape(c[i], shB)) entryB = i; else break; }
    if (entryB <= exitA) { exitA = 0; entryB = c.length - 1; }
    const blend = c.map((_, i) =>
      i <= exitA ? 0 : i >= entryB ? 1 : (i - exitA) / (entryB - exitA));
    out.push({ faceA: b.faceA, e, center: c, prof: b.widthProfile, nrm, blend });
  }
  return out;
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

// Axis-aligned (in the flat-net plane) box for component bodies.
function emitBox(cx, cy, fi, zBot, zTop, w, h, t, sign, out) {
  const hw = w / 2, hh = h / 2;
  const c = [
    [cx-hw, cy-hh], [cx+hw, cy-hh], [cx+hw, cy+hh], [cx-hw, cy+hh],
  ];
  emitConvexPrism(c, fi, zBot, zTop, t, sign, out);
}

function pushV(arr, v) { arr.push(v[0], v[1], v[2]); }

// Emit a curved bridge substrate prism: each cross-section rides a
// partial fold (blend f), so the strip sweeps a smooth arc across the
// gap instead of a hard crease.
function emitCurvedBridge(bd, zBot, zTop, t, sign, out) {
  const { faceA, e, center, prof, nrm, blend } = bd;
  const n = center.length;
  const lT = [], rT = [], lB = [], rB = [];
  for (let i = 0; i < n; i++) {
    const hw = prof[i];
    const lx = center[i][0] + nrm[i][0] * hw, ly = center[i][1] + nrm[i][1] * hw;
    const rx = center[i][0] - nrm[i][0] * hw, ry = center[i][1] - nrm[i][1] * hw;
    lT.push(transformBridgePoint([lx, ly, zTop], faceA, e, blend[i], t, sign));
    rT.push(transformBridgePoint([rx, ry, zTop], faceA, e, blend[i], t, sign));
    lB.push(transformBridgePoint([lx, ly, zBot], faceA, e, blend[i], t, sign));
    rB.push(transformBridgePoint([rx, ry, zBot], faceA, e, blend[i], t, sign));
  }
  const tri = (a, b, c) => { pushV(out, a); pushV(out, b); pushV(out, c); };
  for (let i = 0; i < n - 1; i++) {
    tri(lT[i], rT[i], lT[i + 1]); tri(rT[i], rT[i + 1], lT[i + 1]);
    tri(lB[i], lB[i + 1], rB[i]); tri(rB[i], lB[i + 1], rB[i + 1]);
    tri(lT[i], lT[i + 1], lB[i]); tri(lB[i], lT[i + 1], lB[i + 1]);
    tri(rT[i], rB[i], rT[i + 1]); tri(rB[i], rB[i + 1], rT[i + 1]);
  }
  tri(lT[0], lB[0], rT[0]); tri(rT[0], lB[0], rB[0]);
  const e2 = n - 1;
  tri(lT[e2], rT[e2], lB[e2]); tri(rT[e2], rB[e2], lB[e2]);
}

// Emit a thin copper lane ribbon on a bridge, offset `off` across the
// strip, following the same curved fold so it stays bonded.
function emitCurvedLane(bd, off, halfW, z, t, sign, out) {
  const { faceA, e, center, nrm, blend } = bd;
  const n = center.length;
  const L = [], R = [];
  for (let i = 0; i < n; i++) {
    const cx = center[i][0] + nrm[i][0] * off, cy = center[i][1] + nrm[i][1] * off;
    L.push(transformBridgePoint([cx + nrm[i][0] * halfW, cy + nrm[i][1] * halfW, z], faceA, e, blend[i], t, sign));
    R.push(transformBridgePoint([cx - nrm[i][0] * halfW, cy - nrm[i][1] * halfW, z], faceA, e, blend[i], t, sign));
  }
  for (let i = 0; i < n - 1; i++) {
    pushV(out, L[i]); pushV(out, R[i]); pushV(out, L[i + 1]);
    pushV(out, R[i]); pushV(out, R[i + 1]); pushV(out, L[i + 1]);
  }
}

// Procedural polyimide (Kapton) texture: an amber base with fine fiber
// speckle + a faint weave, so the flex substrate reads as a real board
// instead of flat plastic. Generated on a canvas — no external assets.
let _polyTex = null;
function polyimideTexture() {
  if (_polyTex) return _polyTex;
  const N = 256;
  const cv = document.createElement('canvas');
  cv.width = cv.height = N;
  const g = cv.getContext('2d');
  g.fillStyle = '#8a5a1e';
  g.fillRect(0, 0, N, N);
  // fiber speckle
  const img = g.getImageData(0, 0, N, N);
  for (let i = 0; i < img.data.length; i += 4) {
    const n = (Math.sin(i * 12.9898) * 43758.5453) % 1;
    const d = (n - Math.floor(n) - 0.5) * 26;
    img.data[i] += d; img.data[i + 1] += d * 0.8; img.data[i + 2] += d * 0.5;
  }
  g.putImageData(img, 0, 0);
  // faint diagonal weave
  g.globalAlpha = 0.05;
  g.strokeStyle = '#000';
  for (let k = -N; k < N; k += 6) {
    g.beginPath(); g.moveTo(k, 0); g.lineTo(k + N, N); g.stroke();
  }
  g.globalAlpha = 1;
  const tex = new THREE.CanvasTexture(cv);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(3, 3);
  _polyTex = tex;
  return tex;
}

// Rebuild all geometry for the current fold + params.
function rebuild() {
  if (!scene) return;
  const t = foldT.value, sign = foldSign.value;
  const net = geometry.value.net;
  const s = state.params.edgeLengthMm;
  const panel = state.params.panel;
  const led = currentLED.value;

  // One uniform stack thickness — segments and bridges are the same
  // flex sheet, so they render at the same thickness.
  const boardH = (state.params.designRules.boardThicknessMm ?? 1.6) / s;

  const panelTris = [];
  const bridgeTris = [];
  const ledBodyTris = [];
  const ledDomeTris = [];
  const connTris = [];
  const copperTris = [];
  const padTris = [];

  // Panels as prisms (front = +z, back = −z).
  for (let fi = 0; fi < net.faces.length; fi++) {
    const face = net.faces[fi];
    if (!face) continue;
    emitConvexPrism(panelPoints(face), fi, -boardH / 2, boardH / 2, t, sign, panelTris);
  }

  // Bridges: same thickness as the segments (one continuous flex
  // sheet), and each sweeps a gradual arc over its free span rather
  // than a hard crease. Copper lanes ride the same curve so they stay
  // bonded and end spaced apart at the segment edges (no convergence).
  const bd3d = curvedBridges();
  const traceHalf = ((state.params.designRules.traceWidthMm ?? 0.25) / 2) / s;
  const laneZ = boardH / 2 + 0.02 / s;
  const showTraces3d = state.prefs.showTraces && state.params.routing.enabled;
  const tc = bridgeTraceCount(requiredWireCount.value);
  const tw = (state.params.designRules.traceWidthMm ?? 0.25);
  const cl = (state.params.designRules.clearanceMm ?? 0.2);
  const pitchN = (tw + cl) / s;
  for (const bd of bd3d) {
    emitCurvedBridge(bd, -boardH / 2, boardH / 2, t, sign, bridgeTris);
    if (showTraces3d) {
      for (let k = 0; k < tc; k++) {
        const off = (k - (tc - 1) / 2) * pitchN;
        emitCurvedLane(bd, off, traceHalf, laneZ, t, sign, copperTris);
      }
    }
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
  if (state.prefs.showConnector && conn && !state.params.connectorTab.enabled) {
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

  // Connector tab: tab board + optional flex bridge ride the connector
  // face's fold transform; a connector body block sits on the tab.
  if (state.prefs.showConnector && state.params.connectorTab.enabled) {
    const g = connectorTabGeometry(net, state.params, resolveTabSpec(state.params.connectorTab), s);
    if (g) {
      const fi = g.faceIdx;
      emitConvexPrism(g.tab, fi, -boardH / 2, boardH / 2, t, sign, panelTris);
      if (g.bridge) emitConvexPrism(g.bridge, fi, -boardH / 2, boardH / 2, t, sign, bridgeTris);
      // connector body straddling the tab (on the front for visibility)
      let bx = 0, by = 0; for (const p of g.tab) { bx += p[0] / 4; by += p[1] / 4; }
      const cw = (resolveTabSpec(state.params.connectorTab).tabWMm * 0.7) / s;
      const ch = (resolveTabSpec(state.params.connectorTab).tabLMm * 0.35) / s;
      emitBox(bx, by, fi, boardH / 2, boardH / 2 + 2.0 / s, cw, ch, t, sign, connTris);
      // Gold tab pads on the back surface.
      for (const p of g.pads) emitBox(p[0], p[1], fi, -boardH / 2 - 0.02 / s, -boardH / 2, g.padW, g.padH, t, sign, padTris);
    }
  }

  // (Copper traces are emitted alongside each bridge above.)

  // Recenter everything on the origin.
  const allArrays = [panelTris, bridgeTris, ledBodyTris, ledDomeTris, connTris, copperTris, padTris];
  let cx = 0, cy = 0, cz = 0, count = 0;
  for (const arr of allArrays) for (let i = 0; i < arr.length; i += 3) { cx += arr[i]; cy += arr[i+1]; cz += arr[i+2]; count++; }
  count = Math.max(1, count); cx /= count; cy /= count; cz /= count;
  for (const arr of allArrays) for (let i = 0; i < arr.length; i += 3) { arr[i]-=cx; arr[i+1]-=cy; arr[i+2]-=cz; }

  disposeMesh(panelMesh); disposeMesh(bridgeMesh); disposeMesh(ledGroup);
  panelMesh = bridgeMesh = ledGroup = null;

  const ledCol = new THREE.Color(cssVar('--led', '#7b5cfa'));

  const mkMesh = (tris, mat, uvScale) => {
    if (!tris.length) return null;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(tris, 3));
    if (uvScale) {
      // Planar UVs from world XY — static in the assembled view.
      const uv = new Float32Array((tris.length / 3) * 2);
      for (let i = 0, j = 0; i < tris.length; i += 3, j += 2) {
        uv[j] = tris[i] * uvScale; uv[j + 1] = tris[i + 1] * uvScale;
      }
      g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    }
    g.computeVertexNormals();
    return new THREE.Mesh(g, mat);
  };

  // Flex PCB look: amber polyimide substrate (textured) for panels and
  // bridges, copper traces, gold pads.
  const poly = polyimideTexture();
  const uvScale = 6 / geometry.value.net.bbox.width; // a few repeats across the net
  const substrate = () => new THREE.MeshStandardMaterial({
    color: 0xb9832f, map: poly, roughness: 0.62, metalness: 0.12,
    emissive: 0x2a1602, emissiveIntensity: 0.25, side: THREE.DoubleSide,
  });

  panelMesh = mkMesh(panelTris, substrate(), uvScale);
  if (panelMesh) scene.add(panelMesh);

  bridgeMesh = mkMesh(bridgeTris, substrate(), uvScale);
  if (bridgeMesh) scene.add(bridgeMesh);

  // Copper + component meshes grouped so they dispose together.
  ledGroup = new THREE.Group();
  const copperMesh = mkMesh(copperTris, new THREE.MeshStandardMaterial({ color: 0xc4772f, roughness: 0.35, metalness: 0.85, side: THREE.DoubleSide }));
  const padMesh = mkMesh(padTris, new THREE.MeshStandardMaterial({ color: 0xd9b25a, roughness: 0.3, metalness: 0.9 }));
  const bodyMesh = mkMesh(ledBodyTris, new THREE.MeshStandardMaterial({ color: 0x141414, roughness: 0.5 }));
  const domeMesh = mkMesh(ledDomeTris, new THREE.MeshStandardMaterial({ color: 0xf6f6f2, emissive: ledCol, emissiveIntensity: 0.9, roughness: 0.2 }));
  const connMesh = mkMesh(connTris, new THREE.MeshStandardMaterial({ color: 0xf2f2f4, roughness: 0.5, metalness: 0.1 }));
  for (const m of [copperMesh, padMesh, bodyMesh, domeMesh, connMesh]) if (m) ledGroup.add(m);
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

// ── folded 3D model export (GLB keeps materials, STL is print-ready) ─
function dl(name, data, mime) {
  const blob = new Blob([data], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = name;
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
function modelName(ext) {
  const stem = state.currentPatch || `${state.params.polyhedronId}-${state.params.edgeLengthMm}mm`;
  return `${stem.replace(/\s+/g, '_')}-folded.${ext}`;
}
function exportGroup() {
  const grp = new THREE.Group();
  for (const m of [panelMesh, bridgeMesh, ledGroup]) if (m) grp.add(m.clone());
  grp.updateMatrixWorld(true);
  return grp;
}
const exporting = ref(false);
function exportGLB() {
  exporting.value = true;
  new GLTFExporter().parse(exportGroup(),
    (res) => { dl(modelName('glb'), res, 'model/gltf-binary'); exporting.value = false; },
    (err) => { console.error(err); exporting.value = false; },
    { binary: true });
}
function exportSTL() {
  const stl = new STLExporter().parse(exportGroup(), { binary: true });
  dl(modelName('stl'), stl, 'model/stl');
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
    tab: state.params.connectorTab, rt: state.params.routing,
    b: state.prefs.showBridges, sl: state.prefs.showLEDs, sc: state.prefs.showConnector,
    tr: state.prefs.showTraces,
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
    <div class="export3d">
      <button @click="exportGLB" :disabled="exporting" title="Folded model with flex-PCB materials">Export GLB</button>
      <button @click="exportSTL" title="Folded model as a printable mesh">Export STL</button>
    </div>
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
.export3d { position: absolute; top: 10px; right: 12px; z-index: 2; display: flex; gap: 6px; }
.export3d button { background: var(--s); color: var(--t); border: 1px solid var(--bd); border-radius: 6px; padding: 6px 10px; font: 500 0.72rem 'DM Sans', sans-serif; cursor: pointer; }
.export3d button:hover { border-color: var(--ac2); }
.export3d button:disabled { opacity: 0.5; cursor: default; }
</style>
