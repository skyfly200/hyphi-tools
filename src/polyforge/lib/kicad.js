// Minimal KiCad PCB (.kicad_pcb) writer for PolyForge.
//
// Emits a board file that opens in KiCad's pcbnew with:
//   - Edge.Cuts polylines for each unfolded face outline
//   - Dwgs.User lines for the fold creases between faces
//   - Per-LED footprints with named pads (VCC / DIN / GND / DOUT or
//     APA102's clock+data variant)
//   - Solder-pad strip OR a named-connector keepout footprint on the
//     designated connector face
//   - Mounting-hole footprints (NPTH) on every face when enabled
//
// The output is intentionally minimal — version 20221018 of the
// S-expression schema, no zones, no copper tracks, no DRC settings
// beyond the defaults. The user wires the nets up in pcbnew after
// importing.
//
// KiCad uses Y-DOWN coordinates (positive Y goes down on screen),
// which matches our SVG flip. Net coords come in unit-edge-length;
// we multiply by edgeLengthMm to get millimeters.

import { mountingHolePositions, ledPositions, centroid2D } from './layout.js';

const LINE_W = 0.05; // mm, KiCad's typical Edge.Cuts hairline

function s(...parts) { return '(' + parts.join(' ') + ')'; }
function n(num)      { return Number(num).toFixed(4); }

// LED pad layout — pads sit at the corners of the body, labelled to
// match the LED's `signals` array. Order: pin 1 at bottom-left of the
// LED (looking at the F.Cu side), going CCW.
function ledPadLayout(led) {
  const w = led.body.w, h = led.body.h;
  const offX = w / 2 + 0.4; // 0.4mm pad land outside body
  const offY = h / 2 + 0.4;
  const padW = 0.8, padH = 1.0;
  const corners = [
    [-offX,  offY], // bottom-left
    [ offX,  offY], // bottom-right
    [ offX, -offY], // top-right
    [-offX, -offY], // top-left
  ];
  return led.signals.slice(0, 4).map((sig, i) => ({
    num: i + 1, sig, x: corners[i][0], y: corners[i][1],
    w: padW, h: padH,
  }));
}

function ledFootprint(led, cxMm, cyMm, refName, nets) {
  const pads = ledPadLayout(led);
  const padBlocks = pads.map(p => {
    const netIdx = nets[p.sig] ?? 0;
    const netStr = netIdx > 0 ? ` (net ${netIdx} "${p.sig}")` : '';
    return s('pad', `"${p.num}"`, 'smd', 'rect',
      s('at', n(p.x), n(p.y)),
      s('size', n(p.w), n(p.h)),
      s('layers', '"F.Cu"', '"F.Paste"', '"F.Mask"')
    ).slice(0, -1) + netStr + ')';
  }).join('\n    ');

  return [
    s('footprint', `"PolyForge:LED_${led.id}"`,
      s('layer', '"F.Cu"'),
      s('at', n(cxMm), n(cyMm)),
      s('attr', 'smd')
    ).slice(0, -1),
    `    (fp_text reference "${refName}" (at 0 ${n(-led.body.h - 1.2)}) (layer "F.SilkS") (effects (font (size 1 1) (thickness 0.15))))`,
    `    (fp_text value "${led.label}" (at 0 ${n(led.body.h + 1.2)}) (layer "F.Fab") (effects (font (size 0.8 0.8) (thickness 0.12))))`,
    `    ${padBlocks}`,
    '  )',
  ].join('\n  ');
}

function mountingHoleFootprint(cxMm, cyMm, diaMm, refName) {
  return [
    s('footprint', '"PolyForge:MountingHole"',
      s('layer', '"F.Cu"'),
      s('at', n(cxMm), n(cyMm)),
      s('attr', 'through_hole')
    ).slice(0, -1),
    `    (fp_text reference "${refName}" (at 0 0) (layer "F.SilkS") (effects (font (size 1 1) (thickness 0.15))))`,
    `    (pad "" np_thru_hole circle (at 0 0) (size ${n(diaMm)} ${n(diaMm)}) (drill ${n(diaMm)}) (layers "*.Cu" "*.Mask"))`,
    '  )',
  ].join('\n  ');
}

