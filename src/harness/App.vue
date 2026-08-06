<script setup>
import { reactive, ref, computed, defineAsyncComponent } from 'vue';

// Lazy-load the Three.js 3D view so its bundle only loads when opened.
const Harness3D = defineAsyncComponent(() => import('./Harness3D.vue'));

// ---- palette ----
const POWER = '#F5A623';
const DATA = '#4FD1E8';
const CORE = '#5B6B82';
const BG = '#0A0F16';
const PANEL = '#101826';
const LINE = '#1E2A3B';
const TEXT = '#DCE6F2';
const DIM = '#7A8AA0';

let idSeq = 1;
const nextId = () => idSeq++;

const defaultNode = (segLen = 60) => ({ id: nextId(), segLen, branchLen: 70, powerTap: true });
const defaultFork = (label) => ({ label, branchLen: 60, powerTap: true, hasData: true, dataSource: 'chain' });

// deterministic pseudo-random 0..1 per index, stable across re-renders
function seededRandom(i) {
  const x = Math.sin(i * 12.9898 + 78.233) * 43758.5453;
  return x - Math.floor(x);
}
// multiplier for node i of n: base->tip taper plus organic jitter
function growthMultiplier(i, n, taper, jitter) {
  const posFrac = n > 1 ? i / (n - 1) : 0; // 0 = base (near driver), 1 = tip
  const base = 1 + taper * (1 - 2 * posFrac);
  const j = jitter * (seededRandom(i) * 2 - 1);
  return Math.max(0.15, base * (1 + j));
}
function segPx(mm) { return Math.max(34, Math.min(110, mm * 1.05 + 22)); }
function branchPx(mm) { return Math.max(30, Math.min(100, mm * 0.8 + 18)); }

// ---- state ----
const nodes = reactive([defaultNode(0), defaultNode(55), defaultNode(48), defaultNode(62)]);
const slack = ref(8);
const leadIn = ref(50);

const forkEnabled = ref(true);
const forkDistance = ref(40);
const forkGap = ref(6);
const forkA = reactive(defaultFork('A'));
const forkB = reactive({ ...defaultFork('B'), powerTap: false, dataSource: 'sibling' });

const taper = ref(0);
const jitter = ref(0);
const scaleBranches = ref(true); // scale branch lengths along with core segments

// Twisting: each conductor follows a helix, so its cut length exceeds the
// straight axial run by sqrt(1 + (2*pi*R*n)^2), where n is turns per unit
// length and R is the helix radius of that conductor.
//  - Core bundle wires twist AROUND a central core -> larger radius.
//  - Stem wires twist directly together -> radius set by wire packing.
const twist = ref(80);        // turns per meter (default higher)
const conductors = ref(3);    // wires per stem/LED run (3 or 4)
const wireDia = ref(1.6);     // single conductor Ø incl. insulation, mm
const coreDia = ref(4);       // central core Ø the bundle twists around, mm

const jointOverlap = ref(5);  // solder/crimp overlap added per joint, mm
const ledStripe = ref(4);     // wire stripped/served per LED solder, mm

const conductorItems = [
  { title: '3-wire (5V / GND / Data)', value: 3 },
  { title: '4-wire (5V / GND / Data / Clk)', value: 4 },
];

// N wires twisted directly together sit at radius wireR / sin(pi/N).
const stemRadius = computed(() => (wireDia.value / 2) / Math.sin(Math.PI / Math.max(2, conductors.value)));
// Bundle wound around a central core sits one wire-radius off the core surface.
const coreRadius = computed(() => coreDia.value / 2 + wireDia.value / 2);

function helixFactor(turnsPerM, radiusMm) {
  const n = turnsPerM / 1000; // turns per mm
  return Math.sqrt(1 + Math.pow(2 * Math.PI * radiusMm * n, 2));
}
const coreTwist = computed(() => helixFactor(twist.value, coreRadius.value));
const stemTwist = computed(() => helixFactor(twist.value, stemRadius.value));

const view = ref('2d');
const spread3d = ref(1); // 0 = flat (planar 2D layout) .. 1 = full 3D winding

const dataSourceItems = [
  { title: 'core chain', value: 'chain' },
  { title: 'other fork', value: 'sibling' },
];

// ---- derived scaling ----
const multipliers = computed(() => nodes.map((_, i) => growthMultiplier(i, nodes.length, taper.value, jitter.value)));

const scaledNodes = computed(() => nodes.map((n, i) => ({
  ...n,
  segLen: i === 0 ? n.segLen : n.segLen * multipliers.value[i],
  branchLen: scaleBranches.value ? n.branchLen * multipliers.value[i] : n.branchLen,
})));

