<script setup>
import { computed } from 'vue';
import { iconSvg } from './icons.js';
const props = defineProps({ name: String, size: { type: Number, default: 18 } });
const html = computed(() => iconSvg(props.name, props.size));
</script>
<template><span class="ico" v-html="html" /></template>
<style scoped>
.ico { display: inline-flex; align-items: center; justify-content: center; line-height: 0; }
</style>
