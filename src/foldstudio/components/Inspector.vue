<script setup>
import { ref, computed } from 'vue';
import { state, mirrorSelection, repeatSelection, setEdgeFoldAngle } from '../store.js';
import { effectiveFoldAngle, defaultFoldAngle } from '../lib/fold-io.js';

const mirrorOpts = ref({ axis: 'y', flipMV: false });
const repeatOpts = ref({ kind: 'rotational', count: 4, angle: 90, dx: 0.1, dy: 0, cx: 0.5, cy: 0.5 });

// When edges are selected, surface their fold angles. If they all share an
// angle, show that; otherwise show a "mixed" state.
const selectedEdges = computed(() =>
  [...state.selection.edges].map(i => state.model.edges[i]).filter(Boolean)
);
const sharedFoldAngle = computed(() => {
  const arr = selectedEdges.value;
  if (!arr.length) return null;
  const first = effectiveFoldAngle(arr[0]);
  for (const e of arr) {
    if (effectiveFoldAngle(e) !== first) return 'mixed';
  }
  return first;
});
const angleSlider = ref(0);
function syncAngle() {
  if (typeof sharedFoldAngle.value === 'number') angleSlider.value = sharedFoldAngle.value;
}
</script>

<template>
  <div class="inspector">
    <section v-if="state.tool === 'mirror'">
      <h3>Mirror</h3>
      <p class="hint">Select edges, choose an axis, then click Apply.</p>
      <label title="Reflection line: horizontal mirror at y=0.5 or vertical mirror at x=0.5">Axis
        <select v-model="mirrorOpts.axis">
          <option value="x">Horizontal (mid Y)</option>
          <option value="y">Vertical (mid X)</option>
        </select>
      </label>
      <label class="check" title="Mirroring a fold often inverts mountain/valley — toggle to swap them on the copy">
        <input type="checkbox" v-model="mirrorOpts.flipMV" /> Flip M↔V on mirror
      </label>
      <button class="primary" @click="mirrorSelection(mirrorOpts)" :disabled="!state.selection.edges.size">Apply mirror</button>
      <p class="meta">{{ state.selection.edges.size }} edge(s) selected</p>
    </section>

    <section v-if="state.tool === 'repeat'">
      <h3>Rotate / Repeat</h3>
      <p class="hint">Select edges, configure, then click Apply. Each step compounds: count 4 produces 4 copies.</p>
      <label title="Rotational pivots around a center; translational shifts by (dx, dy)">Kind
        <select v-model="repeatOpts.kind">
          <option value="rotational">Rotational</option>
          <option value="translational">Translational</option>
        </select>
      </label>
      <label title="Number of copies to add (1 = one extra copy)">Count
        <input type="number" min="1" max="32" v-model.number="repeatOpts.count" />
      </label>
      <template v-if="repeatOpts.kind === 'rotational'">
        <label title="Rotation per step in degrees, CCW">Angle step (°)
          <input type="number" v-model.number="repeatOpts.angle" />
        </label>
        <label title="Pivot X in paper-space (0–1)">Center X
          <input type="number" step="0.05" v-model.number="repeatOpts.cx" />
        </label>
        <label title="Pivot Y in paper-space (0–1)">Center Y
          <input type="number" step="0.05" v-model.number="repeatOpts.cy" />
        </label>
      </template>
      <template v-else>
        <label title="Shift per step along X (paper-units)">dx
          <input type="number" step="0.05" v-model.number="repeatOpts.dx" />
        </label>
        <label title="Shift per step along Y (paper-units)">dy
          <input type="number" step="0.05" v-model.number="repeatOpts.dy" />
        </label>
      </template>
      <button class="primary" @click="repeatSelection(repeatOpts)" :disabled="!state.selection.edges.size">Apply repeat</button>
      <p class="meta">{{ state.selection.edges.size }} edge(s) selected</p>
    </section>

    <section v-if="state.tool === 'angle'">
      <h3>Angle crease</h3>
      <p class="hint">Click an anchor on the canvas — a crease at the chosen angle and length is placed from there. Click a second time to commit.</p>
    </section>

    <section v-if="state.tool === 'select'">
      <h3>Selection</h3>
      <p class="meta">{{ state.selection.edges.size }} edge(s)</p>
      <p class="hint">Click an edge. Shift-click to add. Press <kbd>1</kbd>–<kbd>5</kbd> to reassign type. <kbd>Del</kbd> removes.</p>
    </section>

    <section v-if="state.tool === 'draw'">
      <h3>Draw</h3>
      <p class="hint">Click two points on the paper to place a crease in the active color. Snaps to grid nodes and existing vertices. <kbd>Esc</kbd> cancels mid-draw.</p>
    </section>

    <!-- Per-edge fold angle, only when edges are selected -->
    <section v-if="state.selection.edges.size">
      <h3>Fold angle</h3>
      <p class="hint">Used for Origami Simulator. Default by type: M = −180°, V = +180°, F = 0°.</p>
      <div v-if="sharedFoldAngle === 'mixed'" class="mixed">Mixed angles — slider will set them all.</div>
      <div v-else class="meta">Current: {{ sharedFoldAngle }}°</div>
      <input type="range" min="-180" max="180" step="5"
             :value="typeof sharedFoldAngle === 'number' ? sharedFoldAngle : 0"
             @input="setEdgeFoldAngle(+$event.target.value)"
             title="Drag to override the fold angle on every selected edge" />
      <div class="row">
        <button @click="setEdgeFoldAngle(null)" title="Revert to the default angle for this crease type">Reset to default</button>
      </div>
    </section>

    <section>
      <h3>Validation</h3>
      <p :class="['status', state.validation.ok ? 'ok' : 'bad']">
        {{ state.validation.ok ? 'Flat-foldable at every interior corner' : `${state.validation.issues.length} corner${state.validation.issues.length === 1 ? '' : 's'} won’t fold flat` }}
      </p>
      <ul v-if="state.validation.issues.length" class="issues">
        <li v-for="(iss, idx) in state.validation.issues" :key="idx" :title="iss.msg">
          <strong>v{{ iss.vertex }} — {{ iss.title }}</strong>
          <span class="msg">{{ iss.msg }}</span>
        </li>
      </ul>
    </section>
  </div>
