<script setup>
import { TEMPLATES } from '../lib/templates.js';
import { newFromTemplate } from '../store.js';

const props = defineProps({ open: Boolean });
const emit = defineEmits(['close']);

function pick(id) {
  newFromTemplate(id);
  emit('close');
}
</script>

<template>
  <div v-if="open" class="modal-bg" @click.self="$emit('close')">
    <div class="modal np">
      <h3>New project</h3>
      <p class="hint">Start from a blank paper or one of these classic bases.</p>
      <div class="grid">
        <button v-for="t in TEMPLATES" :key="t.id" class="tpl" @click="pick(t.id)">
          <span class="name">{{ t.name }}</span>
          <span class="tag">{{ t.tagline }}</span>
        </button>
      </div>
      <div class="row">
        <button @click="$emit('close')">Cancel</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.modal-bg { position: fixed; inset: 0; background: rgba(0,0,0,0.55); display: flex; align-items: center; justify-content: center; z-index: 60; padding: 12px; }
.modal { background: var(--s); border: 1px solid var(--bd); border-radius: 10px; padding: 20px; min-width: min(520px, calc(100vw - 24px)); max-width: 640px; max-height: calc(100vh - 24px); overflow-y: auto; display: flex; flex-direction: column; gap: 14px; }
.modal h3 { margin: 0; font: 500 1rem 'DM Sans'; }
.hint { font: 400 0.78rem 'DM Mono'; color: var(--sub); }
.grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(180px, 1fr)); gap: 8px; }
.tpl { display: flex; flex-direction: column; align-items: flex-start; gap: 4px; background: var(--bg); border: 1px solid var(--bd); border-radius: 8px; padding: 10px 12px; cursor: pointer; text-align: left; }
.tpl:hover { border-color: var(--ac2); background: var(--acd); }
.name { font: 500 0.85rem 'DM Sans'; color: var(--t); }
.tag { font: 400 0.7rem 'DM Mono'; color: var(--sub); }
.row { display: flex; gap: 8px; justify-content: flex-end; }
.row button { background: var(--bg); color: var(--t); border: 1px solid var(--bd); border-radius: 6px; padding: 7px 10px; font: 500 0.78rem 'DM Sans'; cursor: pointer; }
@media (max-width: 700px) {
  .grid { grid-template-columns: 1fr 1fr; }
}
</style>
