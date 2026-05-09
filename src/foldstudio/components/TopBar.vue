<script setup>
import { ref } from 'vue';
import { state } from '../store.js';
import Icon from './Icon.vue';

const showHelp = ref(false);
</script>

<template>
  <div class="topbar">
    <div class="title-block">
      <a href="/" class="brand">Hyphi Tools</a>
      <div class="title">FoldStudio <span class="badge">beta</span></div>
      <div v-if="state.currentProject" class="proj">/ {{ state.currentProject }}</div>
    </div>

    <div class="actions">
      <button class="panel-toggle mobile-only"
              :class="{ active: state.ui.mobileSidebar }"
              @click="state.ui.mobileSidebar = !state.ui.mobileSidebar"
              title="Show grid / labels / tool options drawer">
        <Icon name="panelLeft" /><span class="lbl">Tools</span>
      </button>

      <button @click="showHelp = true" title="Help / shortcuts / FOLD basics">
        <span class="qmark">?</span><span class="lbl">Help</span>
      </button>

      <button class="panel-toggle mobile-only"
              :class="{ active: state.ui.mobileInspector }"
              @click="state.ui.mobileInspector = !state.ui.mobileInspector"
              title="Show selection / fold angle / validation drawer">
        <Icon name="panelRight" /><span class="lbl">Info</span>
      </button>
    </div>

    <!-- Help modal -->
    <div v-if="showHelp" class="modal-bg" @click.self="showHelp = false">
      <div class="modal help">
        <h3>FoldStudio · Help</h3>
        <div class="help-grid">
          <section>
            <h4>Tools</h4>
            <dl>
              <dt>Draw <kbd>D</kbd></dt><dd>Click two points to place a crease. Snaps to grid + existing vertices. Esc cancels mid-draw.</dd>
              <dt>Select <kbd>S</kbd></dt><dd>Click an edge to select. Shift-click adds. <kbd>1</kbd>–<kbd>5</kbd> reassigns M/V/B/F/U.</dd>
              <dt>Mirror <kbd>M</kbd></dt><dd>Reflect selected creases across the H or V axis (Inspector). Optionally flip M↔V.</dd>
              <dt>Rotate <kbd>R</kbd></dt><dd>Repeat selected creases rotationally or translationally (Inspector controls count, angle, center).</dd>
              <dt>Angle <kbd>A</kbd></dt><dd>Click an anchor point, the crease extends at the configured angle/length from there.</dd>
            </dl>
          </section>

          <section>
            <h4>Crease types</h4>
            <dl>
              <dt><span class="sw" style="background:#e23b3b"></span>M Mountain</dt><dd>Folds away from you (default angle −180°).</dd>
              <dt><span class="sw" style="background:#3a7bd5"></span>V Valley</dt><dd>Folds toward you (default angle +180°).</dd>
              <dt><span class="sw" style="background:#111"></span>B Border</dt><dd>Paper boundary, doesn't fold.</dd>
              <dt><span class="sw" style="background:#999"></span>F Flat</dt><dd>Drawn but flat (0°), used as a reference line.</dd>
              <dt><span class="sw" style="background:#777"></span>U Unknown</dt><dd>Type not yet decided.</dd>
            </dl>
          </section>

          <section>
            <h4>Shortcuts</h4>
            <dl>
              <dt><kbd>Ctrl/⌘</kbd>+<kbd>Z</kbd></dt><dd>Undo</dd>
              <dt><kbd>Ctrl/⌘</kbd>+<kbd>Shift</kbd>+<kbd>Z</kbd></dt><dd>Redo</dd>
              <dt><kbd>Ctrl/⌘</kbd>+<kbd>A</kbd></dt><dd>Select all edges</dd>
              <dt><kbd>Del</kbd> / <kbd>Backspace</kbd></dt><dd>Delete selected edges</dd>
              <dt><kbd>1</kbd>–<kbd>5</kbd></dt><dd>Set paint to M / V / B / F / U</dd>
              <dt><kbd>Esc</kbd></dt><dd>Cancel current draw or clear selection</dd>
            </dl>
          </section>

          <section>
            <h4>Fold angles &amp; simulation</h4>
            <p>By default M = −180°, V = +180°, F = 0°. With edges selected, the Inspector lets you override the angle to model partial folds. <strong>Open in Simulator</strong> sends the FOLD with these angles to <a href="https://origamisimulator.org" target="_blank" rel="noopener">origamisimulator.org</a>.</p>
            <p>If a vertex has a red ring, it doesn't fold flat. Hover the issue in the Inspector for the explanation.</p>
          </section>

          <section>
            <h4>Storage</h4>
            <p>Projects and preferences are stored in your browser's localStorage — they don't leave this machine. Use Export FOLD to back them up.</p>
          </section>
        </div>
        <div class="row">
          <button class="primary" @click="showHelp = false">Got it</button>
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

