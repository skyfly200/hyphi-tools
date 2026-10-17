<script setup>
import { fs, applyLilyPreset, addStep, removeStep, moveStep, duplicateStep, selectedStep } from '../../foldingStore.js';
const badge = s => {
  const r = fs.results[s.id];
  if (!r) return { t: 'unsolved', c: 'idle' };
  if (r.stale) return { t: 'stale', c: 'warn' };
  return r.completed ? { t: 'solved', c: 'ok' } : { t: 'failed', c: 'bad' };
};
</script>

<template>
  <div class="sl">
    <div class="head"><b>Steps</b><button class="primary" @click="addStep()">+ Add step</button></div>
    <ol>
      <li v-for="(s, i) in fs.steps" :key="s.id" :class="{ sel: fs.selected.stepId === s.id }" @click="fs.selected.stepId = s.id; fs.rightTab = 'step'; fs.version++">
        <span class="n">{{ String(i + 1).padStart(2, '0') }}</span>
        <span class="t">{{ s.title }}</span>
        <span class="b" :class="badge(s).c">{{ badge(s).t }}</span>
        <span class="acts" @click.stop>
          <button title="Move up" :disabled="i === 0" @click="moveStep(s.id, -1)">↑</button>
          <button title="Move down" :disabled="i === fs.steps.length - 1" @click="moveStep(s.id, 1)">↓</button>
          <button title="Duplicate" @click="duplicateStep(s.id)">⧉</button>
          <button title="Delete" @click="removeStep(s.id)">✕</button>
        </span>
      </li>
    </ol>
    <p v-if="!fs.steps.length" class="empty">No steps yet. A step drives some creases, holds some, and lets the rest solve.</p>
    <div class="preset">
      <button @click="applyLilyPreset" title="Classifies the lily's U edges and adds phase 1 (fold in half, part way), then solves it">Load lily recipe (phase 1)</button>
    </div>
  </div>
</template>

<style scoped>
.sl { padding: 10px; font-size: 12.5px; }
.head { display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px; }
ol { list-style: none; margin: 0; padding: 0; }
li { display: grid; grid-template-columns: 24px 1fr auto; gap: 6px; align-items: center; padding: 7px 6px; border: 1px solid var(--bd); border-radius: 6px; margin-bottom: 5px; cursor: pointer; background: var(--bg); }
li.sel { border-color: var(--ac2); background: var(--acd); }
.n { font-family: 'DM Mono', monospace; color: var(--sub); }
.t { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.b { font: 10px 'DM Mono', monospace; padding: 1px 5px; border-radius: 3px; border: 1px solid var(--bd); color: var(--sub); }
.b.ok { color: #4caf50; border-color: #4caf50; } .b.bad { color: #ff5252; border-color: #ff5252; } .b.warn { color: #f5a623; border-color: #f5a623; }
.acts { grid-column: 1 / -1; display: none; gap: 4px; justify-content: flex-end; }
li.sel .acts { display: flex; }
button { background: var(--bg); color: var(--t); border: 1px solid var(--bd); border-radius: 5px; padding: 3px 7px; font: 500 11px 'DM Sans', sans-serif; cursor: pointer; }
button.primary { background: var(--ac2); color: #fff; border-color: var(--ac2); }
button:disabled { opacity: .35; cursor: default; }
.empty { color: var(--sub); line-height: 1.4; }
.preset { margin-top: 10px; padding-top: 10px; border-top: 1px dashed var(--bd); }
</style>
