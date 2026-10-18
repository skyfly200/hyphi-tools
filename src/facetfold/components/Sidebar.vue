<script setup>
import { computed } from 'vue';
import { state, raw, scheduleRebuild, toggleHinge, resetHinges, addMount, removeMount, setSurface, applySurfaceToAll, suggestHingeWidth, PROCESSES } from '../store.js';
import { PATTERNS, assessSurface, diffractionAngleDeg, dispersionDeg, maxPitchForDispersionUm } from '../lib/surface.js';

const P = state.params;
const edit = () => scheduleRebuild();
const faces = computed(() => Array.from({ length: state.faceCount }, (_, i) => i));
const spec = computed(() => state.surfaces[state.selectedFace] || { kind: 'none', pitchMm: 1.5, angleDeg: 0, depthMm: 0.15, intent: 'texture' });
const patch = p => setSurface(state.selectedFace, { ...spec.value, ...p });
const assess = computed(() => spec.value.kind === 'none' ? null : assessSurface({ kind: spec.value.kind, pitchUm: spec.value.pitchMm * 1000, depthUm: (spec.value.depthMm ?? 0.15) * 1000, intent: spec.value.intent }, state.process));
const calcPitch = computed({ get: () => state.calcPitch ?? 1.0, set: v => { state.calcPitch = v; } });
const calc = computed(() => ({ a: diffractionAngleDeg(calcPitch.value, 550), spread: dispersionDeg(calcPitch.value), max: maxPitchForDispersionUm() }));
const hingeCount = computed(() => state.edgeList.filter(e => e.kind === 'hinge').length);
const portVertices = computed(() => Array.from({ length: state.vertexCount }, (_, i) => i));
</script>