const tipMult = computed(() => (nodes.length > 0 ? multipliers.value[multipliers.value.length - 1] : 1));
const scaledForkDistance = computed(() => forkDistance.value * tipMult.value);
const scaledForkA = computed(() => ({ ...forkA, branchLen: scaleBranches.value ? forkA.branchLen * tipMult.value : forkA.branchLen }));
const scaledForkB = computed(() => ({ ...forkB, branchLen: scaleBranches.value ? forkB.branchLen * tipMult.value : forkB.branchLen }));

// ---- node list ops ----
function updateNode(id, patch) { const n = nodes.find((x) => x.id === id); if (n) Object.assign(n, patch); }
function addNode() { nodes.push(defaultNode(50)); }
function removeNode(id) { if (nodes.length > 1) { const i = nodes.findIndex((x) => x.id === id); if (i >= 0) nodes.splice(i, 1); } }
function setStemCount(count) {
  const n = Math.max(1, Math.round(Number(count) || 1));
  if (n === nodes.length) return;
  if (n < nodes.length) { nodes.splice(n); return; }
  while (nodes.length < n) nodes.push(defaultNode(50));
}

// ---- diagram geometry ----
const BASE_JOG = 26;

const diagram = computed(() => {
  const width = 420;
  const centerX = width / 2;
  const marginBottom = 60;
  const marginTop = 40;
  const sn = scaledNodes.value;
  const mult = multipliers.value;

  const pts = [];
  let y = 0;
  let x = centerX;
  pts.push({ x, y, kind: 'driver' });

  // lead-in (straight)
  y -= segPx(leadIn.value);
  pts.push({ x, y, kind: 'node', node: sn[0], segLenLabel: leadIn.value, i: 0 });

  for (let i = 1; i < sn.length; i++) {
    // angle (lateral jog) scales with the base->tip multiplier
    const jog = BASE_JOG * mult[i];
    x = centerX + (i % 2 === 0 ? jog : -jog);
    y -= segPx(sn[i].segLen);
    pts.push({ x, y, kind: 'node', node: sn[i], segLenLabel: Math.round(sn[i].segLen), i });
  }

  let forkPoint = null;
  if (forkEnabled.value && sn.length > 0) {
    const lastPt = pts[pts.length - 1];
    forkPoint = { x: centerX, y: lastPt.y - segPx(scaledForkDistance.value) };
  }

  const topY = forkPoint
    ? forkPoint.y - branchPx(Math.max(scaledForkA.value.branchLen, scaledForkB.value.branchLen)) - 30
    : pts[pts.length - 1].y - branchPx(sn[sn.length - 1]?.branchLen || 60) - 30;

  const totalHeight = marginBottom + (pts[0].y - topY) + marginTop;
  const offsetY = marginBottom - topY;
  const T = (p) => ({ x: p.x, y: p.y + offsetY });

  const corePts = pts.map(T);
  const corePath = corePts.map((p) => `${p.x},${p.y}`).join(' ');
  const dataPath = corePts.map((p) => `${p.x + 6},${p.y}`).join(' ');

  const segLabels = pts.slice(1).map((p, idx) => {
    const prev = corePts[idx];
    const cur = T(p);
    return { x: (prev.x + cur.x) / 2 - 20, y: (prev.y + cur.y) / 2, text: `${p.segLenLabel}mm` };
  });

  const nodeEls = pts.slice(1).map((p) => {
    const n = p.node;
    const t = T(p);
    const dir = t.x >= centerX ? 1 : -1;
    const bLen = branchPx(n.branchLen);
    const flowerX = t.x + dir * bLen * 0.8;
    const flowerY = t.y - bLen;
    return {
      key: p.i, cx: t.x, cy: t.y, powerTap: n.powerTap, dir,
      flowerX, flowerY, num: p.i + 1, branchLabel: `${Math.round(n.branchLen)}mm`,
    };
  });

  const driver = corePts[0];

  let fork = null;
  if (forkPoint) {
    const lastT = corePts[corePts.length - 1];
    const fp = { x: forkPoint.x, y: forkPoint.y + offsetY };
    const arms = [['A', scaledForkA.value, -1], ['B', scaledForkB.value, 1]].map(([label, f, dir]) => {
      const bLen = branchPx(f.branchLen);
      const fx = fp.x + dir * bLen * 0.85;
      const fy = fp.y - bLen;
      return { label, dir, fx, fy, powerTap: f.powerTap, hasData: f.hasData, dataSource: f.dataSource };
    });
    // sibling data link A -> B
    let sibPath = null;
    const b = arms.find((a) => a.label === 'B');
    if (b && b.hasData && b.dataSource === 'sibling') {
      const aFx = fp.x - branchPx(scaledForkA.value.branchLen) * 0.85;
      const aFy = fp.y - branchPx(scaledForkA.value.branchLen);
      sibPath = `M ${aFx} ${aFy + 14} Q ${fp.x} ${Math.min(aFy, b.fy) - 10} ${b.fx} ${b.fy + 14}`;
    }
    fork = {
      x1: lastT.x, y1: lastT.y, x2: fp.x, y2: fp.y,
      labelX: fp.x - 20, labelY: (lastT.y + fp.y) / 2, distLabel: `${Math.round(scaledForkDistance.value)}mm`,
      arms, sibPath,
    };
  }

  return { width, totalHeight, corePath, dataPath, segLabels, nodeEls, driver, fork };
});

