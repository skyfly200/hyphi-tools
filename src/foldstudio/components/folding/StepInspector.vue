<script setup>
// Edit one folding step: instruction text, controls (drive / hold / free), anchors,
// branch hints, playback duration, and solve it.
import { computed } from 'vue';
import { fs, raw, regionLabel, selectedStep, touchStep, addControl, removeControl, derivedGroups, addGroup, removeGroup, solveAll, cancelSolve, saveWaypoint, sequenceIssues } from '../../foldingStore.js';

const step = computed(() => { fs.version; return selectedStep(); });
const creases = computed(() => Object.keys(fs.autoGroups));
const groups = computed(() => derivedGroups());
const issues = computed(() => { fs.version; fs.steps.length; return sequenceIssues().filter(i => !i.step || i.step === step.value?.id); });
const kind = t => (t?.groupId ? 'g:' + t.groupId : t?.creaseId ? 'c:' + t.creaseId : t?.connectionId ? 'x:' + t.connectionId : '');
const setTarget = (ctl, v) => { const [k, id] = [v.slice(0, 1), v.slice(2)]; ctl.target = k === 'g' ? { groupId: id } : k === 'c' ? { creaseId: id } : { connectionId: id }; touchStep(); };
const addHint = () => { step.value.branchHint.push({ target: { creaseId: creases.value[0] }, degrees: 3 }); touchStep(); };
const toggleAnchor = id => { const a = step.value.anchors; const i = a.findIndex(x => x.regionId === id); if (i >= 0) a.splice(i, 1); else a.push({ regionId: id, mode: 'holdStartPose' }); touchStep(); };
function makeGroup() { if (fs.groupPick.length) { addGroup(null, fs.groupPick); fs.groupPick = []; } }
</script>

<template>
  <div v-if="step" class="si">
    <label>Title <input v-model="step.title" @input="touchStep" /></label>
    <label>Instruction <textarea v-model="step.instruction" rows="3" placeholder="What the folder physically does" @input="touchStep"></textarea></label>
    <div class="two">
      <label>Duration (s) <input type="number" min="0.1" step="0.1" v-model.number="step.durationSeconds" @input="touchStep" /></label>
      <label>Easing <select v-model="step.easing" @change="touchStep"><option>linear</option><option>smoothstep</option><option>easeInOut</option></select></label>
    </div>
    <label>Unlisted creases
      <select v-model="step.defaultConnectionMode" @change="touchStep"><option value="free">free (solved) — recommended</option><option value="hold">hold (can lock a coupled mechanism)</option></select>
    </label>

    <h4>Controls</h4>
    <div v-for="(ctl, i) in step.controls" :key="i" class="ctl">
      <select :value="kind(ctl.target)" @change="setTarget(ctl, $event.target.value)">
        <optgroup label="Groups"><option v-for="g in groups" :key="g.id" :value="'g:' + g.id">{{ g.name }}</option></optgroup>
        <optgroup label="Creases"><option v-for="c in creases" :key="c" :value="'c:' + c">{{ c }}</option></optgroup>
      </select>
      <select v-model="ctl.mode" @change="touchStep"><option>drive</option><option>hold</option><option>free</option></select>
      <span v-if="ctl.mode === 'drive'" class="deg"><input type="number" step="1" v-model.number="ctl.toDegrees" @input="touchStep" />°</span>
      <button title="Remove" @click="removeControl(step.id, i)">✕</button>
    </div>
    <button @click="addControl(step.id, creases.length ? { creaseId: creases[0] } : { connectionId: fs.connections[0]?.id })" :disabled="!fs.connections.length">+ Control</button>

    <h4>Groups</h4>
    <div class="groups">
      <span v-for="g in fs.groups" :key="g.id" class="chip">{{ g.name }} <i>{{ g.creaseIds.length }}</i><button @click="removeGroup(g.id)">✕</button></span>
      <button :disabled="!fs.groupPick.length" @click="makeGroup" title="Shift-click creases in the 2D view first">Group {{ fs.groupPick.length }} picked</button>
    </div>

    <h4>Anchor</h4>
    <div class="chips">
      <span v-for="a in step.anchors" :key="a.regionId" class="chip" @mouseenter="fs.selected.regionId = a.regionId; fs.version++">{{ regionLabel(a.regionId) }}<button @click="toggleAnchor(a.regionId)">✕</button></span>
    </div>
    <select class="anchor-add" @change="$event.target.value && toggleAnchor($event.target.value); $event.target.value = ''; ">
      <option value="">+ Hold a panel in place…</option>
      <option v-for="r in fs.regions" :key="r.id" :value="r.id" :disabled="step.anchors.some(a => a.regionId === r.id)">{{ r.label }}</option>
    </select>
    <p class="note">The model's own anchor panel is already pinned ({{ regionLabel(raw.compiled?.anchor) }}). Click a panel in the 2D or 3D view to see which one a label refers to.</p>

    <h4>Branch hints</h4>
    <p class="note">From a flat (singular) state several folds are possible. A small nudge picks the branch.</p>
    <div v-for="(h, i) in step.branchHint" :key="i" class="ctl">
      <select :value="kind(h.target)" @change="h.target = { creaseId: $event.target.value.slice(2) }; touchStep()"><option v-for="c in creases" :key="c" :value="'c:' + c">{{ c }}</option></select>
      <span class="deg"><input type="number" step="1" v-model.number="h.degrees" @input="touchStep" />°</span>
      <button @click="step.branchHint.splice(i, 1); touchStep()">✕</button>
    </div>
    <button @click="addHint" :disabled="!creases.length">+ Branch hint</button>

    <label>Notes <textarea v-model="step.notes" rows="2" @input="touchStep"></textarea></label>

    <div v-if="issues.length" class="issues"><div v-for="(i, k) in issues" :key="k" :class="i.level">{{ i.message }}</div></div>
    <div class="run">
      <button class="primary" :disabled="fs.solving || !raw.compiled?.ok" @click="solveAll">{{ fs.solving ? 'Solving…' : 'Solve all steps' }}</button>
      <button v-if="fs.solving" @click="cancelSolve">Cancel</button>
      <button @click="saveWaypoint()" title="Store the displayed configuration">Save waypoint</button>
    </div>
    <div v-if="fs.message" class="msg">{{ fs.message }}</div>
  </div>
  <div v-else class="none">Select or add a step.</div>
