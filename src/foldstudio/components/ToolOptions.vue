<script setup>
import { state, mirrorSelection, repeatSelection } from '../store.js';
</script>

<template>
  <section class="tool-options">
    <h3>Tool options</h3>

    <template v-if="state.tool === 'draw'">
      <p class="hint">Click two points to place a crease in the active color. Snaps to grid + existing vertices. <kbd>Esc</kbd> cancels.</p>
    </template>

    <template v-else-if="state.tool === 'select'">
      <p class="hint">Click an edge. <kbd>Shift</kbd>-click to add. <kbd>1</kbd>–<kbd>5</kbd> reassigns. <kbd>Del</kbd> removes.</p>
      <p class="meta">{{ state.selection.edges.size }} edge(s) selected</p>
    </template>

    <template v-else-if="state.tool === 'mirror'">
      <label title="What to reflect across">Axis
        <select v-model="state.toolOptions.mirror.axis">
          <option value="x">Horizontal (mid Y)</option>
          <option value="y">Vertical (mid X)</option>
          <option value="edge">Selected edge (first selected)</option>
        </select>
      </label>
      <label class="check" title="Mirroring across an axis often inverts mountain/valley — toggle to swap them on the copy">
        <input type="checkbox" v-model="state.toolOptions.mirror.flipMV" /> Flip M↔V on mirror
      </label>
      <button class="primary" @click="mirrorSelection(state.toolOptions.mirror)"
              :disabled="!state.selection.edges.size">
        Apply mirror
      </button>
      <p class="hint" v-if="state.toolOptions.mirror.axis === 'edge'">
        Select the axis edge first, then add the edges you want mirrored. The first edge in your selection is the axis; the rest are mirrored across it.
      </p>
      <p class="meta">{{ state.selection.edges.size }} edge(s) selected</p>
    </template>

    <template v-else-if="state.tool === 'repeat'">
      <label title="Rotational pivots around a center; translational shifts by (dx, dy)">Kind
        <select v-model="state.toolOptions.repeat.kind">
          <option value="rotational">Rotational</option>
          <option value="translational">Translational</option>
        </select>
      </label>
      <label title="How many copies to add (1 = one extra copy)">Count
        <input type="number" min="1" max="32" v-model.number="state.toolOptions.repeat.count" />
      </label>
      <template v-if="state.toolOptions.repeat.kind === 'rotational'">
        <label title="Rotation per step in degrees, CCW">Angle (°)
          <input type="number" v-model.number="state.toolOptions.repeat.angle" />
        </label>
        <div class="row-2">
          <label title="Pivot X (paper-space, 0–1)">cx
            <input type="number" step="0.05" v-model.number="state.toolOptions.repeat.cx" />
          </label>
          <label title="Pivot Y (paper-space, 0–1)">cy
            <input type="number" step="0.05" v-model.number="state.toolOptions.repeat.cy" />
          </label>
        </div>
      </template>
      <template v-else>
        <div class="row-2">
          <label title="Shift per step along X">dx
            <input type="number" step="0.05" v-model.number="state.toolOptions.repeat.dx" />
          </label>
          <label title="Shift per step along Y">dy
            <input type="number" step="0.05" v-model.number="state.toolOptions.repeat.dy" />
          </label>
        </div>
      </template>
      <button class="primary" @click="repeatSelection(state.toolOptions.repeat)"
              :disabled="!state.selection.edges.size">
        Apply repeat
      </button>
      <p class="meta">{{ state.selection.edges.size }} edge(s) selected</p>
    </template>

    <template v-else-if="state.tool === 'angle'">
      <label title="Angle of the crease in degrees, measured CCW from the +x axis">Angle (°)
        <input type="number" step="1" v-model.number="state.toolOptions.angle.angle" />
      </label>
      <label title="How the length of the crease is determined">Length mode
        <select v-model="state.toolOptions.angle.mode">
          <option value="fixed">Fixed length</option>
          <option value="edge">Until next fold or paper edge</option>
          <option value="paper">Until paper edge</option>
        </select>
      </label>
      <label v-if="state.toolOptions.angle.mode === 'fixed'"
             title="Crease length in paper-units (1 = paper width)">Length
        <input type="number" step="0.05" min="0.01" max="2" v-model.number="state.toolOptions.angle.length" />
      </label>
      <p class="hint">Click an anchor point on the canvas to commit the crease at the configured angle.</p>
    </template>
  </section>
</template>

<style scoped>
.tool-options { display: flex; flex-direction: column; gap: 8px; }
h3 { font: 500 0.85rem 'DM Sans'; color: var(--t); margin: 0; padding-bottom: 4px; border-bottom: 1px solid var(--bd); }
label { display: flex; flex-direction: column; gap: 3px; font: 400 0.7rem 'DM Mono', monospace; color: var(--sub); }
label.check { flex-direction: row; align-items: center; gap: 8px; color: var(--t); }
input, select { background: var(--bg); color: var(--t); border: 1px solid var(--bd); border-radius: 4px; padding: 5px 7px; font: 400 0.78rem 'DM Sans'; }
button { background: var(--bg); color: var(--t); border: 1px solid var(--bd); border-radius: 6px; padding: 7px 10px; font: 500 0.78rem 'DM Sans'; cursor: pointer; }
button.primary { background: var(--ac2); border-color: var(--ac2); color: #fff; }
button:disabled { opacity: 0.4; cursor: not-allowed; }
button:hover:not(:disabled) { filter: brightness(1.15); border-color: var(--ac2); }
.hint { font: 400 0.7rem 'DM Mono'; color: var(--sub); line-height: 1.5; }
.hint kbd { background: var(--bg); border: 1px solid var(--bd); border-radius: 3px; padding: 0 4px; font-size: 0.7rem; }
.meta { font: 400 0.7rem 'DM Mono'; color: var(--sub); }
.row-2 { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; }
</style>
