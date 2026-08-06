<script setup>
import { ref, onMounted, onBeforeUnmount, watch, defineExpose } from 'vue';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';

const props = defineProps({ model: { type: Object, required: true } });

const host = ref(null);
let renderer, scene, camera, controls, raf, ro;
let harnessGroup = null;

const CORE = 0x5b6b82;
const POWER = 0xf5a623;
const DATA = 0x4fd1e8;

const V = (p) => new THREE.Vector3(p.x, p.y, p.z || 0);

function tube(a, b, radius, color) {
  const curve = new THREE.LineCurve3(V(a), V(b));
  const geo = new THREE.TubeGeometry(curve, 1, radius, 10, false);
  return new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color, roughness: 0.6, metalness: 0.1 }));
}

// A helical tube wound around the axis a->b, used to show twisted data pairs.
function helix(a, b, radius, turns, wireRadius, color) {
  const A = V(a), B = V(b);
  const axis = new THREE.Vector3().subVectors(B, A);
  const len = axis.length();
  if (len < 1e-3) return null;
  axis.normalize();
  // perpendicular basis
  const ref = Math.abs(axis.y) < 0.99 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0);
  const u = new THREE.Vector3().crossVectors(axis, ref).normalize();
  const v = new THREE.Vector3().crossVectors(axis, u).normalize();
  const segs = Math.max(8, Math.ceil(Math.abs(turns) * 24));
  const pts = [];
  for (let i = 0; i <= segs; i++) {
    const t = i / segs;
    const ang = 2 * Math.PI * turns * t;
    const center = new THREE.Vector3().copy(A).addScaledVector(axis, len * t);
    center.addScaledVector(u, radius * Math.cos(ang));
    center.addScaledVector(v, radius * Math.sin(ang));
    pts.push(center);
  }
  const curve = new THREE.CatmullRomCurve3(pts);
  const geo = new THREE.TubeGeometry(curve, segs, wireRadius, 6, false);
  return new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color, roughness: 0.5, metalness: 0.1 }));
}

function node3d(radius, color) {
  return new THREE.Mesh(new THREE.SphereGeometry(radius, 16, 12), new THREE.MeshStandardMaterial({ color, roughness: 0.5 }));
}

function build() {
  if (harnessGroup) { scene.remove(harnessGroup); disposeGroup(harnessGroup); }
  harnessGroup = new THREE.Group();
  const m = props.model;
  const twistTurnsPerMm = (m.twist || 0) / 1000;
  const bundleR = Math.max(0.8, (m.bundleDia || 4) / 2);

  const cp = m.corePts;
  // core segments as thick tubes; data helix wound around each if twisted
  for (let i = 1; i < cp.length; i++) {
    harnessGroup.add(tube(cp[i - 1], cp[i], bundleR, CORE));
    if (twistTurnsPerMm > 0) {
      const segLen = V(cp[i]).distanceTo(V(cp[i - 1]));
      const turns = twistTurnsPerMm * segLen;
      const h = helix(cp[i - 1], cp[i], bundleR + 0.6, turns, 0.35, DATA);
      if (h) harnessGroup.add(h);
    }
  }

  // driver box
  const d = cp[0];
  const driver = new THREE.Mesh(new THREE.BoxGeometry(14, 8, 10), new THREE.MeshStandardMaterial({ color: 0x101826, roughness: 0.8 }));
  driver.position.copy(V(d));
  harnessGroup.add(driver);

  // stem branches
  m.nodes.forEach((n) => {
    const nd = node3d(1.4, CORE);
    nd.position.copy(V(n.base));
    harnessGroup.add(nd);
    if (n.powerTap) harnessGroup.add(tube(n.base, n.tip, 1.0, POWER));
    if (n.hasData) harnessGroup.add(tube(n.base, n.tip, 0.5, DATA));
    const tip = node3d(2.2, POWER); tip.position.copy(V(n.tip)); harnessGroup.add(tip);
  });

  // fork
  if (m.fork) {
    const last = cp[cp.length - 1];
    harnessGroup.add(tube(last, m.fork.point, bundleR, CORE));
    if (twistTurnsPerMm > 0) {
      const segLen = V(m.fork.point).distanceTo(V(last));
      const h = helix(last, m.fork.point, bundleR + 0.6, twistTurnsPerMm * segLen, 0.35, DATA);
      if (h) harnessGroup.add(h);
    }
    const fpNode = node3d(1.4, CORE); fpNode.position.copy(V(m.fork.point)); harnessGroup.add(fpNode);
    m.fork.arms.forEach((arm) => {
      if (arm.powerTap) harnessGroup.add(tube(arm.base, arm.tip, 1.0, POWER));
      if (arm.hasData) harnessGroup.add(tube(arm.base, arm.tip, 0.5, DATA));
      const t = node3d(2.2, arm.powerTap ? POWER : DATA); t.position.copy(V(arm.tip)); harnessGroup.add(t);
    });
  }

  scene.add(harnessGroup);
  frameCamera();
}

function frameCamera() {
  const box = new THREE.Box3().setFromObject(harnessGroup);
  const center = box.getCenter(new THREE.Vector3());
  const size = box.getSize(new THREE.Vector3());
  const maxDim = Math.max(size.x, size.y, size.z, 50);
  controls.target.copy(center);
  camera.position.set(center.x + maxDim * 0.8, center.y, center.z + maxDim * 1.4);
  camera.near = maxDim / 100;
  camera.far = maxDim * 20;
  camera.updateProjectionMatrix();
  controls.update();
}

function disposeGroup(g) {
  g.traverse((o) => {
    if (o.geometry) o.geometry.dispose();
    if (o.material) o.material.dispose();
  });
}

function init() {
  const el = host.value;
  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0d1420);

  camera = new THREE.PerspectiveCamera(45, el.clientWidth / el.clientHeight, 1, 5000);
  renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(el.clientWidth, el.clientHeight);
  el.appendChild(renderer.domElement);

  controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;

  scene.add(new THREE.AmbientLight(0xffffff, 0.6));
  const key = new THREE.DirectionalLight(0xffffff, 0.9);
  key.position.set(1, 1, 1);
  scene.add(key);
  const rim = new THREE.DirectionalLight(0x4fd1e8, 0.4);
  rim.position.set(-1, 0.5, -1);
  scene.add(rim);

  build();

  const loop = () => { raf = requestAnimationFrame(loop); controls.update(); renderer.render(scene, camera); };
  loop();

  ro = new ResizeObserver(() => {
    if (!el.clientWidth) return;
    camera.aspect = el.clientWidth / el.clientHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(el.clientWidth, el.clientHeight);
  });
  ro.observe(el);
}

function exportGLB() {
  const exporter = new GLTFExporter();
  exporter.parse(harnessGroup, (result) => {
    const blob = new Blob([result], { type: 'model/gltf-binary' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = 'harness.glb';
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }, (err) => console.error('GLB export failed', err), { binary: true });
}
defineExpose({ exportGLB });

onMounted(init);
onBeforeUnmount(() => {
  cancelAnimationFrame(raf);
  if (ro) ro.disconnect();
  if (harnessGroup) disposeGroup(harnessGroup);
  if (renderer) { renderer.dispose(); renderer.domElement.remove(); }
});

watch(() => props.model, () => { if (scene) build(); }, { deep: true });
</script>

<template>
  <div ref="host" class="harness-3d" />
</template>
