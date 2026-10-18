<script setup>
import TopBar from './components/TopBar.vue';
import Sidebar from './components/Sidebar.vue';
import Inspector from './components/Inspector.vue';
import Viewport from './components/Viewport.vue';
import { state } from './store.js';
</script>

<template>
  <div class="app" :class="`theme-${state.theme}`">
    <TopBar />
    <div class="body">
      <Sidebar v-if="state.ui.sidebar" />
      <main class="canvas-area"><Viewport /></main>
      <Inspector v-if="state.ui.inspector" />
    </div>
  </div>
</template>

<style>
.facetfold-root, .facetfold-root * { box-sizing: border-box; }
.facetfold-root {
  --bg:#0a0a0f; --s:#111118; --bd:#2a2a3a; --t:#e8e8f0; --sub:#7a7a9a;
  --ac:#ff6b35; --ac2:#7b5cfa; --acd:rgba(123,92,250,.12); --canvas-bg:#14141c;
  --ok:#4caf50; --warn:#f5a623; --bad:#ff5252;
  font-family:'DM Sans',sans-serif; background:var(--bg); color:var(--t);
  position:fixed; inset:0; display:flex; touch-action:manipulation;
}
.facetfold-root .app.theme-light {
  --bg:#f5f6fb; --s:#ffffff; --bd:#d5d9e6; --t:#1a1a24; --sub:#5a6078; --canvas-bg:#e4e7ef;
  --acd:rgba(99,71,224,.10); --ac2:#6347e0; background:var(--bg); color:var(--t);
}
.facetfold-root .app { display:flex; flex-direction:column; width:100%; height:100%; }
.facetfold-root .body { display:flex; flex:1; min-height:0; }
.facetfold-root .canvas-area { flex:1; min-width:0; min-height:0; position:relative; }
.facetfold-root aside { width:300px; flex-shrink:0; background:var(--s); overflow:auto; }
.facetfold-root aside.left { border-right:1px solid var(--bd); }
.facetfold-root aside.right { width:340px; border-left:1px solid var(--bd); }
.facetfold-root h3 { margin:0; font:600 11px 'DM Mono',monospace; letter-spacing:.07em; text-transform:uppercase; color:var(--sub); }
.facetfold-root section.blk { padding:12px; border-bottom:1px solid var(--bd); display:flex; flex-direction:column; gap:8px; font-size:12px; }
.facetfold-root label { display:flex; flex-direction:column; gap:3px; color:var(--sub); }
.facetfold-root label.row { flex-direction:row; align-items:center; justify-content:space-between; gap:8px; }
.facetfold-root input, .facetfold-root select { background:var(--bg); color:var(--t); border:1px solid var(--bd); border-radius:5px; padding:5px 6px; font:12px 'DM Sans',sans-serif; min-width:0; }
.facetfold-root input[type=number] { width:78px; }
.facetfold-root input[type=range] { padding:0; width:100%; }
.facetfold-root button { background:var(--bg); color:var(--t); border:1px solid var(--bd); border-radius:6px; padding:5px 9px; font:500 12px 'DM Sans',sans-serif; cursor:pointer; }
.facetfold-root button:hover { border-color:var(--ac2); }
.facetfold-root button.primary { background:var(--ac2); border-color:var(--ac2); color:#fff; }
.facetfold-root button:disabled { opacity:.4; cursor:default; }
.facetfold-root .note { color:var(--sub); line-height:1.4; margin:0; }
.facetfold-root .btns { display:flex; flex-wrap:wrap; gap:6px; }
@media (max-width: 1000px) { .facetfold-root aside { width:240px; } .facetfold-root aside.right { width:260px; } }
@media (max-width: 760px) { .facetfold-root .body { flex-direction:column; overflow:auto; } .facetfold-root aside, .facetfold-root aside.right { width:auto; max-height:45vh; } .facetfold-root .canvas-area { min-height:55vh; } }
</style>
