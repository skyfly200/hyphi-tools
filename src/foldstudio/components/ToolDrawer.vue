<script setup>
import { ref } from 'vue';
import Icon from './Icon.vue';

const props = defineProps({
  tools: { type: Array, required: true },   // [{ id, icon, label, key }]
  activeId: String,                          // id of the currently-active tool (may not be in this drawer)
  label: { type: String, required: true },   // drawer label (e.g. "Construct")
  fallbackIcon: { type: String, required: true },
});
const emit = defineEmits(['pick']);

const open = ref(false);
function pick(id) {
  emit('pick', id);
  open.value = false;
}
function closeMenu() { open.value = false; }

const vClickOutside = {
  mounted(el, binding) {
    el.__co__ = (ev) => { if (!el.contains(ev.target)) binding.value(); };
    setTimeout(() => document.addEventListener('pointerdown', el.__co__), 0);
  },
  unmounted(el) {
    if (el.__co__) document.removeEventListener('pointerdown', el.__co__);
  },
};

import { computed } from 'vue';
const activeInDrawer = computed(() => props.tools.find(t => t.id === props.activeId));
const triggerIcon = computed(() => activeInDrawer.value?.icon || props.fallbackIcon);
</script>

<template>
  <div class="drawer" v-click-outside="closeMenu">
    <button class="drawer-trigger"
            :class="{ active: !!activeInDrawer }"
            @click="open = !open"
            :title="`${label} tools`">
      <Icon :name="triggerIcon" />
      <span class="lbl">{{ activeInDrawer ? activeInDrawer.label : label }}</span>
      <Icon name="chevron" :size="14" />
    </button>
    <div v-if="open" class="drawer-pop">
      <button v-for="t in tools" :key="t.id"
              :class="{ on: activeId === t.id }"
              @click="pick(t.id)"
              :title="`${t.label}${t.key ? ' (' + t.key + ')' : ''}`">
        <Icon :name="t.icon" />
        <span class="name">{{ t.label }}</span>
        <span v-if="t.key" class="kbd">{{ t.key }}</span>
      </button>
    </div>
  </div>
</template>

<style scoped>
.drawer { position: relative; display: inline-flex; }
.drawer-trigger { display: inline-flex; align-items: center; gap: 5px; background: var(--bg); color: var(--t); border: 1px solid var(--bd); border-radius: 6px; padding: 6px 8px; font: 500 0.75rem 'DM Sans', sans-serif; cursor: pointer; min-height: 34px; }
.drawer-trigger.active { background: var(--acd); border-color: var(--ac2); }
.drawer-trigger :deep(svg:last-child) { opacity: 0.55; }
.drawer-pop { position: absolute; z-index: 30; left: 0; top: calc(100% + 6px); background: var(--s); border: 1px solid var(--bd); border-radius: 8px; padding: 4px; display: flex; flex-direction: column; gap: 2px; box-shadow: 0 6px 20px rgba(0,0,0,0.45); min-width: 180px; }
.drawer-pop button { display: grid; grid-template-columns: 18px 1fr auto; align-items: center; gap: 10px; padding: 7px 10px; border-radius: 6px; border: 1px solid transparent; background: var(--bg); color: var(--t); font: 500 0.78rem 'DM Sans', sans-serif; cursor: pointer; min-height: 34px; }
.drawer-pop button:hover { background: var(--acd); }
.drawer-pop button.on { border-color: var(--ac2); background: var(--acd); }
.drawer-pop .name { text-align: left; }
.drawer-pop .kbd { font: 500 0.66rem 'DM Mono', monospace; color: var(--sub); background: var(--bg); border: 1px solid var(--bd); border-radius: 3px; padding: 0 4px; }
@media (max-width: 900px) {
  .drawer-trigger { padding: 6px 7px; min-height: 36px; }
  .drawer-trigger .lbl { display: none; }
}
</style>
