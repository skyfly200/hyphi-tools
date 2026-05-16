<script setup>
import {
  state, mirrorSelection, repeatSelection,
  extendSelectionAlongRuns,
} from '../store.js';
</script>

<template>
  <section class="tool-options">
    <h3>Tool options</h3>

    <template v-if="state.tool === 'draw'">
      <p class="hint">Click two points to place a crease in the active color. Snaps to grid + existing vertices. <kbd>Esc</kbd> cancels.</p>
    </template>

    <template v-else-if="state.tool === 'select'">
      <p class="hint">Pick mode (Edges / Vertices / Both) is on the toolbar. Click to select; <kbd>Shift</kbd>-click to add; <kbd>Shift</kbd>-double-click an edge to grab every edge on that line; <kbd>1</kbd>–<kbd>5</kbd> reassigns; <kbd>Del</kbd> removes. <strong>All ▾</strong> in the toolbar selects every edge or by type; <kbd>Ctrl/⌘-I</kbd> inverts the selection.</p>
      <p class="meta">{{ state.selection.edges.size }} edge(s) · {{ state.selection.vertices.size }} vertex/vertices selected</p>
      <div class="smart-row">
        <button class="rm" @click="extendSelectionAlongRuns" title="Pull in same-type collinear edges connected through endpoints">Extend run</button>
      </div>
    </template>

    <template v-else-if="state.tool === 'perpBisect'">
      <p class="hint">Click two points. The crease passes through the midpoint, perpendicular to the segment between them.</p>
      <label title="How far the bisector extends from the midpoint">Length mode
        <select v-model="state.toolOptions.perpBisect.mode">
          <option value="fixed">Fixed length</option>
          <option value="edge">Until next fold / paper edge</option>
          <option value="paper">Until paper edge</option>
        </select>
      </label>
      <label v-if="state.toolOptions.perpBisect.mode === 'fixed'">Length (paper-units)
        <input type="number" step="0.05" min="0.01" max="2"
               v-model.number="state.toolOptions.perpBisect.length" />
      </label>
      <p class="meta">{{ state.constructAnchors.length }} / 2 anchors picked</p>
    </template>

    <template v-else-if="state.tool === 'angleBisect'">
      <p class="hint">Click two edges. The crease bisects the angle at their intersection. Toggle the branch to switch acute / obtuse.</p>
      <label title="Which of the two perpendicular bisectors to emit">Branch
        <select v-model.number="state.toolOptions.angleBisect.branch">
          <option :value="0">Same-side (acute)</option>
          <option :value="1">Perpendicular (obtuse)</option>
        </select>
      </label>
      <label title="How far the bisector extends from the intersection">Length mode
        <select v-model="state.toolOptions.angleBisect.mode">
          <option value="fixed">Fixed length</option>
          <option value="edge">Until next fold / paper edge</option>
          <option value="paper">Until paper edge</option>
        </select>
      </label>
      <label v-if="state.toolOptions.angleBisect.mode === 'fixed'">Length (paper-units)
        <input type="number" step="0.05" min="0.01" max="2"
               v-model.number="state.toolOptions.angleBisect.length" />
      </label>
      <p class="meta">{{ state.constructAnchors.length }} / 2 edges picked</p>
    </template>

    <template v-else-if="state.tool === 'lineThrough'">
      <p class="hint">Click two points. Fixed mode draws exactly the segment; extend modes continue past both endpoints.</p>
      <label title="Fixed = segment exactly. Extend modes continue past P1 and P2.">Length mode
        <select v-model="state.toolOptions.lineThrough.mode">
          <option value="fixed">Segment only</option>
          <option value="edge">Extend to next fold / paper edge</option>
          <option value="paper">Extend to paper edge</option>
        </select>
      </label>
      <label v-if="state.toolOptions.lineThrough.mode === 'fixed' || state.toolOptions.lineThrough.mode === 'extend-explicit'">Length (paper-units)
        <input type="number" step="0.05" min="0.01" max="2"
               v-model.number="state.toolOptions.lineThrough.length" />
      </label>
      <p class="meta">{{ state.constructAnchors.length }} / 2 anchors picked</p>
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

    <template v-else-if="state.tool === 'relief'">
      <p class="hint">Tap a fold junction (vertex) to cut a small boundary polygon around it. The incident creases reconnect to the polygon's perimeter, relieving paper tension at tight junctions.</p>
      <label title="Cutout radius as a % of paper width. 1% ≈ 1.5mm on 150mm paper.">
        <span class="row-between">
          <span>Cutout radius</span>
          <span class="meta">{{ (state.toolOptions.relief.radius * 100).toFixed(1) }}% of paper</span>
        </span>
        <input type="range" min="0.005" max="0.15" step="0.005" v-model.number="state.toolOptions.relief.radius" />
        <span class="row-between minmax">
          <span>0.5%</span>
          <input type="number" class="num" min="0.005" max="0.15" step="0.005"
                 v-model.number="state.toolOptions.relief.radius" />
          <span>15%</span>
        </span>
      </label>
      <p class="hint">A live preview circle on the canvas shows the cut size. Refuses to apply if the radius is longer than any incident crease.</p>
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
.smart-row { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
.smart-row .rm { padding: 5px 9px; font: 500 0.72rem 'DM Sans', sans-serif; background: var(--bg); color: var(--t); border: 1px solid var(--bd); border-radius: 4px; cursor: pointer; }
.smart-row .rm:hover { border-color: var(--ac2); }
.row-between { display: flex; justify-content: space-between; align-items: center; gap: 8px; }
.row-between.minmax { font: 400 0.66rem 'DM Mono', monospace; color: var(--sub); }
.num { background: var(--bg); color: var(--t); border: 1px solid var(--bd); border-radius: 4px; padding: 3px 5px; width: 60px; font: 500 0.74rem 'DM Sans'; text-align: center; }
.seg-label { font: 400 0.7rem 'DM Mono', monospace; color: var(--sub); margin-top: 2px; }
.seg { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 0; }
.seg button { background: var(--bg); color: var(--sub); border: 1px solid var(--bd); padding: 6px 4px; font: 500 0.7rem 'DM Sans', sans-serif; cursor: pointer; border-radius: 0; margin: 0; }
.seg button:first-child { border-top-left-radius: 6px; border-bottom-left-radius: 6px; }
.seg button:last-child { border-top-right-radius: 6px; border-bottom-right-radius: 6px; }
.seg button + button { border-left: none; }
.seg button.on { background: var(--acd); border-color: var(--ac2); color: var(--t); }
</style>
