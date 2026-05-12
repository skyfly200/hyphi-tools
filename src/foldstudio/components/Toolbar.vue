<script setup>
import { state, undo, redo, deleteSelection, assignSelection, selectAll, clearSelection, resetPaper, invertCreases } from '../store.js';
import { ref, computed, onMounted, onUnmounted } from 'vue';
import Icon from './Icon.vue';

const paintMenuOpen = ref(false);
function closePaintMenu() { paintMenuOpen.value = false; }

// Tiny click-outside directive — closes the paint dropdown when the user
// taps anywhere else. Scoped to this component.
const vClickOutside = {
  mounted(el, binding) {
    el.__clickOutside__ = (ev) => {
      if (!el.contains(ev.target)) binding.value();
    };
    setTimeout(() => document.addEventListener('pointerdown', el.__clickOutside__), 0);
  },
  unmounted(el) {
    if (el.__clickOutside__) document.removeEventListener('pointerdown', el.__clickOutside__);
  },
};

const tools = [
  { id: 'draw',   icon: 'draw',   label: 'Draw',   key: 'D' },
  { id: 'select', icon: 'select', label: 'Select', key: 'S' },
];
const transformTools = [
  { id: 'mirror', icon: 'mirror', label: 'Mirror', key: 'M' },
  { id: 'repeat', icon: 'rotate', label: 'Rotate', key: 'R' },
  { id: 'angle',  icon: 'angle',  label: 'Angle',  key: 'A' },
  { id: 'relief', icon: 'relief', label: 'Relief', key: 'C' },
];

const assignments = [
  { id: 'M', label: 'Mountain', color: '#e23b3b', hint: 'Mountain fold (default −180°). Click to set as paint; click with edges selected to reassign them.' },
  { id: 'V', label: 'Valley',   color: '#3a7bd5', hint: 'Valley fold (default +180°). Click to paint future creases as valley.' },
  { id: 'B', label: 'Border',   color: '#5c6478', hint: 'Paper boundary. Doesn\'t fold; counts as the edge of the paper.' },
  { id: 'F', label: 'Flat',     color: '#9aa0aa', hint: 'Flat / reference line (0°). Drawn but not folded.' },
  { id: 'U', label: 'Unknown',  color: '#6e7382', hint: 'Unknown / unassigned crease type.' },
];

