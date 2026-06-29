// Build per-layer SVG strings for PolyForge net export.
//
// Each returned file is a standalone <svg> with a single Inkscape-style
// layer group. The full bundle is intended to be unzipped and imported
// into KiCad (or another CAM tool) one layer at a time — KiCad maps:
//   outline.svg  → Edge.Cuts
//   folds.svg    → Dwgs.User
//   leds.svg     → F.Fab (placement reference)
//   conn.svg     → F.Fab (placement reference)
//   holes.svg    → drill / NPTH guidance
//
// All coordinates are in millimeters with KiCad's Y-down convention so
// the SVG drops in at the correct orientation.

import { mountingHolePositions, ledPositions, centroid2D, panelOutline, bridgesForNet } from './layout.js';

function svgWrap(name, viewBox, body) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg"
     xmlns:inkscape="http://www.inkscape.org/namespaces/inkscape"
     viewBox="${viewBox}" width="${viewBox.split(' ')[2]}mm" height="${viewBox.split(' ')[3]}mm">
  <g inkscape:groupmode="layer" inkscape:label="${name}" id="${name}">
${body}
  </g>
</svg>
`;
}

function bboxForNet(net, edgeLengthMm) {
  const b = net.bbox;
  const w = Math.max(1, b.width * edgeLengthMm);
  const h = Math.max(1, b.height * edgeLengthMm);
  const pad = Math.max(w, h) * 0.05 + 5;
  return `${(-w / 2 - pad).toFixed(3)} ${(-h / 2 - pad).toFixed(3)} ${(w + pad * 2).toFixed(3)} ${(h + pad * 2).toFixed(3)}`;
}

function fmt(v) { return Number(v).toFixed(3); }

// outline.svg — panel-clipped boundary of every face. Rounded
// corners and inscribed circles/hexagons all render as native SVG
// primitives KiCad's Import Graphics handles.
function outlineLayer(net, panel, edgeLengthMm) {
  const parts = [];
  // Bridges first so they sit underneath the panel outlines in the
  // SVG stack — visually no different, but keeps the file logical.
  for (const b of bridgesForNet(net.foldEdges, panel, edgeLengthMm)) {
    const pts = b.points.map(([x, y]) =>
      `${fmt(x * edgeLengthMm)},${fmt(-y * edgeLengthMm)}`).join(' ');
    parts.push(`    <polygon points="${pts}" fill="none" stroke="black" stroke-width="0.05" />`);
  }
  for (const face of net.faces) {
    if (!face) continue;
    const shape = panelOutline(face.polygon2D, panel || { shape: 'face' }, edgeLengthMm);
    if (shape.kind === 'circle') {
      parts.push(`    <circle cx="${fmt(shape.cx * edgeLengthMm)}" cy="${fmt(-shape.cy * edgeLengthMm)}" r="${fmt(shape.r * edgeLengthMm)}" fill="none" stroke="black" stroke-width="0.05" />`);
      continue;
    }
    const pts = shape.points.map(([x, y]) => [x * edgeLengthMm, -y * edgeLengthMm]);
    const rPx = (shape.cornerRadius || 0) * edgeLengthMm;
    if (rPx <= 0.01) {
      const ptsStr = pts.map(([x, y]) => `${fmt(x)},${fmt(y)}`).join(' ');
      parts.push(`    <polygon points="${ptsStr}" fill="none" stroke="black" stroke-width="0.05" />`);
    } else {
      // Rounded polygon: build an SVG path with arc commands.
      const n = pts.length;
      const segs = [];
      for (let i = 0; i < n; i++) {
        const prev = pts[(i - 1 + n) % n], curr = pts[i], next = pts[(i + 1) % n];
        const e1 = [prev[0] - curr[0], prev[1] - curr[1]];
        const e2 = [next[0] - curr[0], next[1] - curr[1]];
        const l1 = Math.hypot(e1[0], e1[1]) || 1;
        const l2 = Math.hypot(e2[0], e2[1]) || 1;
        const r = Math.min(rPx, l1 / 2, l2 / 2);
        const start = [curr[0] + (e1[0] / l1) * r, curr[1] + (e1[1] / l1) * r];
        const end   = [curr[0] + (e2[0] / l2) * r, curr[1] + (e2[1] / l2) * r];
        segs.push({ start, end, r });
      }
      let d = `M ${fmt(segs[0].start[0])} ${fmt(segs[0].start[1])}`;
      for (let i = 0; i < n; i++) {
        const cur = segs[i];
        const nxt = segs[(i + 1) % n];
        d += ` A ${fmt(cur.r)} ${fmt(cur.r)} 0 0 0 ${fmt(cur.end[0])} ${fmt(cur.end[1])}`;
        d += ` L ${fmt(nxt.start[0])} ${fmt(nxt.start[1])}`;
      }
      d += ' Z';
      parts.push(`    <path d="${d}" fill="none" stroke="black" stroke-width="0.05" />`);
    }
  }
  return parts.join('\n');
}

function foldsLayer(net, edgeLengthMm) {
  return net.foldEdges.map(e => {
    const x1 = fmt(e.a0[0] * edgeLengthMm), y1 = fmt(-e.a0[1] * edgeLengthMm);
    const x2 = fmt(e.a1[0] * edgeLengthMm), y2 = fmt(-e.a1[1] * edgeLengthMm);
    return `    <line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="orange" stroke-width="0.1" stroke-dasharray="0.6 0.4" />`;
  }).join('\n');
}

function ledsLayer(net, led, ledsPerFace, edgeLengthMm) {
  if (!led || ledsPerFace <= 0) return '';
  const w = led.body.w, h = led.body.h;
  const parts = [];
  for (const face of net.faces) {
    if (!face) continue;
    const pts = ledPositions(face.polygon2D, led, ledsPerFace, edgeLengthMm);
    for (const [ux, uy] of pts) {
      const cx = ux * edgeLengthMm, cy = -uy * edgeLengthMm;
      parts.push(`    <rect x="${fmt(cx - w/2)}" y="${fmt(cy - h/2)}" width="${fmt(w)}" height="${fmt(h)}" fill="none" stroke="purple" stroke-width="0.1" />`);
    }
  }
  return parts.join('\n');
}

function connLayer(net, connector, connectorFaceIdx, wireCount, solderPad, edgeLengthMm) {
  if (!connector || connectorFaceIdx == null) return '';
  const face = net.faces[connectorFaceIdx];
  if (!face) return '';
  const c = centroid2D(face.polygon2D);
  const cx = c[0] * edgeLengthMm, cy = -c[1] * edgeLengthMm;
  const parts = [];
  if (connector.id === 'PAD_ONLY' && solderPad) {
    const stripW = solderPad.pitchMm * (wireCount - 1);
    const x0 = cx - stripW / 2;
    for (let i = 0; i < wireCount; i++) {
      const px = x0 + solderPad.pitchMm * i;
      if (solderPad.shape === 'circle') {
        parts.push(`    <circle cx="${fmt(px)}" cy="${fmt(cy)}" r="${fmt(solderPad.padDiaMm/2)}" fill="green" />`);
      } else {
        parts.push(`    <rect x="${fmt(px - solderPad.padWMm/2)}" y="${fmt(cy - solderPad.padHMm/2)}" width="${fmt(solderPad.padWMm)}" height="${fmt(solderPad.padHMm)}" fill="green" />`);
      }
    }
  } else {
    parts.push(`    <rect x="${fmt(cx - connector.body.w/2)}" y="${fmt(cy - connector.body.h/2)}" width="${fmt(connector.body.w)}" height="${fmt(connector.body.h)}" fill="none" stroke="green" stroke-width="0.1" />`);
  }
  return parts.join('\n');
}

function holesLayer(net, mountingHole, edgeLengthMm) {
  if (!mountingHole || !mountingHole.enabled) return '';
  const r = mountingHole.diameterMm / 2;
  const parts = [];
  for (const face of net.faces) {
    if (!face) continue;
    const pts = mountingHolePositions(face.polygon2D, mountingHole, edgeLengthMm);
    for (const [ux, uy] of pts) {
      parts.push(`    <circle cx="${fmt(ux * edgeLengthMm)}" cy="${fmt(-uy * edgeLengthMm)}" r="${fmt(r)}" fill="white" stroke="black" stroke-width="0.05" />`);
    }
  }
  return parts.join('\n');
}

// Return { 'outline.svg': '<?xml…>', 'folds.svg': … }. Omits layers
// that would be empty so the bundle stays clean.
export function buildSVGLayers({
  net, edgeLengthMm,
  led, ledsPerFace,
  connector, connectorFaceIdx, wireCount, solderPad,
  mountingHole, panel,
}) {
  const viewBox = bboxForNet(net, edgeLengthMm);
  const out = {};
  out['outline.svg'] = svgWrap('Edge.Cuts', viewBox, outlineLayer(net, panel, edgeLengthMm));
  const folds = foldsLayer(net, edgeLengthMm);
  if (folds) out['folds.svg'] = svgWrap('Dwgs.User', viewBox, folds);
  const leds = ledsLayer(net, led, ledsPerFace, edgeLengthMm);
  if (leds) out['leds.svg'] = svgWrap('F.Fab.LEDs', viewBox, leds);
  const conn = connLayer(net, connector, connectorFaceIdx, wireCount, solderPad, edgeLengthMm);
  // Connector + pads live on the BACK of the PCB → B.Fab layer.
  // KiCad's Import Graphics drops the file on the back-side layer.
  if (conn) out['connector_back.svg'] = svgWrap('B.Fab.Connector', viewBox, conn);
  const holes = holesLayer(net, mountingHole, edgeLengthMm);
  if (holes) out['holes.svg'] = svgWrap('NPTH', viewBox, holes);
  return out;
}
