<script setup>
import { computed } from 'vue';
import { fs, raw, runCollisionCheck, sequenceIssues, solveHere } from '../../foldingStore.js';

const geom = computed(() => fs.issues.filter(i => i.code !== 'ambiguousEdge'));
const seqIssues = computed(() => { fs.version; fs.steps.length; return sequenceIssues(); });
const fail = computed(() => fs.diagnostics?.failure || null);
const thick = computed({ get: () => fs.view.thickness, set: v => { fs.view.thickness = v; } });
let thicknessAware = false;
</script>

<template>
  <div class="dp">
    <h4>Validation level</h4>
    <ul class="lv">
      <li :class="{ on: fs.status === 'preview' }">Preview <small>interpolated / unsolved</small></li>
      <li :class="{ on: fs.status === 'geometryValidated' }">Geometry validated <small>closure + targets in mm / °</small></li>
      <li :class="{ on: fs.status === 'collisionChecked' }">Collision checked <small>this configuration only</small></li>
      <li :class="{ on: fs.status === 'stale' }">Stale <small>design changed since solving</small></li>
    </ul>
    <div class="row">
      <button @click="runCollisionCheck({ thicknessAware })">Check collisions</button>
      <label class="chk"><input type="checkbox" @change="thicknessAware = $event.target.checked" /> thickness-aware</label>
      <button @click="solveHere" title="Re-close the displayed configuration onto the mechanism">Re-close</button>
    </div>
    <div v-if="fs.collisionMethod" class="meth">Method: {{ fs.collisionMethod.kind }} · {{ fs.collisionMethod.mode }} · {{ fs.collisionMethod.narrowPhaseTests }} tests. Passing one configuration does not prove the path is clear.</div>
    <div v-if="fs.collisions.length" class="coll"><b>{{ fs.collisions.length }} collision(s)</b>
      <div v-for="(c, i) in fs.collisions" :key="i"><code>{{ c.regions.map(r => r.slice(2, 10)).join(' × ') }}</code> {{ c.crossing ? 'interpenetrating' : c.distanceMm.toFixed(3) + ' mm < ' + c.requiredMm.toFixed(2) }}</div>
    </div>
    <h4>Mechanism</h4>
    <div v-if="fs.summary" class="kv">
      <span>Regions</span><b>{{ fs.summary.regionCount }}</b><span>Variables</span><b>{{ fs.summary.variableConnIds.length }}</b><span>Closed loops</span><b>{{ fs.summary.loops }}</b>
    </div>
    <h4>Geometry issues ({{ geom.length }})</h4>
    <div class="list"><div v-for="(i, k) in geom.slice(0, 50)" :key="k" :class="i.level">{{ i.message }}</div><div v-if="!geom.length" class="ok">none</div></div>
    <h4 v-if="seqIssues.length">Sequence issues</h4>
    <div class="list"><div v-for="(i, k) in seqIssues" :key="k" :class="i.level">{{ i.message }}</div></div>
    <template v-if="fail">
      <h4>Last solve failure</h4>
      <div class="error">{{ fail.message }}</div>
      <div v-for="(w, i) in fail.worstResiduals || []" :key="i" class="res">{{ w.constraint.type }} {{ w.constraint.connId || w.constraint.regionId }} — off by {{ (w.errorDeg ?? w.errorMm).toFixed(2) }}{{ w.errorDeg !== undefined ? '°' : ' mm' }}</div>
      <p class="note">Largest residuals, not a minimal conflicting set.</p>
    </template>
  </div>
</template>

<style scoped>
.dp { padding: 10px; font-size: 12px; } h4 { margin: 12px 0 5px; font: 600 11px 'DM Mono', monospace; letter-spacing: .06em; text-transform: uppercase; color: var(--sub); }
h4:first-child { margin-top: 0; }
.lv { list-style: none; padding: 0; margin: 0 0 8px; } .lv li { padding: 3px 7px; border-left: 3px solid var(--bd); color: var(--sub); } .lv li small { opacity: .75; }
.lv li.on { border-color: var(--ac2); color: var(--t); background: var(--acd); }
.row { display: flex; gap: 6px; align-items: center; flex-wrap: wrap; } .chk { color: var(--sub); display: inline-flex; gap: 4px; align-items: center; }
button { background: var(--bg); color: var(--t); border: 1px solid var(--bd); border-radius: 5px; padding: 4px 8px; font: 500 11px 'DM Sans', sans-serif; cursor: pointer; }
.kv { display: grid; grid-template-columns: 1fr auto; gap: 3px 10px; max-width: 220px; } .kv span { color: var(--sub); }
.error { color: #ff5252; } .warning { color: #f5a623; } .ok { color: #4caf50; } .list div { padding: 2px 0; line-height: 1.35; }
.coll { margin-top: 6px; color: #ff5252; } .meth, .note { color: var(--sub); margin-top: 6px; line-height: 1.35; } code { font: 11px 'DM Mono', monospace; } .res { color: var(--sub); }
</style>
