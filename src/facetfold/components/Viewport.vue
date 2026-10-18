<script setup>
// 3D view. Folded: each printed panel is posed by the folding engine at fold progress s (angles = s·φ).
// Plate: the exact print layout, flat on the bed, with the bed outline.
import { ref, onMounted, onBeforeUnmount, watch } from 'vue';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { evaluatePoses } from '@hyphi/folding';
import { state, raw } from '../store.js';

const host = ref(null);
let renderer, scene, camera, controls, group, ro, anim = 0, fitKey = '';
const raycaster = new THREE.Raycaster();
const PAL = i => new THREE.Color().setHSL((i * 0.137) % 1, 0.5, 0.62);

function init() {
  const w = host.value.clientWidth || 600, h = host.value.clientHeight || 400;
  renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1)); renderer.setSize(w, h); host.value.appendChild(renderer.domElement);
  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(35, w / h, 0.5, 8000); camera.up.set(0, 0, 1);
  controls = new OrbitControls(camera, renderer.domElement); controls.enableDamping = true;
  scene.add(new THREE.HemisphereLight(0xffffff, 0x444466, 1.0));
  const dl = new THREE.DirectionalLight(0xffffff, 1.1); dl.position.set(120, -80, 200); scene.add(dl);
  group = new THREE.Group(); scene.add(group);
  let down = null;
  renderer.domElement.addEventListener('pointerdown', e => { down = [e.clientX, e.clientY]; });
  renderer.domElement.addEventListener('pointerup', e => { if (down && Math.hypot(e.clientX - down[0], e.clientY - down[1]) < 4) pick(e); });
  ro = new ResizeObserver(resize); ro.observe(host.value);
  const loop = () => { anim = requestAnimationFrame(loop); controls.update(); renderer.render(scene, camera); }; loop();
}
function resize() { if (!renderer) return; const w = host.value.clientWidth, h = host.value.clientHeight; if (!w || !h) return; renderer.setSize(w, h); camera.aspect = w / h; camera.updateProjectionMatrix(); }

function geom(mesh) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(mesh.positions), 3));
  g.setIndex(Array.from(mesh.indices)); g.computeVertexNormals(); return g;
}
function clear() { for (const c of [...group.children]) { group.remove(c); c.traverse?.(o => { o.geometry?.dispose?.(); o.material?.dispose?.(); }); } }

function rebuild() {
  clear();
  const net = raw.net, M = raw.meshes; if (!net || !M) return;
  const folded = state.view === 'folded';
  if (folded) {
    const compiled = raw.verify.compiled;
    const angles = compiled.variableConnIds.map(id => state.fold * compiled.connIndex.get(id).source.phi);
    const poses = evaluatePoses(compiled, angles);
    const mat = id => { const P = poses.get(`f${id}`), R = P.R, t = P.t; return new THREE.Matrix4().set(R[0], R[1], R[2], t[0], R[3], R[4], R[5], t[1], R[6], R[7], R[8], t[2], 0, 0, 0, 1); };
    for (const [fid, mesh] of M.panels) {
      const sel = fid === state.selectedFace, isPort = raw.solid?.portFace === fid;
      const painted = state.colors.mode !== 'single' && raw.faceColors?.length;
      const col = painted ? new THREE.Color(state.colors.palette[raw.faceColors[fid]]?.hex ?? '#888888') : isPort ? new THREE.Color(0x3fbf7f) : PAL(fid);
      const o = new THREE.Mesh(geom(mesh), new THREE.MeshStandardMaterial({ color: sel ? col.clone().lerp(new THREE.Color(0xffffff), 0.5) : col, roughness: 0.55, transparent: true, opacity: 0.9, side: THREE.DoubleSide }));
      o.matrixAutoUpdate = false; o.matrix.copy(mat(fid)); o.userData.face = fid; group.add(o);
    }
    // Strips are rigid in this preview and cannot show the bend, so they are drawn only while the net is nearly flat.
    if (state.fold < 0.03) net.hinges.forEach((h, i) => { const m = M.strips[i]; if (!m) return; const o = new THREE.Mesh(geom(m), new THREE.MeshStandardMaterial({ color: 0xf5d76e })); o.matrixAutoUpdate = false; o.matrix.copy(mat(h.parent)); group.add(o); });
  } else {
    if (M.bodies.length) M.bodies.forEach(b => group.add(new THREE.Mesh(geom(b.mesh), new THREE.MeshStandardMaterial({ color: new THREE.Color(state.colors.palette[b.color]?.hex ?? '#888888'), roughness: 0.6, side: THREE.DoubleSide }))));
    else M.components.forEach((m, i) => { const o = new THREE.Mesh(geom(m), new THREE.MeshStandardMaterial({ color: 0x9fb4ff, roughness: 0.6, side: THREE.DoubleSide })); group.add(o); });
    for (const [fid, mesh] of M.panels) { /* per-face pick targets are the component meshes; faces are selected from the list */ void fid; void mesh; }
    const [bw, bh] = state.bedMm; const pts = [0, 0, 0, bw, 0, 0, bw, 0, 0, bw, bh, 0, bw, bh, 0, 0, bh, 0, 0, bh, 0, 0, 0, 0];
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    group.add(new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: 0x7a7a9a })));
  }
  const box = new THREE.Box3().setFromObject(group);
  if (!box.isEmpty()) {
    const key = `${state.view}:${state.solidId}:${state.faceCount}:${state.view === 'plate' ? state.bedMm.join() : ''}`;
    if (key !== fitKey) { fitKey = key; frame(state.view === 'plate' ? new THREE.Box3(new THREE.Vector3(0, 0, 0), new THREE.Vector3(Math.min(state.bedMm[0], 400), Math.min(state.bedMm[1], 400), 3)).union(box) : box, state.view === 'plate'); }
  }
}

