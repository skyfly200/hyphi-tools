<script setup>
import { ref, computed } from 'vue';
import {
  state, geometry, currentLED, currentConnector, requiredWireCount,
  savePatchAs, loadPatchByName, deletePatchByName,
  exportCurrentPatchJSON, importPatchJSON,
} from '../store.js';
import { buildDXF } from '../lib/dxf.js';
import { buildKiCadPCB } from '../lib/kicad.js';
import { buildSVGLayers } from '../lib/svgLayers.js';
import { buildZip } from '../lib/zip.js';

const saveName = ref('');
const importErr = ref('');

function downloadBlob(filename, mime, content) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function suggestedFilename(ext) {
  const poly = state.params.polyhedronId;
  const edge = state.params.edgeLengthMm;
  const stem = state.currentPatch ? state.currentPatch : `${poly}-${edge}mm`;
  return `${stem.replace(/\s+/g, '_')}.${ext}`;
}

function doSave() {
  const name = (saveName.value || state.currentPatch || '').trim();
  if (!name) return;
  savePatchAs(name);
  saveName.value = '';
}

function doExportPatch() {
  downloadBlob(suggestedFilename('polyforge.json'), 'application/json',
    exportCurrentPatchJSON());
}

function doExportDXF() {
  // Convert net units (normalized edge length) into millimeters.
  const scale = state.params.edgeLengthMm;
  const dxf = buildDXF({
    net: geometry.value.net,
    ledFootprint: state.prefs.showLEDs ? currentLED.value : null,
    ledsPerFace: state.params.ledsPerFace,
    connector: state.prefs.showConnector ? currentConnector.value : null,
    connectorFaceIdx: state.params.connectorFaceIdx,
    wireCount: requiredWireCount.value,
    solderPad: state.params.solderPad,
    mountingHole: state.params.mountingHole,
    panel: state.params.panel,
    scale,
  });
  downloadBlob(suggestedFilename('dxf'), 'application/dxf', dxf);
}

function doExportKiCad() {
  const text = buildKiCadPCB({
    net: geometry.value.net,
    edgeLengthMm: state.params.edgeLengthMm,
    led: currentLED.value,
    ledsPerFace: state.params.ledsPerFace,
    connector: currentConnector.value,
    connectorFaceIdx: state.params.connectorFaceIdx,
    wireCount: requiredWireCount.value,
    solderPad: state.params.solderPad,
    mountingHole: state.params.mountingHole,
    panel: state.params.panel,
  });
  downloadBlob(suggestedFilename('kicad_pcb'), 'application/octet-stream', text);
}

function doExportSVGZip() {
  const files = buildSVGLayers({
    net: geometry.value.net,
    edgeLengthMm: state.params.edgeLengthMm,
    led: currentLED.value,
    ledsPerFace: state.params.ledsPerFace,
    connector: currentConnector.value,
    connectorFaceIdx: state.params.connectorFaceIdx,
    wireCount: requiredWireCount.value,
    solderPad: state.params.solderPad,
    mountingHole: state.params.mountingHole,
    panel: state.params.panel,
  });
  const zip = buildZip(files);
  downloadBlob(suggestedFilename('svg.zip'), 'application/zip', zip);
}

function doImport(e) {
  const file = e.target.files?.[0];
  if (!file) return;
  importErr.value = '';
  const reader = new FileReader();
  reader.onload = () => {
    try {
      importPatchJSON(String(reader.result || ''));
    } catch (err) {
      importErr.value = err.message || 'Could not parse patch.';
    }
    e.target.value = '';
  };
  reader.readAsText(file);
}

const totalLEDs = computed(() =>
  geometry.value.built.faces.length * (state.params.ledsPerFace || 0));

const totalEdgesMm = computed(() => {
  const e = geometry.value.edges.length;
  return (e * state.params.edgeLengthMm).toFixed(1);
});

const netBox = computed(() => {
  const b = geometry.value.net.bbox;
  const s = state.params.edgeLengthMm;
  return { w: (b.width * s).toFixed(1), h: (b.height * s).toFixed(1) };
});
</script>

