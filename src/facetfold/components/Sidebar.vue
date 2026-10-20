<script setup>
import { computed } from 'vue';
import { state, raw, setFaceColor, scheduleRebuild, toggleHinge, resetHinges, addMount, removeMount, setSurface, applySurfaceToAll, FONTS, addArt, removeArt, copyArtToAllFaces, setSvgFromFile, uploadFont, runNozzleAnalysis, runSlice, loadGcode, downloadGcode, checkServer, cancelSlice, setPrinter, importSettings, downloadImportedProfile, suggestHingeWidth, PROCESSES } from '../store.js';
import { PRINTERS, MATERIALS, PLATES, resolveProfile, validateProfile } from '@hyphi/slicer';
import { PATTERNS, assessSurface, diffractionAngleDeg, dispersionDeg, maxPitchForDispersionUm } from '../lib/surface.js';

const P = state.params;
const edit = () => scheduleRebuild();
const faces = computed(() => Array.from({ length: state.faceCount }, (_, i) => i));
const spec = computed(() => state.surfaces[state.selectedFace] || { kind: 'none', pitchMm: 1.5, angleDeg: 0, depthMm: 0.15, intent: 'texture' });
const patch = p => setSurface(state.selectedFace, { ...spec.value, ...p });
const assess = computed(() => spec.value.kind === 'none' ? null : assessSurface({ kind: spec.value.kind, pitchUm: spec.value.pitchMm * 1000, depthUm: (spec.value.depthMm ?? 0.15) * 1000, intent: spec.value.intent }, state.process));
const calcPitch = computed({ get: () => state.calcPitch ?? 1.0, set: v => { state.calcPitch = v; } });
const calc = computed(() => ({ a: diffractionAngleDeg(calcPitch.value, 550), spread: dispersionDeg(calcPitch.value), max: maxPitchForDispersionUm() }));
const C = state.colors;
const faceChips = computed(() => (state.version, raw.faceColors || []));
const usedColors = computed(() => new Set(faceChips.value).size);
const hexOf = i => C.palette[i]?.hex ?? '#888';
const faceArt = computed(() => state.art.layers.filter(l => l.face === state.selectedFace));
const slots = computed(() => C.palette.slice(0, Math.max(C.count, 2)));
const infoOf = l => state.art.info[l.id] || {};
const onSvg = (l, e) => { const f = e.target.files[0]; if (f) setSvgFromFile(l.id, f); e.target.value = ''; };
const onFont = e => { const f = e.target.files[0]; if (f) uploadFont(f); e.target.value = ''; };
const SL = state.slicing, pieceCount = computed(() => (state.version, raw.plate?.components?.length || 1));
const onImport = e => { const f = e.target.files[0]; if (f) importSettings(f); e.target.value = ''; };
const onGcode = e => { const f = e.target.files[0]; if (f) loadGcode(f); e.target.value = ''; };
const plateNotes = computed(() => validateProfile(resolveProfile({ ...state.slicing.profile, plate: state.bedFinish })).filter(i => i.code === 'plateForMaterial' || i.code === 'plateFinish'));
const hingeCount = computed(() => state.edgeList.filter(e => e.kind === 'hinge').length);
const portVertices = computed(() => Array.from({ length: state.vertexCount }, (_, i) => i));
</script>