// ---- precut list, grouped ----
const groups = computed(() => {
  const power = [];
  const data = [];
  const sn = scaledNodes.value;
  const cT = coreTwist.value, sT = stemTwist.value;
  // A run's cut length: core wire runs twist at the core radius, stem wire
  // runs twist directly together, plus overlap at each solder/crimp joint,
  // wire served at each LED solder, and general slack.
  const mk = (label, detail, { core = 0, stem = 0, joints = 0, leds = 0 }) => {
    const geo = core * cT + stem * sT;
    const length = geo + joints * jointOverlap.value + leds * ledStripe.value + slack.value;
    return { label, detail, qty: 2, geo, length };
  };

  sn.forEach((n, i) => {
    if (n.powerTap) power.push(mk(`Stem ${i + 1}`, 'power + ground', { stem: n.branchLen, joints: 1, leds: 1 }));
  });

  if (sn.length > 0) {
    data.push(mk('Driver → stem 1', 'lead-in, send + return', { core: leadIn.value, stem: sn[0].branchLen, joints: 1, leds: 1 }));
  }
  for (let i = 0; i < sn.length - 1; i++) {
    const a = sn[i], b = sn[i + 1];
    data.push(mk(`Stem ${i + 1} → stem ${i + 2}`, 'send + return', { core: b.segLen, stem: a.branchLen + b.branchLen, leds: 2 }));
  }

  if (forkEnabled.value && sn.length > 0) {
    const last = sn[sn.length - 1];
    const fA = scaledForkA.value, fB = scaledForkB.value;
    const fd = scaledForkDistance.value;
    if (fA.powerTap) power.push(mk('Fork A', 'power + ground', { stem: fA.branchLen, joints: 1, leds: 1 }));
    if (fB.powerTap) power.push(mk('Fork B', 'power + ground', { stem: fB.branchLen, joints: 1, leds: 1 }));
    if (fA.hasData && fA.dataSource === 'chain') {
      data.push(mk(`Stem ${sn.length} → fork A`, 'send + return', { core: fd, stem: last.branchLen + fA.branchLen, leds: 2 }));
    }
    if (fB.hasData) {
      if (fB.dataSource === 'chain') {
        data.push(mk(`Stem ${sn.length} → fork B`, fB.powerTap ? 'send + return' : 'data only — no power tap', { core: fd, stem: last.branchLen + fB.branchLen, leds: 2 }));
      } else {
        data.push(mk('Fork A → fork B', fB.powerTap ? 'send + return' : 'data only — no power tap', { core: forkGap.value, stem: fA.branchLen + fB.branchLen, leds: 2 }));
      }
    }
  }

  const summarize = (rows) => ({
    rows,
    pieces: rows.reduce((s, r) => s + r.qty, 0),
    length: rows.reduce((s, r) => s + r.qty * r.length, 0),
  });

  return [
    { name: 'Power taps', color: POWER, ...summarize(power) },
    { name: 'Data links', color: DATA, ...summarize(data) },
  ].filter((g) => g.rows.length > 0);
});

const totalPieces = computed(() => groups.value.reduce((s, g) => s + g.pieces, 0));
const totalLength = computed(() => groups.value.reduce((s, g) => s + g.length, 0));
const powerTotal = computed(() => groups.value.find((g) => g.name === 'Power taps')?.length || 0);
const dataTotal = computed(() => groups.value.find((g) => g.name === 'Data links')?.length || 0);

const forks = [forkA, forkB];

// ---- 3D model description (real mm coordinates, Y up) ----
// Each joint's jog and branch are rotated around the core (Y) axis so the
// harness winds through all three dimensions instead of lying flat. The
// spread slider dials how far each successive joint turns; at 0 it collapses
// back to the planar 2D layout.
const BASE_JOG_MM = 30;
const GOLDEN = Math.PI * (3 - Math.sqrt(5)); // ~137.5°, organic azimuth step

