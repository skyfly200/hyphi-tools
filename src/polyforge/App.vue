<script setup>
import TopBar from './components/TopBar.vue';
import Sidebar from './components/Sidebar.vue';
import Inspector from './components/Inspector.vue';
import BottomBar from './components/BottomBar.vue';
import CanvasSVG from './components/CanvasSVG.vue';
import { defineAsyncComponent } from 'vue';
import { state } from './store.js';

// Lazy-load the Three.js folded renderer so its ~150KB (gzipped)
// bundle only loads when the user actually opens the Folded view.
const Folded3D = defineAsyncComponent(() => import('./components/Folded3D.vue'));
</script>

<template>
  <div class="app" :class="`theme-${state.prefs.theme}`">
    <TopBar />
    <div class="body"
         :class="{ 'show-sidebar': state.ui.mobileSidebar, 'show-inspector': state.ui.mobileInspector }">
      <div class="backdrop"
           @click="state.ui.mobileSidebar = state.ui.mobileInspector = false"></div>
      <Sidebar />
      <main class="canvas-area">
        <Folded3D v-if="state.prefs.view === 'folded'" />
        <CanvasSVG v-else />
      </main>
      <Inspector />
    </div>
    <BottomBar />
  </div>
</template>

<style>
.polyforge-root, .polyforge-root * { box-sizing: border-box; }
.polyforge-root {
  --bg:#0a0a0f; --s:#111118; --bd:#2a2a3a; --t:#e8e8f0; --sub:#7a7a9a;
  --ac:#ff6b35; --ac2:#7b5cfa; --acd:rgba(123,92,250,.12);
  --canvas-bg:#1a1a24; --paper:#1e1e2a; --paper-stroke:#3a3a4a;
  --fold:#ff6b35; --led:#7b5cfa; --conn:#3fbf7f;
  font-family:'DM Sans',sans-serif; background:var(--bg); color:var(--t);
  position: fixed; inset: 0; display: flex;
  touch-action: manipulation;
}
.polyforge-root .app.theme-light {
  --bg:#f5f6fb; --s:#ffffff; --bd:#d5d9e6; --t:#1a1a24; --sub:#5a6078;
  --ac:#ff6b35; --ac2:#6347e0; --acd:rgba(99,71,224,.10);
  --canvas-bg:#e4e7ef; --paper:#ffffff; --paper-stroke:#b0b6c5;
  --fold:#ff6b35; --led:#6347e0; --conn:#1f9d63;
  background: var(--bg); color: var(--t);
}
.polyforge-root .app { display:flex; flex-direction:column; width:100%; height:100%; }
.polyforge-root .body { display:flex; flex:1; min-height:0; position:relative; }
.polyforge-root .canvas-area { flex:1; display:flex; align-items:stretch; justify-content:stretch; min-width:0; min-height:0; overflow:hidden; }
.polyforge-root .backdrop { display:none; }

@media (max-width: 900px) {
  .polyforge-root .body > aside,
  .polyforge-root .body > .inspector {
    position:absolute; top:0; bottom:0; z-index:20;
    width:min(86vw, 340px);
    transition: transform 0.18s ease;
    box-shadow: 0 0 12px rgba(0,0,0,0.4);
  }
  .polyforge-root .body > aside { left:0; transform: translateX(-101%); }
  .polyforge-root .body > .inspector { right:0; transform: translateX(101%); }
  .polyforge-root .body.show-sidebar > aside { transform: translateX(0); }
  .polyforge-root .body.show-inspector > .inspector { transform: translateX(0); }
  .polyforge-root .body.show-sidebar .backdrop,
  .polyforge-root .body.show-inspector .backdrop {
    display:block; position:absolute; inset:0;
    background: rgba(0,0,0,0.45); z-index:15;
  }
}
</style>
