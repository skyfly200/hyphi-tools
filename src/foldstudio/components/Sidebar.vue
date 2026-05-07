<script setup>
import { state } from '../store.js';
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
      <label title="Number of divisions across the paper">Density
        <input type="range" min="2" max="32" v-model.number="state.grid.density" />
        <span class="meta">{{ state.grid.density }}</span>
      </label>
      <label class="check" title="When drawing, snap pointer to nearest grid node or existing vertex">
        <input type="checkbox" v-model="state.grid.snap" /> Snap to grid + vertices
      </label>
      <label class="check" title="Toggle grid visibility on the canvas">
        <input type="checkbox" v-model="state.grid.visible" /> Show grid
      </label>
      <label class="check" title="Render the grid into the workspace area beyond the paper edges">
        <input type="checkbox" v-model="state.grid.extend" /> Extend grid past paper
      </label>
    </section>

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
input, select { background: var(--bg); color: var(--t); border: 1px solid var(--bd); border-radius: 4px; padding: 5px 7px; font: 400 0.78rem 'DM Sans'; }
input[type=range] { padding: 0; }
button, .filebtn { background: var(--bg); color: var(--t); border: 1px solid var(--bd); border-radius: 6px; padding: 7px 10px; font: 500 0.78rem 'DM Sans'; cursor: pointer; text-align: center; }
button:hover, .filebtn:hover { border-color: var(--ac2); }
.meta { font: 400 0.7rem 'DM Mono'; color: var(--sub); }
.hint-inline { color: var(--sub); font-size: 0.7em; margin-left: 4px; }
</style>
