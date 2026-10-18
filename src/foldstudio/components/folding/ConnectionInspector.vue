<script setup>
import { computed } from 'vue';
import { fs, raw, connectionModes, derivedGroups } from '../../foldingStore.js';
import { deg } from '@hyphi/folding';

const conn = computed(() => { fs.version; return fs.connections.find(c => c.id === fs.selected.connId) || null; });
const angle = computed(() => {
  fs.version;
  const i = raw.compiled?.varIndex.get(fs.selected.connId);
  return i === undefined ? null : deg(fs.angles[i] ?? 0);
});
const mode = computed(() => { fs.version; return connectionModes().get(fs.selected.connId) || 'free'; });
const groupsOf = computed(() => derivedGroups().filter(g => g.connectionIds.includes(fs.selected.connId)).map(g => g.name));
const frame = computed(() => raw.compiled?.frames.get(fs.selected.connId) || null);
const KIND = { idealHinge: 'Ideal hinge', circularBand: 'Finite-width band', segmentedBand: 'Segmented band', rigidJoin: 'Rigid join' };
</script>

<template>
  <div class="ci" v-if="conn">
    <h4>{{ KIND[conn.kind] || conn.kind }}</h4>
    <dl>
      <dt>ID</dt><dd><code>{{ conn.id }}</code></dd>
      <dt>Crease</dt><dd><code>{{ conn.crease }}</code></dd>
      <dt>Assignment</dt><dd>{{ conn.assignment || '—' }}<span v-if="conn.authoredAngleDeg !== null"> · authored {{ conn.authoredAngleDeg }}°</span></dd>
      <dt>Joins</dt><dd><code>{{ conn.a.slice(2, 14) }}</code> ↔ <code>{{ conn.b.slice(2, 14) }}</code></dd>
      <dt>Current angle</dt><dd>{{ angle === null ? '—' : angle.toFixed(2) + '°' }} <small v-if="angle !== null">({{ angle >= 0 ? 'valley' : 'mountain' }})</small></dd>
      <dt>Mode in step</dt><dd><span class="mode" :class="mode">{{ mode }}</span></dd>
      <dt v-if="conn.lengthMm">Band length</dt><dd v-if="conn.lengthMm">{{ conn.lengthMm }} mm</dd>
      <dt v-if="groupsOf.length">Groups</dt><dd v-if="groupsOf.length">{{ groupsOf.join(', ') }}</dd>
      <dt v-if="frame">Edge length</dt><dd v-if="frame">{{ frame.edgeLen.toFixed(2) }} mm</dd>
      <dt>Loop closure</dt><dd>{{ raw.compiled?.closureConnIds.includes(conn.id) ? 'closes a loop (solved)' : 'in spanning tree' }}</dd>
    </dl>
    <p class="note">Hinge width and thickness are set in the header. A hinge's drive/hold/free mode comes from the selected step.</p>
  </div>
  <div v-else class="none">Click a crease in the 2D or 3D view.</div>
</template>

<style scoped>
.ci { padding: 10px; font-size: 12px; } h4 { margin: 0 0 8px; }
dl { display: grid; grid-template-columns: 100px 1fr; gap: 4px 8px; margin: 0; } dt { color: var(--sub); } dd { margin: 0; }
code { font: 11px 'DM Mono', monospace; } small { color: var(--sub); }
.mode { padding: 1px 6px; border-radius: 3px; font: 11px 'DM Mono', monospace; border: 1px solid var(--bd); }
.mode.drive { color: #ff6b35; border-color: #ff6b35; } .mode.hold { color: #4aa3ff; border-color: #4aa3ff; }
.note { color: var(--sub); line-height: 1.4; } .none { padding: 14px; color: var(--sub); }
</style>
