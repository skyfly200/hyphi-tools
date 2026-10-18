import { createApp } from 'vue';
import App from './App.vue';
import { rebuild } from './store.js';

let appInstance = null;

export function mountFacetFold(el) {
  if (appInstance) appInstance.unmount();
  el.classList.add('facetfold-root');
  appInstance = createApp(App);
  appInstance.mount(el);
  rebuild();
  return () => { if (appInstance) { appInstance.unmount(); appInstance = null; } el.classList.remove('facetfold-root'); };
}
