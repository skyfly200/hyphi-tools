<script setup>
import { state } from '../store.js';
</script>

<template>
  <aside class="sidebar">
    <section>
      <h3>Grid</h3>
      <label>Type
        <select v-model="state.grid.type">
          <option value="square">Square</option>
          <option value="triangular">Triangular</option>
          <option value="radial">Radial</option>
        </select>
      </label>
      <label>Density
        <input type="range" min="2" max="32" v-model.number="state.grid.density" />
        <span class="meta">{{ state.grid.density }}</span>
      </label>
      <label class="check">
        <input type="checkbox" v-model="state.grid.snap" /> Snap to grid + vertices
      </label>
      <label class="check">
        <input type="checkbox" v-model="state.grid.visible" /> Show grid
      </label>
    </section>

    <section>
      <h3>Labels</h3>
      <label class="check"><input type="checkbox" v-model="state.labels.vertices" /> Vertex IDs</label>
      <label class="check"><input type="checkbox" v-model="state.labels.edges" /> Edge IDs</label>
      <label class="check"><input type="checkbox" v-model="state.labels.faces" /> Face IDs</label>
      <label class="check"><input type="checkbox" v-model="state.labels.oneBased" /> 1-based numbering</label>
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
</style>
