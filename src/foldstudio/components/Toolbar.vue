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
  { id: 'M', label: 'Mountain', color: '#e23b3b' },
  { id: 'V', label: 'Valley',   color: '#3a7bd5' },
  { id: 'B', label: 'Border',   color: '#111' },
  { id: 'F', label: 'Flat',     color: '#999' },
  { id: 'U', label: 'Unknown',  color: '#777' },
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
        <Icon :name="t.icon" /><span>{{ t.label }}</span>
      </button>
    </div>

    <div class="divider" />

    <div class="group">
      <button v-for="t in transformTools" :key="t.id"
              :class="{ active: state.tool === t.id }"
              @click="state.tool = t.id" :title="`${t.label} (${t.key})`">
        <Icon :name="t.icon" /><span>{{ t.label }}</span>
      </button>
    </div>

    <div class="divider" />

    <div class="group">
      <button v-for="a in assignments" :key="a.id"
              :class="{ active: state.assignment === a.id }"
              :style="{ borderColor: state.assignment === a.id ? a.color : 'var(--bd)' }"
              @click="assignSelection(a.id)"
              :title="`${a.label} (${assignments.indexOf(a) + 1})`">
        <span class="swatch" :style="{ background: a.color }" />
        {{ a.id }}
      </button>
    </div>

    <div class="divider" />

    <div class="group">
      <button @click="undo" title="Undo (Ctrl/Cmd-Z)"><Icon name="undo" /></button>
      <button @click="redo" title="Redo (Ctrl/Cmd-Shift-Z)"><Icon name="redo" /></button>
      <button @click="deleteSelection" title="Delete selected (Del)"><Icon name="trash" /></button>
      <button @click="selectAll" title="Select all (Ctrl/Cmd-A)">All</button>
      <button @click="clearSelection" title="Deselect">None</button>
    </div>
  </div>
</template>

<style scoped>
.toolbar { display: flex; flex-wrap: wrap; gap: 6px; padding: 8px 12px; background: var(--s); border-bottom: 1px solid var(--bd); align-items: center; }
.group { display: flex; gap: 4px; }
.divider { width: 1px; align-self: stretch; background: var(--bd); margin: 0 4px; }
button { background: var(--bg); color: var(--t); border: 1px solid var(--bd); border-radius: 6px; padding: 6px 9px; font: 500 0.75rem 'DM Sans', sans-serif; cursor: pointer; display: inline-flex; align-items: center; gap: 6px; }
button:hover { border-color: var(--ac2); }
button.active { background: var(--acd); border-color: var(--ac2); color: var(--t); }
.swatch { width: 10px; height: 10px; border-radius: 2px; display: inline-block; }
</style>