const currentPaint = computed(() =>
  assignments.find(a => a.id === state.assignment) || assignments[0]
);

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
  else if (k === 'c' && !(ev.ctrlKey || ev.metaKey)) state.tool = 'relief';
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
                title="Pick edges only">
          <Icon name="pickEdge" /><span class="lbl">Edges</span>
        </button>
        <button :class="{ on: state.selectMode === 'vertices' }"
                @click="state.selectMode = 'vertices'"
                title="Pick vertices only">
          <Icon name="pickVertex" /><span class="lbl">Vertices</span>
        </button>
        <button :class="{ on: state.selectMode === 'both' }"
                @click="state.selectMode = 'both'"
                title="Pick vertices first, then edges">
          <Icon name="pickBoth" /><span class="lbl">Both</span>
        </button>
      </div>
      <button class="multi-toggle"
              :class="{ active: state.multiSelect }"
              @click="state.multiSelect = !state.multiSelect"
              :title="state.multiSelect ? 'Add-to-selection mode is on — every tap toggles into the selection. Click to disable.' : 'Add-to-selection mode (sticky shift) — useful on touch when you can\'t hold Shift.'">
        <span class="plus">+</span><span class="lbl">Multi</span>
      </button>
    </template>

    <div class="divider" />

    <div class="group paint-row">
      <button v-for="a in assignments" :key="a.id"
              :class="{ active: state.assignment === a.id }"
              :style="{ borderColor: state.assignment === a.id ? a.color : 'var(--bd)' }"
              @click="assignSelection(a.id)"
              :title="`${a.label} (${assignments.indexOf(a) + 1}) — ${a.hint}`">
        <span class="swatch" :style="{ background: a.color }" />
        {{ a.id }}
      </button>
    </div>

    <!-- Mobile-only compact paint dropdown. Trigger shows the active paint;
         tapping opens a popover with all five options. -->
    <div class="group paint-menu" v-click-outside="closePaintMenu">
      <button class="paint-trigger"
              :style="{ borderColor: currentPaint.color }"
              @click="paintMenuOpen = !paintMenuOpen"
              :title="`Paint: ${currentPaint.label} (tap to change)`">
        <span class="swatch" :style="{ background: currentPaint.color }" />
        {{ currentPaint.id }}
        <span class="chev">▾</span>
      </button>
      <div v-if="paintMenuOpen" class="paint-popover">
        <button v-for="a in assignments" :key="a.id"
                :class="{ active: state.assignment === a.id }"
                @click="assignSelection(a.id); paintMenuOpen = false"
                :title="a.hint">
          <span class="swatch" :style="{ background: a.color }" />
          <span class="paint-id">{{ a.id }}</span>
          <span class="paint-label">{{ a.label }}</span>
        </button>
      </div>
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
      <button @click="invertCreases"
              :title="state.selection.edges.size ? 'Flip M↔V on selected creases' : 'Flip M↔V on every crease'">
        <Icon name="invert" /><span class="lbl">Invert</span>
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
.seg button { background: var(--bg); color: var(--sub); border: 1px solid var(--bd); padding: 6px 9px; font: 500 0.7rem 'DM Sans', sans-serif; cursor: pointer; border-radius: 0; min-height: 34px; display: inline-flex; align-items: center; gap: 6px; }
.seg button:first-child { border-top-left-radius: 6px; border-bottom-left-radius: 6px; }
.seg button:last-child { border-top-right-radius: 6px; border-bottom-right-radius: 6px; }
.seg button + button { border-left: none; }
.seg button.on { background: var(--acd); border-color: var(--ac2); color: var(--t); }
.seg button:hover:not(.on) { color: var(--t); }
.multi-toggle { color: var(--sub); }
.multi-toggle .plus { font-weight: 700; font-size: 0.95rem; color: inherit; width: 14px; text-align: center; }
.multi-toggle.active { background: var(--acd); border-color: var(--ac2); color: var(--ac2); }
.mobile-only { display: none; }

.paint-menu { position: relative; display: none; }
.paint-trigger .chev { font-size: 0.7rem; color: var(--sub); margin-left: 1px; }
.paint-popover { position: absolute; z-index: 30; left: 0; top: calc(100% + 6px); background: var(--s); border: 1px solid var(--bd); border-radius: 8px; padding: 4px; display: flex; flex-direction: column; gap: 2px; box-shadow: 0 6px 20px rgba(0,0,0,0.45); min-width: 160px; }
.paint-popover button { display: grid; grid-template-columns: 16px 18px 1fr; align-items: center; gap: 8px; padding: 8px 10px; border-radius: 6px; border: 1px solid transparent; background: var(--bg); color: var(--t); font: 500 0.78rem 'DM Sans', sans-serif; cursor: pointer; min-height: 36px; }
.paint-popover button:hover { background: var(--acd); }
.paint-popover button.active { border-color: var(--ac2); }
.paint-popover .paint-id { font-family: 'DM Mono', monospace; font-size: 0.72rem; color: var(--sub); }
.paint-popover .paint-label { font-size: 0.78rem; color: var(--t); }

@media (max-width: 900px) {
  .mobile-only { display: flex; }
  /* Mobile is icons-only — labels eat too much room. The segmented Pick
     control keeps text (Edges / Vertices / Both) since it has no icons,
     but its font/padding shrink. The paint row collapses to a single
     dropdown trigger. */
  button .lbl { display: none; }
  button { padding: 6px 7px; min-height: 36px; gap: 0; }
  .toolbar { padding: 6px 8px; gap: 4px; }
  .seg button { padding: 6px 8px; font-size: 0.65rem; min-height: 36px; }
  .divider { margin: 0 2px; }
  .paint-row { display: none; }
  .paint-menu { display: flex; }
  .paint-trigger { gap: 4px; padding: 6px 8px; }
}
</style>
