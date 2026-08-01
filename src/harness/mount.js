// Mount the Vue Harness Calculator app into a host DOM node provided by React.
import { createApp } from 'vue';
import { createVuetify } from 'vuetify';
import * as components from 'vuetify/components';
import * as directives from 'vuetify/directives';
import 'vuetify/styles';
import '@mdi/font/css/materialdesignicons.css';
import App from './App.vue';

const vuetify = createVuetify({
  components,
  directives,
  theme: {
    defaultTheme: 'harnessDark',
    themes: {
      harnessDark: {
        dark: true,
        colors: {
          background: '#0A0F16',
          surface: '#101826',
          primary: '#4FD1E8',
          secondary: '#F5A623',
          error: '#E05C6B',
          info: '#4FD1E8',
        },
      },
    },
  },
});

let appInstance = null;

export function mountHarness(el) {
  if (appInstance) appInstance.unmount();
  el.classList.add('harness-root');
  appInstance = createApp(App);
  appInstance.use(vuetify);
  appInstance.mount(el);
  return () => {
    if (appInstance) { appInstance.unmount(); appInstance = null; }
    el.classList.remove('harness-root');
  };
}
