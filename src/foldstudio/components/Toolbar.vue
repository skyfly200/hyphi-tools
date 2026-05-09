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

    <template v-if="state.tool === 'select'">
      <div class="divider" />
      <div class="seg" role="radiogroup" aria-label="Select target">
        <button :class="{ on: state.selectMode === 'edges' }"
                @click="state.selectMode = 'edges'"
                title="Pick only edges">Edges</button>
        <button :class="{ on: state.selectMode === 'vertices' }"
                @click="state.selectMode = 'vertices'"
                title="Pick only vertices">Vertices</button>
        <button :class="{ on: state.selectMode === 'both' }"
                @click="state.selectMode = 'both'"
                title="Pick vertices first, then edges">Both</button>
      </div>
    </template>

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

    <div class="divider" />

    <div class="group">
      <button class="snap-toggle"
              :class="{ active: state.snap.enabled, off: !state.snap.enabled }"
              @click="state.snap.enabled = !state.snap.enabled"
              :title="state.snap.enabled ? 'Snap is on — click to disable globally' : 'Snap is off — click to enable'">
        <Icon name="magnet" /><span class="lbl">{{ state.snap.enabled ? 'Snap' : 'No snap' }}</span>
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
/* Outline so dark swatches (B / U) stay visible against the dark UI bg. */
.swatch { width: 10px; height: 10px; border-radius: 2px; display: inline-block; box-shadow: 0 0 0 1px rgba(255,255,255,0.25); }
.snap-toggle { color: var(--ac2); border-color: var(--ac2); }
.snap-toggle.off { color: var(--sub); border-color: var(--bd); }
.snap-toggle.off :deep(svg) { opacity: 0.5; }

.seg { display: inline-flex; }
.seg button { background: var(--bg); color: var(--sub); border: 1px solid var(--bd); padding: 6px 10px; font: 500 0.7rem 'DM Sans', sans-serif; cursor: pointer; border-radius: 0; min-height: 34px; }
.seg button:first-child { border-top-left-radius: 6px; border-bottom-left-radius: 6px; }
.seg button:last-child { border-top-right-radius: 6px; border-bottom-right-radius: 6px; }
.seg button + button { border-left: none; }
.seg button.on { background: var(--acd); border-color: var(--ac2); color: var(--t); }
.seg button:hover:not(.on) { color: var(--t); }
.mobile-only { display: none; }

@media (max-width: 900px) {
  .mobile-only { display: flex; }
  /* Shrink labels on touch to keep the bar compact instead of dropping
     them entirely — labels are the only thing telling users what each icon
     does without a tooltip. */
  button .lbl { font-size: 0.6rem; }
  /* Bigger tap target on touch devices. */
  button { padding: 6px 8px; min-height: 40px; }
  .toolbar { padding: 8px 10px; gap: 5px; }
}
</style>
