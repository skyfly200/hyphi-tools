<script setup>
// Live folded 3D assembly (Three.js). Mesh topology is fixed per assembly, so
// each configuration only rewrites the position buffer.
import { ref, onMounted, onBeforeUnmount, watch } from 'vue';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { fs, raw, selectedStep, connectionModes, poses } from '../../foldingStore.js';
import { buildMesh } from '../../../folding/export/index.js';
import { applyPose } from '../../../folding/math.js';

const host = ref(null);
let renderer, scene, camera, controls, mesh, hingeLines, flatLines, collisionPts, ro, anim = 0, partOfTri = [];
let fitted = null, geomKey = null;
const raycaster = new THREE.Raycaster();
raycaster.params.Line = { threshold: 1.5 };

const PALETTE = i => new THREE.Color().setHSL(((i * 0.137) % 1), 0.45, 0.62);
const MODE_COLOR = { drive: 0xff6b35, hold: 0x4aa3ff, free: 0x9aa0aa };

function init() {
  const w = host.value.clientWidth || 600, h = host.value.clientHeight || 400;
  renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
  renderer.setSize(w, h);
  host.value.appendChild(renderer.domElement);
  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(35, w / h, 0.5, 5000);
  camera.up.set(0, 0, 1);                                   // assembly coordinates are Z-up
  camera.position.set(160, -190, 130);
  controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  scene.add(new THREE.HemisphereLight(0xffffff, 0x444466, 1.0));
  const dl = new THREE.DirectionalLight(0xffffff, 1.1); dl.position.set(120, -80, 200); scene.add(dl);
  const grid = new THREE.GridHelper(300, 30, 0x55556a, 0x33334a); grid.rotation.x = Math.PI / 2; grid.material.transparent = true; grid.material.opacity = 0.35; scene.add(grid);
  scene.add(new THREE.AxesHelper(20));
  renderer.domElement.addEventListener('pointerdown', onDown);
  renderer.domElement.addEventListener('pointerup', onUp);
  ro = new ResizeObserver(() => resize()); ro.observe(host.value);
  loop();
}

function resize() {
  if (!renderer || !host.value) return;
  const w = host.value.clientWidth, h = host.value.clientHeight; if (!w || !h) return;
  renderer.setSize(w, h); camera.aspect = w / h; camera.updateProjectionMatrix();
}

function disposeObj(o) { if (!o) return; scene.remove(o); o.geometry?.dispose?.(); o.material?.dispose?.(); }

