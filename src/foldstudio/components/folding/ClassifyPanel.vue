<script setup>
// Resolve `U` (unassigned) edges. The engine never guesses: each one must become a
// fold, a rigid join (triangulation inside one panel), a boundary, or a bendable region.
import { computed } from 'vue';
import { fs, classify, classifyAllAmbiguous } from '../../foldingStore.js';

const rows = computed(() => fs.ambiguous);
const decided = computed(() => Object.keys(fs.classification).length);
const KINDS = [
  { k: 'join', label: 'Join', tip: 'Same rigid panel (triangulation edge)' },
  { k: 'fold', label: 'Fold', tip: 'A real crease that moves' },
  { k: 'boundary', label: 'Cut', tip: 'Boundary / no connection' },
  { k: 'bendable', label: 'Bend', tip: 'Flexible region (needs the petal model)' },
];
</script>

<template>
  <div class="cl">
    <p class="hint">Edges marked <b>U</b> are not guessed. Decide what each one is before solving.</p>
    <div class="bulk" v-if="rows.length">
      <span>All {{ rows.length }} unclassified:</span>
      <button v-for="k in KINDS" :key="k.k" :title="k.tip" @click="classifyAllAmbiguous(k.k)">{{ k.label }}</button>
    </div>
    <div v-else class="ok">✓ every edge is classified</div>
    <ul class="list">
      <li v-for="r in rows" :key="r.edgeId" :class="{ sel: fs.selected.connId === r.edgeId }">
        <code>{{ r.edgeId }}</code>
        <span class="btns"><button v-for="k in KINDS" :key="k.k" :title="k.tip" @click="classify([r.crease], k.k)">{{ k.label }}</button></span>
      </li>
    </ul>
    <details v-if="decided" class="decided"><summary>{{ decided }} decision(s) made</summary>
      <ul class="list"><li v-for="(kind, id) in fs.classification" :key="id"><code>{{ id }}</code><span>{{ kind }}</span><button @click="classify([id], null)">undo</button></li></ul>
    </details>
  </div>
</template>

<style scoped>
.cl { padding: 10px; font-size: 12px; }
.hint { color: var(--sub); margin: 0 0 8px; line-height: 1.4; }
.bulk { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; margin-bottom: 8px; }
.ok { color: #4caf50; }
.list { list-style: none; margin: 0; padding: 0; max-height: 40vh; overflow: auto; }
.list li { display: flex; align-items: center; justify-content: space-between; gap: 6px; padding: 3px 0; border-bottom: 1px solid var(--bd); }
.list li.sel { background: var(--acd); }
button { background: var(--bg); color: var(--t); border: 1px solid var(--bd); border-radius: 5px; padding: 3px 7px; font: 500 11px 'DM Sans', sans-serif; cursor: pointer; }
button:hover { border-color: var(--ac2); }
code { font-family: 'DM Mono', monospace; font-size: 11px; }
.btns { display: flex; gap: 3px; }
.decided { margin-top: 10px; color: var(--sub); }
</style>
