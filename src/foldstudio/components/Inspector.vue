<script setup>
import { ref } from 'vue';
import { state, mirrorSelection, repeatSelection } from '../store.js';

const mirrorOpts = ref({ axis: 'y', flipMV: false });
const repeatOpts = ref({ kind: 'rotational', count: 4, angle: 90, dx: 0.1, dy: 0, cx: 0.5, cy: 0.5 });
</script>

<template>
  <div class="inspector">
    <section v-if="state.tool === 'mirror'">
      <h3>Mirror</h3>
      <p class="hint">Select edges, choose an axis, then click Apply.</p>
      <label>Axis
        <select v-model="mirrorOpts.axis">
          <option value="x">Horizontal (mid Y)</option>
          <option value="y">Vertical (mid X)</option>
        </select>
      </label>
      <label class="check">
        <input type="checkbox" v-model="mirrorOpts.flipMV" /> Flip M↔V on mirror
      </label>
      <button class="primary" @click="mirrorSelection(mirrorOpts)">Apply mirror</button>
      <p class="meta">{{ state.selection.edges.size }} edge(s) selected</p>
    </section>

    <section v-if="state.tool === 'repeat'">
      <h3>Repeat</h3>
      <p class="hint">Select edges, configure, then click Apply.</p>
      <label>Kind
        <select v-model="repeatOpts.kind">
          <option value="rotational">Rotational</option>
          <option value="translational">Translational</option>
        </select>
      </label>
      <label>Count
        <input type="number" min="1" max="32" v-model.number="repeatOpts.count" />
      </label>
      <template v-if="repeatOpts.kind === 'rotational'">
        <label>Angle step (°)
          <input type="number" v-model.number="repeatOpts.angle" />
        </label>
        <label>Center X
          <input type="number" step="0.05" v-model.number="repeatOpts.cx" />
        </label>
        <label>Center Y
          <input type="number" step="0.05" v-model.number="repeatOpts.cy" />
        </label>
      </template>
      <template v-else>
        <label>dx
          <input type="number" step="0.05" v-model.number="repeatOpts.dx" />
        </label>
        <label>dy
          <input type="number" step="0.05" v-model.number="repeatOpts.dy" />
        </label>
      </template>
      <button class="primary" @click="repeatSelection(repeatOpts)">Apply repeat</button>
      <p class="meta">{{ state.selection.edges.size }} edge(s) selected</p>
    </section>

    <section v-if="state.tool === 'angle'">
      <h3>Angle crease</h3>
      <p class="hint">Click an anchor point on the canvas, then click again — or set length and Extend, then anchor only.</p>
      <p class="meta">Configure angle/length in the canvas overlay (use draw tool to also see live preview).</p>
    </section>

    <section v-if="state.tool === 'select'">
      <h3>Selection</h3>
      <p class="meta">{{ state.selection.edges.size }} edge(s)</p>
      <p class="hint">Shift-click to add. Press 1-5 to reassign. Del to remove.</p>
    </section>

    <section v-if="state.tool === 'draw'">
      <h3>Draw</h3>
      <p class="hint">Click two points to place a crease. Snaps to grid + existing vertices. Esc cancels.</p>
    </section>

    <section>
      <h3>Validation</h3>
      <p :class="['status', state.validation.ok ? 'ok' : 'bad']">
        {{ state.validation.ok ? 'Flat-foldable (interior vertices)' : `${state.validation.issues.length} issue(s)` }}
      </p>
      <ul v-if="state.validation.issues.length" class="issues">
        <li v-for="(i, idx) in state.validation.issues" :key="idx">
          v{{ i.vertex }}: {{ i.msg }}
        </li>
      </ul>
    </section>
  </div>
</template>

<style scoped>
.inspector { display: flex; flex-direction: column; gap: 18px; padding: 14px; background: var(--s); border-left: 1px solid var(--bd); width: 260px; overflow-y: auto; }
section { display: flex; flex-direction: column; gap: 8px; }
h3 { font: 500 0.85rem 'DM Sans'; color: var(--t); margin: 0; padding-bottom: 4px; border-bottom: 1px solid var(--bd); }
label { display: flex; flex-direction: column; gap: 3px; font: 400 0.7rem 'DM Mono', monospace; color: var(--sub); }
label.check { flex-direction: row; align-items: center; gap: 8px; color: var(--t); }
input, select { background: var(--bg); color: var(--t); border: 1px solid var(--bd); border-radius: 4px; padding: 5px 7px; font: 400 0.78rem 'DM Sans'; }
button { background: var(--bg); color: var(--t); border: 1px solid var(--bd); border-radius: 6px; padding: 7px 10px; font: 500 0.78rem 'DM Sans'; cursor: pointer; }
button.primary { background: var(--ac2); border-color: var(--ac2); color: #fff; }
button:hover { filter: brightness(1.1); }
.hint { font: 400 0.7rem 'DM Mono'; color: var(--sub); line-height: 1.5; }
.meta { font: 400 0.7rem 'DM Mono'; color: var(--sub); }
.status.ok { color: #4caf50; }
.status.bad { color: #ff6b35; }
.issues { font: 400 0.7rem 'DM Mono'; color: var(--sub); padding-left: 16px; max-height: 160px; overflow-y: auto; }
</style>