function rebuildGeometry() {
  disposeObj(mesh); disposeObj(hingeLines); disposeObj(flatLines); disposeObj(collisionPts);
  mesh = hingeLines = flatLines = collisionPts = null; partOfTri = [];
  const c = raw.compiled;
  if (!c?.ok) {                                  // not solvable yet: still show the flat sheet for orientation
    if (raw.assembly) {
      const pts = [];
      for (const r of raw.assembly.regions) for (const poly of (r.polygons || [r.polygon])) for (let i = 0; i < poly.length; i++) { const a = poly[i], b = poly[(i + 1) % poly.length]; pts.push(a[0], a[1], 0, b[0], b[1], 0); }
      const fg = new THREE.BufferGeometry(); fg.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
      flatLines = new THREE.LineSegments(fg, new THREE.LineBasicMaterial({ color: 0xaab0c4 })); scene.add(flatLines);
      const S = fs.physical.sheetMm;
      if (fitted !== 'flat:' + S) { frame(new THREE.Box3(new THREE.Vector3(0, 0, 0), new THREE.Vector3(S, S, S * 0.3))); fitted = 'flat:' + S; }
    }
    geomKey = 'flat'; return;
  }
  const m = buildMesh(c, fs.angles, { thickness: fs.view.thickness });
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(m.positions), 3));
  g.setIndex(Array.from(m.indices));
  const col = new Float32Array(m.positions.length);
  m.parts.forEach((p, i) => {
    const color = p.kind === 'band' ? new THREE.Color(0xf5d76e) : PALETTE(c.regionIndex.size ? [...c.regionIndex.keys()].indexOf(p.id) : i);
    for (let v = p.vertexStart; v < p.vertexStart + p.vertexCount; v++) { col[3 * v] = color.r; col[3 * v + 1] = color.g; col[3 * v + 2] = color.b; }
    for (let t = p.triStart; t < p.triStart + p.triCount; t++) partOfTri[t] = p;
  });
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.computeVertexNormals();
  mesh = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ vertexColors: true, side: THREE.DoubleSide, roughness: 0.75, metalness: 0.0, flatShading: false }));
  mesh.userData.parts = m.parts;
  scene.add(mesh);
  // hinge lines (one segment per connection with an edge)
  const conns = [...c.connIndex.values()].filter(x => x.edge);
  const lg = new THREE.BufferGeometry();
  lg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(conns.length * 6), 3));
  lg.setAttribute('color', new THREE.BufferAttribute(new Float32Array(conns.length * 6), 3));
  hingeLines = new THREE.LineSegments(lg, new THREE.LineBasicMaterial({ vertexColors: true, linewidth: 2, depthTest: false, transparent: true }));
  hingeLines.renderOrder = 5; hingeLines.userData.conns = conns.map(x => x.id);
  scene.add(hingeLines);
  // faint flat sheet at z = 0 for reference
  const pts = [];
  for (const r of c.regionIndex.values()) for (const poly of (r.polygons || [r.polygon])) for (let i = 0; i < poly.length; i++) { const a = poly[i], b = poly[(i + 1) % poly.length]; pts.push(a[0] - 0, a[1], -0.05, b[0], b[1], -0.05); }
  const fg = new THREE.BufferGeometry(); fg.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
  flatLines = new THREE.LineSegments(fg, new THREE.LineBasicMaterial({ color: 0x8a91a4, transparent: true, opacity: 0.35 }));
  scene.add(flatLines);
  geomKey = `${c.hash}:${fs.view.thickness}`;
  if (fitted !== c.hash) { fit(m); fitted = c.hash; }
}

// Frame the whole sheet: distance from the bounding sphere and the camera's FOV so the
// object fills ~70% of the view whatever its size, with a fixed 3/4 viewing direction.
function frame(box) {
  const ctr = box.getCenter(new THREE.Vector3());
  const r = Math.max(box.getSize(new THREE.Vector3()).length() / 2, 1);
  const vfov = (camera.fov * Math.PI) / 180, hfov = 2 * Math.atan(Math.tan(vfov / 2) * camera.aspect);
  const dist = (r / Math.sin(Math.min(vfov, hfov) / 2)) * 1.15;
  controls.target.copy(ctr);
  camera.position.copy(ctr).add(new THREE.Vector3(0.62, -0.72, 0.58).normalize().multiplyScalar(dist));
  camera.near = Math.max(dist / 200, 0.1); camera.far = dist * 20; camera.updateProjectionMatrix();
  controls.update();
}
function fit(m) {
  // include the flat sheet so the view does not jump when a fold starts
  const box = new THREE.Box3(); const P = m.positions;
  for (let i = 0; i < P.length; i += 3) box.expandByPoint(new THREE.Vector3(P[i], P[i + 1], P[i + 2]));
  const S = fs.physical.sheetMm; box.expandByPoint(new THREE.Vector3(0, 0, 0)); box.expandByPoint(new THREE.Vector3(S, S, 0));
  frame(box);
}

