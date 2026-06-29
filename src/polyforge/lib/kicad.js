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

import { mountingHolePositions, ledPositions, centroid2D, panelOutline } from './layout.js';

const LINE_W = 0.05; // mm, KiCad's typical Edge.Cuts hairline

function s(...parts) { return '(' + parts.join(' ') + ')'; }
function n(num)      { return Number(num).toFixed(4); }

// For each polygon corner, compute the rounded-corner geometry KiCad
// needs: { start, mid, end } in mm space, where start is the arc's
// entry point along the incoming edge, end is the exit along the
// outgoing edge, and mid is the midpoint of the arc on the bisector.
function roundedCornerSegments(pts, r) {
  const out = [];
  const m = pts.length;
  for (let i = 0; i < m; i++) {
    const prev = pts[(i - 1 + m) % m];
    const curr = pts[i];
    const next = pts[(i + 1) % m];
    const e1 = [prev[0] - curr[0], prev[1] - curr[1]];
    const e2 = [next[0] - curr[0], next[1] - curr[1]];
    const l1 = Math.hypot(e1[0], e1[1]) || 1;
    const l2 = Math.hypot(e2[0], e2[1]) || 1;
    const rr = Math.min(r, l1 / 2, l2 / 2);
    const start = [curr[0] + (e1[0] / l1) * rr, curr[1] + (e1[1] / l1) * rr];
    const end   = [curr[0] + (e2[0] / l2) * rr, curr[1] + (e2[1] / l2) * rr];
    const bx = e1[0] / l1 + e2[0] / l2;
    const by = e1[1] / l1 + e2[1] / l2;
    const bl = Math.hypot(bx, by) || 1;
    const dot = (e1[0] / l1) * (e2[0] / l2) + (e1[1] / l1) * (e2[1] / l2);
    const halfAngle = Math.acos(Math.max(-1, Math.min(1, dot))) / 2;
    const centerDist = rr / Math.sin(halfAngle);
    const cx = curr[0] + (bx / bl) * centerDist;
    const cy = curr[1] + (by / bl) * centerDist;
    const sweepStart = Math.atan2(start[1] - cy, start[0] - cx);
    let sweepEnd = Math.atan2(end[1] - cy, end[0] - cx);
    let delta = sweepEnd - sweepStart;
    if (delta > Math.PI)  delta -= 2 * Math.PI;
    if (delta < -Math.PI) delta += 2 * Math.PI;
    const tMid = sweepStart + delta / 2;
    const mid = [cx + Math.cos(tMid) * rr, cy + Math.sin(tMid) * rr];
    out.push({ start, mid, end });
  }
  return out;
}

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

