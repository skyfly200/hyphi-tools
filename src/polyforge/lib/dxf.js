import {
  mountingHolePositions, panelOutline,
  bridgesForNet, bridgeTraceCount, computeBridgeWidthMm,
  planRouting,
} from './layout.js';

// Minimal DXF writer for PolyForge.
//
// We emit an R12-flavored ASCII DXF with just the bits KiCad and most
// CAM tools need to import a 2D PCB outline: a single ENTITIES section
// containing polylines for the net outline, the per-face LED keep-out
// rectangles, and (optionally) the connector keepout rectangles.
//
// Layer convention:
//   OUTLINE  — board outline (fold lines + cut edges of the net)
//   LED      — LED body / keepout cutouts
//   CONN     — connector keepout cutouts
//   FOLD     — fold (score) lines between faces, dashed-equivalent layer
//
// The viewer / CAM importer decides what to do with each layer.

function tag(code, value) {
  return `${String(code).padStart(3, ' ')}\n${value}\n`;
}

function polyline(points, layer, closed = true) {
  let s = '';
  s += tag(0, 'POLYLINE');
  s += tag(8, layer);
  s += tag(66, 1);
  s += tag(70, closed ? 1 : 0);
  s += tag(10, 0);
  s += tag(20, 0);
  s += tag(30, 0);
  for (const [x, y] of points) {
    s += tag(0, 'VERTEX');
    s += tag(8, layer);
    s += tag(10, x.toFixed(4));
    s += tag(20, y.toFixed(4));
    s += tag(30, '0.0');
  }
  s += tag(0, 'SEQEND');
  s += tag(8, layer);
  return s;
}

function line(p1, p2, layer) {
  let s = '';
  s += tag(0, 'LINE');
  s += tag(8, layer);
  s += tag(10, p1[0].toFixed(4));
  s += tag(20, p1[1].toFixed(4));
  s += tag(30, '0.0');
  s += tag(11, p2[0].toFixed(4));
  s += tag(21, p2[1].toFixed(4));
  s += tag(31, '0.0');
  return s;
}

function rect(cx, cy, w, h, layer) {
  const x0 = cx - w / 2, y0 = cy - h / 2;
  const x1 = cx + w / 2, y1 = cy + h / 2;
  return polyline([[x0, y0], [x1, y0], [x1, y1], [x0, y1]], layer, true);
}

// Build a DXF string from a fully-resolved net.
//
// scale: multiplier from net units (where the edge length is `edgeLen`)
//        to millimeters. The caller has already applied edgeLen to the
//        net coordinates passed in; scale stays 1 unless the caller
//        wants a uniform stretch.
// Tessellate a panel polygon outline (with optional per-corner radii)
// into a flat point list. cornerRadius is in normalized units so it
// gets scaled into the final mm coordinates here.
function polygonOutlineToPoints(shape, scale) {
  const pts = shape.points;
  const rUnits = shape.cornerRadius || 0;
  if (rUnits <= 0) return pts.map(([x, y]) => [x * scale, y * scale]);

  const out = [];
  const n = pts.length;
  const segs = 8; // arc segments per rounded corner
  for (let i = 0; i < n; i++) {
    const prev = pts[(i - 1 + n) % n];
    const curr = pts[i];
    const next = pts[(i + 1) % n];
    const e1 = [prev[0] - curr[0], prev[1] - curr[1]];
    const e2 = [next[0] - curr[0], next[1] - curr[1]];
    const l1 = Math.hypot(e1[0], e1[1]) || 1;
    const l2 = Math.hypot(e2[0], e2[1]) || 1;
    const r = Math.min(rUnits, l1 / 2, l2 / 2);
    const start = [curr[0] + (e1[0] / l1) * r, curr[1] + (e1[1] / l1) * r];
    const end   = [curr[0] + (e2[0] / l2) * r, curr[1] + (e2[1] / l2) * r];
    // Approximate the arc by walking a circular sweep between the two
    // straight-edge endpoints; center is offset perpendicular to each.
    const a1 = Math.atan2(start[1] - curr[1], start[0] - curr[0]);
    const a2 = Math.atan2(end[1] - curr[1], end[0] - curr[0]);
    // Circle center: the bisector point at distance r * sec(half-angle)
    // from curr — simpler is to step along the incoming bisector.
    const bx = e1[0] / l1 + e2[0] / l2;
    const by = e1[1] / l1 + e2[1] / l2;
    const bl = Math.hypot(bx, by) || 1;
    const dot = (e1[0] / l1) * (e2[0] / l2) + (e1[1] / l1) * (e2[1] / l2);
    const halfAngle = Math.acos(Math.max(-1, Math.min(1, dot))) / 2;
    const centerDist = r / Math.sin(halfAngle);
    const cx = curr[0] + (bx / bl) * centerDist;
    const cy = curr[1] + (by / bl) * centerDist;
    const sweepStart = Math.atan2(start[1] - cy, start[0] - cx);
    let sweepEnd   = Math.atan2(end[1] - cy, end[0] - cx);
    // Walk the short way around — same direction as the polygon winding.
    let delta = sweepEnd - sweepStart;
    if (delta > Math.PI)  delta -= 2 * Math.PI;
    if (delta < -Math.PI) delta += 2 * Math.PI;
    for (let k = 0; k <= segs; k++) {
      const t = sweepStart + (delta * k) / segs;
      out.push([(cx + Math.cos(t) * r) * scale, (cy + Math.sin(t) * r) * scale]);
    }
  }
  return out;
}

