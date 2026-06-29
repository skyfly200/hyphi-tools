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
export function buildDXF({ net, ledFootprint, ledsPerFace, connector, connectorFaceIdx, wireCount = 3, scale = 1 }) {
  let body = '';

  // Outline: emit each unfolded face as its own closed polyline. This
  // way the importer sees them as separate regions even if a future
  // version glues adjacent faces together.
  for (const face of net.faces) {
    if (!face) continue;
    const pts = face.polygon2D.map(([x, y]) => [x * scale, y * scale]);
    body += polyline(pts, 'OUTLINE', true);
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

  // One connector keepout on the requested face's centroid.
  if (connector && connectorFaceIdx != null) {
    const face = net.faces[connectorFaceIdx];
    if (face) {
      const c = centroid(face.polygon2D).map(v => v * scale);
      const baseW = connector.id === 'PAD_ONLY'
        ? connector.pitch * (wireCount + 1)
        : connector.body.w;
      const w = (baseW + connector.keepout * 2);
      const h = (connector.body.h + connector.keepout * 2);
      body += rect(c[0], c[1], w, h, 'CONN');
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