// Solder-pad strip lives on the BACK copper layer so the LED side
// stays clean — wires terminate on the hidden side of the flex PCB.
// KiCad mirrors the footprint visually when placed on B.Cu; we still
// write the local pad X coordinates as-is and KiCad handles the flip.
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
      s('layers', '"B.Cu"', '"B.Paste"', '"B.Mask"')
    ).slice(0, -1) + netStr + ')';
  }).join('\n    ');

  return [
    s('footprint', '"PolyForge:SolderPads"',
      s('layer', '"B.Cu"'),
      s('at', n(cxMm), n(cyMm)),
      s('attr', 'smd')
    ).slice(0, -1),
    `    (fp_text reference "${refName}" (at 0 ${n(-onePadH - 1.2)}) (layer "B.SilkS") (effects (font (size 1 1) (thickness 0.15)) (justify mirror)))`,
    `    (fp_text value "Solder pads ${wireCount}P (back)" (at 0 ${n(onePadH + 1.2)}) (layer "B.Fab") (effects (font (size 0.8 0.8) (thickness 0.12)) (justify mirror)))`,
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
  panel,
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

  // Edge.Cuts: panel-clipped outline of every face. With panel.shape
  // === 'face' and zero corner radius this matches the raw polygon —
  // identical to the previous behavior.
  for (const face of net.faces) {
    if (!face) continue;
    const shape = panelOutline(face.polygon2D, panel || { shape: 'face' }, edgeLengthMm);
    if (shape.kind === 'circle') {
      const cx = shape.cx * edgeLengthMm, cy = -shape.cy * edgeLengthMm;
      const r = shape.r * edgeLengthMm;
      lines.push(`  (gr_circle (center ${n(cx)} ${n(cy)}) (end ${n(cx + r)} ${n(cy)}) (layer "Edge.Cuts") (width ${LINE_W}) (fill none))`);
    } else if (shape.cornerRadius > 0) {
      // Rounded polygon: emit straight segments and gr_arc fillets.
      const pts = shape.points.map(([x, y]) => [x * edgeLengthMm, -y * edgeLengthMm]);
      const rPx = shape.cornerRadius * edgeLengthMm;
      const corners = roundedCornerSegments(pts, rPx);
      for (let i = 0; i < corners.length; i++) {
        const c = corners[i];
        const next = corners[(i + 1) % corners.length];
        // straight from this corner's `end` to next corner's `start`
        lines.push(`  (gr_line (start ${n(c.end[0])} ${n(c.end[1])}) (end ${n(next.start[0])} ${n(next.start[1])}) (layer "Edge.Cuts") (width ${LINE_W}))`);
        // fillet arc from `start` to `end` around `center` at `next` corner
        const nc = next;
        lines.push(`  (gr_arc (start ${n(nc.start[0])} ${n(nc.start[1])}) (mid ${n(nc.mid[0])} ${n(nc.mid[1])}) (end ${n(nc.end[0])} ${n(nc.end[1])}) (layer "Edge.Cuts") (width ${LINE_W}))`);
      }
    } else {
      const pts = shape.points.map(([x, y]) => [x * edgeLengthMm, -y * edgeLengthMm]);
      for (let i = 0; i < pts.length; i++) {
        const a = pts[i], b = pts[(i + 1) % pts.length];
        lines.push(`  (gr_line (start ${n(a[0])} ${n(a[1])}) (end ${n(b[0])} ${n(b[1])}) (layer "Edge.Cuts") (width ${LINE_W}))`);
      }
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
        // Placed on the BACK so wire entry is on the hidden side.
        lines.push(`  (footprint "PolyForge:Conn_${connector.id}" (layer "B.Cu") (at ${n(cx)} ${n(cy)}) (attr smd)`);
        lines.push(`    (fp_text reference "J1" (at 0 ${n(-connector.body.h / 2 - 1.5)}) (layer "B.SilkS") (effects (font (size 1 1) (thickness 0.15)) (justify mirror)))`);
        lines.push(`    (fp_text value "${connector.label} (back)" (at 0 ${n(connector.body.h / 2 + 1.5)}) (layer "B.Fab") (effects (font (size 0.8 0.8) (thickness 0.12)) (justify mirror)))`);
        lines.push(`    (fp_line (start ${n(-connector.body.w/2)} ${n(-connector.body.h/2)}) (end ${n(connector.body.w/2)} ${n(-connector.body.h/2)}) (layer "B.SilkS") (width 0.12))`);
        lines.push(`    (fp_line (start ${n(connector.body.w/2)} ${n(-connector.body.h/2)}) (end ${n(connector.body.w/2)} ${n(connector.body.h/2)}) (layer "B.SilkS") (width 0.12))`);
        lines.push(`    (fp_line (start ${n(connector.body.w/2)} ${n(connector.body.h/2)}) (end ${n(-connector.body.w/2)} ${n(connector.body.h/2)}) (layer "B.SilkS") (width 0.12))`);
        lines.push(`    (fp_line (start ${n(-connector.body.w/2)} ${n(connector.body.h/2)}) (end ${n(-connector.body.w/2)} ${n(-connector.body.h/2)}) (layer "B.SilkS") (width 0.12))`);
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
