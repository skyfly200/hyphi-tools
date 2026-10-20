<script setup>
import { computed } from 'vue';
import { state, raw, exportColorSTLs, export3MFFile, exportSTLs, exportPlateSvg, exportHeightmap, exportReport } from '../store.js';

const r = computed(() => state.report);
const SL = state.slicing, nt = computed(() => SL.nozzleTable), res = computed(() => SL.result);
const mmss = t => `${Math.floor(t / 3600)}h ${String(Math.floor((t % 3600) / 60)).padStart(2, '0')}m`;
const featRows = computed(() => Object.values(res.value?.analysis.features || {}));
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

    <section class="blk" v-if="SL.imported">
      <h3>Imported settings ({{ SL.imported.source }})</h3>
      <div class="kv"><template v-for="f in SL.imported.found" :key="f.key"><span>{{ f.key }}</span><b>{{ typeof f.value === 'object' ? JSON.stringify(f.value) : f.value }}</b></template></div>
      <div v-for="n in SL.imported.notes" :key="n" class="iss warn">{{ n }}</div>
      <p v-if="SL.imported.measured" class="note">Measured from the toolpaths: {{ SL.imported.measured.layers }} layers at {{ SL.imported.measured.layerHeightMm }} mm, outer wall {{ SL.imported.measured.outerWidthMm }} mm wide, nozzle {{ SL.imported.measured.nozzleC }} °C, bed {{ SL.imported.measured.bedC }} °C.</p>
      <p class="note">Applied to the Slicing panel. Source file: {{ SL.imported.from }}.</p>
    </section>

    <section class="blk" v-if="nt">
      <h3>Nozzle fit (piece {{ nt.piece + 1 }})</h3>
      <p class="iss ok">Recommended: <b>{{ nt.recommended.nozzleMm }} mm</b> — {{ nt.recommended.reason }}.</p>
      <table class="tbl"><thead><tr><th>nozzle</th><th>layer</th><th>lost</th><th>single-line</th><th>time ×</th></tr></thead>
        <tbody><tr v-for="t in nt.table" :key="t.nozzleMm" :class="{ rec: t.nozzleMm === nt.recommended.nozzleMm, bad: !t.ok }"><td>{{ t.nozzleMm }}</td><td :class="{ bad: !t.layerOk }">{{ t.layerHeightMm }}</td><td>{{ t.lostPct }}%</td><td>{{ t.thinPct }}%</td><td>{{ t.relativeTime }}</td></tr></tbody></table>
      <p class="note">“Lost” = share of the cross-sections narrower than one extrusion line (cannot be printed). “Single-line” = under two lines wide (one wall, weak). Layer height is half the nozzle (red = taller than the thinnest hinge); time is relative.</p>
    </section>

    <section class="blk" v-if="res">
      <h3>G-code ({{ res.engine }})</h3>
      <div class="kv"><span>Layers</span><b>{{ res.analysis.layers }}</b>
        <span>Time (rough)</span><b>{{ mmss(res.analysis.timeS) }}</b>
        <span>Filament</span><b>{{ (res.analysis.filamentMm / 1000).toFixed(2) }} m · {{ res.analysis.filamentCm3 }} cm³</b>
        <span>Travel / retractions</span><b>{{ (res.analysis.travelMm / 1000).toFixed(1) }} m / {{ res.analysis.retractions }}</b>
        <span v-if="res.lostVolumeMm3 !== undefined">Detail not printed</span><b v-if="res.lostVolumeMm3 !== undefined" :class="{ warn: res.lostVolumeMm3 > 1 }">{{ res.lostVolumeMm3.toFixed(1) }} mm³</b></div>
      <table class="tbl"><thead><tr><th>feature</th><th>length</th><th>width (5/50/95%)</th></tr></thead>
        <tbody><tr v-for="f in featRows" :key="f.label"><td>{{ f.label }}</td><td>{{ (f.lengthMm / 1000).toFixed(2) }} m</td><td>{{ f.widthP5Mm }} / {{ f.widthMedianMm }} / {{ f.widthP95Mm }}</td></tr></tbody></table>
      <div v-for="i in [...res.profileIssues, ...res.analysis.issues]" :key="i.code" class="iss" :class="i.level === 'error' ? 'bad' : i.level === 'warning' ? 'warn' : ''">{{ i.message }}</div>
      <div v-if="res.fitsBed === false" class="iss bad">The piece is larger than the bed.</div>
      <div v-if="SL.stale" class="iss warn">The design changed since this was sliced — slice again.</div>
      <p class="note">Estimated from move lengths and feed rates only (no acceleration model). Built-in slicer: no gap fill, bridging or seam control.</p>
    </section>

    <section class="blk" v-if="r?.colors">
      <h3>Multi-colour</h3>
      <div class="kv"><span>Colours in use</span><b>{{ r.colors.colorsUsed }} of {{ r.colors.extruders }} slots</b><span>Bodies</span><b>{{ r.colors.bodies }}</b><span>Colour changes (rough)</span><b>≈ {{ r.colors.changes }}</b></div>
      <p class="note">Every layer of a panel contains every colour, so changes scale with colours × layers. The count is indicative; real purge depends on the slicer.</p>
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
        <button class="primary" @click="exportColorSTLs" :disabled="!r">{{ raw.bodies?.length ? 'STL per colour (mm)' : 'STL per piece (mm)' }}</button>
        <button @click="export3MFFile" :disabled="!raw.bodies?.length" title="One object per colour with an extruder map. Check the import in your slicer.">3MF multi-colour</button>
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
.tbl { width:100%; border-collapse:collapse; font-size:11px; } .tbl th { text-align:left; color:var(--sub); font-weight:400; } .tbl td, .tbl th { padding:2px 4px; }
.tbl tr.rec td { color:var(--ok); font-weight:600; } .tbl tr.bad td:nth-child(3) { color:var(--bad); }
summary { cursor:pointer; color:var(--sub); }
</style>
