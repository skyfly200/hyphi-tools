<script setup>
import { ref, computed } from 'vue';
import {
  state, loadModel, resetPaper,
  saveCurrentProject, loadSavedProject, deleteSavedProject,
} from '../store.js';
import { modelToFOLD, foldToModel, modelToSVG, downloadJSON, downloadText } from '../lib/fold-io.js';
import Icon from './Icon.vue';

const showSave = ref(false);
const showLoad = ref(false);
const projectName = ref('');

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

function exportFold() {
  downloadJSON((state.currentProject || 'pattern') + '.fold', modelToFOLD(state.model, { ids: true }));
}
function exportSVG() {
  downloadText((state.currentProject || 'pattern') + '.svg', modelToSVG(state.model));
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

const fmt = ts => new Date(ts).toLocaleString();
</script>

<template>
  <div class="topbar">
    <div class="title-block">
      <a href="/" class="brand">Hyphi Tools</a>
      <div class="title">FoldStudio <span class="badge">beta</span></div>
      <div v-if="state.currentProject" class="proj">/ {{ state.currentProject }}</div>
    </div>

    <div class="actions">
      <button @click="resetPaper" title="New blank paper">
        <Icon name="newDoc" /><span>New</span>
      </button>
      <button @click="openSave" title="Save project to browser">
        <Icon name="save" /><span>Save</span>
      </button>
      <button @click="showLoad = true" title="Open saved project">
        <Icon name="open" /><span>Open</span>
      </button>

      <div class="divider" />

      <label class="filebtn" title="Import .fold file">
        <Icon name="upload" /><span>Import</span>
        <input type="file" accept=".fold,application/json" @change="importFile" hidden />
      </label>
      <button @click="exportFold" title="Export FOLD JSON">
        <Icon name="download" /><span>FOLD</span>
      </button>
      <button @click="exportSVG" title="Export SVG">
        <Icon name="download" /><span>SVG</span>
      </button>
    </div>

    <!-- Save modal -->
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

    <!-- Load modal -->
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
  </div>
</template>

<style scoped>
.topbar { display: flex; align-items: center; gap: 14px; padding: 10px 18px; background: var(--s); border-bottom: 1px solid var(--bd); flex-wrap: wrap; }
.title-block { display: flex; align-items: baseline; gap: 12px; }
.brand { font-family: 'Bebas Neue', sans-serif; font-size: 1.4rem; letter-spacing: 0.04em; background: linear-gradient(135deg, #ff6b35, #7b5cfa); -webkit-background-clip: text; -webkit-text-fill-color: transparent; background-clip: text; text-decoration: none; }
.title { font-weight: 500; font-size: 0.95rem; }
.badge { font-family: 'DM Mono', monospace; font-size: 0.6rem; color: var(--ac); border: 1px solid var(--ac); padding: 1px 5px; border-radius: 3px; margin-left: 4px; vertical-align: middle; }
.proj { font-family: 'DM Mono', monospace; font-size: 0.78rem; color: var(--sub); }
.actions { display: flex; gap: 4px; align-items: center; margin-left: auto; flex-wrap: wrap; }
.divider { width: 1px; align-self: stretch; background: var(--bd); margin: 0 6px; }
button, .filebtn { background: var(--bg); color: var(--t); border: 1px solid var(--bd); border-radius: 6px; padding: 6px 9px; font: 500 0.75rem 'DM Sans', sans-serif; cursor: pointer; display: inline-flex; align-items: center; gap: 6px; }
button:hover, .filebtn:hover { border-color: var(--ac2); }
button.primary { background: var(--ac2); border-color: var(--ac2); color: #fff; }
button:disabled { opacity: 0.4; cursor: not-allowed; }
button.link { background: none; border: none; color: var(--ac2); padding: 4px 0; font-weight: 500; text-align: left; }
button.link:hover { text-decoration: underline; }
button.danger { color: var(--ac); padding: 4px 6px; }

.modal-bg { position: fixed; inset: 0; background: rgba(0,0,0,0.55); display: flex; align-items: center; justify-content: center; z-index: 50; }
.modal { background: var(--s); border: 1px solid var(--bd); border-radius: 10px; padding: 20px; min-width: 320px; display: flex; flex-direction: column; gap: 14px; }
.modal.wide { min-width: 420px; }
.modal h3 { margin: 0; font: 500 1rem 'DM Sans'; }
.modal input { background: var(--bg); color: var(--t); border: 1px solid var(--bd); border-radius: 6px; padding: 8px 10px; font: 400 0.85rem 'DM Sans'; }
.modal .row { display: flex; gap: 8px; justify-content: flex-end; }
.proj-list { list-style: none; padding: 0; margin: 0; max-height: 320px; overflow-y: auto; display: flex; flex-direction: column; gap: 2px; }
.proj-list li { display: grid; grid-template-columns: 1fr auto auto; align-items: center; gap: 12px; padding: 6px 8px; border-radius: 6px; }
.proj-list li:hover { background: var(--acd); }
.when { font-family: 'DM Mono', monospace; font-size: 0.7rem; color: var(--sub); }
.hint { font-family: 'DM Mono', monospace; font-size: 0.78rem; color: var(--sub); }
</style>