</template>

<style scoped>
.si { padding: 10px; font-size: 12px; display: flex; flex-direction: column; gap: 8px; }
label { display: flex; flex-direction: column; gap: 3px; color: var(--sub); }
input, select, textarea { background: var(--bg); color: var(--t); border: 1px solid var(--bd); border-radius: 5px; padding: 5px 6px; font: 12px 'DM Sans', sans-serif; }
textarea { resize: vertical; }
h4 { margin: 8px 0 0; font: 600 11px 'DM Mono', monospace; letter-spacing: .06em; text-transform: uppercase; color: var(--sub); }
.two { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
.ctl { display: flex; gap: 4px; align-items: center; } .ctl select { flex: 1; min-width: 0; }
.deg { display: inline-flex; align-items: center; gap: 2px; } .deg input { width: 56px; }
button { background: var(--bg); color: var(--t); border: 1px solid var(--bd); border-radius: 5px; padding: 4px 8px; font: 500 11px 'DM Sans', sans-serif; cursor: pointer; align-self: flex-start; }
button.primary { background: var(--ac2); color: #fff; border-color: var(--ac2); }
button:disabled { opacity: .4; }
.groups, .chips, .run { display: flex; flex-wrap: wrap; gap: 5px; align-items: center; }
.chip { display: inline-flex; gap: 4px; align-items: center; padding: 2px 6px; border: 1px solid var(--bd); border-radius: 10px; } .chip i { color: var(--sub); font-style: normal; }
.chip button { padding: 0 3px; border: 0; background: none; }
.note { color: var(--sub); margin: 0; line-height: 1.35; }
.issues div { padding: 3px 0; } .issues .error { color: #ff5252; } .issues .warning { color: #f5a623; }
.msg { color: var(--sub); }
.none { padding: 14px; color: var(--sub); }
</style>
