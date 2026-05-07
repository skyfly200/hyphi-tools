<script setup>
import TopBar from './components/TopBar.vue';
import Toolbar from './components/Toolbar.vue';
import CanvasSVG from './components/CanvasSVG.vue';
import Sidebar from './components/Sidebar.vue';
import Inspector from './components/Inspector.vue';
import { state } from './store.js';
</script>

<template>
  <div class="app">
    <TopBar />
    <Toolbar />

    <div class="body">
      <Sidebar />
      <main class="canvas-area"><CanvasSVG /></main>
      <Inspector />
    </div>

    <footer class="status">{{ state.status }} · tool: {{ state.tool }} · paint: {{ state.assignment }}</footer>
  </div>
</template>

<style>
.foldstudio-root, .foldstudio-root * { box-sizing: border-box; }
.foldstudio-root {
  --bg:#0a0a0f; --s:#111118; --bd:#2a2a3a; --t:#e8e8f0; --sub:#7a7a9a; --ac:#ff6b35; --ac2:#7b5cfa; --acd:rgba(123,92,250,.12);
  font-family:'DM Sans',sans-serif; background:var(--bg); color:var(--t);
  position: fixed; inset: 0; display: flex;
}
.foldstudio-root .app { display: flex; flex-direction: column; width: 100%; height: 100%; }
.foldstudio-root .body { display: flex; flex: 1; min-height: 0; }
.foldstudio-root .canvas-area { flex: 1; display: flex; align-items: stretch; justify-content: stretch; min-width: 0; min-height: 0; overflow: hidden; }
.foldstudio-root .status { font-family: 'DM Mono', monospace; font-size: 0.7rem; color: var(--sub); padding: 8px 18px; border-top: 1px solid var(--bd); background: var(--s); }
</style>