function frame(box, top) {
  const ctr = box.getCenter(new THREE.Vector3()), r = Math.max(box.getSize(new THREE.Vector3()).length() / 2, 1);
  const vfov = (camera.fov * Math.PI) / 180, hfov = 2 * Math.atan(Math.tan(vfov / 2) * camera.aspect);
  const dist = (r / Math.sin(Math.min(vfov, hfov) / 2)) * 1.1;
  controls.target.copy(ctr);
  const dir = top ? new THREE.Vector3(0.001, -0.02, 1) : new THREE.Vector3(0.62, -0.72, 0.58);
  camera.position.copy(ctr).add(dir.normalize().multiplyScalar(dist)); camera.near = Math.max(dist / 200, 0.1); camera.far = dist * 20; camera.updateProjectionMatrix(); controls.update();
}

function pick(e) {
  if (state.view !== 'folded') return;
  const r = renderer.domElement.getBoundingClientRect();
  raycaster.setFromCamera(new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -(((e.clientY - r.top) / r.height) * 2 - 1)), camera);
  const hit = raycaster.intersectObjects(group.children.filter(o => o.userData.face !== undefined))[0];
  if (hit) state.selectedFace = hit.object.userData.face;
}

onMounted(() => { init(); rebuild(); });
watch(() => [state.version, state.view, state.fold, state.selectedFace], rebuild);
onBeforeUnmount(() => { cancelAnimationFrame(anim); ro?.disconnect(); if (group) clear(); controls?.dispose(); renderer?.dispose(); renderer?.domElement.remove(); });
</script>

<template>
  <div class="vp" ref="host">
    <div v-if="state.view === 'folded'" class="fold">
      <span>Flat</span><input type="range" min="0" max="1" step="0.005" v-model.number="state.fold" /><span>Closed</span>
      <b>{{ Math.round(state.fold * 100) }}%</b>
    </div>
    <div v-if="state.view === 'folded' && state.fold >= 0.03" class="cap">Hinge strips are hidden while folded (the preview poses rigid panels). Slide to Flat to see them.</div>
    <div v-if="state.view === 'plate'" class="cap">Printed outer-face-down. Outer surfaces touch the bed; walls lean inward going up (no supports).</div>
  </div>
</template>

<style scoped>
.vp { position:absolute; inset:0; background:var(--canvas-bg); overflow:hidden; }
.vp :deep(canvas) { display:block; width:100%; height:100%; }
.fold { position:absolute; left:50%; bottom:14px; transform:translateX(-50%); display:flex; align-items:center; gap:10px; background:rgba(0,0,0,.45); color:#ddd; padding:6px 14px; border-radius:20px; font-size:12px; width:min(440px, 90%); }
.fold input { flex:1; }
.cap { position:absolute; left:12px; top:10px; color:var(--sub); font-size:12px; background:rgba(0,0,0,.35); padding:4px 8px; border-radius:6px; }
</style>
