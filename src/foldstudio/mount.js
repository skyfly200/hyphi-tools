// Mount the Vue FoldStudio app into a host DOM node provided by React.
import { createApp } from 'vue';
import App from './App.vue';

let appInstance = null;

export function mountFoldStudio(el) {
  if (appInstance) appInstance.unmount();
  el.classList.add('foldstudio-root');
  appInstance = createApp(App);
  appInstance.mount(el);
  return () => {
    if (appInstance) { appInstance.unmount(); appInstance = null; }
    el.classList.remove('foldstudio-root');
  };
}
