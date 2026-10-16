<script setup>
// Read-only 2D design view for the fold steps workspace: rigid regions, hinge
// creases (M/V colour) with step-mode halos, and unresolved `U` edges in amber.
import { computed } from 'vue';
import { state } from '../../store.js';
import { fs, raw, connectionModes } from '../../foldingStore.js';

const MODE_COLOR = { drive: '#ff6b35', hold: '#4aa3ff', free: '#9aa0aa' };
const ASSIGN_COLOR = { M: '#e23b3b', V: '#3a7bd5' };

const view = computed(() => {
  fs.version;
  const a = raw.assembly; if (!a) return null;
  const sheet = fs.physical.sheetMm; const pad = sheet * 0.06;
  return { box: `${-pad} ${-pad} ${sheet + 2 * pad} ${sheet + 2 * pad}`, sheet };
});
const regions = computed(() => { fs.version; return (raw.assembly?.regions || []).map((r, i) => ({ id: r.id, polys: (r.polygons || [r.polygon]).map(p => p.map(q => `${q[0]},${fs.physical.sheetMm - q[1]}`).join(' ')), hue: (i * 49) % 360 })); });
const conns = computed(() => {
  fs.version;
  const modes = connectionModes();
  return (raw.assembly?.connections || []).map(c => {
    const e = c.edge, S = fs.physical.sheetMm;
    const orig = c.source?.idealCrease || e;
    return { id: c.id, crease: c.source?.crease ?? c.id, x1: orig.p0[0], y1: S - orig.p0[1], x2: orig.p1[0], y2: S - orig.p1[1],
      color: ASSIGN_COLOR[c.source?.assignment] || '#c9cdd8', halo: MODE_COLOR[modes.get(c.id) || 'free'], mode: modes.get(c.id) || 'free', band: c.type !== 'idealHinge' };
  });
});
const ambiguous = computed(() => {
  fs.version;
  const m = state.model, S = fs.physical.sheetMm;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const [x, y] of m.vertices) { minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y); }
  const k = S / (Math.max(maxX - minX, maxY - minY) || 1);
  return fs.ambiguous.map(i => {
    const e = m.edges.find(x => x.id === i.edgeId); if (!e) return null;
    const a = m.vertices[e.v1], b = m.vertices[e.v2];
    return { id: i.edgeId, crease: i.crease, x1: (a[0] - minX) * k, y1: S - (a[1] - minY) * k, x2: (b[0] - minX) * k, y2: S - (b[1] - minY) * k };
  }).filter(Boolean);
});

function clickConn(c, ev) {
  if (ev.shiftKey) { const i = fs.groupPick.indexOf(c.crease); if (i >= 0) fs.groupPick.splice(i, 1); else fs.groupPick.push(c.crease); }
  fs.selected.connId = c.id; fs.rightTab = 'connection'; fs.version++;
}
function clickRegion(r) { fs.selected.regionId = r.id; fs.version++; }
</script>

<template>
  <div class="p2d">
    <svg v-if="view" :viewBox="view.box" preserveAspectRatio="xMidYMid meet">
      <rect :x="0" :y="0" :width="view.sheet" :height="view.sheet" class="sheet" />
      <g v-for="r in regions" :key="r.id" @click.stop="clickRegion(r)">
        <polygon v-for="(p, i) in r.polys" :key="i" :points="p"
                 :style="{ fill: `hsl(${r.hue} 55% ${fs.selected.regionId === r.id ? 72 : 58}%)`, fillOpacity: fs.selected.regionId === r.id ? 0.7 : 0.35 }" class="region" />
      </g>
      <g v-for="a in ambiguous" :key="a.id" class="amb">
        <line :x1="a.x1" :y1="a.y1" :x2="a.x2" :y2="a.y2" />
      </g>
      <g v-for="c in conns" :key="c.id" class="conn" :class="{ sel: fs.selected.connId === c.id, picked: fs.groupPick.includes(c.crease) }" @click.stop="clickConn(c, $event)">
        <line :x1="c.x1" :y1="c.y1" :x2="c.x2" :y2="c.y2" class="halo" :style="{ stroke: c.halo, opacity: c.mode === 'free' ? 0.0 : 0.55 }" />
        <line :x1="c.x1" :y1="c.y1" :x2="c.x2" :y2="c.y2" class="crease" :style="{ stroke: c.color }" :stroke-dasharray="c.band ? '2 1.2' : null" />
        <line :x1="c.x1" :y1="c.y1" :x2="c.x2" :y2="c.y2" class="hit" />
      </g>
    </svg>
    <div v-else class="empty">No assembly yet</div>
    <div class="legend">
      <span><i style="background:#ff6b35"></i>drive</span><span><i style="background:#4aa3ff"></i>hold</span><span><i style="background:#9aa0aa"></i>free</span>
      <span v-if="ambiguous.length"><i style="background:#f5a623"></i>unclassified U ({{ ambiguous.length }})</span>
    </div>
  </div>
</template>

<style scoped>
.p2d { position: relative; width: 100%; height: 100%; background: var(--canvas-bg); }
svg { width: 100%; height: 100%; display: block; }
.sheet { fill: var(--paper); stroke: var(--paper-stroke); stroke-width: 0.4; }
.region { stroke: var(--paper-stroke); stroke-width: 0.15; cursor: pointer; }
.crease { stroke-width: 0.6; stroke-linecap: round; pointer-events: none; }
.halo { stroke-width: 2.2; stroke-linecap: round; pointer-events: none; }
.hit { stroke: transparent; stroke-width: 3; cursor: pointer; }
.conn.sel .crease { stroke-width: 1.2; stroke: #ffd400 !important; }
.conn.picked .crease { stroke-width: 1.2; }
.amb line { stroke: #f5a623; stroke-width: 0.5; stroke-dasharray: 1.2 1; pointer-events: none; }
.legend { position: absolute; left: 8px; bottom: 6px; display: flex; gap: 10px; font: 11px 'DM Mono', monospace; color: var(--sub); flex-wrap: wrap; }
.legend i { display: inline-block; width: 9px; height: 9px; border-radius: 2px; margin-right: 4px; vertical-align: -1px; }
.empty { display: grid; place-items: center; height: 100%; color: var(--sub); }
</style>