const model3d = computed(() => {
  const sn = scaledNodes.value;
  const mult = multipliers.value;
  const sp = spread3d.value;
  const corePts = [];
  let y = 0;
  corePts.push({ x: 0, y, z: 0, driver: true });
  y += leadIn.value; // straight lead-in
  const nodeMeta = [];
  let lastAz = 0;

  for (let i = 0; i < sn.length; i++) {
    // azimuth around the core: golden-angle steps scaled by spread, with a
    // planar zig-zag as the baseline so spread=0 matches the 2D diagram.
    const planar = (i % 2 === 0 ? 0 : Math.PI);
    const az = planar * (1 - sp) + i * GOLDEN * sp;
    const cosA = Math.cos(az), sinA = Math.sin(az);
    const off = i === 0 ? 0 : BASE_JOG_MM * mult[i];
    if (i > 0) y += sn[i].segLen;
    const p = { x: off * cosA, y, z: off * sinA };
    corePts.push(p);
    lastAz = az;
    // branch fans outward radially (node's azimuth) plus up
    const bl = sn[i].branchLen;
    const vx = cosA * 0.6, vz = sinA * 0.6, vy = 1, len = Math.hypot(vx, vy, vz);
    nodeMeta.push({
      base: p,
      tip: { x: p.x + (vx / len) * bl, y: p.y + (vy / len) * bl, z: p.z + (vz / len) * bl },
      powerTap: sn[i].powerTap, hasData: true, num: i + 1,
    });
  }

  let fork = null;
  if (forkEnabled.value && sn.length > 0) {
    const base = corePts[corePts.length - 1];
    const fp = { x: base.x, y: base.y + scaledForkDistance.value, z: base.z };
    // arm plane is perpendicular to the last joint azimuth so the two arms
    // splay into depth rather than always along X.
    const armAz = lastAz + Math.PI / 2;
    const cosA = Math.cos(armAz), sinA = Math.sin(armAz);
    const arms = [scaledForkA.value, scaledForkB.value].map((f, idx) => {
      const s = idx === 0 ? -1 : 1;
      const vx = s * cosA * 0.7, vz = s * sinA * 0.7, vy = 1, len = Math.hypot(vx, vy, vz);
      return {
        label: idx === 0 ? 'A' : 'B',
        base: fp,
        tip: { x: fp.x + (vx / len) * f.branchLen, y: fp.y + (vy / len) * f.branchLen, z: fp.z + (vz / len) * f.branchLen },
        powerTap: f.powerTap, hasData: f.hasData,
      };
    });
    fork = { point: fp, arms };
  }

  return {
    corePts, nodes: nodeMeta, fork,
    twist: twist.value, conductors: conductors.value,
    coreRadius: coreRadius.value, stemRadius: stemRadius.value,
    wireRadius: wireDia.value / 2,
  };
});