</template>

<style scoped>
.inspector { display: flex; flex-direction: column; gap: 18px; padding: 14px; background: var(--s); border-left: 1px solid var(--bd); width: 280px; overflow-y: auto; }
section { display: flex; flex-direction: column; gap: 8px; }
h3 { font: 500 0.85rem 'DM Sans'; color: var(--t); margin: 0; padding-bottom: 4px; border-bottom: 1px solid var(--bd); }
label { display: flex; flex-direction: column; gap: 3px; font: 400 0.7rem 'DM Mono', monospace; color: var(--sub); }
label.check { flex-direction: row; align-items: center; gap: 8px; color: var(--t); }
input, select { background: var(--bg); color: var(--t); border: 1px solid var(--bd); border-radius: 4px; padding: 5px 7px; font: 400 0.78rem 'DM Sans'; }
input[type=range] { padding: 0; }
button { background: var(--bg); color: var(--t); border: 1px solid var(--bd); border-radius: 6px; padding: 7px 10px; font: 500 0.78rem 'DM Sans'; cursor: pointer; }
button.primary { background: var(--ac2); border-color: var(--ac2); color: #fff; }
button:disabled { opacity: 0.4; cursor: not-allowed; }
button:hover:not(:disabled) { filter: brightness(1.15); border-color: var(--ac2); }
.hint { font: 400 0.7rem 'DM Mono'; color: var(--sub); line-height: 1.5; }
.hint kbd { background: var(--bg); border: 1px solid var(--bd); border-radius: 3px; padding: 0 4px; font-size: 0.7rem; }
.meta { font: 400 0.7rem 'DM Mono'; color: var(--sub); }
.mixed { font: 400 0.7rem 'DM Mono'; color: var(--ac); }
.status.ok { color: #4caf50; font-size: 0.8rem; }
.status.bad { color: #ff6b35; font-size: 0.8rem; }
.issues { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 8px; max-height: 220px; overflow-y: auto; }
.issues li { display: flex; flex-direction: column; gap: 3px; padding: 7px 8px; background: rgba(255, 107, 53, 0.06); border-left: 2px solid var(--ac); border-radius: 3px; }
.issues strong { font: 500 0.72rem 'DM Sans'; color: var(--t); }
.issues .msg { font: 400 0.7rem 'DM Sans'; color: var(--sub); line-height: 1.45; }
.row { display: flex; gap: 6px; }
</style>
