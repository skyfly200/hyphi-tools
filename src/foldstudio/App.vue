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

    <div class="body" :class="{ 'show-sidebar': state.ui.mobileSidebar, 'show-inspector': state.ui.mobileInspector }">
      <!-- Backdrop appears below drawer on mobile to dismiss when tapped. -->
      <div class="backdrop"
           @click="state.ui.mobileSidebar = state.ui.mobileInspector = false"></div>
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
  /* Prevent the editor from triggering mobile browser zoom on double-tap. */
  touch-action: manipulation;
}
.foldstudio-root .app { display: flex; flex-direction: column; width: 100%; height: 100%; }
.foldstudio-root .body { display: flex; flex: 1; min-height: 0; position: relative; }
.foldstudio-root .canvas-area { flex: 1; display: flex; align-items: stretch; justify-content: stretch; min-width: 0; min-height: 0; overflow: hidden; }
.foldstudio-root .status { font-family: 'DM Mono', monospace; font-size: 0.7rem; color: var(--sub); padding: 6px 14px; border-top: 1px solid var(--bd); background: var(--s); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.foldstudio-root .backdrop { display: none; }

/* Mobile: collapse Sidebar + Inspector into off-canvas drawers, taken out of
   the flex flow so the canvas always fills the available width. */
@media (max-width: 900px) {
  .foldstudio-root .body > aside,
  .foldstudio-root .body > .inspector {
    position: absolute;
    top: 0; bottom: 0;
    z-index: 20;
    width: min(82vw, 320px);
    transition: transform 0.18s ease;
    box-shadow: 0 0 12px rgba(0,0,0,0.4);
  }
  .foldstudio-root .body > aside { left: 0; transform: translateX(-101%); }
  .foldstudio-root .body > .inspector { right: 0; transform: translateX(101%); }
  .foldstudio-root .body.show-sidebar > aside { transform: translateX(0); }
  .foldstudio-root .body.show-inspector > .inspector { transform: translateX(0); }
  .foldstudio-root .body.show-sidebar .backdrop,
  .foldstudio-root .body.show-inspector .backdrop {
    display: block;
    position: absolute;
    inset: 0;
    background: rgba(0,0,0,0.45);
    z-index: 15;
  }
  .foldstudio-root .status { font-size: 0.62rem; padding: 5px 10px; }
}
</style>
