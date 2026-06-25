<script setup>
import { computed } from 'vue';
import { state, geometry } from '../store.js';

const status = computed(() => {
  const p = geometry.value.poly;
  const fc = geometry.value.built.faces.length;
  const lpf = state.params.ledsPerFace;
  return `${p.label} · ${fc} ${p.faceLabel}${fc === 1 ? '' : 's'} · ${fc * lpf} LEDs · edge ${state.params.edgeLengthMm} mm`;
});
</script>

<template>
  <div class="bottombar">
    <div class="status">{{ status }}</div>
    <div class="hint">click a face to inspect it</div>
  </div>
</template>

<style scoped>
.bottombar { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 6px 18px; background: var(--s); border-top: 1px solid var(--bd); font: 400 0.74rem 'DM Mono', monospace; color: var(--sub); }
.status { color: var(--t); }
@media (max-width: 600px) { .hint { display: none; } }
</style>
