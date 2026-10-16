<script setup>
import { ref } from 'vue';
import { fs, exportCurrent, exportBundle, saveWaypoint } from '../../foldingStore.js';
const msg = ref('');
const go = (k) => { const r = exportCurrent(k); msg.value = r.ok === false ? r.message : r.stats ? `${r.stats.triangles} triangles · ${r.stats.manifold ? 'manifold' : r.stats.boundaryEdges + ' open edges'}${r.note ? ' — ' + r.note : ''}` : 'exported'; };
const bundle = () => { const r = exportBundle(); msg.value = r.ok ? `Wrote ${r.files.join(', ')}` : r.message; };
</script>

<template>
  <div class="ep">
    <h4>Current configuration</h4>
    <div class="row"><button @click="go('glb')">GLB (metres)</button><button @click="go('stl')">STL (mm)</button><button @click="go('json')">JSON + diagnostics</button></div>
    <h4>Animation for Blender</h4>
    <button @click="bundle">Export bundle (4 files)</button>
    <p class="note">Import with <code>tools/blender/import_folding_bundle.py</code>. 1 Blender unit = 1 mm. Every step must be solved first.</p>
    <p v-if="msg" class="msg">{{ msg }}</p>
    <p class="note">Exports are geometric. STL is never marked print-ready: check manifoldness, self-intersection and minimum feature size separately. Panels use {{ fs.physical.panelThicknessMm }} mm, hinge bands {{ fs.physical.hingeThicknessMm }} mm.</p>
  </div>
</template>

<style scoped>
.ep { padding: 10px; font-size: 12px; display: flex; flex-direction: column; gap: 8px; } h4 { margin: 4px 0 0; font: 600 11px 'DM Mono', monospace; letter-spacing: .06em; text-transform: uppercase; color: var(--sub); }
.row { display: flex; flex-wrap: wrap; gap: 6px; } button { background: var(--bg); color: var(--t); border: 1px solid var(--bd); border-radius: 5px; padding: 5px 9px; font: 500 11px 'DM Sans', sans-serif; cursor: pointer; align-self: flex-start; }
.note { color: var(--sub); line-height: 1.4; margin: 0; } .msg { color: var(--t); margin: 0; } code { font: 11px 'DM Mono', monospace; }
</style>
