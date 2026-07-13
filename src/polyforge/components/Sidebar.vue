<script setup>
import { computed } from 'vue';
import { state, geometry, requiredWireCount, compatibleConnectors, setPolyhedron, setDesignRulesFromText } from '../store.js';
import { listPolyhedra } from '../lib/polyhedra.js';
import { listLEDs } from '../lib/leds.js';
import { CONNECTOR_PLACEMENTS } from '../lib/connectors.js';
import { bridgeTraceCount, computeBridgeWidthMm } from '../lib/layout.js';

const polyhedra = listPolyhedra();
const leds = listLEDs();
const connectors = computed(() => compatibleConnectors().map(c => ({
  id: c.id,
  label: c.id === 'PAD_ONLY' ? `${c.label} (${requiredWireCount.value} pads)` : c.label,
})));
const placements = CONNECTOR_PLACEMENTS;

const faceCount = computed(() => geometry.value.built.faces.length);
const faceIndices = computed(() => Array.from({ length: faceCount.value }, (_, i) => i));

const bridgeTraces = computed(() => bridgeTraceCount(requiredWireCount.value));
const derivedBridgeWidth = computed(() =>
  computeBridgeWidthMm(bridgeTraces.value, state.params.designRules));
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
        <select v-model="state.params.panel.shape">
          <option value="face">Face polygon (full or inset)</option>
          <option value="circle">Inscribed circle</option>
          <option value="hexagon">Inscribed hexagon</option>
        </select>
      </label>
      <label>Inset (mm)
        <input type="number" min="0" max="50" step="0.5"
               :value="state.params.panel.insetMm"
               @input="state.params.panel.insetMm = Math.max(0, Number($event.target.value) || 0)" />
      </label>
      <label v-if="state.params.panel.shape === 'face'">
        Corner radius (mm)
        <input type="number" min="0" max="50" step="0.5"
               :value="state.params.panel.cornerRadiusMm"
               @input="state.params.panel.cornerRadiusMm = Math.max(0, Number($event.target.value) || 0)" />
      </label>
      <label v-else>
        Scale (× inscribed radius)
        <input type="number" min="0.1" max="1" step="0.01"
               :value="state.params.panel.scale"
               @input="state.params.panel.scale = Math.min(1, Math.max(0.1, Number($event.target.value) || 0.1))" />
      </label>

      <fieldset class="subsec">
        <legend>Bridges (flex hinges)</legend>
        <label class="inline">
          <input type="checkbox" v-model="state.params.panel.bridge.enabled" />
          Connect adjacent panels
        </label>
        <template v-if="state.params.panel.bridge.enabled">
          <label>Pattern
            <select v-model="state.params.panel.bridge.style">
              <option value="straight">Straight</option>
              <option value="s-curve">S-curve (tighter folds)</option>
            </select>
          </label>
          <label v-if="state.params.panel.bridge.style === 's-curve'">
            Curve amplitude (mm)
            <input type="number" min="0.5" max="30" step="0.5"
                   :value="state.params.panel.bridge.curveAmplitudeMm"
                   @input="state.params.panel.bridge.curveAmplitudeMm = Math.max(0.5, Number($event.target.value) || 0.5)" />
          </label>
          <div class="hint-row">
            Each bridge spans panel-center to panel-center across the
            fold, so it always reaches both panels regardless of inset.
            The S-curve pattern adds slack material so the hinge can
            wrap a tighter bend radius. Width auto-sized from design
            rules: <strong>{{ derivedBridgeWidth.toFixed(2) }} mm</strong>
            ({{ bridgeTraces }} traces)
          </div>
        </template>
      </fieldset>

      <fieldset class="subsec">
        <legend>Routing</legend>
        <label class="inline">
          <input type="checkbox" v-model="state.params.routing.enabled" />
          Auto-route VCC / GND / DATA
        </label>
        <div v-if="state.params.routing.enabled" class="hint-row">
          One pass of VCC + GND rails through every bridge, plus
          DIN / DOUT along the chain. Design-rule values control trace
          width + spacing.
        </div>
      </fieldset>
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
      <h4>Connector <span class="hint">· back layer</span></h4>
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

      <!-- Solder-pad sub-section: only meaningful for PAD_ONLY -->
      <fieldset v-if="state.params.connectorId === 'PAD_ONLY'" class="subsec">
        <legend>Solder pads · {{ requiredWireCount }} wire{{ requiredWireCount === 1 ? '' : 's' }}</legend>
        <label>Pad shape
          <select v-model="state.params.solderPad.shape">
            <option value="rect">Rectangle</option>
            <option value="circle">Circle</option>
          </select>
        </label>
        <template v-if="state.params.solderPad.shape === 'rect'">
          <label>Pad width (mm)
            <input type="number" min="0.2" max="20" step="0.1"
                   :value="state.params.solderPad.padWMm"
                   @input="state.params.solderPad.padWMm = Math.max(0.2, Number($event.target.value) || 0.2)" />
          </label>
          <label>Pad height (mm)
            <input type="number" min="0.2" max="20" step="0.1"
                   :value="state.params.solderPad.padHMm"
                   @input="state.params.solderPad.padHMm = Math.max(0.2, Number($event.target.value) || 0.2)" />
          </label>
        </template>
        <label v-else>Pad diameter (mm)
          <input type="number" min="0.2" max="20" step="0.1"
                 :value="state.params.solderPad.padDiaMm"
                 @input="state.params.solderPad.padDiaMm = Math.max(0.2, Number($event.target.value) || 0.2)" />
        </label>
        <label>Pad pitch (mm)
          <input type="number" min="0.5" max="20" step="0.1"
                 :value="state.params.solderPad.pitchMm"
                 @input="state.params.solderPad.pitchMm = Math.max(0.5, Number($event.target.value) || 0.5)" />
        </label>
        <label>Strip keepout (mm)
          <input type="number" min="0" max="10" step="0.1"
                 :value="state.params.solderPad.keepoutMm"
                 @input="state.params.solderPad.keepoutMm = Math.max(0, Number($event.target.value) || 0)" />
        </label>
      </fieldset>
    </section>

    <section>
      <h4>Mounting holes</h4>
      <label class="inline">
        <input type="checkbox" v-model="state.params.mountingHole.enabled" />
        Add mounting holes
      </label>
      <template v-if="state.params.mountingHole.enabled">
        <label>Position
          <select v-model="state.params.mountingHole.position">
            <option value="corners">One per face corner</option>
            <option value="center">One at face center</option>
          </select>
        </label>
        <label>Hole diameter (mm)
          <input type="number" min="0.5" max="20" step="0.1"
                 :value="state.params.mountingHole.diameterMm"
                 @input="state.params.mountingHole.diameterMm = Math.max(0.5, Number($event.target.value) || 0.5)" />
        </label>
        <label v-if="state.params.mountingHole.position === 'corners'">
          Corner inset (mm)
          <input type="number" min="0" max="50" step="0.5"
                 :value="state.params.mountingHole.marginMm"
                 @input="state.params.mountingHole.marginMm = Math.max(0, Number($event.target.value) || 0)" />
        </label>
      </template>
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
.subsec { margin: 4px 0 0; padding: 8px 10px 10px; border: 1px solid var(--bd); border-radius: 6px; display: flex; flex-direction: column; gap: 8px; }
.subsec legend { font: 500 0.7rem 'DM Mono', monospace; color: var(--ac2); padding: 0 6px; }
h4 .hint { font: 400 0.65rem 'DM Mono', monospace; color: var(--sub); }
.hint-row { font: 400 0.68rem 'DM Sans', sans-serif; color: var(--sub); padding: 4px 2px; line-height: 1.45; }
.hint-row strong { color: var(--t); font-weight: 500; font-family: 'DM Mono', monospace; }
</style>