<template>
  <aside class="left">
    <section class="blk">
      <h3>Dimensions</h3>
      <label class="row">Shortest edge (mm) <input type="number" min="8" step="1" v-model.number="P.edgeLengthMm" @input="edit" /></label>
      <label class="row">Panel thickness (mm) <input type="number" min="0.8" step="0.1" v-model.number="P.panelThicknessMm" @input="edit" /></label>
      <label class="row">Seam clearance (mm) <input type="number" min="0" step="0.05" v-model.number="P.seamClearanceMm" @input="edit" /></label>
    </section>

    <section class="blk">
      <h3>Hinges</h3>
      <label class="row">Flexure thickness (mm) <input type="number" min="0.05" step="0.05" v-model.number="P.hingeThicknessMm" @input="edit" /></label>
      <label class="row">Flexure width (mm) <input type="number" min="0.3" step="0.1" v-model.number="P.hingeWidthMm" @input="edit" /></label>
      <button @click="suggestHingeWidth" title="Narrowest width that keeps the worst fold within the yield band">Suggest width for strain</button>
      <p class="note">Edges: {{ hingeCount }} hinges, {{ state.edgeList.length - hingeCount }} seams. Toggle to split the net or rearrange it.</p>
      <div class="edges">
        <button v-for="e in state.edgeList" :key="e.key" class="e" :class="e.kind" :title="`${e.phiDeg.toFixed(1)}° fold · ${e.lengthMm.toFixed(1)} mm`" @click="toggleHinge(e.key)">{{ e.key }}<i>{{ e.kind === 'hinge' ? 'H' : 'S' }}</i></button>
      </div>
      <button v-if="state.customHinges" @click="resetHinges">Reset to default net</button>
    </section>

    <section class="blk">
      <h3>Lighting &amp; wiring</h3>
      <label class="row"><span>Cable port at a vertex</span><input type="checkbox" v-model="state.port.enabled" @change="edit" /></label>
      <template v-if="state.port.enabled">
        <label class="row">Vertex <select v-model.number="state.port.vertex" @change="edit"><option v-for="v in portVertices" :key="v" :value="v">{{ v }}</option></select></label>
        <label class="row">Cut depth (mm) <input type="number" min="2" step="0.5" v-model.number="state.port.depthMm" @input="edit" /></label>
        <label class="row">Cable hole Ø (mm) <input type="number" min="2" step="0.5" v-model.number="state.port.holeMm" @input="edit" /></label>
        <label class="row"><span>Cable-tie slots</span><input type="checkbox" v-model="state.port.tieSlots" @change="edit" /></label>
        <p class="note">The vertex is truncated; the new small face carries a gland hole with a collar.</p>
      </template>
      <div v-for="(m, i) in state.mounts" :key="i" class="mount">
        <b>Face {{ m.face }}</b>
        <select v-model="m.type" @change="edit"><option value="round">round</option><option value="rect">rectangular</option></select>
        <input v-if="m.type === 'round'" type="number" step="0.5" v-model.number="m.diameterMm" @input="edit" title="diameter mm" />
        <template v-else><input type="number" step="0.5" v-model.number="m.widthMm" @input="edit" title="width" /><input type="number" step="0.5" v-model.number="m.heightMm" @input="edit" title="height" /></template>
        <button @click="removeMount(i)">✕</button>
      </div>
      <button @click="addMount">+ Mount on face {{ state.selectedFace }}</button>
    </section>

    <section class="blk">
      <h3>Snap seams</h3>
      <label class="row"><span>Snap detents on seams</span><input type="checkbox" v-model="state.snap.enabled" @change="edit" /></label>
      <label class="row">Max bump radius (mm) <input type="number" min="0.3" step="0.1" v-model.number="state.snap.bumpRadiusMm" @input="edit" /></label>
      <label class="row">Detent spacing (mm) <input type="number" min="8" step="1" v-model.number="state.snap.spacingMm" @input="edit" /></label>
      <p class="note">Sizes shrink to what the wall can hold. Thin panels get none, with a warning.</p>
    </section>

    <section class="blk">
      <h3>Outer surface</h3>
      <label class="row">Build sheet <select v-model="state.bedFinish" @change="edit"><option value="smooth">smooth</option><option value="textured">textured (diffuse)</option></select></label>
      <label class="row">Printer <select v-model="state.process" @change="edit"><option v-for="p in PROCESSES" :key="p.id" :value="p.id">{{ p.label }}</option></select></label>
      <label class="row">Face <select v-model.number="state.selectedFace"><option v-for="f in faces" :key="f" :value="f">{{ f }}</option></select></label>
      <label class="row">Pattern <select :value="spec.kind" @change="patch({ kind: $event.target.value })"><option v-for="k in PATTERNS" :key="k" :value="k">{{ k }}</option></select></label>
      <template v-if="spec.kind !== 'none'">
        <label class="row">Pitch (mm) <input type="number" min="0.05" step="0.1" :value="spec.pitchMm" @change="patch({ pitchMm: +$event.target.value })" /></label>
        <label class="row">Angle (°) <input type="number" step="5" :value="spec.angleDeg" @change="patch({ angleDeg: +$event.target.value })" /></label>
        <label class="row">Depth (mm) <input type="number" min="0.02" step="0.02" :value="spec.depthMm" @change="patch({ depthMm: +$event.target.value })" /></label>
        <label class="row">Intent <select :value="spec.intent" @change="patch({ intent: $event.target.value })"><option value="texture">texture / diffuse</option><option value="diffraction">diffraction</option></select></label>
        <div v-if="assess" class="assess" :class="assess.verdict"><b>{{ assess.verdict }}</b> on {{ assess.process.label }}<div v-for="(r, i) in assess.reasons" :key="i">{{ r }}</div></div>
        <div class="btns"><button @click="applySurfaceToAll(spec)">Apply to all faces</button></div>
      </template>
      <details><summary>Diffraction calculator</summary>
        <label class="row">Period (µm) <input type="number" min="0.4" step="0.1" v-model.number="calcPitch" /></label>
        <p class="note">550 nm, normal incidence: first order at {{ calc.a === null ? 'none (evanescent)' : calc.a.toFixed(1) + '°' }}. Colour spread 450–650 nm: {{ calc.spread === null ? '—' : calc.spread.toFixed(1) + '°' }}. A visible spread needs a period below ≈ {{ calc.max.toFixed(1) }} µm — far below any printer; export the prescription for a master or film.</p>
      </details>
    </section>
  </aside>
</template>

<style scoped>
.edges { display:flex; flex-wrap:wrap; gap:4px; max-height:140px; overflow:auto; }
.e { padding:2px 6px; font:11px 'DM Mono',monospace; display:inline-flex; gap:4px; } .e i { font-style:normal; opacity:.7; }
.e.hinge { border-color:var(--ac); } .e.seam { opacity:.85; }
.mount { display:flex; gap:5px; align-items:center; } .mount input { width:56px !important; }
.assess { padding:6px 8px; border-left:3px solid var(--bd); line-height:1.4; border-radius:3px; background:var(--acd); }
.assess.printable { border-color:var(--ok); } .assess.marginal { border-color:var(--warn); } .assess.not-printable { border-color:var(--bad); }
summary { cursor:pointer; color:var(--sub); }
</style>
