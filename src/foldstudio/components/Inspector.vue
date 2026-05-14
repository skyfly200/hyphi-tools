<script setup>
import { computed } from 'vue';
import { state, setEdgeFoldAngle } from '../store.js';
import { effectiveFoldAngle } from '../lib/fold-io.js';

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
</script>

<template>
  <div class="inspector">
    <section>
      <h3>Selection</h3>
      <p class="meta">{{ state.selection.edges.size }} edge(s) · {{ state.selection.vertices.size }} vertex/vertices</p>
      <p class="hint" v-if="!state.selection.edges.size && !state.selection.vertices.size">
        Use the Select tool, then click edges or vertices. Click vertices to select them; <kbd>Del</kbd> removes them and any incident edges. Mirror / Rotate / Angle controls live in the left drawer (Tool options).
      </p>
    </section>

    <!-- Per-edge fold angle, only when edges are selected -->
    <section v-if="state.selection.edges.size">
      <h3>Fold angle</h3>
      <p class="hint">Used by Origami Simulator. Defaults: M = −180°, V = +180°, F = 0°.</p>
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
      <label class="check" title="Turn off to stop Maekawa / Kawasaki checking while you sketch">
        <input type="checkbox" v-model="state.validateFold" />
        Check flat-foldability
      </label>
      <template v-if="state.validateFold">
        <p :class="['status', state.validation.ok ? 'ok' : 'bad']">
          {{ state.validation.ok ? 'Flat-foldable at every interior corner' : `${state.validation.issues.length} corner${state.validation.issues.length === 1 ? '' : 's'} won’t fold flat` }}
        </p>
        <ul v-if="state.validation.issues.length" class="issues">
          <li v-for="(iss, idx) in state.validation.issues" :key="idx" :title="iss.msg">
            <strong>v{{ iss.vertex }} — {{ iss.title }}</strong>
            <span class="msg">{{ iss.msg }}</span>
          </li>
        </ul>
      </template>
      <p v-else class="hint">Validation is off — issue markers and the foldability report are paused.</p>

      <label class="check" title="Faces are checkerboard-colorable iff the pattern can be flat-folded (necessary condition)">
        <input type="checkbox" v-model="state.validateTwoColor" />
        Check 2-colorability
      </label>
      <label class="check" title="Surface T-junctions (vertex on the interior of an edge) and coincident / overlapping edges">
        <input type="checkbox" v-model="state.validateGeo" />
        Check geometry
      </label>
      <template v-if="state.validateTwoColor">
        <p :class="['status', state.twoColor.ok ? 'ok' : 'bad']">
          {{ state.twoColor.ok ? `Faces 2-colorable (${state.model.faces.length} face${state.model.faces.length === 1 ? '' : 's'})` : `${state.twoColor.conflicts.length} adjacency conflict${state.twoColor.conflicts.length === 1 ? '' : 's'}` }}
        </p>
        <ul v-if="state.twoColor.conflicts.length" class="issues">
          <li v-for="(c, idx) in state.twoColor.conflicts" :key="idx">
            <strong>f{{ c.face1 }} ↔ f{{ c.face2 }}</strong>
            <span class="msg">Adjacent faces end up the same colour. The crease pattern can't fold flat.</span>
          </li>
        </ul>
      </template>
      <template v-if="state.validateGeo">
        <p :class="['status', state.geo.ok ? 'ok' : 'bad']">
          {{ state.geo.ok ? 'Geometry clean' : `${state.geo.issues.length} geometry issue${state.geo.issues.length === 1 ? '' : 's'}` }}
        </p>
        <ul v-if="state.geo.issues.length" class="issues">
          <li v-for="(iss, idx) in state.geo.issues" :key="idx">
            <template v-if="iss.kind === 'tjunction'">
              <strong>T-junction at v{{ iss.vertex }} on e{{ iss.edge }}</strong>
              <span class="msg">A vertex sits on the interior of an edge that hasn't been split. Run Cleanup to fix.</span>
            </template>
            <template v-else-if="iss.kind === 'duplicate'">
              <strong>e{{ iss.edges[0] }} ↔ e{{ iss.edges[1] }} duplicate</strong>
              <span class="msg">Two edges share the same endpoints. Run Cleanup to merge them.</span>
            </template>
            <template v-else-if="iss.kind === 'overlap'">
              <strong>e{{ iss.edges[0] }} ↔ e{{ iss.edges[1] }} overlap</strong>
              <span class="msg">Edges lie on the same line and share a segment. Split or delete one before exporting.</span>
            </template>
          </li>
        </ul>
      </template>
    </section>
  </div>
</template>

<style scoped>
.inspector { display: flex; flex-direction: column; gap: 18px; padding: 14px; background: var(--s); border-left: 1px solid var(--bd); width: 280px; overflow-y: auto; }
section { display: flex; flex-direction: column; gap: 8px; }
h3 { font: 500 0.85rem 'DM Sans'; color: var(--t); margin: 0; padding-bottom: 4px; border-bottom: 1px solid var(--bd); }
label { display: flex; flex-direction: column; gap: 3px; font: 400 0.7rem 'DM Mono', monospace; color: var(--sub); }
label.check { flex-direction: row; align-items: center; gap: 8px; color: var(--t); font-size: 0.75rem; }
input, select { background: var(--bg); color: var(--t); border: 1px solid var(--bd); border-radius: 4px; padding: 5px 7px; font: 400 0.78rem 'DM Sans'; }
input[type=range] { padding: 0; }
button { background: var(--bg); color: var(--t); border: 1px solid var(--bd); border-radius: 6px; padding: 7px 10px; font: 500 0.78rem 'DM Sans'; cursor: pointer; }
button:hover { filter: brightness(1.15); border-color: var(--ac2); }
.hint { font: 400 0.7rem 'DM Mono'; color: var(--sub); line-height: 1.5; }
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