function circle(cx, cy, r, layer) {
  let s = '';
  s += tag(0, 'CIRCLE');
  s += tag(8, layer);
  s += tag(10, cx.toFixed(4));
  s += tag(20, cy.toFixed(4));
  s += tag(30, '0.0');
  s += tag(40, r.toFixed(4));
  return s;
}

export function buildDXF({ net, ledFootprint, ledsPerFace, connector, connectorFaceIdx, wireCount = 3, solderPad = null, mountingHole = null, panel = null, designRules = null, routing = null, scale = 1 }) {
  let body = '';

  // Outline: each face's panel-clipped boundary. The "OUTLINE" layer
  // is the actual cut path — circle, rounded-rect, or polygon. With
  // panel.shape === 'face' and zero corner radius, this matches the
  // raw face polygon, preserving the original behavior.
  for (const face of net.faces) {
    if (!face) continue;
    const shape = panelOutline(face.polygon2D, panel || { shape: 'face' }, scale);
    if (shape.kind === 'circle') {
      body += circle(shape.cx * scale, shape.cy * scale, shape.r * scale, 'OUTLINE');
    } else {
      // Corner-rounded polygons: emit as a flat polyline at higher
      // segmentation rather than spec-compliant DXF arcs (keeps the
      // writer minimal; CAM tools resample anyway).
      const pts = polygonOutlineToPoints(shape, scale);
      body += polyline(pts, 'OUTLINE', true);
    }
  }

  // Bridges along each fold edge — auto-sized for the routing they
  // carry. Width is derived from design rules + LED wire count so
  // the bridge is exactly as wide as the traces need.
  const bridgeWidthMm = computeBridgeWidthMm(bridgeTraceCount(wireCount), designRules || {});
  for (const b of bridgesForNet(net, panel, bridgeWidthMm, scale)) {
    const pts = b.points.map(([x, y]) => [x * scale, y * scale]);
    body += polyline(pts, 'OUTLINE', true);
  }

  // Optional routed traces on a TRACE layer for CAM to pick up.
  if (routing?.enabled) {
    const plan = planRouting({
      net, connectorFaceIdx, led: ledFootprint, ledsPerFace,
      connector, panel, wireCount, designRules: designRules || {},
      edgeLengthMm: scale,
    });
    for (const t of plan.traces) {
      const pts = t.points;
      for (let i = 1; i < pts.length; i++) {
        body += line(pts[i - 1], pts[i], `TRACE_${t.signal}`);
      }
    }
  }

  // Fold lines (the shared edges in the spanning tree). These should
  // get scored (not cut) by the CAM tool.
  for (const e of net.foldEdges) {
    body += line(
      [e.a0[0] * scale, e.a0[1] * scale],
      [e.a1[0] * scale, e.a1[1] * scale],
      'FOLD'
    );
  }

  // LED footprints: drop the configured number of LED keepouts on each
  // face centroid for now. (Later: real PCB-tool placement.)
  if (ledFootprint && ledsPerFace > 0) {
    const { body: led, keepout } = ledFootprint;
    const w = (led.w + keepout * 2);
    const h = (led.h + keepout * 2);
    for (const face of net.faces) {
      if (!face) continue;
      const c = centroid(face.polygon2D).map(v => v * scale);
      if (ledsPerFace === 1) {
        body += rect(c[0], c[1], w, h, 'LED');
      } else {
        // Lay them on a simple ring around the face centroid. Crude but
        // adequate for previewing keepout coverage in CAM.
        const r = Math.min(face.polygon2D.length, 4) * (w + h) * 0.15;
        for (let i = 0; i < ledsPerFace; i++) {
          const a = (2 * Math.PI * i) / ledsPerFace;
          body += rect(c[0] + Math.cos(a) * r, c[1] + Math.sin(a) * r, w, h, 'LED');
        }
      }
    }
  }

  // Connector on the requested face's centroid: named parts get a
  // single keepout rectangle; PAD_ONLY gets individual pads (circle or
  // rect) plus the surrounding keepout strip.
  if (connector && connectorFaceIdx != null) {
    const face = net.faces[connectorFaceIdx];
    if (face) {
      const c = centroid(face.polygon2D).map(v => v * scale);
      if (connector.id === 'PAD_ONLY' && solderPad) {
        const onePadW = solderPad.shape === 'circle' ? solderPad.padDiaMm : solderPad.padWMm;
        const onePadH = solderPad.shape === 'circle' ? solderPad.padDiaMm : solderPad.padHMm;
        const stripW = solderPad.pitchMm * (wireCount - 1);
        // Surrounding keepout strip.
        body += rect(c[0], c[1],
          stripW + onePadW + solderPad.keepoutMm * 2,
          onePadH + solderPad.keepoutMm * 2,
          'CONN');
        // Per-pad geometry, also on the CONN layer so KiCad can pick
        // them up as PCB pad outlines.
        const x0 = c[0] - stripW / 2;
        for (let i = 0; i < wireCount; i++) {
          const px = x0 + solderPad.pitchMm * i;
          if (solderPad.shape === 'circle') {
            body += circle(px, c[1], solderPad.padDiaMm / 2, 'CONN_B');
          } else {
            body += rect(px, c[1], solderPad.padWMm, solderPad.padHMm, 'CONN_B');
          }
        }
      } else {
        const w = (connector.body.w + connector.keepout * 2);
        const h = (connector.body.h + connector.keepout * 2);
        body += rect(c[0], c[1], w, h, 'CONN_B');
      }
    }
  }

  // Mounting holes on a dedicated HOLE layer so CAM can route them
  // separately from the LED keepouts.
  if (mountingHole && mountingHole.enabled) {
    for (const face of net.faces) {
      if (!face) continue;
      const pts = mountingHolePositions(face.polygon2D, mountingHole, scale);
      for (const [x, y] of pts) {
        body += circle(x * scale, y * scale, mountingHole.diameterMm / 2, 'HOLE');
      }
    }
  }

  return (
    tag(0, 'SECTION') +
    tag(2, 'ENTITIES') +
    body +
    tag(0, 'ENDSEC') +
    tag(0, 'EOF')
  );
}

function centroid(pts) {
  let x = 0, y = 0;
  for (const p of pts) { x += p[0]; y += p[1]; }
  return [x / pts.length, y / pts.length];
}
