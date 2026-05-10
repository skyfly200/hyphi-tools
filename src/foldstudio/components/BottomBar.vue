<script setup>
import { ref } from 'vue';
import {
  state, loadModel, cleanup, saveCurrentProject,
  loadSavedProject, deleteSavedProject,
} from '../store.js';
import {
  modelToFOLD, foldToModel, modelToSVG, downloadJSON, downloadText,
} from '../lib/fold-io.js';
import { setHandoff } from '../../lib/foldHandoff.js';
import Icon from './Icon.vue';
import NewProjectModal from './NewProjectModal.vue';

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
    <div class="grp project">
      <button @click="showNew = true" title="Start a new project (blank or template)">
        <Icon name="newDoc" /><span class="lbl">New</span>
      </button>
      <button @click="cleanup" title="Remove redundant vertices">
        <Icon name="broom" /><span class="lbl">Cleanup</span>
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

    <div class="grp handoff">
      <button @click="openInOrigamiSimulator" title="Open in Origami Simulator">
        <Icon name="external" /><span class="lbl">Simulator</span>
      </button>
      <button @click="openInTool('/foldform')" title="Open this pattern in FoldForm">
        <Icon name="foldform" /><span class="lbl">FoldForm</span>
      </button>
      <button @click="openInTool('/fold')" title="Open this pattern in FoldPress">
        <Icon name="foldpress" /><span class="lbl">FoldPress</span>
      </button>
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
            <button class="link" @click="loadSavedProject(p.name); showLoad = false">
              {{ p.name }}
            </button>
            <span class="when">{{ fmt(p.savedAt) }}</span>
            <button class="danger" @click="deleteSavedProject(p.name)" title="Delete">
              <Icon name="trash" :size="14" />
            </button>
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
.bottombar { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 8px; padding: 8px 12px; background: var(--s); border-top: 1px solid var(--bd); }
.grp { display: flex; gap: 4px; flex-wrap: wrap; }
button, .filebtn { background: var(--bg); color: var(--t); border: 1px solid var(--bd); border-radius: 6px; padding: 6px 9px; font: 500 0.75rem 'DM Sans', sans-serif; cursor: pointer; display: inline-flex; align-items: center; gap: 6px; min-height: 36px; }
button:hover, .filebtn:hover { border-color: var(--ac2); }
button:disabled { opacity: 0.4; cursor: not-allowed; }

.export-pair { display: inline-flex; align-items: stretch; }
.export-pair button { border-top-right-radius: 0; border-bottom-right-radius: 0; padding-right: 8px; }
.export-pair select { background: var(--bg); color: var(--t); border: 1px solid var(--bd); border-left: none; border-top-left-radius: 0; border-bottom-left-radius: 0; border-top-right-radius: 6px; border-bottom-right-radius: 6px; padding: 0 6px; font: 500 0.72rem 'DM Mono'; cursor: pointer; }

.modal-bg { position: fixed; inset: 0; background: rgba(0,0,0,0.55); display: flex; align-items: center; justify-content: center; z-index: 60; padding: 12px; }
.modal { background: var(--s); border: 1px solid var(--bd); border-radius: 10px; padding: 20px; min-width: min(360px, calc(100vw - 24px)); max-width: 640px; max-height: calc(100vh - 24px); overflow-y: auto; display: flex; flex-direction: column; gap: 14px; }
.modal h3 { margin: 0; font: 500 1rem 'DM Sans'; }
.modal input { background: var(--bg); color: var(--t); border: 1px solid var(--bd); border-radius: 6px; padding: 8px 10px; font: 400 0.85rem 'DM Sans'; }
.modal .row { display: flex; gap: 8px; justify-content: flex-end; }
.modal .row button.primary { background: var(--ac2); border-color: var(--ac2); color: #fff; }
.proj-list { list-style: none; padding: 0; margin: 0; max-height: 320px; overflow-y: auto; display: flex; flex-direction: column; gap: 4px; }
.proj-list li { display: grid; grid-template-columns: 1fr auto auto; align-items: center; gap: 12px; padding: 6px 8px; border-radius: 6px; }
.danger { background: none; border: none; color: var(--ac); padding: 4px 6px; cursor: pointer; min-height: auto; }
.proj-list li:hover { background: var(--acd); }
.when { font-family: 'DM Mono', monospace; font-size: 0.7rem; color: var(--sub); }
.hint { font: 400 0.78rem 'DM Mono'; color: var(--sub); }
.link { background: none; border: none; color: var(--ac2); padding: 4px 0; font: 500 0.85rem 'DM Sans'; text-align: left; cursor: pointer; }

@media (max-width: 700px) {
  .bottombar { padding: 6px 8px; gap: 4px; justify-content: center; }
  /* Icons-only on mobile so all the file actions fit on one row. */
  .lbl { display: none; }
  button, .filebtn { padding: 6px 8px; min-height: 36px; gap: 0; }
  .grp { gap: 3px; }
  .export-pair select { padding: 0 4px; font-size: 0.65rem; }
}
</style>