function padOnlyFootprint(sp, wireCount, cxMm, cyMm, refName, signals, nets) {
  const onePadW = sp.shape === 'circle' ? sp.padDiaMm : sp.padWMm;
  const onePadH = sp.shape === 'circle' ? sp.padDiaMm : sp.padHMm;
  const stripW = sp.pitchMm * (wireCount - 1);
  const padBlocks = Array.from({ length: wireCount }, (_, i) => {
    const x = -stripW / 2 + sp.pitchMm * i;
    const sig = signals[i] || `P${i + 1}`;
    const netIdx = nets[sig] ?? 0;
    const netStr = netIdx > 0 ? ` (net ${netIdx} "${sig}")` : '';
    const shape = sp.shape === 'circle' ? 'circle' : 'rect';
    const size = sp.shape === 'circle'
      ? `${n(sp.padDiaMm)} ${n(sp.padDiaMm)}`
      : `${n(onePadW)} ${n(onePadH)}`;
    return s('pad', `"${i + 1}"`, 'smd', shape,
      s('at', n(x), '0'),
      `(size ${size})`,
      s('layers', '"F.Cu"', '"F.Paste"', '"F.Mask"')
    ).slice(0, -1) + netStr + ')';
  }).join('\n    ');

  return [
    s('footprint', '"PolyForge:SolderPads"',
      s('layer', '"F.Cu"'),
      s('at', n(cxMm), n(cyMm)),
      s('attr', 'smd')
    ).slice(0, -1),
    `    (fp_text reference "${refName}" (at 0 ${n(-onePadH - 1.2)}) (layer "F.SilkS") (effects (font (size 1 1) (thickness 0.15))))`,
    `    (fp_text value "Solder pads ${wireCount}P" (at 0 ${n(onePadH + 1.2)}) (layer "F.Fab") (effects (font (size 0.8 0.8) (thickness 0.12))))`,
    `    ${padBlocks}`,
    '  )',
  ].join('\n  ');
}

// Default net assignment: signal name → integer net id. Net 0 is the
// always-present unconnected net.
function buildNetTable(led, wireCount, padSignals) {
  const set = new Set();
  // From LED pads
  led.signals.forEach(s => set.add(s));
  // From pad-strip signals
  padSignals.forEach(s => set.add(s));
  const nets = { '': 0 };
  let idx = 1;
  for (const sig of set) { nets[sig] = idx++; }
  return nets;
}

// Standard signal mapping for the wire-in connector. For single-data
// LEDs (3 wires), pads carry VCC / DIN / GND. For APA102 (4 wires),
// pads carry VCC / GND / CIN / DIN.
function wireSignals(led, wireCount) {
  if (wireCount === 4) return ['VCC', 'GND', 'CIN', 'DIN'];
  // 3-wire: re-use the LED's own naming for VCC/GND (handles VDD/VSS)
  const vcc = led.signals.find(s => /^VCC|VDD/i.test(s)) || 'VCC';
  const gnd = led.signals.find(s => /^GND|VSS/i.test(s)) || 'GND';
  return [vcc, 'DIN', gnd];
}

