<script setup>
import { ref } from 'vue';
import {
  state, loadModel, saveCurrentProject,
  loadSavedProject, deleteSavedProject, renameSavedProject,
} from '../store.js';
import {
  modelToFOLD, foldToModel, modelToSVG, downloadJSON, downloadText,
} from '../lib/fold-io.js';
import { setHandoff } from '../../lib/foldHandoff.js';
import Icon from './Icon.vue';
import NewProjectModal from './NewProjectModal.vue';

const handoffOpen = ref(false);
function closeHandoffMenu() { handoffOpen.value = false; }
const vClickOutside = {
  mounted(el, binding) {
    el.__clickOutside__ = (ev) => {
      if (!el.contains(ev.target)) binding.value();
    };
    setTimeout(() => document.addEventListener('pointerdown', el.__clickOutside__), 0);
  },
  unmounted(el) {
    if (el.__clickOutside__) document.removeEventListener('pointerdown', el.__clickOutside__);
  },
};

const renaming = ref(null);
const renameValue = ref('');
function startRename(name) {
  renaming.value = name;
  renameValue.value = name;
}
function cancelRename() {
  renaming.value = null;
  renameValue.value = '';
}
function commitRename(oldName) {
  const target = renameValue.value;
  if (renaming.value !== oldName) return;
  if (target && target !== oldName) renameSavedProject(oldName, target);
  cancelRename();
}

const showNew = ref(false);
const showSave = ref(false);
const showLoad = ref(false);
const showSimulator = ref(false);
const projectName = ref('');
const exportFormat = ref(state.export?.format || 'fold');

function openSave() {
  projectName.value = state.currentProject || '';
  showSave.value = true;
}
function commitSave() {
  const n = projectName.value.trim();
  if (!n) return;
  saveCurrentProject(n);
  showSave.value = false;
}

function doExport() {
  const base = state.currentProject || 'pattern';
  if (exportFormat.value === 'svg') {
    downloadText(`${base}.svg`, modelToSVG(state.model), 'image/svg+xml');
  } else {
    downloadJSON(`${base}.fold`, modelToFOLD(state.model, { ids: true }));
  }
}

function importFile(ev) {
  const f = ev.target.files?.[0];
  if (!f) return;
  const reader = new FileReader();
  reader.onload = () => {
    try { loadModel(foldToModel(JSON.parse(reader.result))); }
    catch (e) { alert('Could not parse FOLD file: ' + e.message); }
  };
  reader.readAsText(f);
  ev.target.value = '';
}

function openInOrigamiSimulator() {
  const filename = (state.currentProject || 'pattern') + '.fold';
  const fold = modelToFOLD(state.model, { ids: false });
  const popup = window.open('https://origamisimulator.org/', '_blank');
  if (!popup) {
    downloadJSON(filename, fold);
    showSimulator.value = true;
    return;
  }
  let attempts = 0;
  const send = () => {
    if (popup.closed || attempts >= 12) return;
    try {
      popup.postMessage(
        { op: 'importFold', fold, filename, file_title: state.currentProject || 'FoldStudio' },
        '*'
      );
    } catch (_) {}
    attempts++;
    setTimeout(send, attempts === 1 ? 1800 : 1000);
  };
  send();
}

function openInTool(path) {
  setHandoff(modelToFOLD(state.model, { ids: false }));
  window.location.assign(path);
}

const fmt = ts => new Date(ts).toLocaleString();
</script>

