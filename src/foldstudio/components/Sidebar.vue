<script setup>
import { watch } from 'vue';
import { state } from '../store.js';
import ToolOptions from './ToolOptions.vue';

const POWERS = [2, 4, 8, 16, 32, 64];

function nearestPower(d) {
  let best = POWERS[0], bd = Math.abs(d - POWERS[0]);
  for (const p of POWERS) {
    const dd = Math.abs(d - p);
    if (dd < bd) { bd = dd; best = p; }
  }
  return best;
}

// When the user re-enables Powers-of-2 mode, snap density to the nearest power.
watch(() => state.grid.snapPow2, on => {
  if (on) state.grid.density = nearestPower(state.grid.density);
});
</script>

<template>
  <aside class="sidebar">
    <section>
      <h3>Grid</h3>
      <div class="meta">Types <span class="hint-inline">(stack as many as you like)</span></div>
      <label class="check" title="Square / aligned grid">
        <input type="checkbox" :value="'square'" v-model="state.grid.types" /> Square
      </label>
      <label class="check" title="60° triangular grid (good for tessellations)">
        <input type="checkbox" :value="'triangular'" v-model="state.grid.types" /> Triangular
      </label>
      <label class="check" title="Concentric rings + sectors centered on the paper, extended to the corners">
        <input type="checkbox" :value="'radial'" v-model="state.grid.types" /> Radial
      </label>

      <div class="density-block">
        <div class="density-head">
          <span class="meta">Density</span>
          <label class="check inline" title="Snap density to powers of 2 (2, 4, 8, 16, 32, 64). Off lets you pick any whole number.">
            <input type="checkbox" v-model="state.grid.snapPow2" /> ×2
          </label>
        </div>
        <div v-if="state.grid.snapPow2" class="pow-row">
          <button v-for="p in POWERS" :key="p"
                  :class="{ active: state.grid.density === p }"
                  @click="state.grid.density = p"
                  :title="`${p} divisions`">{{ p }}</button>
        </div>
        <label v-else title="Number of divisions across the paper">
          <input type="range" min="2" max="64" v-model.number="state.grid.density" />
          <span class="meta">{{ state.grid.density }}</span>
        </label>
      </div>

      <label class="check" title="Toggle grid visibility on the canvas">
        <input type="checkbox" v-model="state.grid.visible" /> Show grid
      </label>
      <label class="check" title="Render the grid into the workspace area beyond the paper edges">
        <input type="checkbox" v-model="state.grid.extend" /> Extend grid past paper
      </label>
    </section>

    <section>
      <h3>Snap to</h3>
      <label class="check" title="Snap to existing crease vertices">
        <input type="checkbox" v-model="state.snap.vertices" /> Vertices (nodes)
      </label>
      <label class="check" title="Snap to nodes of the active grid(s)">
        <input type="checkbox" v-model="state.snap.grid" /> Grid points
      </label>
      <label class="check" title="Snap to the midpoint of every existing edge">
        <input type="checkbox" v-model="state.snap.midpoints" /> Edge midpoints
      </label>
    </section>

    <section>
      <h3>Symmetry</h3>
      <p class="meta">Auto-mirrors every new crease around the paper center.</p>
      <div class="sym-row">
        <button v-for="n in [1, 2, 4, 8, 16, 32]" :key="n"
                :class="{ active: state.symmetry === n }"
                @click="state.symmetry = n"
                :title="n === 1 ? 'No symmetry' : `${n}-fold rotational`">
          {{ n === 1 ? 'Off' : `1⁄${n}` }}
        </button>
      </div>
    </section>

    <ToolOptions />

    <section>
      <h3>Labels</h3>
      <label class="check" title="Show v0, v1, … on every vertex"><input type="checkbox" v-model="state.labels.vertices" /> Vertex IDs</label>
      <label class="check" title="Show e0, e1, … on every edge midpoint"><input type="checkbox" v-model="state.labels.edges" /> Edge IDs</label>
      <label class="check" title="Show f0, f1, … on every face centroid"><input type="checkbox" v-model="state.labels.faces" /> Face IDs</label>
      <label class="check" title="Number from 1 instead of 0"><input type="checkbox" v-model="state.labels.oneBased" /> 1-based numbering</label>
    </section>

  </aside>
</template>

<style scoped>
.sidebar { display: flex; flex-direction: column; gap: 18px; padding: 14px; background: var(--s); border-right: 1px solid var(--bd); width: 230px; overflow-y: auto; }
section { display: flex; flex-direction: column; gap: 8px; }
h3 { font: 500 0.85rem 'DM Sans'; color: var(--t); margin: 0; padding-bottom: 4px; border-bottom: 1px solid var(--bd); }
label { display: flex; flex-direction: column; gap: 3px; font: 400 0.7rem 'DM Mono', monospace; color: var(--sub); }
label.check { flex-direction: row; align-items: center; gap: 8px; color: var(--t); }
label.check.inline { font-size: 0.65rem; gap: 5px; color: var(--sub); }
input, select { background: var(--bg); color: var(--t); border: 1px solid var(--bd); border-radius: 4px; padding: 5px 7px; font: 400 0.78rem 'DM Sans'; }
input[type=range] { padding: 0; }
button, .filebtn { background: var(--bg); color: var(--t); border: 1px solid var(--bd); border-radius: 6px; padding: 5px 8px; font: 500 0.72rem 'DM Sans'; cursor: pointer; text-align: center; }
button:hover, .filebtn:hover { border-color: var(--ac2); }
button.active { background: var(--acd); border-color: var(--ac2); }
.density-block { display: flex; flex-direction: column; gap: 6px; }
.density-head { display: flex; align-items: center; justify-content: space-between; }
.pow-row { display: grid; grid-template-columns: repeat(6, 1fr); gap: 3px; }
.pow-row button { padding: 5px 0; }
.meta { font: 400 0.7rem 'DM Mono'; color: var(--sub); }
.sym-row { display: grid; grid-template-columns: repeat(6, 1fr); gap: 3px; }
.sym-row button { padding: 5px 0; font-size: 0.7rem; }
.hint-inline { color: var(--sub); font-size: 0.7em; margin-left: 4px; }
</style>