<template>
  <aside class="left">
    <section class="blk">
      <h3>Dimensions</h3>
      <label class="row">Shortest edge (mm) <input type="number" min="8" step="1" v-model.number="P.edgeLengthMm" @input="edit" /></label>
      <label class="row">Panel thickness (mm) <input type="number" min="0.8" step="0.1" v-model.number="P.panelThicknessMm" @input="edit" /></label>
      <label class="row">Seam clearance (mm) <input type="number" min="0" step="0.05" v-model.number="P.seamClearanceMm" @input="edit" /></label>
    </section>

    <section class="blk">
      <h3>Hinges</h3>
      <label class="row">Flexure thickness (mm) <input type="number" min="0.05" step="0.05" v-model.number="P.hingeThicknessMm" @input="edit" /></label>
      <label class="row">Flexure width (mm) <input type="number" min="0.3" step="0.1" v-model.number="P.hingeWidthMm" @input="edit" /></label>
      <button @click="suggestHingeWidth" title="Narrowest width that keeps the worst fold within the yield band">Suggest width for strain</button>
      <p class="note">Edges: {{ hingeCount }} hinges, {{ state.edgeList.length - hingeCount }} seams. Toggle to split the net or rearrange it.</p>
      <div class="edges">
        <button v-for="e in state.edgeList" :key="e.key" class="e" :class="e.kind" :title="`${e.phiDeg.toFixed(1)}° fold · ${e.lengthMm.toFixed(1)} mm`" @click="toggleHinge(e.key)">{{ e.key }}<i>{{ e.kind === 'hinge' ? 'H' : 'S' }}</i></button>
      </div>
      <button v-if="state.customHinges" @click="resetHinges">Reset to default net</button>
    </section>

    <section class="blk">
      <h3>Lighting &amp; wiring</h3>
      <label class="row"><span>Cable port at a vertex</span><input type="checkbox" v-model="state.port.enabled" @change="edit" /></label>
      <template v-if="state.port.enabled">
        <label class="row">Vertex <select v-model.number="state.port.vertex" @change="edit"><option v-for="v in portVertices" :key="v" :value="v">{{ v }}</option></select></label>
        <label class="row">Cut depth (mm) <input type="number" min="2" step="0.5" v-model.number="state.port.depthMm" @input="edit" /></label>
        <label class="row">Cable hole Ø (mm) <input type="number" min="2" step="0.5" v-model.number="state.port.holeMm" @input="edit" /></label>
        <label class="row"><span>Cable-tie slots</span><input type="checkbox" v-model="state.port.tieSlots" @change="edit" /></label>
        <p class="note">The vertex is truncated; the new small face carries a gland hole with a collar.</p>
      </template>
      <div v-for="(m, i) in state.mounts" :key="i" class="mount">
        <b>Face {{ m.face }}</b>
        <select v-model="m.type" @change="edit"><option value="round">round</option><option value="rect">rectangular</option></select>
        <input v-if="m.type === 'round'" type="number" step="0.5" v-model.number="m.diameterMm" @input="edit" title="diameter mm" />
        <template v-else><input type="number" step="0.5" v-model.number="m.widthMm" @input="edit" title="width" /><input type="number" step="0.5" v-model.number="m.heightMm" @input="edit" title="height" /></template>
        <button @click="removeMount(i)">✕</button>
      </div>
      <button @click="addMount">+ Mount on face {{ state.selectedFace }}</button>
    </section>

    <section class="blk">
      <h3>Snap seams</h3>
      <label class="row"><span>Snap detents on seams</span><input type="checkbox" v-model="state.snap.enabled" @change="edit" /></label>
      <label class="row">Max bump radius (mm) <input type="number" min="0.3" step="0.1" v-model.number="state.snap.bumpRadiusMm" @input="edit" /></label>
      <label class="row">Detent spacing (mm) <input type="number" min="8" step="1" v-model.number="state.snap.spacingMm" @input="edit" /></label>
      <p class="note">Sizes shrink to what the wall can hold. Thin panels get none, with a warning.</p>
    </section>

    <section class="blk">
      <h3>Colours (multi-material)</h3>
      <label class="row">Mode <select v-model="C.mode" @change="edit"><option value="single">single colour</option><option value="adjacent">neighbours differ</option><option value="each">cycle through colours</option><option value="manual">pick per face</option></select></label>
      <template v-if="C.mode !== 'single'">
        <label class="row">Colours <input type="number" min="2" max="8" v-model.number="C.count" @input="edit" /></label>
        <label class="row">Extruder / AMS slots <input type="number" min="1" max="16" v-model.number="C.extruders" @input="edit" /></label>
        <div class="pal"><div v-for="(c, i) in C.palette.slice(0, C.count)" :key="i" class="sw" :class="{ on: C.active === i }" @click="C.active = i">
          <input type="color" v-model="c.hex" @input="edit" :title="c.name" /><input class="nm" v-model="c.name" @change="edit" /></div></div>
        <label class="row">Hinge strips <select v-model="C.hingeMode" @change="edit"><option value="parent">colour of parent face</option><option value="child">colour of child face</option><option value="own">own material slot</option></select></label>
        <label v-if="C.hingeMode === 'own'" class="row">Hinge slot <select v-model.number="C.hingeSlot" @change="edit"><option v-for="(c, i) in C.palette" :key="i" :value="i">{{ c.name }}</option></select></label>
        <div class="faces"><button v-for="(c, f) in faceChips" :key="f" class="fc" :class="{ sel: state.selectedFace === f }" :style="{ background: hexOf(c) }" :title="`face ${f}`"
            @click="state.selectedFace = f; if (C.mode === 'manual') setFaceColor(f, C.active)">{{ f }}</button></div>
        <p class="note">{{ C.mode === 'manual' ? 'Select a colour above, then click faces to paint them.' : 'Switch to “pick per face” to paint individual faces.' }} {{ usedColors }} colour(s) in use. Each colour prints as its own body in the same frame; bodies do not overlap.</p>
      </template>
    </section>

    <section class="blk">
      <h3>Art (SVG / text) — face {{ state.selectedFace }}</h3>
      <div class="pal"><div v-for="(c, i) in slots" :key="i" class="sw"><input type="color" v-model="c.hex" @input="edit" :title="c.name" /><span class="nm">{{ i }}</span></div></div>
      <div class="row"><button @click="addArt('text')">+ Text</button><button @click="addArt('svg')">+ SVG</button>
        <label class="up">font file <input type="file" accept=".ttf,.otf,.woff" @change="onFont" /></label></div>
      <div v-for="l in faceArt" :key="l.id" class="art">
        <div class="row"><b>{{ l.type }}</b><button @click="l.open = !l.open">{{ l.open ? '–' : '+' }}</button><button @click="copyArtToAllFaces(l.id)" title="copy to every other face">all faces</button><button @click="removeArt(l.id)">✕</button></div>
        <template v-if="l.open">
          <template v-if="l.type === 'text'">
            <input class="wide" v-model="l.text" @input="edit" />
            <label class="row">Font <select v-model="l.font" @change="edit"><option v-for="f in FONTS" :key="f.id" :value="f.id">{{ f.label }}</option><option v-if="state.art.customFontName" value="custom">{{ state.art.customFontName }}</option></select></label>
            <label class="row">Size mm <input type="number" min="1" step="0.5" v-model.number="l.sizeMm" @input="edit" /></label>
          </template>
          <template v-else>
            <input type="file" accept=".svg,image/svg+xml" @change="onSvg(l, $event)" />
            <textarea class="wide" rows="3" v-model="l.svg" @input="l.slotMap = {}; edit()" placeholder="paste SVG markup"></textarea>
            <label class="row">Width mm <input type="number" min="1" step="0.5" v-model.number="l.widthMm" @input="edit" /></label>
            <div v-if="infoOf(l).colors?.length" class="row">SVG colours →
              <span v-for="c in infoOf(l).colors" :key="c" class="map"><i :style="{ background: c }"></i>
                <select :value="l.slotMap[c] ?? ''" @change="l.slotMap = { ...l.slotMap, [c]: $event.target.value === '' ? undefined : +$event.target.value }; edit()"><option value="">nearest</option><option v-for="(p, i) in slots" :key="i" :value="i">{{ i }}</option></select></span></div>
          </template>
          <label class="row">Colour (default) <select v-model.number="l.slot" @change="edit"><option v-for="(p, i) in slots" :key="i" :value="i">{{ i }} {{ p.name }}</option></select></label>
          <label class="row">X / Y mm <input type="number" step="0.5" v-model.number="l.dx" @input="edit" /><input type="number" step="0.5" v-model.number="l.dy" @input="edit" /></label>
          <label class="row">Rotate° / scale <input type="number" v-model.number="l.rotDeg" @input="edit" /><input type="number" step="0.1" min="0.1" v-model.number="l.scale" @input="edit" /></label>
          <label class="row">Depth mm <input type="number" step="0.1" min="0.1" v-model.number="l.depthMm" :disabled="l.through" @input="edit" /> <label><input type="checkbox" v-model="l.through" @change="edit" /> through</label></label>
          <label class="row">Side <select v-model="l.side" @change="edit"><option value="outer">outer face (print bed)</option><option value="inner">inner side</option></select></label>
          <p v-if="infoOf(l).error" class="note err">{{ infoOf(l).error }}</p>
          <p v-for="w in infoOf(l).warnings || []" :key="w" class="note">{{ w }}</p>
        </template>
      </div>
      <p class="note">Select a face, add text or an SVG. Art is inlaid into the panel from the print-bed side (reads correctly from outside), each colour as its own body. Thin strokes below ~2 nozzle widths are flagged.</p>
    </section>

    <section class="blk">
      <h3>Slicing</h3>
      <label class="row">Piece <select v-model.number="SL.piece"><option v-for="i in pieceCount" :key="i" :value="i - 1">{{ i }}</option></select></label>
      <div class="row"><label class="up">import settings from a good print (.gcode / .3mf) <input type="file" accept=".gcode,.gco,.3mf,text/plain" @change="onImport" /></label><button :disabled="!SL.imported" @click="downloadImportedProfile">Save profile</button></div>
      <label class="row">Printer <select :value="SL.profile.printer" @change="setPrinter($event.target.value)"><option v-for="(p, id) in PRINTERS" :key="id" :value="id">{{ p.label }}</option></select></label>
      <label class="row">Nozzle mm <select v-model.number="SL.profile.nozzleMm"><option v-for="n in PRINTERS[SL.profile.printer].nozzles" :key="n" :value="n">{{ n }}</option></select></label>
      <p v-if="PRINTERS[SL.profile.printer].previewOnly" class="note">Built-in slicing is a preview only for this printer. Print the Orca engine's output (hosted server or local).</p>
      <label class="row">Layer height mm <input type="number" step="0.01" min="0.05" v-model.number="SL.profile.layerHeightMm" @input="SL.profile.firstLayerHeightMm = SL.profile.layerHeightMm" /></label>
      <label class="row">Walls / top / bottom <input type="number" min="1" v-model.number="SL.profile.walls" /><input type="number" min="0" v-model.number="SL.profile.topLayers" /><input type="number" min="0" v-model.number="SL.profile.bottomLayers" /></label>
      <label class="row">Infill % <input type="number" min="0" max="100" v-model.number="SL.profile.infillPct" /></label>
      <label class="row">Material <select v-model="SL.profile.material" @change="edit"><option v-for="(m, id) in MATERIALS" :key="id" :value="id">{{ id }}</option></select></label>
      <label class="row">Build plate <select v-model="state.bedFinish" @change="edit"><option v-for="(p, id) in PLATES" :key="id" :value="id">{{ p.label }}</option></select></label>
      <p v-for="n in plateNotes" :key="n.code" class="note" :class="{ err: n.level !== 'info' }">{{ n.message }}</p>
      <label class="row">Slice on <select v-model="SL.where"><option value="local">this browser (preview slicer)</option><option value="server">hosted slicing server</option></select></label>
      <template v-if="SL.where === 'server'">
        <input class="wide" v-model="SL.server.url" placeholder="https://slicer.example.com" />
        <input class="wide" type="password" autocomplete="off" v-model="SL.server.key" placeholder="API key" />
        <label class="row"><span><input type="checkbox" v-model="SL.server.remember" /> remember key in this browser</span></label>
        <div class="row"><button @click="checkServer">Check server</button>
          <select v-model="SL.server.engine"><option v-for="e in SL.server.engines" :key="e" :value="e">{{ e }}</option></select></div>
        <p v-if="SL.server.info" class="note">{{ SL.server.info }}</p>
        <p class="note">The piece's STL and your settings are sent to that server; use only a server you trust. A remembered key is stored unencrypted in this browser.</p>
      </template>
      <div class="row"><button :disabled="SL.busy" @click="runNozzleAnalysis">Analyze nozzles</button><button :disabled="SL.busy" @click="runSlice">Slice piece</button><button v-if="SL.busy && SL.where === 'server'" @click="cancelSlice">Cancel</button></div>
      <div class="row"><label class="up">open G-code <input type="file" accept=".gcode,.gco,.nc,text/plain" @change="onGcode" /></label><button :disabled="!SL.result" @click="downloadGcode">Download G-code</button></div>
      <label class="row">Colour by <select v-model="SL.colorBy"><option value="type">feature type</option><option value="width">line width vs nozzle</option></select></label>
      <p class="note">{{ SL.busy ? (SL.progress || 'Working…') : SL.error || 'Slices the selected plate piece with a built-in preview slicer (walls, skin, rectilinear infill, single colour). For production, export the STL and use the same settings with your slicer, then open its G-code here to inspect it.' }}</p>
    </section>

    <section class="blk">
      <h3>Outer surface</h3>
      <label class="row">Build plate <select v-model="state.bedFinish" @change="edit"><option v-for="(p, id) in PLATES" :key="id" :value="id">{{ p.label }}</option></select></label>
      <label class="row">Printer <select v-model="state.process" @change="edit"><option v-for="p in PROCESSES" :key="p.id" :value="p.id">{{ p.label }}</option></select></label>
      <label class="row">Face <select v-model.number="state.selectedFace"><option v-for="f in faces" :key="f" :value="f">{{ f }}</option></select></label>
      <label class="row">Pattern <select :value="spec.kind" @change="patch({ kind: $event.target.value })"><option v-for="k in PATTERNS" :key="k" :value="k">{{ k }}</option></select></label>
      <template v-if="spec.kind !== 'none'">
        <label class="row">Pitch (mm) <input type="number" min="0.05" step="0.1" :value="spec.pitchMm" @change="patch({ pitchMm: +$event.target.value })" /></label>
        <label class="row">Angle (°) <input type="number" step="5" :value="spec.angleDeg" @change="patch({ angleDeg: +$event.target.value })" /></label>
        <label class="row">Depth (mm) <input type="number" min="0.02" step="0.02" :value="spec.depthMm" @change="patch({ depthMm: +$event.target.value })" /></label>
        <label class="row">Intent <select :value="spec.intent" @change="patch({ intent: $event.target.value })"><option value="texture">texture / diffuse</option><option value="diffraction">diffraction</option></select></label>
        <div v-if="assess" class="assess" :class="assess.verdict"><b>{{ assess.verdict }}</b> on {{ assess.process.label }}<div v-for="(r, i) in assess.reasons" :key="i">{{ r }}</div></div>
        <div class="btns"><button @click="applySurfaceToAll(spec)">Apply to all faces</button></div>
      </template>
      <details><summary>Diffraction calculator</summary>
        <label class="row">Period (µm) <input type="number" min="0.4" step="0.1" v-model.number="calcPitch" /></label>
        <p class="note">550 nm, normal incidence: first order at {{ calc.a === null ? 'none (evanescent)' : calc.a.toFixed(1) + '°' }}. Colour spread 450–650 nm: {{ calc.spread === null ? '—' : calc.spread.toFixed(1) + '°' }}. A visible spread needs a period below ≈ {{ calc.max.toFixed(1) }} µm — far below any printer; export the prescription for a master or film.</p>
      </details>
    </section>
  </aside>