<template>
  <footer class="bottombar">
    <div class="status" :title="state.status">
      {{ state.status }}
      <span class="dim">· {{ state.tool }} · {{ state.assignment }}</span>
    </div>

    <div class="grp project">
      <button @click="showNew = true" title="Start a new project (blank or template)">
        <Icon name="newDoc" /><span class="lbl">New</span>
      </button>
      <button @click="openSave" title="Save project to browser">
        <Icon name="save" /><span class="lbl">Save</span>
      </button>
      <button @click="showLoad = true" title="Open a saved project">
        <Icon name="open" /><span class="lbl">Open</span>
      </button>
    </div>

    <div class="grp file">
      <label class="filebtn" title="Import .fold file">
        <Icon name="upload" /><span class="lbl">Import</span>
        <input type="file" accept=".fold,application/json" @change="importFile" hidden />
      </label>
      <div class="export-pair" title="Export the current pattern">
        <button @click="doExport"><Icon name="download" /><span class="lbl">Export</span></button>
        <select v-model="exportFormat" title="Choose export format">
          <option value="fold">.fold</option>
          <option value="svg">.svg</option>
        </select>
      </div>
    </div>

    <div class="grp handoff" v-click-outside="closeHandoffMenu">
      <button class="handoff-trigger"
              @click="handoffOpen = !handoffOpen"
              title="Open this pattern in another tool">
        <Icon name="external" /><span class="lbl">Open in…</span>
        <span class="chev">▾</span>
      </button>
      <div v-if="handoffOpen" class="handoff-popover">
        <button @click="openInOrigamiSimulator(); handoffOpen = false"
                title="Open in origamisimulator.org with the configured fold angles">
          <Icon name="external" /><span class="handoff-label">Origami Simulator</span>
        </button>
        <button @click="openInTool('/foldform'); handoffOpen = false"
                title="Open this pattern in FoldForm to make a living-hinge model">
          <Icon name="foldform" /><span class="handoff-label">FoldForm</span>
        </button>
        <button @click="openInTool('/fold'); handoffOpen = false"
                title="Open this pattern in FoldPress to make press plates">
          <Icon name="foldpress" /><span class="handoff-label">FoldPress</span>
        </button>
      </div>
    </div>

    <NewProjectModal :open="showNew" @close="showNew = false" />

    <div v-if="showSave" class="modal-bg" @click.self="showSave = false">
      <div class="modal">
        <h3>Save project</h3>
        <input v-model="projectName" placeholder="project name"
               @keyup.enter="commitSave" autofocus />
        <div class="row">
          <button @click="showSave = false">Cancel</button>
          <button class="primary" @click="commitSave" :disabled="!projectName.trim()">Save</button>
        </div>
      </div>
    </div>

    <div v-if="showLoad" class="modal-bg" @click.self="showLoad = false">
      <div class="modal wide">
        <h3>Open project</h3>
        <ul v-if="state.projects.length" class="proj-list">
          <li v-for="p in state.projects" :key="p.name">
            <template v-if="renaming === p.name">
              <input ref="renameInput"
                     v-model="renameValue"
                     @keyup.enter="commitRename(p.name)"
                     @keyup.esc="cancelRename"
                     @blur="commitRename(p.name)"
                     autofocus />
              <span class="when">{{ fmt(p.savedAt) }}</span>
              <button class="rename" @mousedown.prevent @click="commitRename(p.name)" title="Confirm rename">✓</button>
            </template>
            <template v-else>
              <button class="link" @click="loadSavedProject(p.name); showLoad = false">
                {{ p.name }}
              </button>
              <span class="when">{{ fmt(p.savedAt) }}</span>
              <button class="rename" @click="startRename(p.name)" title="Rename project">✎</button>
              <button class="danger" @click="deleteSavedProject(p.name)" title="Delete">
                <Icon name="trash" :size="14" />
              </button>
            </template>
          </li>
        </ul>
        <p v-else class="hint">No saved projects yet.</p>
        <div class="row">
          <button @click="showLoad = false">Close</button>
        </div>
      </div>
    </div>

    <div v-if="showSimulator" class="modal-bg" @click.self="showSimulator = false">
      <div class="modal">
        <h3>Open in Origami Simulator</h3>
        <p class="hint">
          Pop-up was blocked, so the file has been downloaded for you. Drop it into the simulator window.
        </p>
        <div class="row">
          <button class="primary" @click="showSimulator = false">Got it</button>
        </div>
      </div>
    </div>
  </footer>
</template>

