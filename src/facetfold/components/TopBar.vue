<script setup>
import { state, SOLIDS, scheduleRebuild } from '../store.js';
const pick = e => { state.solidId = e.target.value; state.customHinges = null; state.port.enabled = false; state.mounts = []; state.surfaces = {}; scheduleRebuild(0); };
</script>

<template>
  <div class="topbar">
    <a href="/" class="brand">Hyphi Tools</a>
    <div class="title">FacetFold <span class="badge">alpha</span></div>
    <select :value="state.solidId" @change="pick" title="Solid">
      <option v-for="s in SOLIDS" :key="s.id" :value="s.id">{{ s.label }}</option>
    </select>
    <div class="seg">
      <button :class="{ on: state.view === 'folded' }" @click="state.view = 'folded'">Folded</button>
      <button :class="{ on: state.view === 'plate' }" @click="state.view = 'plate'">Print plate</button>
    </div>
    <span class="status" :class="{ bad: state.error || (state.report && !state.report.verification?.ok) }">{{ state.busy ? 'Building…' : state.error || state.status }}</span>
    <div class="right">
      <button @click="state.ui.sidebar = !state.ui.sidebar">Parameters</button>
      <button @click="state.ui.inspector = !state.ui.inspector">Report</button>
      <button @click="state.theme = state.theme === 'dark' ? 'light' : 'dark'">{{ state.theme === 'dark' ? '☀' : '☾' }}</button>
    </div>
  </div>
</template>

<style scoped>
.topbar { display:flex; align-items:center; gap:12px; padding:9px 16px; background:var(--s); border-bottom:1px solid var(--bd); flex-wrap:wrap; }
.brand { font-family:'Bebas Neue',sans-serif; font-size:1.4rem; letter-spacing:.04em; background:linear-gradient(135deg,#ff6b35,#7b5cfa); -webkit-background-clip:text; -webkit-text-fill-color:transparent; text-decoration:none; }
.title { font-weight:500; } .badge { font:.6rem 'DM Mono',monospace; color:var(--ac); border:1px solid var(--ac); padding:1px 5px; border-radius:3px; margin-left:4px; }
.seg { display:inline-flex; } .seg button { border-radius:0; } .seg button:first-child { border-radius:6px 0 0 6px; } .seg button:last-child { border-radius:0 6px 6px 0; }
.seg button.on { background:var(--ac2); border-color:var(--ac2); color:#fff; }
.status { font:12px 'DM Mono',monospace; color:var(--ok); } .status.bad { color:var(--bad); }
.right { margin-left:auto; display:flex; gap:6px; }
</style>