.modal-bg { position: fixed; inset: 0; background: rgba(0,0,0,0.55); display: flex; align-items: center; justify-content: center; z-index: 50; padding: 12px; }
.modal { background: var(--s); border: 1px solid var(--bd); border-radius: 10px; padding: 20px; min-width: 320px; max-width: calc(100vw - 24px); max-height: calc(100vh - 24px); overflow-y: auto; display: flex; flex-direction: column; gap: 14px; }
.modal.wide { min-width: min(420px, calc(100vw - 24px)); }
.modal h3 { margin: 0; font: 500 1rem 'DM Sans'; }
.modal input { background: var(--bg); color: var(--t); border: 1px solid var(--bd); border-radius: 6px; padding: 8px 10px; font: 400 0.85rem 'DM Sans'; }
.modal .row { display: flex; gap: 8px; justify-content: flex-end; }
.proj-list { list-style: none; padding: 0; margin: 0; max-height: 320px; overflow-y: auto; display: flex; flex-direction: column; gap: 2px; }
.proj-list li { display: grid; grid-template-columns: 1fr auto auto; align-items: center; gap: 12px; padding: 6px 8px; border-radius: 6px; }
.proj-list li:hover { background: var(--acd); }
.when { font-family: 'DM Mono', monospace; font-size: 0.7rem; color: var(--sub); }
.hint { font-family: 'DM Mono', monospace; font-size: 0.78rem; color: var(--sub); }

.qmark { font-weight: 700; color: var(--ac2); width: 14px; text-align: center; }
.steps { padding-left: 20px; margin: 0; display: flex; flex-direction: column; gap: 6px; font-size: 0.82rem; color: var(--t); line-height: 1.5; }
.steps strong { color: var(--ac2); font-weight: 500; }
.modal.help { min-width: min(640px, calc(100vw - 24px)); max-width: 760px; max-height: 85vh; overflow-y: auto; }
.help-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 18px 28px; }
@media (max-width: 760px) {
  .help-grid { grid-template-columns: 1fr; gap: 14px; }
  .modal { padding: 16px; }
}
.help-grid section { display: flex; flex-direction: column; gap: 6px; }
.help-grid h4 { font: 500 0.8rem 'DM Sans'; color: var(--ac2); margin: 0; padding-bottom: 4px; border-bottom: 1px solid var(--bd); }
.help-grid dl { display: grid; grid-template-columns: max-content 1fr; gap: 4px 12px; margin: 0; font-size: 0.8rem; }
.help-grid dt { color: var(--t); font-weight: 500; display: flex; align-items: center; gap: 6px; }
.help-grid dd { color: var(--sub); margin: 0; line-height: 1.45; }
.help-grid p { margin: 0; font-size: 0.8rem; color: var(--sub); line-height: 1.5; }
.help-grid p strong { color: var(--t); font-weight: 500; }
.help-grid p a { color: var(--ac2); }
.help-grid kbd { background: var(--bg); border: 1px solid var(--bd); border-radius: 3px; padding: 0 5px; font: 500 0.7rem 'DM Mono', monospace; color: var(--t); }
.help-grid .sw { display: inline-block; width: 10px; height: 10px; border-radius: 2px; }

.mobile-only { display: none; }

/* Mobile compaction: drop button labels (icon survives), shrink padding,
   ensure wrap. Only .lbl is hidden so the icon span keeps rendering. */
@media (max-width: 700px) {
  .topbar { padding: 8px 10px; gap: 8px; }
  .brand { font-size: 1.1rem; }
  .title { font-size: 0.85rem; }
  .actions .lbl { font-size: 0.6rem; }
  .actions button, .actions .filebtn { padding: 6px 8px; min-height: 40px; }
  .mobile-only { display: inline-flex; }
}
</style>
