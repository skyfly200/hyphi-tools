// Mount the Vue PolyForge app into a host DOM node provided by React.
import { createApp } from 'vue';
import App from './App.vue';

let appInstance = null;

export function mountPolyForge(el) {
  if (appInstance) appInstance.unmount();
  el.classList.add('polyforge-root');
  appInstance = createApp(App);
  appInstance.mount(el);
  return () => {
    if (appInstance) { appInstance.unmount(); appInstance = null; }
    el.classList.remove('polyforge-root');
  };
}
