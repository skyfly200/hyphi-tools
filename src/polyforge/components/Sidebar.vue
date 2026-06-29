<script setup>
import { computed } from 'vue';
import { state, geometry, requiredWireCount, compatibleConnectors, setPolyhedron, setDesignRulesFromText } from '../store.js';
import { listPolyhedra } from '../lib/polyhedra.js';
import { listLEDs } from '../lib/leds.js';
import { CONNECTOR_PLACEMENTS } from '../lib/connectors.js';

const polyhedra = listPolyhedra();
const leds = listLEDs();
const connectors = computed(() => compatibleConnectors().map(c => ({
  id: c.id,
  label: c.id === 'PAD_ONLY' ? `${c.label} (${requiredWireCount.value} pads)` : c.label,
})));
const placements = CONNECTOR_PLACEMENTS;

const faceCount = computed(() => geometry.value.built.faces.length);
const faceIndices = computed(() => Array.from({ length: faceCount.value }, (_, i) => i));
</script>

<template>
  <aside class="sidebar">
    <section>
      <h4>Polyhedron</h4>
      <label>Shape
        <select :value="state.params.polyhedronId" @change="setPolyhedron($event.target.value)">
          <option v-for="p in polyhedra" :key="p.id" :value="p.id">{{ p.label }}</option>
        </select>
      </label>
      <label>Edge length (mm)
        <input type="number" min="5" max="500" step="1"
               :value="state.params.edgeLengthMm"
               @input="state.params.edgeLengthMm = Number($event.target.value) || 1" />
      </label>
      <label>Root face (lays flat in the net)
        <select :value="state.rootFace" @change="state.rootFace = Number($event.target.value)">
          <option v-for="i in faceIndices" :key="i" :value="i">Face {{ i }}</option>
        </select>
      </label>
    </section>

    <section>
      <h4>Panel</h4>
      <label>Shape
        <select v-model="state.params.panelShape">
          <option value="face">Full face polygon</option>
          <option value="circle">Inscribed circle</option>
          <option value="hexagon">Inscribed hexagon</option>
        </select>
      </label>
    </section>

    <section>
      <h4>LEDs</h4>
      <label>Type
        <select v-model="state.params.ledId">
          <option v-for="l in leds" :key="l.id" :value="l.id">{{ l.label }}</option>
        </select>
      </label>
      <label>Per face
        <input type="number" min="0" max="24" step="1"
               :value="state.params.ledsPerFace"
               @input="state.params.ledsPerFace = Math.max(0, Number($event.target.value) || 0)" />
      </label>
    </section>

    <section>
      <h4>Connector</h4>
      <label>Type
        <select v-model="state.params.connectorId">
          <option v-for="c in connectors" :key="c.id" :value="c.id">{{ c.label }}</option>
        </select>
      </label>
      <label>Mounted on face
        <select :value="state.params.connectorFaceIdx"
                @change="state.params.connectorFaceIdx = Number($event.target.value)">
          <option v-for="i in faceIndices" :key="i" :value="i">Face {{ i }}</option>
        </select>
      </label>
      <label>Placement
        <select v-model="state.params.connectorPlacement">
          <option v-for="p in placements" :key="p.id" :value="p.id">{{ p.label }}</option>
        </select>
      </label>
    </section>

    <section>
      <h4>Design rules</h4>
      <label>Trace width (mm)
        <input type="number" min="0.05" max="5" step="0.05"
               :value="state.params.designRules.traceWidthMm"
               @input="state.params.designRules.traceWidthMm = Number($event.target.value) || 0.05" />
      </label>
      <label>Clearance (mm)
        <input type="number" min="0.05" max="5" step="0.05"
               :value="state.params.designRules.clearanceMm"
               @input="state.params.designRules.clearanceMm = Number($event.target.value) || 0.05" />
      </label>
      <label>Edge margin (mm)
        <input type="number" min="0" max="10" step="0.1"
               :value="state.params.designRules.edgeMarginMm"
               @input="state.params.designRules.edgeMarginMm = Number($event.target.value) || 0" />
      </label>
      <label>Signals per trace
        <input type="number" min="1" max="8" step="1"
               :value="state.params.designRules.signalsPerTrace"
               @input="state.params.designRules.signalsPerTrace = Math.max(1, Number($event.target.value) || 1)" />
      </label>

      <details>
        <summary>Edit as JSON</summary>
        <textarea rows="6" :value="state.ui.designRulesText"
                  @input="setDesignRulesFromText($event.target.value)"></textarea>
        <div v-if="state.ui.designRulesError" class="err">{{ state.ui.designRulesError }}</div>
      </details>
    </section>

    <section>
      <h4>Display</h4>
      <label class="inline"><input type="checkbox" v-model="state.prefs.showFoldLines" /> Fold lines</label>
      <label class="inline"><input type="checkbox" v-model="state.prefs.showLEDs" /> LED footprints</label>
      <label class="inline"><input type="checkbox" v-model="state.prefs.showConnector" /> Connector keepout</label>
      <label class="inline"><input type="checkbox" v-model="state.prefs.showFaceLabels" /> Face labels</label>
    </section>
  </aside>
</template>

<style scoped>
.sidebar { width: 280px; background: var(--s); border-right: 1px solid var(--bd); padding: 14px; overflow-y: auto; display: flex; flex-direction: column; gap: 14px; }
section { display: flex; flex-direction: column; gap: 8px; padding-bottom: 12px; border-bottom: 1px solid var(--bd); }
section:last-child { border-bottom: none; }
h4 { margin: 0; font: 500 0.78rem 'DM Sans'; color: var(--ac2); }
label { display: flex; flex-direction: column; gap: 4px; font: 400 0.74rem 'DM Sans'; color: var(--sub); }
label.inline { flex-direction: row; align-items: center; gap: 6px; color: var(--t); }
input, select, textarea { background: var(--bg); color: var(--t); border: 1px solid var(--bd); border-radius: 6px; padding: 6px 8px; font: 400 0.82rem 'DM Sans'; }
textarea { font-family: 'DM Mono', monospace; font-size: 0.76rem; resize: vertical; }
details { font: 400 0.74rem 'DM Sans'; color: var(--sub); }
details summary { cursor: pointer; padding: 4px 0; }
.err { color: var(--ac); font: 500 0.72rem 'DM Mono', monospace; padding-top: 4px; }
</style>