<template>
  <aside class="inspector">
    <section>
      <h4>Dimensions</h4>
      <dl>
        <dt>Faces</dt><dd>{{ geometry.built.faces.length }}</dd>
        <dt>Edges</dt><dd>{{ geometry.edges.length }}</dd>
        <dt>Total LEDs</dt><dd>{{ totalLEDs }}</dd>
        <dt>Wires in</dt><dd>{{ requiredWireCount }}</dd>
        <dt>Total edge length</dt><dd>{{ totalEdgesMm }} mm</dd>
        <dt>Net bbox</dt><dd>{{ netBox.w }} × {{ netBox.h }} mm</dd>
        <dt>Dihedral angle</dt><dd>{{ geometry.poly.dihedralDeg.toFixed(2) }}°</dd>
      </dl>
    </section>

    <section v-if="state.selectedFace != null">
      <h4>Face {{ state.selectedFace }}</h4>
      <dl>
        <dt>Sides</dt><dd>{{ geometry.built.faces[state.selectedFace].length }}</dd>
        <dt>Root</dt><dd>{{ state.selectedFace === state.rootFace ? 'yes' : 'no' }}</dd>
        <dt>Connector here</dt><dd>{{ state.selectedFace === state.params.connectorFaceIdx ? 'yes' : 'no' }}</dd>
      </dl>
      <div class="row">
        <button class="link" @click="state.rootFace = state.selectedFace">Use as root</button>
        <button class="link" @click="state.params.connectorFaceIdx = state.selectedFace">Mount connector here</button>
      </div>
    </section>

    <section>
      <h4>Patches</h4>
      <div class="row">
        <input v-model="saveName" :placeholder="state.currentPatch || 'patch name'" />
        <button class="primary" @click="doSave">Save</button>
      </div>
      <ul class="patch-list">
        <li v-for="p in state.patchList" :key="p">
          <span class="name">{{ p }}</span>
          <button class="link" @click="loadPatchByName(p)">Load</button>
          <button class="danger" @click="deletePatchByName(p)">×</button>
        </li>
        <li v-if="!state.patchList.length" class="empty">No saved patches yet.</li>
      </ul>
    </section>

    <section>
      <h4>Export / Import</h4>
      <div class="row">
        <button @click="doExportPatch">Patch (.json)</button>
        <button @click="doExportDXF">DXF</button>
        <button @click="doExportKiCad">KiCad PCB</button>
        <button @click="doExportSVGZip">SVG layers (.zip)</button>
      </div>
      <label class="filebtn">
        Import patch (.json)
        <input type="file" accept=".json,application/json" @change="doImport" hidden />
      </label>
      <div v-if="importErr" class="err">{{ importErr }}</div>
    </section>
  </aside>
</template>

<style scoped>
.inspector { width: 280px; background: var(--s); border-left: 1px solid var(--bd); padding: 14px; overflow-y: auto; display: flex; flex-direction: column; gap: 14px; }
section { display: flex; flex-direction: column; gap: 8px; padding-bottom: 12px; border-bottom: 1px solid var(--bd); }
section:last-child { border-bottom: none; }
h4 { margin: 0; font: 500 0.78rem 'DM Sans'; color: var(--ac2); }
dl { display: grid; grid-template-columns: 1fr auto; gap: 3px 12px; margin: 0; font: 400 0.78rem 'DM Sans'; }
dt { color: var(--sub); }
dd { color: var(--t); margin: 0; font-family: 'DM Mono', monospace; }
.row { display: flex; gap: 6px; align-items: center; flex-wrap: wrap; }
input { background: var(--bg); color: var(--t); border: 1px solid var(--bd); border-radius: 6px; padding: 6px 8px; font: 400 0.82rem 'DM Sans'; flex: 1; min-width: 0; }
button { background: var(--bg); color: var(--t); border: 1px solid var(--bd); border-radius: 6px; padding: 6px 9px; font: 500 0.75rem 'DM Sans'; cursor: pointer; }
button:hover { border-color: var(--ac2); }
button.primary { background: var(--ac2); border-color: var(--ac2); color: #fff; }
button.link { background: none; border: none; color: var(--ac2); padding: 4px 0; font-weight: 500; }
button.link:hover { text-decoration: underline; }
button.danger { color: var(--ac); padding: 4px 6px; border-color: transparent; }
.patch-list { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 2px; }
.patch-list li { display: grid; grid-template-columns: 1fr auto auto; gap: 6px; align-items: center; padding: 4px 6px; border-radius: 5px; }
.patch-list li:hover { background: var(--acd); }
.patch-list .name { font: 500 0.78rem 'DM Mono', monospace; }
.patch-list .empty { font: 400 0.75rem 'DM Sans'; color: var(--sub); }
.filebtn { display: inline-flex; gap: 6px; align-items: center; background: var(--bg); border: 1px solid var(--bd); border-radius: 6px; padding: 6px 9px; font: 500 0.75rem 'DM Sans'; cursor: pointer; }
.filebtn:hover { border-color: var(--ac2); }
.err { color: var(--ac); font: 500 0.72rem 'DM Mono', monospace; }
</style>
