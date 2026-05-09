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
      <p class="hint">Pick mode (Edges / Vertices / Both) is on the toolbar. Click to select; <kbd>Shift</kbd>-click to add; <kbd>1</kbd>–<kbd>5</kbd> reassigns; <kbd>Del</kbd> removes.</p>
      <p class="meta">{{ state.selection.edges.size }} edge(s) · {{ state.selection.vertices.size }} vertex/vertices selected</p>
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
              :disabled="state.toolOptions.mirror.axis === 'edge' ? state.selection.edges.size < 2 : !state.selection.edges.size">
        Apply mirror
      </button>
      <p class="hint" v-if="state.toolOptions.mirror.axis === 'edge'">
        Click edges directly while in Mirror tool — the <strong>first</strong> one (highlighted orange) is the axis, the rest get reflected across it. Click again to deselect.
      </p>
      <p class="hint" v-else>
        Click edges in the Mirror tool to add/remove from the selection (no shift needed). Then Apply.
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
.seg-label { font: 400 0.7rem 'DM Mono', monospace; color: var(--sub); margin-top: 2px; }
.seg { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 0; }
.seg button { background: var(--bg); color: var(--sub); border: 1px solid var(--bd); padding: 6px 4px; font: 500 0.7rem 'DM Sans', sans-serif; cursor: pointer; border-radius: 0; margin: 0; }
.seg button:first-child { border-top-left-radius: 6px; border-bottom-left-radius: 6px; }
.seg button:last-child { border-top-right-radius: 6px; border-bottom-right-radius: 6px; }
.seg button + button { border-left: none; }
.seg button.on { background: var(--acd); border-color: var(--ac2); color: var(--t); }
</style>
