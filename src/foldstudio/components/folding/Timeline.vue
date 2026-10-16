<script setup>
import { computed } from 'vue';
import { fs, timeline, setPosition, play, pause, solveHere } from '../../foldingStore.js';
const tl = computed(() => { fs.steps.length; fs.version; JSON.stringify(fs.steps.map(s => s.durationSeconds)); return timeline(); });
const LABEL = { preview: 'Preview', geometryValidated: 'Geometry validated', collisionChecked: 'Collision checked', stale: 'Stale' };
const onInput = e => setPosition(parseFloat(e.target.value));
const toggle = () => (fs.playback.playing ? pause() : play());
</script>

<template>
  <div class="tl">
    <button class="pp" :disabled="!tl.total" @click="toggle">{{ fs.playback.playing ? '❚❚' : '▶' }}</button>
    <div class="track">
      <div class="segs"><div v-for="s in tl.segments" :key="s.id" class="seg" :class="{ sel: fs.selected.stepId === s.id, solved: fs.results[s.id]?.completed && !fs.results[s.id]?.stale }"
           :style="{ left: (s.start / (tl.total || 1)) * 100 + '%', width: ((s.end - s.start) / (tl.total || 1)) * 100 + '%' }" :title="s.title" @click="fs.selected.stepId = s.id; fs.version++">{{ s.title }}</div></div>
      <input type="range" min="0" :max="tl.total || 1" step="0.01" :value="fs.playback.t" :disabled="!tl.total" @input="onInput" @change="solveHere" />
    </div>
    <span class="time">{{ fs.playback.t.toFixed(2) }} / {{ tl.total.toFixed(1) }} s</span>
    <span class="badge" :class="fs.status">{{ LABEL[fs.status] }}</span>
    <div v-if="fs.solving" class="prog"><i :style="{ width: fs.progress * 100 + '%' }"></i></div>
  </div>
</template>

<style scoped>
.tl { display: flex; align-items: center; gap: 10px; padding: 8px 14px; background: var(--s); border-top: 1px solid var(--bd); position: relative; }
.pp { width: 34px; height: 30px; background: var(--bg); color: var(--t); border: 1px solid var(--bd); border-radius: 6px; cursor: pointer; }
.track { flex: 1; position: relative; min-width: 0; } .segs { position: relative; height: 18px; margin-bottom: 2px; }
.seg { position: absolute; top: 0; height: 100%; box-sizing: border-box; border: 1px solid var(--bd); background: var(--bg); font: 10px 'DM Mono', monospace; color: var(--sub); overflow: hidden; white-space: nowrap; padding: 1px 4px; border-radius: 3px; cursor: pointer; }
.seg.solved { border-color: #4caf50; } .seg.sel { background: var(--acd); color: var(--t); }
input[type=range] { width: 100%; }
.time { font: 11px 'DM Mono', monospace; color: var(--sub); white-space: nowrap; }
.badge { font: 11px 'DM Mono', monospace; padding: 2px 8px; border-radius: 10px; border: 1px solid var(--bd); white-space: nowrap; }
.badge.preview { color: #f5a623; border-color: #f5a623; } .badge.geometryValidated { color: #4caf50; border-color: #4caf50; } .badge.collisionChecked { color: #2bd4c4; border-color: #2bd4c4; } .badge.stale { color: #ff5252; border-color: #ff5252; }
.prog { position: absolute; left: 0; right: 0; top: 0; height: 2px; } .prog i { display: block; height: 100%; background: var(--ac2); }
</style>
