// Shared geometry helpers for net rendering and export.
//
// All inputs are in normalized-edge-length units (the unfolder's output);
// the caller scales to millimeters by multiplying by edgeLengthMm.

export function centroid2D(pts) {
  let x = 0, y = 0;
  for (const p of pts) { x += p[0]; y += p[1]; }
  return [x / pts.length, y / pts.length];
}

// Mounting hole positions per face, in normalized units. Caller scales.
//
// 'center'  → one hole at the face centroid
// 'corners' → one hole per face vertex, inset toward the centroid by
//             `marginMm`. We do the inset in mm and convert back to
//             normalized units via edgeLengthMm so the margin is a real
//             physical clearance regardless of edge length.
export function mountingHolePositions(face2D, params, edgeLengthMm) {
  if (!params || !params.enabled) return [];
  const c = centroid2D(face2D);
  if (params.position === 'center') return [c];
  const insetUnits = (params.marginMm || 0) / Math.max(edgeLengthMm, 0.001);
  return face2D.map(([x, y]) => {
    const dx = c[0] - x, dy = c[1] - y;
    const d = Math.sqrt(dx * dx + dy * dy) || 1;
    const t = Math.min(insetUnits / d, 0.45); // clamp so it never crosses the centroid
    return [x + dx * t, y + dy * t];
  });
}

// Apply the panel shape (face / circle / hexagon) to a face's 2D
// polygon and return a tagged outline ready to render or export.
//
// 'face'    → original polygon, optionally inset and/or rounded at
//             the corners. cornerRadius is in normalized units.
// 'circle'  → inscribed circle, scaled by panel.scale. Returned as
//             { kind: 'circle', cx, cy, r } so the renderer can use
//             a real circle primitive instead of a many-sided polygon.
// 'hexagon' → regular 6-gon inscribed in the face's inradius.
export function panelOutline(face2D, panel, edgeLengthMm) {
  const c = centroid2D(face2D);
  const inradius = inradiusOf(face2D, c);
  const insetUnits = (panel?.insetMm || 0) / Math.max(edgeLengthMm, 0.001);
  const shape = panel?.shape || 'face';

  if (shape === 'circle') {
    const r = Math.max(0.001, inradius * (panel?.scale ?? 0.95) - insetUnits);
    return { kind: 'circle', cx: c[0], cy: c[1], r };
  }

  if (shape === 'hexagon') {
    const r = Math.max(0.001, inradius * (panel?.scale ?? 0.95) - insetUnits);
    const pts = Array.from({ length: 6 }, (_, i) => {
      const a = (Math.PI / 3) * i;
      return [c[0] + Math.cos(a) * r, c[1] + Math.sin(a) * r];
    });
    return { kind: 'polygon', points: pts, cornerRadius: 0 };
  }

  // 'face' — same shape as the original polygon, inset and/or rounded.
  const inset = insetPolygon(face2D, c, insetUnits);
  const cornerRadius = (panel?.cornerRadiusMm || 0) / Math.max(edgeLengthMm, 0.001);
  return { kind: 'polygon', points: inset, cornerRadius };
}

// Largest circle that fits inside a (convex) polygon centered on c —
// the perpendicular distance from c to the nearest edge.
function inradiusOf(poly, c) {
  let r = Infinity;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length];
    const dx = b[0] - a[0], dy = b[1] - a[1];
    const len = Math.sqrt(dx * dx + dy * dy) || 1;
    const d = Math.abs(dy * c[0] - dx * c[1] + b[0] * a[1] - b[1] * a[0]) / len;
    if (d < r) r = d;
  }
  return r;
}

// Pull each vertex of `poly` toward `c` until the boundary moves
// inward by `inset` units. Approximate but good enough for the small
// insets users actually need; switch to a proper polygon offset
// (e.g. Clipper) if anyone ever asks for a 0.5×-edge inset.
function insetPolygon(poly, c, inset) {
  if (inset <= 0) return poly.map(p => [p[0], p[1]]);
  return poly.map(([x, y]) => {
    const dx = c[0] - x, dy = c[1] - y;
    const d = Math.sqrt(dx * dx + dy * dy) || 1;
    const t = Math.min(inset / d, 0.45);
    return [x + dx * t, y + dy * t];
  });
}