function updatePositions() {
  const c = raw.compiled; if (!c) return;
  const key = c.ok ? `${c.hash}:${fs.view.thickness}` : 'flat';
  if (geomKey !== key || (c.ok && !mesh) || (!c.ok && mesh)) rebuildGeometry();
  if (!c.ok || !mesh) return;
  const m = buildMesh(c, fs.angles, { thickness: fs.view.thickness });
  const pos = mesh.geometry.attributes.position; pos.array.set(m.positions); pos.needsUpdate = true;
  mesh.geometry.computeVertexNormals(); mesh.geometry.computeBoundingSphere();
  // selected region highlight
  const col = mesh.geometry.attributes.color, names = [...c.regionIndex.keys()];
  mesh.userData.parts.forEach(p => {
    const base = p.kind === 'band' ? new THREE.Color(0xf5d76e) : PALETTE(names.indexOf(p.id));
    const sel = p.id === fs.selected.regionId; const colr = sel ? base.clone().lerp(new THREE.Color(0xffffff), 0.55) : base;
    for (let v = p.vertexStart; v < p.vertexStart + p.vertexCount; v++) { col.array[3 * v] = colr.r; col.array[3 * v + 1] = colr.g; col.array[3 * v + 2] = colr.b; }
  });
  col.needsUpdate = true;
  // hinge lines
  const P = poses(), modes = connectionModes();
  const lp = hingeLines.geometry.attributes.position, lc = hingeLines.geometry.attributes.color;
  hingeLines.userData.conns.forEach((id, k) => {
    const cn = c.connIndex.get(id), Pa = P.get(cn.a);
    const A = applyPose(Pa, [cn.edge.p0[0], cn.edge.p0[1], 0]), B = applyPose(Pa, [cn.edge.p1[0], cn.edge.p1[1], 0]);
    lp.array.set([...A, ...B], k * 6);
    const sel = id === fs.selected.connId;
    const color = new THREE.Color(sel ? 0xffffff : MODE_COLOR[modes.get(id) || 'free']);
    lc.array.set([color.r, color.g, color.b, color.r, color.g, color.b], k * 6);
  });
  lp.needsUpdate = true; lc.needsUpdate = true; hingeLines.visible = fs.view.showHinges;
  flatLines.visible = fs.view.showFlat;
  // collisions
  disposeObj(collisionPts); collisionPts = null;
  if (fs.view.showCollisions && fs.collisions.length) {
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(fs.collisions.flatMap(h => h.point), 3));
    collisionPts = new THREE.Points(g, new THREE.PointsMaterial({ color: 0xff2b2b, size: 9, sizeAttenuation: false, depthTest: false }));
    collisionPts.renderOrder = 10; scene.add(collisionPts);
  }
}

let downAt = null;
const onDown = e => { downAt = [e.clientX, e.clientY]; };
function onUp(e) {
  if (!downAt || Math.hypot(e.clientX - downAt[0], e.clientY - downAt[1]) > 4) return;
  const r = renderer.domElement.getBoundingClientRect();
  raycaster.setFromCamera(new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -(((e.clientY - r.top) / r.height) * 2 - 1)), camera);
  const lineHit = hingeLines && fs.view.showHinges ? raycaster.intersectObject(hingeLines)[0] : null;
  const meshHit = mesh ? raycaster.intersectObject(mesh)[0] : null;
  if (lineHit && (!meshHit || lineHit.distance <= meshHit.distance + 2)) {
    fs.selected.connId = hingeLines.userData.conns[Math.floor(lineHit.index / 2)]; fs.rightTab = 'connection';
  } else if (meshHit) {
    const part = partOfTri[meshHit.faceIndex];
    if (part?.kind === 'region') fs.selected.regionId = part.id; else if (part) fs.selected.connId = part.id;
  }
  fs.version++;
}

function loop() { anim = requestAnimationFrame(loop); controls.update(); renderer.render(scene, camera); }

onMounted(() => { init(); updatePositions(); });
watch(() => fs.version, updatePositions);
watch(() => [fs.view.thickness, fs.view.showHinges, fs.view.showFlat, fs.view.showCollisions, fs.selected.stepId, fs.selected.connId, fs.selected.regionId], updatePositions);
onBeforeUnmount(() => {
  cancelAnimationFrame(anim); ro?.disconnect();
  [mesh, hingeLines, flatLines, collisionPts].forEach(disposeObj);
  controls?.dispose(); renderer?.dispose(); renderer?.domElement.remove();
});
defineExpose({ resetView: () => { fitted = null; updatePositions(); } });
</script>

<template>
  <div ref="host" class="vp"></div>
</template>

<style scoped>
.vp { position: relative; width: 100%; height: 100%; min-height: 200px; background: var(--canvas-bg); overflow: hidden; }
.vp :deep(canvas) { display: block; width: 100%; height: 100%; }
</style>