export function buildKiCadPCB({
  net,
  edgeLengthMm,
  led,
  ledsPerFace,
  connector,
  connectorFaceIdx,
  wireCount,
  solderPad,
  mountingHole,
}) {
  const lines = [];

  const padSignals = (connector?.id === 'PAD_ONLY' && solderPad)
    ? wireSignals(led, wireCount)
    : [];
  const nets = buildNetTable(led, wireCount, padSignals);

  // Header / setup
  lines.push('(kicad_pcb (version 20221018) (generator polyforge)');
  lines.push('  (general (thickness 1.6))');
  lines.push('  (paper "A4")');
  lines.push('  (layers');
  const layerDefs = [
    [0, 'F.Cu', 'signal'], [31, 'B.Cu', 'signal'],
    [32, 'B.Adhes', 'user'], [33, 'F.Adhes', 'user'],
    [34, 'B.Paste', 'user'], [35, 'F.Paste', 'user'],
    [36, 'B.SilkS', 'user'], [37, 'F.SilkS', 'user'],
    [38, 'B.Mask', 'user'],  [39, 'F.Mask', 'user'],
    [40, 'Dwgs.User', 'user'], [41, 'Cmts.User', 'user'],
    [44, 'Edge.Cuts', 'user'], [48, 'B.Fab', 'user'], [49, 'F.Fab', 'user'],
  ];
  for (const [num, name, type] of layerDefs) {
    lines.push(`    (${num} "${name}" ${type})`);
  }
  lines.push('  )');
  lines.push('  (setup (pad_to_mask_clearance 0))');

  // Nets — write every entry in our net table.
  for (const [name, idx] of Object.entries(nets)) {
    lines.push(`  (net ${idx} "${name}")`);
  }

  // Edge.Cuts: outline of every unfolded face. KiCad treats every
  // closed segment loop on Edge.Cuts as a board outline; emitting each
  // face as its own loop lets the user pick the assembly strategy
  // (single rigid board, V-cuts, milled separations).
  for (const face of net.faces) {
    if (!face) continue;
    const pts = face.polygon2D.map(([x, y]) => [x * edgeLengthMm, -y * edgeLengthMm]);
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i], b = pts[(i + 1) % pts.length];
      lines.push(`  (gr_line (start ${n(a[0])} ${n(a[1])}) (end ${n(b[0])} ${n(b[1])}) (layer "Edge.Cuts") (width ${LINE_W}))`);
    }
  }

  // Fold lines on Dwgs.User — not cut, but visible in pcbnew so the
  // user knows where the rigid board meets a hinge.
  for (const e of net.foldEdges) {
    const a = [e.a0[0] * edgeLengthMm, -e.a0[1] * edgeLengthMm];
    const b = [e.a1[0] * edgeLengthMm, -e.a1[1] * edgeLengthMm];
    lines.push(`  (gr_line (start ${n(a[0])} ${n(a[1])}) (end ${n(b[0])} ${n(b[1])}) (layer "Dwgs.User") (width 0.1))`);
  }

  // LED footprints
  if (led && ledsPerFace > 0) {
    let ledNum = 1;
    for (const face of net.faces) {
      if (!face) continue;
      const positions = ledPositions(face.polygon2D, led, ledsPerFace, edgeLengthMm);
      for (const [x, y] of positions) {
        const cx = x * edgeLengthMm;
        const cy = -y * edgeLengthMm;
        lines.push('  ' + ledFootprint(led, cx, cy, `D${ledNum++}`, nets));
      }
    }
  }

  // Connector footprint on the configured face
  if (connector && connectorFaceIdx != null) {
    const face = net.faces[connectorFaceIdx];
    if (face) {
      const c = centroid2D(face.polygon2D);
      const cx = c[0] * edgeLengthMm, cy = -c[1] * edgeLengthMm;
      if (connector.id === 'PAD_ONLY' && solderPad) {
        lines.push('  ' + padOnlyFootprint(solderPad, wireCount, cx, cy, 'J1', padSignals, nets));
      } else {
        // Named connector: keepout-style footprint without specific pads
        // (KiCad already has these in libraries; we just mark the spot).
        lines.push(`  (footprint "PolyForge:Conn_${connector.id}" (layer "F.Cu") (at ${n(cx)} ${n(cy)}) (attr smd)`);
        lines.push(`    (fp_text reference "J1" (at 0 ${n(-connector.body.h / 2 - 1.5)}) (layer "F.SilkS") (effects (font (size 1 1) (thickness 0.15))))`);
        lines.push(`    (fp_text value "${connector.label}" (at 0 ${n(connector.body.h / 2 + 1.5)}) (layer "F.Fab") (effects (font (size 0.8 0.8) (thickness 0.12))))`);
        lines.push(`    (fp_line (start ${n(-connector.body.w/2)} ${n(-connector.body.h/2)}) (end ${n(connector.body.w/2)} ${n(-connector.body.h/2)}) (layer "F.SilkS") (width 0.12))`);
        lines.push(`    (fp_line (start ${n(connector.body.w/2)} ${n(-connector.body.h/2)}) (end ${n(connector.body.w/2)} ${n(connector.body.h/2)}) (layer "F.SilkS") (width 0.12))`);
        lines.push(`    (fp_line (start ${n(connector.body.w/2)} ${n(connector.body.h/2)}) (end ${n(-connector.body.w/2)} ${n(connector.body.h/2)}) (layer "F.SilkS") (width 0.12))`);
        lines.push(`    (fp_line (start ${n(-connector.body.w/2)} ${n(connector.body.h/2)}) (end ${n(-connector.body.w/2)} ${n(-connector.body.h/2)}) (layer "F.SilkS") (width 0.12))`);
        lines.push('  )');
      }
    }
  }

  // Mounting holes on every face
  if (mountingHole && mountingHole.enabled) {
    let mhNum = 1;
    for (const face of net.faces) {
      if (!face) continue;
      const positions = mountingHolePositions(face.polygon2D, mountingHole, edgeLengthMm);
      for (const [x, y] of positions) {
        const cx = x * edgeLengthMm, cy = -y * edgeLengthMm;
        lines.push('  ' + mountingHoleFootprint(cx, cy, mountingHole.diameterMm, `MH${mhNum++}`));
      }
    }
  }

  lines.push(')');
  return lines.join('\n');
}
