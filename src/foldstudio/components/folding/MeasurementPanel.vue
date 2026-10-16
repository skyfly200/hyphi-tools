<script setup>
// Feature-to-feature distances, overall envelope and a section plane readout.
import { ref, computed } from 'vue';
import { fs, raw, measure, runCollisionCheck, poses } from '../../foldingStore.js';
import { sectionSegments, chainSegments, radialExtents } from '../../../folding/collision/validation.js';

const A = ref({ region: '', x: 0, y: 0 }), B = ref({ region: '', x: 0, y: 0 });
const result = ref(null);
const plane = ref({ axis: 'y', at: 50 });
const section = ref(null);
const radial = ref(null);
const regions = computed(() => fs.regions.map(r => r.id));
function go() { result.value = measure({ region: A.value.region, local: [A.value.x, A.value.y] }, { region: B.value.region, local: [B.value.x, B.value.y] }); }
function runSection() {
  const normal = plane.value.axis === 'x' ? [1, 0, 0] : plane.value.axis === 'y' ? [0, 1, 0] : [0, 0, 1];
  const origin = [normal[0] * plane.value.at, normal[1] * plane.value.at, normal[2] * plane.value.at];
  const chains = chainSegments(sectionSegments(raw.compiled, poses(), { origin, normal }));
  section.value = { polylines: chains.length, points: chains.reduce((s, c) => s + c.points.length, 0) };
}
function runRadial() { const c = fs.envelope ? [(fs.envelope.min[0] + fs.envelope.max[0]) / 2, (fs.envelope.min[1] + fs.envelope.max[1]) / 2, 0] : [fs.physical.sheetMm / 2, fs.physical.sheetMm / 2, 0]; radial.value = radialExtents(raw.compiled, poses(), c, [0, 0, 1]); }
const f = v => (v ?? 0).toFixed(2);
</script>

<template>
  <div class="mp">
    <h4>Envelope</h4>
    <button @click="runCollisionCheck()">Compute for this configuration</button>
    <div v-if="fs.envelope" class="kv"><span>W × D × H</span><b>{{ fs.envelope.size.map(f).join(' × ') }} mm</b>
      <span>Min</span><b>{{ fs.envelope.min.map(f).join(', ') }}</b><span>Max</span><b>{{ fs.envelope.max.map(f).join(', ') }}</b></div>
    <h4>Radial extents (about vertical axis through centre)</h4>
    <button @click="runRadial">Compute</button>
    <div v-if="radial" class="kv"><span>Max radius</span><b>{{ f(radial.maxRadiusMm) }} mm</b><span>Min radius</span><b>{{ f(radial.minRadiusMm) }} mm</b><span>Height range</span><b>{{ f(radial.axialMinMm) }} … {{ f(radial.axialMaxMm) }}</b></div>
    <h4>Section plane</h4>
    <div class="row"><select v-model="plane.axis"><option>x</option><option>y</option><option>z</option></select> = <input type="number" v-model.number="plane.at" /> mm <button @click="runSection">Cut</button></div>
    <div v-if="section" class="kv"><span>Polylines</span><b>{{ section.polylines }}</b><span>Points</span><b>{{ section.points }}</b></div>
    <h4>Distance between features</h4>
    <div class="row"><select v-model="A.region"><option v-for="r in regions" :key="r" :value="r">{{ r.slice(2, 12) }}</option></select><input type="number" v-model.number="A.x" /><input type="number" v-model.number="A.y" /></div>
    <div class="row"><select v-model="B.region"><option v-for="r in regions" :key="r" :value="r">{{ r.slice(2, 12) }}</option></select><input type="number" v-model.number="B.x" /><input type="number" v-model.number="B.y" /></div>
    <button :disabled="!A.region || !B.region" @click="go">Measure</button>
    <div v-if="result" class="kv"><span>Distance</span><b>{{ f(result.distanceMm) }} mm</b><span>Δ</span><b>{{ result.delta.map(f).join(', ') }}</b></div>
    <p class="note">Local coordinates are flat sheet millimetres. All outputs are nominal geometry; add manufacturing tolerance separately.</p>
  </div>
</template>

<style scoped>
.mp { padding: 10px; font-size: 12px; display: flex; flex-direction: column; gap: 6px; } h4 { margin: 10px 0 2px; font: 600 11px 'DM Mono', monospace; letter-spacing: .06em; text-transform: uppercase; color: var(--sub); }
.row { display: flex; gap: 5px; align-items: center; } input, select { background: var(--bg); color: var(--t); border: 1px solid var(--bd); border-radius: 5px; padding: 4px 5px; width: 70px; font: 12px 'DM Sans'; } select { width: auto; max-width: 110px; }
button { background: var(--bg); color: var(--t); border: 1px solid var(--bd); border-radius: 5px; padding: 4px 8px; font: 500 11px 'DM Sans', sans-serif; cursor: pointer; align-self: flex-start; }
.kv { display: grid; grid-template-columns: auto 1fr; gap: 3px 10px; } .kv span { color: var(--sub); } .note { color: var(--sub); line-height: 1.35; }
</style>