// Flex bridges connecting adjacent panels along each fold edge.
// Each bridge is a 4-point closed rectangle in normalized units,
// centered on the fold edge, length = (edgeLen - 2*marginMm),
// width = bridgeWidthMm, oriented so the long axis lies along the
// fold edge direction.
//
// foldEdges come from the unfolder: { a0, a1, faceA, faceB, ... }
// where a0/a1 are the 2D endpoints of the shared edge in the
// unfolded plane.
export function bridgesForNet(foldEdges, panel, edgeLengthMm) {
  const cfg = panel?.bridge;
  if (!cfg || !cfg.enabled) return [];
  const wUnits = (cfg.widthMm || 0) / Math.max(edgeLengthMm, 0.001);
  const mUnits = (cfg.marginMm || 0) / Math.max(edgeLengthMm, 0.001);
  const out = [];
  for (const e of foldEdges) {
    const [x0, y0] = e.a0;
    const [x1, y1] = e.a1;
    const dx = x1 - x0, dy = y1 - y0;
    const len = Math.sqrt(dx * dx + dy * dy);
    if (len <= 2 * mUnits) continue; // too short — skip
    const ux = dx / len, uy = dy / len;       // along the edge
    const nx = -uy, ny = ux;                  // perpendicular
    const half = wUnits / 2;
    const sx = x0 + ux * mUnits, sy = y0 + uy * mUnits;
    const ex = x1 - ux * mUnits, ey = y1 - uy * mUnits;
    const corners = [
      [sx + nx * half, sy + ny * half],
      [ex + nx * half, ey + ny * half],
      [ex - nx * half, ey - ny * half],
      [sx - nx * half, sy - ny * half],
    ];
    out.push({
      points: corners,
      faceA: e.faceA, faceB: e.faceB,
      midpoint: [(sx + ex) / 2, (sy + ey) / 2],
      length: len - 2 * mUnits,
      width: wUnits,
    });
  }
  return out;
}

// Chain order: BFS from the connector face through the unfolded
// fold-edge graph. Returns face indices in visit order so the LED at
// position 0 is the one closest to the connector (data-in), and the
// last face is the chain terminator (DOUT dangles or wraps back).
export function chainOrderFromConnector(net, connectorFaceIdx) {
  const adj = new Map();
  for (const e of net.foldEdges) {
    if (!adj.has(e.faceA)) adj.set(e.faceA, []);
    if (!adj.has(e.faceB)) adj.set(e.faceB, []);
    adj.get(e.faceA).push(e.faceB);
    adj.get(e.faceB).push(e.faceA);
  }
  const seen = new Set();
  const order = [];
  const queue = [connectorFaceIdx];
  while (queue.length) {
    const fi = queue.shift();
    if (seen.has(fi)) continue;
    if (!net.faces[fi]) continue;
    seen.add(fi);
    order.push(fi);
    const neighbors = adj.get(fi) || [];
    for (const n of neighbors) if (!seen.has(n)) queue.push(n);
  }
  // Pick up any faces unreachable from the connector face (shouldn't
  // happen for connected polyhedra but defensive).
  for (let i = 0; i < net.faces.length; i++) {
    if (net.faces[i] && !seen.has(i)) order.push(i);
  }
  return order;
}

// LED positions per face, in normalized units. Single LED → centroid;
// multiple LEDs → ring around the centroid sized by LED body so they
// don't overlap.
export function ledPositions(face2D, ledFootprint, ledsPerFace, edgeLengthMm) {
  if (!ledFootprint || ledsPerFace <= 0) return [];
  const c = centroid2D(face2D);
  if (ledsPerFace === 1) return [c];
  const rMm = Math.max(ledFootprint.body.w, ledFootprint.body.h) * 0.9;
  const rUnits = rMm / Math.max(edgeLengthMm, 0.001);
  return Array.from({ length: ledsPerFace }, (_, i) => {
    const a = (2 * Math.PI * i) / ledsPerFace - Math.PI / 2;
    return [c[0] + Math.cos(a) * rUnits, c[1] + Math.sin(a) * rUnits];
  });
}
