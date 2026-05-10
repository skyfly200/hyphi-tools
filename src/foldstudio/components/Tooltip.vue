<script setup>
import { ref, onMounted, onUnmounted } from 'vue';

// Mobile-only long-press tooltip. Watches for touchstart on any element
// with a [title] attribute, hides the native tooltip (so it doesn't pop up
// alongside ours), and shows a small toast after ~500 ms. The element's
// title is restored on touchend so desktop hover still works.

const visible = ref(false);
const text = ref('');
const x = ref(0);
const y = ref(0);

let timer = null;
let stashedTitle = null;
let stashedEl = null;

function clear() {
  if (timer) { clearTimeout(timer); timer = null; }
  if (stashedEl && stashedTitle != null) {
    stashedEl.setAttribute('title', stashedTitle);
  }
  stashedEl = null;
  stashedTitle = null;
}

function onTouchStart(ev) {
  // Find the nearest [title] ancestor inside the foldstudio root.
  const root = document.querySelector('.foldstudio-root');
  if (!root) return;
  let el = ev.target;
  while (el && el !== root) {
    if (el.hasAttribute && el.hasAttribute('title')) break;
    el = el.parentElement;
  }
  if (!el || el === root) return;
  const t = el.getAttribute('title');
  if (!t) return;
  stashedEl = el;
  stashedTitle = t;
  el.setAttribute('title', '');
  const touch = ev.touches[0];
  timer = setTimeout(() => {
    text.value = t;
    x.value = touch.clientX;
    y.value = touch.clientY;
    visible.value = true;
    setTimeout(() => { visible.value = false; }, 1800);
  }, 500);
}

function onTouchEnd() {
  clear();
}

onMounted(() => {
  window.addEventListener('touchstart', onTouchStart, { passive: true });
  window.addEventListener('touchend', onTouchEnd, { passive: true });
  window.addEventListener('touchcancel', onTouchEnd, { passive: true });
});
onUnmounted(() => {
  window.removeEventListener('touchstart', onTouchStart);
  window.removeEventListener('touchend', onTouchEnd);
  window.removeEventListener('touchcancel', onTouchEnd);
  clear();
});
</script>

<template>
  <Teleport to="body">
    <div v-if="visible" class="tooltip-toast" :style="{ left: x + 'px', top: (y - 36) + 'px' }">
      {{ text }}
    </div>
  </Teleport>
</template>

<style scoped>
.tooltip-toast {
  position: fixed;
  transform: translateX(-50%);
  background: rgba(20, 20, 30, 0.95);
  color: #fff;
  border: 1px solid rgba(123, 92, 250, 0.6);
  border-radius: 6px;
  padding: 6px 10px;
  font: 500 0.72rem 'DM Sans', sans-serif;
  pointer-events: none;
  z-index: 9999;
  max-width: 240px;
  text-align: center;
  box-shadow: 0 6px 20px rgba(0, 0, 0, 0.5);
  white-space: normal;
}
</style>
