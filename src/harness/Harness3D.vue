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
const GND = 0x9aa7ba;
const DATA = 0x4fd1e8;
const CLK = 0x7bd88f;

const V = (p) => new THREE.Vector3(p.x, p.y, p.z || 0);

// colour for conductor k in an N-wire bundle: 5V, GND, Data, (Clk)
function wireColor(k) {
  return k === 0 ? POWER : k === 1 ? GND : k === 2 ? DATA : CLK;
}

function mat(color) { return new THREE.MeshStandardMaterial({ color, roughness: 0.55, metalness: 0.1 }); }

function straightTube(a, b, radius, color) {
  const curve = new THREE.LineCurve3(V(a), V(b));
  return new THREE.Mesh(new THREE.TubeGeometry(curve, 1, radius, 10, false), mat(color));
}

function node3d(radius, color) {
  return new THREE.Mesh(new THREE.SphereGeometry(radius, 16, 12), mat(color));
}

// One conductor following a helix around the axis a->b at the given radius,
// phase, and number of turns. turns=0 gives a straight offset wire.
function wireHelix(a, b, radius, turns, phase, wireRadius, color) {
  const A = V(a), B = V(b);
  const axis = new THREE.Vector3().subVectors(B, A);
  const len = axis.length();
  if (len < 1e-3) return null;
  axis.normalize();
  const ref = Math.abs(axis.y) < 0.99 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0);
  const u = new THREE.Vector3().crossVectors(axis, ref).normalize();
  const v = new THREE.Vector3().crossVectors(axis, u).normalize();
  const segs = Math.max(2, Math.ceil(Math.abs(turns) * 24) || 2);
  const pts = [];
  for (let i = 0; i <= segs; i++) {
    const t = i / segs;
    const ang = 2 * Math.PI * turns * t + phase;
    const c = new THREE.Vector3().copy(A).addScaledVector(axis, len * t);
    c.addScaledVector(u, radius * Math.cos(ang));
    c.addScaledVector(v, radius * Math.sin(ang));
    pts.push(c);
  }
  const curve = new THREE.CatmullRomCurve3(pts);
  return new THREE.Mesh(new THREE.TubeGeometry(curve, segs, wireRadius, 6, false), mat(color));
}

// A twisted bundle of `count` conductors along a->b. If coreR > 0 a central
// core is drawn and the wires wind around it; otherwise the wires twist
// directly together at `radius`.
function bundle(group, a, b, { count, radius, coreR, twistPerMm, wireRadius }) {
  const len = V(a).distanceTo(V(b));
  const turns = twistPerMm * len;
  if (coreR > 0) group.add(straightTube(a, b, coreR, CORE));
  for (let k = 0; k < count; k++) {
    const w = wireHelix(a, b, radius, turns, (2 * Math.PI * k) / count, wireRadius, wireColor(k));
    if (w) group.add(w);
  }
}

function disposeGroup(g) {
  g.traverse((o) => { if (o.geometry) o.geometry.dispose(); if (o.material) o.material.dispose(); });
}

function build() {
  if (harnessGroup) { scene.remove(harnessGroup); disposeGroup(harnessGroup); }
  harnessGroup = new THREE.Group();
  const m = props.model;
  const twistPerMm = (m.twist || 0) / 1000;
  const coreN = m.coreWires || 4;
  const coreR = m.coreRadius || 2;
  const wR = Math.max(0.25, (m.wireRadius || 0.8) * 0.9);
  const coreCenterR = Math.max(0.4, coreR - (m.wireRadius || 0.8));

  const cp = m.corePts;
  // core segments: bundle wound around a central core
  for (let i = 1; i < cp.length; i++) {
    bundle(harnessGroup, cp[i - 1], cp[i], { count: coreN, radius: coreR, coreR: coreCenterR, twistPerMm, wireRadius: wR });
  }

  // driver box
  const driver = new THREE.Mesh(new THREE.BoxGeometry(14, 8, 10), new THREE.MeshStandardMaterial({ color: 0x101826, roughness: 0.8 }));
  driver.position.copy(V(cp[0]));
  harnessGroup.add(driver);

  // stems: wires twisted directly together (no central core)
  m.nodes.forEach((n) => {
    const nd = node3d(coreR * 0.9, CORE); nd.position.copy(V(n.base)); harnessGroup.add(nd);
    bundle(harnessGroup, n.base, n.tip, { count: n.wires, radius: n.radius, coreR: 0, twistPerMm, wireRadius: wR });
    const tip = node3d(n.radius + wR, POWER); tip.position.copy(V(n.tip)); harnessGroup.add(tip);
  });

  // fork
  if (m.fork) {
    const last = cp[cp.length - 1];
    bundle(harnessGroup, last, m.fork.point, { count: N, radius: coreR, coreR: coreCenterR, twistPerMm, wireRadius: wR });
    const fpNode = node3d(coreR * 0.9, CORE); fpNode.position.copy(V(m.fork.point)); harnessGroup.add(fpNode);
    m.fork.arms.forEach((arm) => {
      bundle(harnessGroup, arm.base, arm.tip, { count: arm.wires, radius: arm.radius, coreR: 0, twistPerMm, wireRadius: wR });
      const t = node3d(arm.radius + wR, arm.powerTap ? POWER : DATA); t.position.copy(V(arm.tip)); harnessGroup.add(t);
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
