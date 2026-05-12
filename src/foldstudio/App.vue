<script setup>
import TopBar from './components/TopBar.vue';
import Toolbar from './components/Toolbar.vue';
import BottomBar from './components/BottomBar.vue';
import CanvasSVG from './components/CanvasSVG.vue';
import Sidebar from './components/Sidebar.vue';
import Inspector from './components/Inspector.vue';
import Tooltip from './components/Tooltip.vue';
import { state } from './store.js';
</script>

<template>
  <div class="app" :class="`theme-${state.theme}`">
    <TopBar />
    <Toolbar />

    <div class="body" :class="{ 'show-sidebar': state.ui.mobileSidebar, 'show-inspector': state.ui.mobileInspector }">
      <div class="backdrop"
           @click="state.ui.mobileSidebar = state.ui.mobileInspector = false"></div>
      <Sidebar />
      <main class="canvas-area"><CanvasSVG /></main>
      <Inspector />
    </div>

    <BottomBar />
    <Tooltip />
  </div>
</template>

<style>
.foldstudio-root, .foldstudio-root * { box-sizing: border-box; }
.foldstudio-root {
  /* Dark theme is the default; CSS vars get redeclared inside .theme-light. */
  --bg:#0a0a0f; --s:#111118; --bd:#2a2a3a; --t:#e8e8f0; --sub:#7a7a9a;
  --ac:#ff6b35; --ac2:#7b5cfa; --acd:rgba(123,92,250,.12);
  --canvas-bg:#1a1a24; --paper:#ffffff; --paper-stroke:#dddddd;
  --grid-line:#9aa3b8; --grid-node:#6e7488; --vertex:#222222;
  font-family:'DM Sans',sans-serif; background:var(--bg); color:var(--t);
  position: fixed; inset: 0; display: flex;
  /* Prevent the editor from triggering mobile browser zoom on double-tap. */
  touch-action: manipulation;
}
/* Light theme overrides — vars inherit down, so every component repaints. */
.foldstudio-root .app.theme-light {
  --bg:#f5f6fb; --s:#ffffff; --bd:#d5d9e6; --t:#1a1a24; --sub:#5a6078;
  --ac:#ff6b35; --ac2:#6347e0; --acd:rgba(99,71,224,.10);
  --canvas-bg:#e4e7ef; --paper:#ffffff; --paper-stroke:#b0b6c5;
  --grid-line:#b0b6c5; --grid-node:#8a91a4; --vertex:#1a1a24;
  background: var(--bg); color: var(--t);
}
.foldstudio-root .app { display: flex; flex-direction: column; width: 100%; height: 100%; }
.foldstudio-root .body { display: flex; flex: 1; min-height: 0; position: relative; }
.foldstudio-root .canvas-area { flex: 1; display: flex; align-items: stretch; justify-content: stretch; min-width: 0; min-height: 0; overflow: hidden; }
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
}
</style>