</template>

<style scoped>
.art{border:1px solid var(--line,#444);border-radius:6px;padding:6px;margin:6px 0}.art .wide{width:100%;box-sizing:border-box}.map{display:inline-flex;gap:2px;align-items:center;margin-right:6px}.map i{width:12px;height:12px;border:1px solid #888;display:inline-block}.err{color:#e5484d}.up{font-size:11px}
.edges { display:flex; flex-wrap:wrap; gap:4px; max-height:140px; overflow:auto; }
.e { padding:2px 6px; font:11px 'DM Mono',monospace; display:inline-flex; gap:4px; } .e i { font-style:normal; opacity:.7; }
.e.hinge { border-color:var(--ac); } .e.seam { opacity:.85; }
.mount { display:flex; gap:5px; align-items:center; } .mount input { width:56px !important; }
.assess { padding:6px 8px; border-left:3px solid var(--bd); line-height:1.4; border-radius:3px; background:var(--acd); }
.assess.printable { border-color:var(--ok); } .assess.marginal { border-color:var(--warn); } .assess.not-printable { border-color:var(--bad); }
summary { cursor:pointer; color:var(--sub); }
.pal { display:flex; flex-wrap:wrap; gap:6px; } .sw { display:flex; align-items:center; gap:4px; padding:2px 4px; border:1px solid var(--bd); border-radius:6px; cursor:pointer; } .sw.on { border-color:var(--ac2); background:var(--acd); }
.sw input[type=color] { width:22px; height:22px; padding:0; border:0; background:none; } .sw .nm { width:62px; font-size:11px; padding:2px 4px; }
.faces { display:flex; flex-wrap:wrap; gap:3px; } .fc { width:26px; height:24px; padding:0; font:10px 'DM Mono',monospace; color:#000; border-radius:4px; mix-blend-mode:normal; } .fc.sel { outline:2px solid var(--ac2); }
</style>