// ---- exports ----
function download(name, mime, content) {
  const blob = content instanceof Blob ? content : new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = name;
  document.body.appendChild(a); a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

function exportCSV() {
  const lines = [['group', 'run', 'detail', 'qty', 'length_mm']];
  groups.value.forEach((g) => {
    g.rows.forEach((r) => lines.push([g.name, r.label, r.detail, r.qty, r.length.toFixed(1)]));
  });
  const csv = lines.map((row) => row.map((c) => {
    const s = String(c);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  }).join(',')).join('\n');
  download('harness-cutlist.csv', 'text/csv', csv);
}

const three = ref(null); // Harness3D component instance
function exportGLB() {
  if (three.value?.exportGLB) three.value.exportGLB();
}
</script>

<template>
  <v-app theme="harnessDark">
    <v-main class="harness-main">
      <v-container class="py-6" style="max-width: 1160px;">
        <!-- header -->
        <div class="mb-5">
          <div class="eyebrow">GLOWFLORA HOME &mdash; HARNESS PLANNER</div>
          <h1 class="title">Stem wiring cut-length calculator</h1>
        </div>

        <v-row>
          <!-- diagram -->
          <v-col cols="12" md="4">
            <v-card class="pa-4 diagram-card" variant="flat">
              <div class="d-flex align-center justify-space-between mb-3">
                <v-btn-toggle v-model="view" mandatory density="compact" variant="outlined" divided>
                  <v-btn value="2d" size="small">2D</v-btn>
                  <v-btn value="3d" size="small">3D</v-btn>
                </v-btn-toggle>
                <v-btn v-if="view === '3d'" size="small" variant="tonal" color="primary" prepend-icon="mdi-download" @click="exportGLB">GLB</v-btn>
              </div>

              <template v-if="view === '3d'">
                <Harness3D ref="three" :model="model3d" />
                <v-slider label="3D spread" v-model="spread3d" :min="0" :max="1" :step="0.05" color="primary" thumb-label hide-details density="compact" class="mt-3">
                  <template #append><span class="unit">{{ Math.round(spread3d * 100) }}%</span></template>
                </v-slider>
              </template>

              <svg v-else :viewBox="`0 0 ${diagram.width} ${diagram.totalHeight}`" style="width:100%;height:auto;display:block">
                <!-- driver -->
                <g>
                  <rect :x="diagram.driver.x - 22" :y="diagram.driver.y - 14" width="44" height="28" rx="3" :fill="PANEL" :stroke="LINE" />
                  <text :x="diagram.driver.x" :y="diagram.driver.y + 4" text-anchor="middle" font-family="monospace" font-size="9" :fill="DIM">DRIVER</text>
                </g>
                <!-- core + data lines -->
                <polyline :points="diagram.corePath" fill="none" :stroke="CORE" stroke-width="5" stroke-linecap="round" stroke-linejoin="round" />
                <polyline :points="diagram.dataPath" fill="none" :stroke="DATA" stroke-width="1.6" stroke-dasharray="4 3" stroke-linejoin="round" />
                <!-- segment labels -->
                <text v-for="(s, idx) in diagram.segLabels" :key="'s' + idx" :x="s.x" :y="s.y" font-family="monospace" font-size="8.5" :fill="DIM">{{ s.text }}</text>
                <!-- nodes + branches -->
                <g v-for="nd in diagram.nodeEls" :key="nd.key">
                  <circle :cx="nd.cx" :cy="nd.cy" r="4" :fill="BG" :stroke="CORE" stroke-width="2" />
                  <line v-if="nd.powerTap" :x1="nd.cx" :y1="nd.cy" :x2="nd.flowerX" :y2="nd.flowerY" :stroke="POWER" stroke-width="2" opacity="0.9" />
                  <line :x1="nd.cx + nd.dir * 3" :y1="nd.cy" :x2="nd.flowerX + nd.dir * 3" :y2="nd.flowerY" :stroke="DATA" stroke-width="1.4" stroke-dasharray="3 2" opacity="0.9" />
                  <circle :cx="nd.flowerX" :cy="nd.flowerY" r="13" fill="#1A2433" :stroke="POWER" stroke-width="1.4" />
                  <text :x="nd.flowerX" :y="nd.flowerY + 3" text-anchor="middle" font-family="monospace" font-size="9" :fill="TEXT">{{ nd.num }}</text>
                  <text :x="nd.flowerX + nd.dir * 18" :y="nd.flowerY + 3" :text-anchor="nd.dir > 0 ? 'start' : 'end'" font-family="monospace" font-size="8" :fill="DIM">{{ nd.branchLabel }}</text>
                </g>
                <!-- fork -->
                <g v-if="diagram.fork">
                  <line :x1="diagram.fork.x1" :y1="diagram.fork.y1" :x2="diagram.fork.x2" :y2="diagram.fork.y2" :stroke="CORE" stroke-width="5" stroke-linecap="round" />
                  <line :x1="diagram.fork.x1 + 6" :y1="diagram.fork.y1" :x2="diagram.fork.x2 + 6" :y2="diagram.fork.y2" :stroke="DATA" stroke-width="1.6" stroke-dasharray="4 3" />
                  <circle :cx="diagram.fork.x2" :cy="diagram.fork.y2" r="4" :fill="BG" :stroke="CORE" stroke-width="2" />
                  <text :x="diagram.fork.labelX" :y="diagram.fork.labelY" font-family="monospace" font-size="8.5" :fill="DIM">{{ diagram.fork.distLabel }}</text>
                  <path v-if="diagram.fork.sibPath" :d="diagram.fork.sibPath" fill="none" :stroke="DATA" stroke-width="1.4" />
                  <g v-for="arm in diagram.fork.arms" :key="arm.label">
                    <line v-if="arm.powerTap" :x1="diagram.fork.x2" :y1="diagram.fork.y2" :x2="arm.fx" :y2="arm.fy" :stroke="POWER" stroke-width="2" opacity="0.9" />
                    <line v-if="arm.hasData" :x1="diagram.fork.x2 + arm.dir * 3" :y1="diagram.fork.y2" :x2="arm.fx + arm.dir * 3" :y2="arm.fy" :stroke="DATA" stroke-width="1.4" stroke-dasharray="3 2" opacity="0.9" />
                    <circle :cx="arm.fx" :cy="arm.fy" r="13" fill="#1A2433" :stroke="arm.powerTap ? POWER : DIM" stroke-width="1.4" :stroke-dasharray="arm.powerTap ? '0' : '3 2'" />
                    <text :x="arm.fx" :y="arm.fy + 3" text-anchor="middle" font-family="monospace" font-size="9" :fill="TEXT">{{ arm.label }}</text>
                  </g>
                </g>
              </svg>

              <v-divider class="my-3" />
              <div class="legend">
                <div class="legend-row"><span class="swatch" :style="{ background: CORE, height: '4px', borderRadius: '2px' }" /> core (14AWG + pwr bus)</div>
                <div class="legend-row"><span class="swatch" :style="{ background: POWER, height: '2px' }" /> power tap</div>
                <div class="legend-row"><svg width="18" height="4"><line x1="0" y1="2" x2="18" y2="2" :stroke="DATA" stroke-width="2" stroke-dasharray="3 2" /></svg> data</div>
              </div>
            </v-card>
          </v-col>

          <!-- controls + precut list -->
          <v-col cols="12" md="8">
            <v-card class="pa-4 mb-5" variant="flat">
              <div class="d-flex align-center justify-space-between mb-3">
                <div class="section-label">CORE BENDS / STEMS</div>
                <div class="d-flex align-center" style="gap:10px">
                  <v-text-field
                    label="# stems" type="number" min="1" density="compact" hide-details variant="outlined"
                    :model-value="nodes.length" style="max-width:96px"
                    @update:model-value="setStemCount" />
                  <v-btn size="small" variant="tonal" color="primary" icon="mdi-plus" @click="addNode" />
                </div>
              </div>

              <v-table density="compact" class="stem-table">
                <thead>
                  <tr>
                    <th style="width:32px">#</th>
                    <th>from</th>
                    <th style="width:110px">seg mm</th>
                    <th style="width:110px">branch mm</th>
                    <th style="width:70px">power</th>
                    <th style="width:48px"></th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="(n, i) in nodes" :key="n.id">
                    <td class="dim">{{ i + 1 }}</td>
                    <td class="dim">{{ i === 0 ? 'from driver' : `from stem ${i}` }}</td>
                    <td>
                      <v-text-field
                        type="number" step="5" density="compact" hide-details variant="outlined"
                        :disabled="i === 0" :model-value="i === 0 ? 0 : n.segLen"
                        @update:model-value="(v) => updateNode(n.id, { segLen: Number(v) })" />
                    </td>
                    <td>
                      <v-text-field
                        type="number" step="5" density="compact" hide-details variant="outlined"
                        :model-value="n.branchLen"
                        @update:model-value="(v) => updateNode(n.id, { branchLen: Number(v) })" />
                    </td>
                    <td>
                      <v-checkbox color="secondary" density="compact" hide-details
                        :model-value="n.powerTap"
                        @update:model-value="(v) => updateNode(n.id, { powerTap: !!v })" />
                    </td>
                    <td>
                      <v-btn size="x-small" variant="text" color="error" icon="mdi-close" @click="removeNode(n.id)" />
                    </td>
                  </tr>
                </tbody>
              </v-table>

              <!-- scaling controls -->
              <v-divider class="my-4" />
              <v-row dense>
                <v-col cols="12" sm="6">
                  <v-slider label="Base → tip scaling" v-model="taper" :min="0" :max="0.8" :step="0.05" color="primary" thumb-label hide-details density="compact" />
                </v-col>
                <v-col cols="12" sm="6">
                  <v-slider label="Irregularity" v-model="jitter" :min="0" :max="0.4" :step="0.02" color="primary" thumb-label hide-details density="compact" />
                </v-col>
              </v-row>
              <v-switch v-model="scaleBranches" color="secondary" density="compact" hide-details
                label="Scale branch lengths along with core segments" class="mt-1" />
              <div v-if="taper > 0 || jitter > 0" class="d-flex flex-wrap ga-2 mt-2">
                <span v-for="(m, i) in multipliers" :key="i" class="mult-chip">stem {{ i + 1 }} &times;{{ m.toFixed(2) }}</span>
              </div>

              <!-- twist -->
              <v-divider class="my-4" />
              <div class="section-label mb-2">TWIST &amp; WIRE</div>
              <v-row dense align="center">
                <v-col cols="12" sm="6">
                  <v-slider label="Twist" v-model="twist" :min="0" :max="200" :step="5" color="primary" thumb-label hide-details density="compact">
                    <template #append><span class="unit">{{ twist }} t/m</span></template>
                  </v-slider>
                </v-col>
                <v-col cols="12" sm="6">
                  <v-select label="conductors per stem" :items="conductorItems" density="compact" hide-details variant="outlined" v-model="conductors" />
                </v-col>
                <v-col cols="6" sm="3">
                  <v-text-field label="wire Ø (mm)" type="number" step="0.1" density="compact" hide-details variant="outlined" v-model.number="wireDia" />
                </v-col>
                <v-col cols="6" sm="3">
                  <v-text-field label="core Ø (mm)" type="number" step="0.5" density="compact" hide-details variant="outlined" v-model.number="coreDia" />
                </v-col>
                <v-col cols="12" sm="6" class="d-flex align-center ga-4">
                  <div class="twist-mult">core &times;{{ coreTwist.toFixed(3) }}</div>
                  <div class="twist-mult">stem &times;{{ stemTwist.toFixed(3) }}</div>
                </v-col>
              </v-row>

              <v-divider class="my-4" />
              <v-row dense>
                <v-col cols="6" sm="3">
                  <v-text-field label="joint slack (mm)" type="number" density="compact" hide-details variant="outlined" v-model.number="slack" />
                </v-col>
                <v-col cols="6" sm="3">
                  <v-text-field label="driver lead-in (mm)" type="number" density="compact" hide-details variant="outlined" v-model.number="leadIn" />
                </v-col>
                <v-col cols="6" sm="3">
                  <v-text-field label="solder/crimp overlap (mm)" type="number" step="0.5" density="compact" hide-details variant="outlined" v-model.number="jointOverlap" />
                </v-col>
                <v-col cols="6" sm="3">
                  <v-text-field label="LED strip/serve (mm)" type="number" step="0.5" density="compact" hide-details variant="outlined" v-model.number="ledStripe" />
                </v-col>
              </v-row>

              <!-- fork -->
              <v-divider class="my-4" />
              <v-switch v-model="forkEnabled" color="primary" density="compact" hide-details
                label="Fork at tip (two stems from last position)" />
              <div v-if="forkEnabled" class="mt-3">
                <v-text-field label="distance to fork point (mm)" type="number" step="5" density="compact" hide-details variant="outlined" v-model.number="forkDistance" style="max-width:220px" class="mb-3" />
                <v-card v-for="f in forks" :key="f.label" variant="tonal" class="pa-3 mb-2">
                  <div class="fork-title">Fork {{ f.label }}</div>
                  <v-row dense align="center">
                    <v-col cols="6" sm="3">
                      <v-text-field label="branch mm" type="number" step="5" density="compact" hide-details variant="outlined" v-model.number="f.branchLen" />
                    </v-col>
                    <v-col cols="6" sm="2">
                      <v-checkbox label="power" color="secondary" density="compact" hide-details v-model="f.powerTap" />
                    </v-col>
                    <v-col cols="6" sm="2">
                      <v-checkbox label="data" color="primary" density="compact" hide-details v-model="f.hasData" />
                    </v-col>
                    <v-col v-if="f.hasData" cols="6" sm="4">
                      <v-select label="data from" :items="dataSourceItems" density="compact" hide-details variant="outlined" v-model="f.dataSource" />
                    </v-col>
                  </v-row>
                </v-card>
                <v-text-field label="gap between fork bases (mm)" type="number" density="compact" hide-details variant="outlined" v-model.number="forkGap" style="max-width:260px" />
              </div>
            </v-card>

            <!-- precut list -->
            <v-card class="pa-4" variant="flat">
              <div class="d-flex align-center justify-space-between mb-3">
                <div class="section-label">PRECUT LIST</div>
                <v-btn size="small" variant="tonal" color="primary" prepend-icon="mdi-download" @click="exportCSV">CSV</v-btn>
              </div>

              <div v-for="g in groups" :key="g.name" class="mb-4">
                <div class="group-head">
                  <span class="dot" :style="{ background: g.color }" />
                  <span class="group-name">{{ g.name }}</span>
                  <span class="group-sub">{{ g.pieces }} pcs &middot; {{ (g.length / 1000).toFixed(2) }} m</span>
                </div>
                <v-table density="compact" class="cut-table">
                  <tbody>
                    <tr v-for="(r, i) in g.rows" :key="i">
                      <td>
                        <div class="cut-label">{{ r.label }}</div>
                        <div class="cut-detail">{{ r.detail }}</div>
                      </td>
                      <td class="qty">&times;{{ r.qty }}</td>
                      <td class="len">{{ r.length.toFixed(0) }} mm</td>
                    </tr>
                  </tbody>
                </v-table>
              </div>

              <v-divider class="my-2" />
              <div class="d-flex justify-space-between align-center">
                <span class="dim">{{ totalPieces }} pieces total</span>
                <span class="grand-total">{{ (totalLength / 1000).toFixed(2) }} m</span>
              </div>
              <div class="d-flex ga-4 mt-1">
                <span :style="{ color: POWER, fontFamily: 'monospace', fontSize: '11px' }">power {{ (powerTotal / 1000).toFixed(2) }} m</span>
                <span :style="{ color: DATA, fontFamily: 'monospace', fontSize: '11px' }">data {{ (dataTotal / 1000).toFixed(2) }} m</span>
              </div>
              <p class="note mt-3">
                Each row is a pair &mdash; power counts pwr + gnd, data counts send + return.
                Core runs are scaled &times;{{ coreTwist.toFixed(3) }} (wires twisting around the core), stem runs &times;{{ stemTwist.toFixed(3) }}
                (wires twisted directly together); solder/crimp overlap, LED serve, and slack are added on top.
                Diagram segment/branch spacing and bend angle are proportional but clamped for readability, not exact scale.
              </p>
            </v-card>
          </v-col>
        </v-row>
      </v-container>
    </v-main>
  </v-app>
</template>

<style>
.harness-root { position: fixed; inset: 0; overflow: auto; }
.harness-main { background: #0A0F16; }
.harness-root .eyebrow { font-family: monospace; font-size: 11px; color: #4FD1E8; letter-spacing: 1.5px; margin-bottom: 6px; }
.harness-root .title { font-size: 21px; font-weight: 600; color: #DCE6F2; margin: 0; }
.harness-root .diagram-card { background: #101826; border: 1px solid #1E2A3B; position: sticky; top: 12px; }
.harness-root .v-card { background: #101826 !important; border: 1px solid #1E2A3B; border-radius: 8px; }
.harness-root .section-label { font-family: monospace; font-size: 11px; color: #7A8AA0; letter-spacing: 1px; }
.harness-root .dim { color: #7A8AA0; font-size: 12px; }
.harness-root .legend { display: flex; flex-direction: column; gap: 6px; }
.harness-root .legend-row { display: flex; align-items: center; gap: 8px; font-size: 11px; color: #7A8AA0; }
.harness-root .legend-row .swatch { width: 18px; display: inline-block; }
.harness-root .stem-table .v-table__wrapper > table > thead > tr > th { font-size: 10px; color: #7A8AA0; }
.harness-root .stem-table td { padding-top: 4px !important; padding-bottom: 4px !important; }
.harness-root .mult-chip { font-family: monospace; font-size: 10px; color: #7A8AA0; background: #0D1420; border: 1px solid #1E2A3B; border-radius: 3px; padding: 2px 6px; }
.harness-root .fork-title { font-family: monospace; font-size: 11px; color: #DCE6F2; margin-bottom: 8px; }
.harness-root .group-head { display: flex; align-items: center; gap: 8px; margin-bottom: 4px; }
.harness-root .group-head .dot { width: 8px; height: 8px; border-radius: 2px; display: inline-block; }
.harness-root .group-name { font-size: 13px; color: #DCE6F2; font-weight: 500; }
.harness-root .group-sub { font-family: monospace; font-size: 11px; color: #7A8AA0; margin-left: auto; }
.harness-root .cut-table td { padding-top: 7px !important; padding-bottom: 7px !important; }
.harness-root .cut-label { font-size: 13px; color: #DCE6F2; }
.harness-root .cut-detail { font-size: 11px; color: #7A8AA0; margin-top: 2px; }
.harness-root .cut-table .qty { font-family: monospace; font-size: 13px; color: #7A8AA0; text-align: right; width: 56px; }
.harness-root .cut-table .len { font-family: monospace; font-size: 14px; color: #DCE6F2; text-align: right; width: 90px; }
.harness-root .grand-total { font-family: monospace; font-size: 16px; color: #DCE6F2; font-weight: 600; }
.harness-root .note { font-size: 11px; color: #7A8AA0; line-height: 1.6; }
.harness-root .unit { font-family: monospace; font-size: 11px; color: #7A8AA0; }
.harness-root .twist-mult { font-family: monospace; font-size: 15px; color: #F5A623; }
.harness-root .harness-3d { width: 100%; height: 420px; border-radius: 6px; overflow: hidden; background: #0D1420; }
</style>
