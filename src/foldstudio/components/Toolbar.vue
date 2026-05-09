<script setup>
import { state, undo, redo, deleteSelection, assignSelection, selectAll, clearSelection, resetPaper } from '../store.js';
import { onMounted, onUnmounted } from 'vue';
import Icon from './Icon.vue';

const tools = [
  { id: 'draw',   icon: 'draw',   label: 'Draw',   key: 'D' },
  { id: 'select', icon: 'select', label: 'Select', key: 'S' },
];
const transformTools = [
  { id: 'mirror', icon: 'mirror', label: 'Mirror', key: 'M' },
  { id: 'repeat', icon: 'rotate', label: 'Rotate', key: 'R' },
  { id: 'angle',  icon: 'angle',  label: 'Angle',  key: 'A' },
];

const assignments = [
  { id: 'M', label: 'Mountain', color: '#e23b3b', hint: 'Mountain fold (default −180°). Click to set as paint; click with edges selected to reassign them.' },
  { id: 'V', label: 'Valley',   color: '#3a7bd5', hint: 'Valley fold (default +180°). Click to paint future creases as valley.' },
  { id: 'B', label: 'Border',   color: '#111',    hint: 'Paper boundary. Doesn\'t fold; counts as the edge of the paper.' },
  { id: 'F', label: 'Flat',     color: '#999',    hint: 'Flat / reference line (0°). Drawn but not folded.' },
  { id: 'U', label: 'Unknown',  color: '#777',    hint: 'Unknown / unassigned crease type.' },
];

function onKey(ev) {
  if (ev.target.tagName === 'INPUT' || ev.target.tagName === 'TEXTAREA') return;
  const k = ev.key.toLowerCase();
  if (k === 'd') state.tool = 'draw';
  else if (k === 's' && !(ev.ctrlKey || ev.metaKey)) state.tool = 'select';
  else if (k === 'r' && (ev.ctrlKey || ev.metaKey)) { ev.preventDefault(); redo(); }
  else if (k === 'r') state.tool = 'repeat';
  else if (k === 'm' && !(ev.ctrlKey || ev.metaKey)) state.tool = 'mirror';
  else if (k === 'a' && (ev.ctrlKey || ev.metaKey)) { ev.preventDefault(); selectAll(); }
  else if (k === 'a') state.tool = 'angle';
  else if (k === 'z' && (ev.ctrlKey || ev.metaKey) && ev.shiftKey) { ev.preventDefault(); redo(); }
  else if (k === 'z' && (ev.ctrlKey || ev.metaKey)) { ev.preventDefault(); undo(); }
  else if (k === 'delete' || k === 'backspace') { ev.preventDefault(); deleteSelection(); }
  else if (k === '1') assignSelection('M');
  else if (k === '2') assignSelection('V');
  else if (k === '3') assignSelection('B');
  else if (k === '4') assignSelection('F');
  else if (k === '5') assignSelection('U');
}

onMounted(() => window.addEventListener('keydown', onKey));
onUnmounted(() => window.removeEventListener('keydown', onKey));
</script>

<template>
  <div class="toolbar">
    <div class="group">
      <button v-for="t in tools" :key="t.id"
              :class="{ active: state.tool === t.id }"
              @click="state.tool = t.id" :title="`${t.label} (${t.key})`">
        <Icon :name="t.icon" /><span class="lbl">{{ t.label }}</span>
      </button>
    </div>

    <div class="divider" />

    <div class="group">
      <button v-for="t in transformTools" :key="t.id"
              :class="{ active: state.tool === t.id }"
              @click="state.tool = t.id" :title="`${t.label} (${t.key})`">
        <Icon :name="t.icon" /><span class="lbl">{{ t.label }}</span>
      </button>
    </div>

    <div class="divider" />

    <div class="group">
      <button v-for="a in assignments" :key="a.id"
              :class="{ active: state.assignment === a.id }"
              :style="{ borderColor: state.assignment === a.id ? a.color : 'var(--bd)' }"
              @click="assignSelection(a.id)"
              :title="`${a.label} (${assignments.indexOf(a) + 1}) — ${a.hint}`">
        <span class="swatch" :style="{ background: a.color }" />
        {{ a.id }}
      </button>
    </div>

    <div class="divider" />

    <div class="group">
      <button @click="undo" title="Undo last change (Ctrl/Cmd-Z)"><Icon name="undo" /></button>
      <button @click="redo" title="Redo (Ctrl/Cmd-Shift-Z)"><Icon name="redo" /></button>
      <button @click="selectAll" title="Select every edge (Ctrl/Cmd-A)">All</button>
      <button @click="clearSelection" title="Clear current selection (Esc)">None</button>
      <button @click="deleteSelection"
              title="Delete selected edges and vertices (Del / Backspace)"
              :disabled="!state.selection.edges.size && !state.selection.vertices.size">
        <Icon name="trash" />
      </button>
    </div>
  </div>
</template>

<style scoped>
.toolbar { display: flex; flex-wrap: wrap; gap: 6px; padding: 8px 12px; background: var(--s); border-bottom: 1px solid var(--bd); align-items: center; }
.group { display: flex; gap: 4px; }
.divider { width: 1px; align-self: stretch; background: var(--bd); margin: 0 4px; }
button { background: var(--bg); color: var(--t); border: 1px solid var(--bd); border-radius: 6px; padding: 6px 9px; font: 500 0.75rem 'DM Sans', sans-serif; cursor: pointer; display: inline-flex; align-items: center; gap: 6px; min-height: 34px; }
button:hover:not(:disabled) { border-color: var(--ac2); }
button.active { background: var(--acd); border-color: var(--ac2); color: var(--t); }
button:disabled { opacity: 0.35; cursor: not-allowed; }
.swatch { width: 10px; height: 10px; border-radius: 2px; display: inline-block; }
.mobile-only { display: none; }

@media (max-width: 900px) {
  .mobile-only { display: flex; }
  /* Hide tool labels to keep the toolbar compact, leaving icons. */
  button .lbl { display: none; }
  /* Bigger tap target on touch devices. */
  button { padding: 8px 10px; min-height: 40px; }
  .toolbar { padding: 8px 10px; gap: 5px; }
}
</style>
