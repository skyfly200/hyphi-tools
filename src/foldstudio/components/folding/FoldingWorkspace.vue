<script setup>
// Fold Steps workspace: 2D design | 3D assembly | steps, classification, inspectors | timeline.
import { computed, onMounted } from 'vue';
import { fs, raw, closeWorkspace, rebuild, persist } from '../../foldingStore.js';
import Pattern2D from './Pattern2D.vue';
import Viewport3D from './Viewport3D.vue';
import StepList from './StepList.vue';
import ClassifyPanel from './ClassifyPanel.vue';
import StepInspector from './StepInspector.vue';
import ConnectionInspector from './ConnectionInspector.vue';
import DiagnosticsPanel from './DiagnosticsPanel.vue';
import MeasurementPanel from './MeasurementPanel.vue';
import ExportPanel from './ExportPanel.vue';
import Timeline from './Timeline.vue';

const RIGHT = [['step', 'Step'], ['connection', 'Crease'], ['diagnostics', 'Diagnostics'], ['measure', 'Measure'], ['export', 'Export']];
const blocked = computed(() => fs.ambiguous.length);
const phys = (k, v) => { fs.physical[k] = Math.max(0, Number(v) || 0); persist({ immediate: true, history: false }); rebuild(); };
onMounted(() => { if (blocked.value) fs.leftTab = 'classify'; });
</script>

<template>
  <div class="fw">
    <header class="bar">
      <button @click="closeWorkspace" class="back">← Crease pattern</button>
      <b class="ttl">Fold Steps</b>
      <label>Sheet <input type="number" min="1" :value="fs.physical.sheetMm" @change="phys('sheetMm', $event.target.value)" /> mm</label>
      <label>Panel <input type="number" min="0" step="0.05" :value="fs.physical.panelThicknessMm" @change="phys('panelThicknessMm', $event.target.value)" /> mm</label>
      <label>Hinge <input type="number" min="0" step="0.05" :value="fs.physical.hingeThicknessMm" @change="phys('hingeThicknessMm', $event.target.value)" /> mm thick</label>
      <label>Hinge width <input type="number" min="0" step="0.1" :value="fs.physical.hingeWidthMm" @change="phys('hingeWidthMm', $event.target.value)" /> mm</label>
      <label class="chk"><input type="checkbox" v-model="fs.view.thickness" /> show thickness</label>
      <span class="hash" v-if="fs.geometryHash" :title="'geometry ' + fs.geometryHash">{{ fs.geometryHash.slice(4, 12) }}</span>
    </header>

    <div v-if="blocked" class="banner">⚠ {{ blocked }} edge(s) are unassigned (U). Classify them in the <a href="#" @click.prevent="fs.leftTab = 'classify'">Classify</a> tab before solving.</div>
    <div v-else-if="raw.compiled && !raw.compiled.ok" class="banner err">The assembly has errors — see Diagnostics.</div>

    <div class="main">
      <aside class="left">
        <nav><button :class="{ on: fs.leftTab === 'steps' }" @click="fs.leftTab = 'steps'">Steps</button><button :class="{ on: fs.leftTab === 'classify' }" @click="fs.leftTab = 'classify'">Classify <i v-if="blocked">{{ blocked }}</i></button></nav>
        <StepList v-if="fs.leftTab === 'steps'" />
        <ClassifyPanel v-else />
      </aside>
      <section class="center">
        <div class="pane p2"><Pattern2D /></div>
        <div class="pane p3"><Viewport3D />
          <div class="vtools"><label><input type="checkbox" v-model="fs.view.showHinges" /> hinges</label><label><input type="checkbox" v-model="fs.view.showFlat" /> flat ref</label><label><input type="checkbox" v-model="fs.view.showCollisions" /> collisions</label></div>
        </div>
      </section>
      <aside class="right">
        <nav><button v-for="[k, l] in RIGHT" :key="k" :class="{ on: fs.rightTab === k }" @click="fs.rightTab = k">{{ l }}</button></nav>
        <StepInspector v-if="fs.rightTab === 'step'" />
        <ConnectionInspector v-else-if="fs.rightTab === 'connection'" />
        <DiagnosticsPanel v-else-if="fs.rightTab === 'diagnostics'" />
        <MeasurementPanel v-else-if="fs.rightTab === 'measure'" />
        <ExportPanel v-else />
      </aside>
    </div>
    <Timeline />
  </div>
</template>

<style scoped>
.fw { display: flex; flex-direction: column; flex: 1; min-height: 0; background: var(--bg); color: var(--t); }
.bar { display: flex; gap: 12px; align-items: center; padding: 7px 14px; background: var(--s); border-bottom: 1px solid var(--bd); flex-wrap: wrap; font-size: 12px; }
.ttl { font-family: 'Bebas Neue', sans-serif; letter-spacing: .05em; font-size: 1.1rem; }
.bar label { display: inline-flex; align-items: center; gap: 4px; color: var(--sub); } .bar input[type=number] { width: 64px; background: var(--bg); color: var(--t); border: 1px solid var(--bd); border-radius: 5px; padding: 3px 5px; }
.back, nav button { background: var(--bg); color: var(--t); border: 1px solid var(--bd); border-radius: 6px; padding: 5px 9px; font: 500 12px 'DM Sans', sans-serif; cursor: pointer; }
.hash { margin-left: auto; font: 11px 'DM Mono', monospace; color: var(--sub); }
.banner { padding: 6px 14px; background: rgba(245,166,35,.15); color: #f5a623; font-size: 12px; } .banner.err { background: rgba(255,82,82,.15); color: #ff5252; } .banner a { color: inherit; }
.main { display: flex; flex: 1; min-height: 0; }
.left { width: 280px; border-right: 1px solid var(--bd); background: var(--s); overflow: auto; flex-shrink: 0; }
.right { width: 310px; border-left: 1px solid var(--bd); background: var(--s); overflow: auto; flex-shrink: 0; }
nav { display: flex; gap: 4px; padding: 8px 8px 0; flex-wrap: wrap; } nav button.on { background: var(--ac2); color: #fff; border-color: var(--ac2); } nav i { font-style: normal; background: #f5a623; color: #000; border-radius: 8px; padding: 0 5px; margin-left: 3px; font-size: 10px; }
.center { flex: 1; display: grid; grid-template-columns: minmax(220px, 38%) 1fr; min-width: 0; min-height: 0; }
.pane { position: relative; min-width: 0; min-height: 0; border-right: 1px solid var(--bd); }
.vtools { position: absolute; right: 8px; top: 8px; display: flex; gap: 8px; font-size: 11px; background: rgba(0,0,0,.35); padding: 3px 7px; border-radius: 6px; color: #ddd; }
@media (max-width: 1100px) { .center { grid-template-columns: 1fr; grid-template-rows: 40% 1fr; } .left { width: 220px; } .right { width: 250px; } }
@media (max-width: 800px) { .main { flex-direction: column; overflow: auto; } .left, .right { width: auto; max-height: 40vh; } .center { min-height: 60vh; } }
</style>
