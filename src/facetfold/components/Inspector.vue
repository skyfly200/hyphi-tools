<script setup>
import { computed } from 'vue';
import { state, exportSTLs, exportPlateSvg, exportHeightmap, exportReport } from '../store.js';

const r = computed(() => state.report);
const pct = v => (v * 100).toFixed(1) + '%';
const LABEL = { elastic: 'elastic', 'yields-once': 'yields once', 'likely-whitens': 'whitens', 'likely-cracks': 'cracks' };
const worst = computed(() => r.value?.worstHingeStrain);
const errors = computed(() => (state.issues || []).filter(i => i.level === 'error'));
const warns = computed(() => (state.issues || []).filter(i => i.level === 'warning'));
const infos = computed(() => (state.issues || []).filter(i => i.level === 'info'));
</script>

<template>
  <aside class="right">
    <section class="blk" v-if="r">
      <h3>Verification (folded in the solver)</h3>
      <div class="kv"><span>Panels vs ideal solid</span><b :class="{ bad: r.verification.maxFaceErrorMm > 0.05 }">{{ r.verification.maxFaceErrorMm.toExponential(1) }} mm</b>
        <span>Worst seam gap</span><b>{{ r.verification.maxSeamGapMm.toExponential(1) }} mm</b>
        <span>Closed-state collisions</span><b :class="{ bad: r.verification.closedCollisions }">{{ r.verification.closedCollisions }}</b>
        <span>Closing path</span><b>{{ r.verification.closingPathCollisionFree ? 'clear' : 'collides' }}</b></div>
      <p class="note" v-if="r.verification.method">Path checked by {{ r.verification.method.kind }} (max step {{ r.verification.method.maxStepMm }} mm); passing samples does not guarantee a clear path.</p>
    </section>

    <section class="blk" v-if="r">
      <h3>Net</h3>
      <div class="kv"><span>Faces / hinges / seams</span><b>{{ r.counts.faces }} / {{ r.counts.hinges }} / {{ r.counts.seams }}</b>
        <span>Pieces on plate</span><b>{{ r.counts.pieces }}</b>
        <span>Fold angles</span><b>{{ r.foldAnglesDeg.map(a => a.toFixed(1) + '°').join(', ') }}</b>
        <span>Snap detents</span><b>{{ r.snaps?.detents ?? 0 }}</b></div>
      <div v-for="f in r.fit" :key="f.piece" class="fit" :class="{ bad: !f.fits }">Piece {{ f.piece + 1 }}: {{ f.widthMm.toFixed(0) }} × {{ f.heightMm.toFixed(0) }} mm {{ f.fits ? 'fits the bed' : '— too large' }}</div>
    </section>

    <section class="blk" v-if="worst">
      <h3>Hinge strain</h3>
      <p class="note">Worst fold {{ worst.phiDeg?.toFixed(0) }}°: outer-fibre strain ≈ <b>{{ pct(worst.strain) }}</b> ({{ LABEL[worst.band] }}). Estimate only — test a printed hinge. Designed to fold once.</p>
    </section>

    <section class="blk">
      <h3>Issues</h3>
      <div v-if="!errors.length && !warns.length" class="ok">No errors or warnings.</div>
      <div v-for="(i, k) in errors" :key="'e' + k" class="iss bad">{{ i.message }}</div>
      <div v-for="(i, k) in warns" :key="'w' + k" class="iss warn">{{ i.message }}</div>
      <details v-if="infos.length"><summary>{{ infos.length }} notes</summary><div v-for="(i, k) in infos" :key="k" class="iss">{{ i.message }}</div></details>
    </section>

    <section class="blk" v-if="r?.surfaces?.length">
      <h3>Surface relief</h3>
      <div v-for="s in r.surfaces" :key="s.face" class="iss" :class="s.verdict === 'not-printable' ? 'bad' : s.verdict === 'marginal' ? 'warn' : ''">Face {{ s.face }}: {{ s.verdict }} <span v-if="s.features">({{ s.features }} features)</span><div v-for="(x, i) in s.reasons" :key="i" class="note">{{ x }}</div></div>
    </section>

    <section class="blk">
      <h3>Export</h3>
      <div class="btns">
        <button class="primary" @click="exportSTLs" :disabled="!r">STL per piece (mm)</button>
        <button @click="exportPlateSvg" :disabled="!r">Plate map SVG</button>
        <button @click="exportHeightmap(state.selectedFace)" :disabled="!state.surfaces[state.selectedFace]">Face {{ state.selectedFace }} heightmap</button>
        <button @click="exportReport" :disabled="!r">Report JSON</button>
      </div>
      <p class="note" v-if="r">{{ r.disclaimer }}</p>
    </section>
  </aside>
</template>

<style scoped>
.kv { display:grid; grid-template-columns:1fr auto; gap:3px 10px; } .kv span { color:var(--sub); }
.bad { color:var(--bad); } .warn { color:var(--warn); } .ok { color:var(--ok); }
.iss { line-height:1.4; padding:2px 0; } .fit.bad { color:var(--bad); }
summary { cursor:pointer; color:var(--sub); }
</style>