<style scoped>
.bottombar { display: flex; flex-wrap: wrap; align-items: center; justify-content: flex-start; gap: 8px; padding: 8px 12px; background: var(--s); border-top: 1px solid var(--bd); }
.status { font-family: 'DM Mono', monospace; font-size: 0.7rem; color: var(--sub); flex: 1 1 240px; min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.status .dim { color: var(--bd); }
.grp { display: flex; gap: 4px; flex-wrap: wrap; }
button, .filebtn { background: var(--bg); color: var(--t); border: 1px solid var(--bd); border-radius: 6px; padding: 6px 9px; font: 500 0.75rem 'DM Sans', sans-serif; cursor: pointer; display: inline-flex; align-items: center; gap: 6px; min-height: 36px; }
button:hover, .filebtn:hover { border-color: var(--ac2); }
button:disabled { opacity: 0.4; cursor: not-allowed; }

.export-pair { display: inline-flex; align-items: stretch; }
.export-pair button { border-top-right-radius: 0; border-bottom-right-radius: 0; padding-right: 8px; }
.export-pair select { background: var(--bg); color: var(--t); border: 1px solid var(--bd); border-left: none; border-top-left-radius: 0; border-bottom-left-radius: 0; border-top-right-radius: 6px; border-bottom-right-radius: 6px; padding: 0 6px; font: 500 0.72rem 'DM Mono'; cursor: pointer; }

.handoff { position: relative; }
.handoff-trigger .chev { font-size: 0.7rem; color: var(--sub); margin-left: 1px; }
.handoff-popover { position: absolute; z-index: 30; right: 0; bottom: calc(100% + 6px); background: var(--s); border: 1px solid var(--bd); border-radius: 8px; padding: 4px; display: flex; flex-direction: column; gap: 2px; box-shadow: 0 6px 20px rgba(0,0,0,0.45); min-width: 200px; }
.handoff-popover button { display: grid; grid-template-columns: 18px 1fr; align-items: center; gap: 10px; padding: 8px 10px; border-radius: 6px; border: 1px solid transparent; background: var(--bg); color: var(--t); font: 500 0.78rem 'DM Sans', sans-serif; cursor: pointer; min-height: 36px; }
.handoff-popover button:hover { background: var(--acd); }
.handoff-label { text-align: left; }

.modal-bg { position: fixed; inset: 0; background: rgba(0,0,0,0.55); display: flex; align-items: center; justify-content: center; z-index: 60; padding: 12px; }
.modal { background: var(--s); border: 1px solid var(--bd); border-radius: 10px; padding: 20px; min-width: min(360px, calc(100vw - 24px)); max-width: 640px; max-height: calc(100vh - 24px); overflow-y: auto; display: flex; flex-direction: column; gap: 14px; }
.modal h3 { margin: 0; font: 500 1rem 'DM Sans'; }
.modal input { background: var(--bg); color: var(--t); border: 1px solid var(--bd); border-radius: 6px; padding: 8px 10px; font: 400 0.85rem 'DM Sans'; }
.modal .row { display: flex; gap: 8px; justify-content: flex-end; }
.modal .row button.primary { background: var(--ac2); border-color: var(--ac2); color: #fff; }
.proj-list { list-style: none; padding: 0; margin: 0; max-height: 320px; overflow-y: auto; display: flex; flex-direction: column; gap: 4px; }
.proj-list li { display: grid; grid-template-columns: 1fr auto auto auto; align-items: center; gap: 12px; padding: 6px 8px; border-radius: 6px; }
.proj-list input { background: var(--bg); color: var(--t); border: 1px solid var(--ac2); border-radius: 4px; padding: 4px 6px; font: 500 0.85rem 'DM Sans'; min-width: 0; }
.rename { background: none; border: none; color: var(--ac2); padding: 4px 8px; min-height: auto; font-size: 0.95rem; cursor: pointer; }
.rename:hover { color: var(--ac); }
.danger { background: none; border: none; color: var(--ac); padding: 4px 6px; cursor: pointer; min-height: auto; }
.proj-list li:hover { background: var(--acd); }
.when { font-family: 'DM Mono', monospace; font-size: 0.7rem; color: var(--sub); }
.hint { font: 400 0.78rem 'DM Mono'; color: var(--sub); }
.link { background: none; border: none; color: var(--ac2); padding: 4px 0; font: 500 0.85rem 'DM Sans'; text-align: left; cursor: pointer; }

@media (max-width: 700px) {
  /* Status text occupies its own first line; all action groups share a
     single row beneath it that wraps as a unit only if it really has to. */
  .bottombar { padding: 12px 8px 14px; gap: 8px; justify-content: flex-start; flex-wrap: wrap; align-items: center; }
  .status { flex: 1 1 100%; width: 100%; text-align: center; white-space: normal; margin-bottom: 2px; }
  .grp { gap: 4px; padding: 2px 0; }
  /* Icons-only on mobile. */
  .lbl { display: none; }
  button, .filebtn { padding: 6px 7px; min-height: 38px; gap: 0; }
  .export-pair select { padding: 0 4px; font-size: 0.65rem; }
}
</style>
