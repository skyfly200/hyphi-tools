// Mount the Vue FoldStudio app into a host DOM node provided by React.
import { createApp } from 'vue';
import App from './App.vue';
import { loadModel } from './store.js';
import { foldToModel } from './lib/fold-io.js';
import { takeHandoff } from '../lib/foldHandoff.js';

let appInstance = null;

export function mountFoldStudio(el) {
  if (appInstance) appInstance.unmount();
  el.classList.add('foldstudio-root');

  // If we arrived here via "Edit in FoldStudio" from another tool, pull the
  // handoff FOLD off sessionStorage and replace the working model with it.
  const handoff = takeHandoff();
  if (handoff) {
    try { loadModel(foldToModel(handoff)); } catch {}
  }

  appInstance = createApp(App);
  appInstance.mount(el);
  return () => {
    if (appInstance) { appInstance.unmount(); appInstance = null; }
    el.classList.remove('foldstudio-root');
  };
}
