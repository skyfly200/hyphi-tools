<script setup>
import { state } from '../store.js';
</script>

<template>
  <div class="topbar">
    <div class="title-block">
      <a href="/" class="brand">Hyphi Tools</a>
      <div class="title">PolyForge <span class="badge">alpha</span></div>
      <div v-if="state.currentPatch" class="proj">/ {{ state.currentPatch }}</div>
    </div>

    <div class="actions">
      <button class="mobile-only"
              :class="{ active: state.ui.mobileSidebar }"
              @click="state.ui.mobileSidebar = !state.ui.mobileSidebar"
              title="Parameters">⚙ <span class="lbl">Params</span></button>

      <button @click="state.prefs.theme = state.prefs.theme === 'dark' ? 'light' : 'dark'"
              :title="`Switch to ${state.prefs.theme === 'dark' ? 'light' : 'dark'} theme`">
        {{ state.prefs.theme === 'dark' ? '☀' : '☾' }}
        <span class="lbl">{{ state.prefs.theme === 'dark' ? 'Light' : 'Dark' }}</span>
      </button>

      <button class="mobile-only"
              :class="{ active: state.ui.mobileInspector }"
              @click="state.ui.mobileInspector = !state.ui.mobileInspector"
              title="Patches + exports">≡ <span class="lbl">Info</span></button>
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
.actions { display: flex; gap: 6px; align-items: center; margin-left: auto; flex-wrap: wrap; }
button { background: var(--bg); color: var(--t); border: 1px solid var(--bd); border-radius: 6px; padding: 6px 9px; font: 500 0.75rem 'DM Sans', sans-serif; cursor: pointer; display: inline-flex; align-items: center; gap: 6px; }
button:hover { border-color: var(--ac2); }
button.active { border-color: var(--ac2); background: var(--acd); }
.mobile-only { display: none; }
@media (max-width: 900px) { .mobile-only { display: inline-flex; } }
@media (max-width: 700px) {
  .topbar { padding: 6px 10px; gap: 6px; }
  .brand { font-size: 1.05rem; }
  .title { font-size: 0.8rem; }
  .actions .lbl { display: none; }
}
</style>
