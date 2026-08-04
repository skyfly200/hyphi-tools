// Shared geometry helpers for net rendering and export.
//
// All inputs are in normalized-edge-length units (the unfolder's output);
// the caller scales to millimeters by multiplying by edgeLengthMm.

import polygonClipping from 'polygon-clipping';

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

// Regular-polygon panel shapes, keyed by side count. 'circle' is
// handled separately as a real circle primitive.
export const INSCRIBED_NGON = {
  triangle: 3, square: 4, pentagon: 5, hexagon: 6,
  heptagon: 7, octagon: 8,
};

// All selectable panel shapes, in menu order, with human labels.
export const PANEL_SHAPES = [
  { id: 'face',     label: 'Face polygon (full or inset)' },
  { id: 'circle',   label: 'Inscribed circle' },
  { id: 'triangle', label: 'Inscribed triangle' },
  { id: 'square',   label: 'Inscribed square' },
  { id: 'pentagon', label: 'Inscribed pentagon' },
  { id: 'hexagon',  label: 'Inscribed hexagon' },
  { id: 'heptagon', label: 'Inscribed heptagon' },
  { id: 'octagon',  label: 'Inscribed octagon' },
];

// Apply the panel shape to a face's 2D polygon and return a tagged
// outline ready to render or export.
//
// 'face'     → original polygon, optionally inset and/or corner-rounded.
// 'circle'   → inscribed circle scaled by panel.scale, returned as
//              { kind:'circle', cx, cy, r } for a real circle primitive.
// n-gon ids  → regular polygon inscribed in the face's inradius, with an
//              optional panel.rotationDeg spin. cornerRadius applies too.
export function panelOutline(face2D, panel, edgeLengthMm) {
  const c = centroid2D(face2D);
  const inradius = inradiusOf(face2D, c);
  const insetUnits = (panel?.insetMm || 0) / Math.max(edgeLengthMm, 0.001);
  const shape = panel?.shape || 'face';
  const cornerRadius = (panel?.cornerRadiusMm || 0) / Math.max(edgeLengthMm, 0.001);

  if (shape === 'circle') {
    const r = Math.max(0.001, inradius * (panel?.scale ?? 0.95) - insetUnits);
    return { kind: 'circle', cx: c[0], cy: c[1], r };
  }

  const sides = INSCRIBED_NGON[shape];
  if (sides) {
    const r = Math.max(0.001, inradius * (panel?.scale ?? 0.95) - insetUnits);
    // Default orientation: flat-bottom for even-sided, point-up for odd,
    // plus any user rotation.
    const base = (sides % 2 ? -Math.PI / 2 : Math.PI / sides);
    const rot = base + (panel?.rotationDeg || 0) * Math.PI / 180;
    const pts = Array.from({ length: sides }, (_, i) => {
      const a = rot + (2 * Math.PI / sides) * i;
      return [c[0] + Math.cos(a) * r, c[1] + Math.sin(a) * r];
    });
    return { kind: 'polygon', points: pts, cornerRadius };
  }

  // 'face' — same shape as the original polygon, inset and/or rounded.
  const inset = insetPolygon(face2D, c, insetUnits);
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

// Trace count carried by every bridge in the spanning tree, given the
// LED's wire count. Each data signal needs to travel down into the
// subtree (DIN/CIN) AND back out as the next-LED feeder (DOUT/COUT),
// so trace count = 2 × data signals + 2 power rails.
//
//   3-wire WS2812 (VCC, DIN, GND):           VCC + GND + DIN + DOUT       = 4
//   4-wire APA102 (VCC, GND, CIN, DIN):      VCC + GND + CIN+COUT + DIN+DOUT = 6
export function bridgeTraceCount(wireCount) {
  return Math.max(2, 2 * (wireCount || 3) - 2);
}

// Bridge width in mm sized exactly for the traces it carries:
// N traces at traceWidth, (N-1) clearance gaps between them, and
// edgeMargin on each side. Returns 0 when N=0.
export function computeBridgeWidthMm(traceCount, designRules) {
  if (traceCount <= 0) return 0;
  const tw = designRules?.traceWidthMm ?? 0.25;
  const cl = designRules?.clearanceMm   ?? 0.2;
  const em = designRules?.edgeMarginMm  ?? 0.5;
  return traceCount * tw + (traceCount - 1) * cl + 2 * em;
}

// Centerline of a bridge from cA to cB, in normalized units.
//
// 'straight' → two points.
// 's-curve'  → tessellated cubic Bézier whose control points are
//              offset laterally in opposite directions, producing a
//              serpentine. The extra material length lets the hinge
//              wrap a tighter bend radius without straining copper —
//              standard practice for dynamic flex sections.
export function bridgeCenterline(cA, cB, style, ampUnits) {
  if (style !== 's-curve' || ampUnits <= 0) return [cA, cB];
  const dx = cB[0] - cA[0], dy = cB[1] - cA[1];
  const len = Math.hypot(dx, dy) || 1;
  const ux = dx / len, uy = dy / len;
  const nx = -uy, ny = ux;
  // Control points at 1/3 and 2/3 along the axis, offset to opposite
  // sides — classic S. Amplitude is the lateral control offset.
  const p0 = cA;
  const p1 = [cA[0] + ux * len / 3 + nx * ampUnits, cA[1] + uy * len / 3 + ny * ampUnits];
  const p2 = [cA[0] + ux * 2 * len / 3 - nx * ampUnits, cA[1] + uy * 2 * len / 3 - ny * ampUnits];
  const p3 = cB;
  const SEGS = 24;
  const pts = [];
  for (let i = 0; i <= SEGS; i++) {
    const t = i / SEGS, s = 1 - t;
    pts.push([
      s*s*s*p0[0] + 3*s*s*t*p1[0] + 3*s*t*t*p2[0] + t*t*t*p3[0],
      s*s*s*p0[1] + 3*s*s*t*p1[1] + 3*s*t*t*p2[1] + t*t*t*p3[1],
    ]);
  }
  return pts;
}

// Offset a polyline laterally by `off` using averaged per-point
// normals. Good enough for the gentle curvature of an S-bridge
// (curvature radius >> offset).
export function offsetPolyline(pts, off) {
  const n = pts.length;
  if (n < 2) return pts.map(p => [p[0], p[1]]);
  const normals = [];
  for (let i = 0; i < n; i++) {
    const a = pts[Math.max(0, i - 1)];
    const b = pts[Math.min(n - 1, i + 1)];
    const dx = b[0] - a[0], dy = b[1] - a[1];
    const l = Math.hypot(dx, dy) || 1;
    normals.push([-dy / l, dx / l]);
  }
  return pts.map((p, i) => [p[0] + normals[i][0] * off, p[1] + normals[i][1] * off]);
}

// Offset a polyline with a PER-POINT half-width (used for flared /
// curved bridge ends). side is +1 / −1.
export function offsetVariablePolyline(pts, halfWidths, side) {
  const n = pts.length;
  if (n < 2) return pts.map(p => [p[0], p[1]]);
  const normals = [];
  for (let i = 0; i < n; i++) {
    const a = pts[Math.max(0, i - 1)];
    const b = pts[Math.min(n - 1, i + 1)];
    const dx = b[0] - a[0], dy = b[1] - a[1];
    const l = Math.hypot(dx, dy) || 1;
    normals.push([-dy / l, dx / l]);
  }
  return pts.map((p, i) => [p[0] + normals[i][0] * halfWidths[i] * side, p[1] + normals[i][1] * halfWidths[i] * side]);
}

// Cumulative arc length along a polyline.
function cumLen(pts) {
  const c = [0];
  for (let i = 1; i < pts.length; i++)
    c[i] = c[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
  return c;
}
function ptAtArc(pts, cum, s) {
  const total = cum[cum.length - 1];
  s = Math.max(0, Math.min(total, s));
  let i = 1;
  while (i < cum.length && cum[i] < s) i++;
  const seg = (cum[i] - cum[i - 1]) || 1;
  const t = (s - cum[i - 1]) / seg;
  return [pts[i - 1][0] + (pts[i][0] - pts[i - 1][0]) * t, pts[i - 1][1] + (pts[i][1] - pts[i - 1][1]) * t];
}
// Uniformly resample the arc-length range [s0, s1] into `samples+1` pts.
function subByArc(pts, cum, s0, s1, samples) {
  const out = [];
  for (let k = 0; k <= samples; k++) out.push(ptAtArc(pts, cum, s0 + (s1 - s0) * k / samples));
  return out;
}

// Trim a centroid→centroid centerline down to just the free gap plus a
// short bonded overlap onto each panel, so the bridge stops at (just
// past) the panel edges instead of burying all the way to the centroid.
function trimCenterlineToEdges(net, e, center, panel, edgeLengthMm, overlapUnits) {
  const shA = panelOutline(net.faces[e.faceA].polygon2D, panel, edgeLengthMm);
  const shB = panelOutline(net.faces[e.faceB].polygon2D, panel, edgeLengthMm);
  const dense = center.length >= 40 ? center : subByArc(center, cumLen(center), 0, cumLen(center).at(-1), 80);
  const cum = cumLen(dense);
  const total = cum.at(-1);
  let exitA = 0;
  for (let i = 0; i < dense.length; i++) { if (insidePanelShape(dense[i], shA)) exitA = i; else break; }
  let entryB = dense.length - 1;
  for (let i = dense.length - 1; i >= 0; i--) { if (insidePanelShape(dense[i], shB)) entryB = i; else break; }
  if (entryB <= exitA) return { line: dense, cum, gap0: 0, gap1: total }; // panels overlap
  const s0 = Math.max(0, cum[exitA] - overlapUnits);
  const s1 = Math.min(total, cum[entryB] + overlapUnits);
  const line = subByArc(dense, cum, s0, s1, 60);
  return { line, cum: cumLen(line), gap0: cum[exitA] - s0, gap1: (s1 - s0) - (s1 - cum[entryB]) };
}

// Half-width profile along a trimmed centerline: nominal `half` in the
// middle, flaring smoothly to `endHalf` over the bonded `flareLen` at
// each end — this is what makes the bridge-to-panel transition curve.
function bridgeWidthProfile(line, half, endHalf, flareLen) {
  const cum = cumLen(line);
  const total = cum.at(-1) || 1;
  return line.map((_, i) => {
    const dEdge = Math.min(cum[i], total - cum[i]);
    if (dEdge >= flareLen || flareLen <= 0) return half;
    const u = dEdge / flareLen;          // 0 at the very end → 1 at flareLen
    const s = u * u * (3 - 2 * u);        // smoothstep
    return endHalf + (half - endHalf) * s;
  });
}

// Gap-aware bridge centerline between two adjacent faces, in
// normalized units. Straight bridges are just centroid → centroid.
// For S-curve bridges, the serpentine is confined to the GAP between
// the two panel boundaries — that's the only stretch free to flex, so
// spreading the curve across the whole span (most of it bonded to
// rigid panel) would waste the amplitude where it does nothing.
export function gapAwareCenterline(net, e, panel, edgeLengthMm) {
  const fA = net.faces[e.faceA];
  const fB = net.faces[e.faceB];
  const cA = centroid2D(fA.polygon2D);
  const cB = centroid2D(fB.polygon2D);
  const cfg = panel?.bridge || {};
  if (cfg.style !== 's-curve' || !(cfg.curveAmplitudeMm > 0)) return [cA, cB];

  const shapeA = panelOutline(fA.polygon2D, panel, edgeLengthMm);
  const shapeB = panelOutline(fB.polygon2D, panel, edgeLengthMm);
  const N = 160;
  const line = Array.from({ length: N }, (_, i) => {
    const t = i / (N - 1);
    return [cA[0] + (cB[0] - cA[0]) * t, cA[1] + (cB[1] - cA[1]) * t];
  });
  let exitA = 0;
  for (let i = 0; i < N; i++) {
    if (insidePanelShape(line[i], shapeA)) exitA = i; else break;
  }
  let entryB = N - 1;
  for (let i = N - 1; i >= 0; i--) {
    if (insidePanelShape(line[i], shapeB)) entryB = i; else break;
  }
  if (entryB - exitA < 2) return [cA, cB]; // panels touch — no gap to shape

  const ampUnits = cfg.curveAmplitudeMm / Math.max(edgeLengthMm, 0.001);
  const s = bridgeCenterline(line[exitA], line[entryB], 's-curve', ampUnits);
  return [cA, ...s, cB];
}

// Flex bridges connecting adjacent panels across each fold edge.
//
// The bridge is a strip running from face A's centroid to face B's
// centroid (crossing the fold edge at its midpoint), `widthMm` wide.
// Anchoring the ends at the panel CENTROIDS — which every panel
// shape contains — guarantees the strip penetrates both panels no
// matter how far the panel boundary is inset (inset polygon,
// inscribed circle, inscribed hexagon). The panel/board union at
// export absorbs the buried portion; only the span between the two
// panel boundaries survives as visible bridge.
//
// style 's-curve' swaps the straight centerline through the panel
// gap for a serpentine (see gapAwareCenterline) — the outline is
// built by offsetting the tessellated curve ±width/2, so the strip
// keeps constant width along the S.
//
// Takes the whole net (faces + foldEdges) since it needs centroids.
export function bridgesForNet(net, panel, widthMm, edgeLengthMm) {
  const cfg = panel?.bridge;
  if (!cfg || !cfg.enabled || widthMm <= 0) return [];
  const wUnits = widthMm / Math.max(edgeLengthMm, 0.001);
  const out = [];
  for (const e of net.foldEdges) {
    const fA = net.faces[e.faceA];
    const fB = net.faces[e.faceB];
    if (!fA || !fB) continue;
    const cA = centroid2D(fA.polygon2D);
    const cB = centroid2D(fB.polygon2D);
    const dx = cB[0] - cA[0], dy = cB[1] - cA[1];
    const len = Math.sqrt(dx * dx + dy * dy);
    if (len < 1e-9) continue;
    const ux = dx / len, uy = dy / len;       // along the bridge axis
    const nx = -uy, ny = ux;                  // across the bridge (trace lanes)
    const half = wUnits / 2;

    // Full centroid→centroid centerline (with any S-curve), then trim
    // to the free gap + a short bonded overlap so the bridge ends at
    // the panel edges instead of running to the centroids.
    const raw = gapAwareCenterline(net, e, panel, edgeLengthMm);
    const overlap = (cfg.overlapMm ?? 1.2) / Math.max(edgeLengthMm, 0.001);
    const { line: center } = trimCenterlineToEdges(net, e, raw, panel, edgeLengthMm, overlap);

    // Curved transitions: flare the width out at the two bonded ends.
    // The fillet is capped at a fraction of the nominal half-width so
    // the ends stay modest (≤ ~1.3× nominal) — otherwise several
    // bridges converging on one panel balloon into a blob.
    const curved = cfg.curved !== false;
    const rawFillet = (cfg.filletMm ?? 0.8) / Math.max(edgeLengthMm, 0.001);
    const filletUnits = curved ? Math.min(rawFillet, half * 0.3) : 0;
    const flareLen = Math.max(overlap, 1.5 / Math.max(edgeLengthMm, 0.001));
    const prof = bridgeWidthProfile(center, half, half + filletUnits, flareLen);

    const left  = offsetVariablePolyline(center, prof, +1);
    const right = offsetVariablePolyline(center, prof, -1);
    const corners = [...left, ...right.reverse()];
    out.push({
      points: corners,
      centerline: center,
      widthProfile: prof,
      faceA: e.faceA, faceB: e.faceB,
      midpoint: [(cA[0] + cB[0]) / 2, (cA[1] + cB[1]) / 2],
      axis: [ux, uy],
      across: [nx, ny],
      endA: cA,
      endB: cB,
      length: len,
      width: wUnits,
    });
  }
  return out;
}

// Connector tab: a small board protruding off one edge of the
// connector face, carrying the wire-entry connector. Returns null when
// disabled. All geometry in normalized units.
//
//   { tab: [[x,y]...],        // tab outline polygon
//     pads: [[x,y]...],       // pad centers (row along the edge)
//     padW, padH,             // pad size
//     bridge: [[x,y]...]|null,// flex strip (attach === 'bridge')
//     dir: [nx,ny],           // outward normal (tab points this way)
//     along: [ux,uy],         // edge tangent (pad row runs this way)
//     faceIdx }               // face the tab rides (folds with it)
//
// `spec` comes from resolveTabSpec(); passed in so this module stays
// free of the connector catalog import.
export function connectorTabGeometry(net, params, spec, edgeLengthMm) {
  const ct = params?.connectorTab;
  if (!ct?.enabled || !spec) return null;
  const fi0 = params.connectorFaceIdx;
  const face = net.faces[fi0];
  if (!face) return null;
  const poly = face.polygon2D;
  const c = centroid2D(poly);
  const n = poly.length;
  const M = Math.max(edgeLengthMm, 0.001);

  // Obstacles the tab must clear: every OTHER face's panel outline plus
  // the panels of the connector face's own neighbors (approximated as
  // their full face polygons — a superset, so the tab clears the real
  // inscribed shapes too).
  const obstacles = [];
  for (let i = 0; i < net.faces.length; i++) {
    if (i === fi0 || !net.faces[i]) continue;
    obstacles.push(shapeToPolygon(panelOutline(net.faces[i].polygon2D, params.panel, edgeLengthMm)));
  }

  // Build the tab (and bridge) for a given edge + standoff.
  function buildAt(ei, gapUnits) {
    const a = poly[ei], b = poly[(ei + 1) % n];
    const mid = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
    const ex = b[0] - a[0], ey = b[1] - a[1];
    const el = Math.hypot(ex, ey) || 1;
    const ux = ex / el, uy = ey / el;
    let nx = -uy, ny = ux;
    if (Math.hypot(mid[0] + nx - c[0], mid[1] + ny - c[1]) < Math.hypot(mid[0] - c[0], mid[1] - c[1])) {
      nx = -nx; ny = -ny;
    }
    const tabW = spec.tabWMm / M, tabL = spec.tabLMm / M;
    const innerC = [mid[0] + nx * gapUnits, mid[1] + ny * gapUnits];
    const outerC = [innerC[0] + nx * tabL, innerC[1] + ny * tabL];
    const hw = tabW / 2;
    const tab = [
      [innerC[0] + ux * hw, innerC[1] + uy * hw],
      [outerC[0] + ux * hw, outerC[1] + uy * hw],
      [outerC[0] - ux * hw, outerC[1] - uy * hw],
      [innerC[0] - ux * hw, innerC[1] - uy * hw],
    ];
    const padC = [innerC[0] + nx * tabL * 0.6, innerC[1] + ny * tabL * 0.6];
    const pitch = spec.pitchMm / M;
    const strip = pitch * (spec.pins - 1);
    const pads = Array.from({ length: spec.pins }, (_, i) => {
      const tt = -strip / 2 + pitch * i;
      return [padC[0] + ux * tt, padC[1] + uy * tt];
    });
    let bridge = null;
    if (ct.attach === 'bridge' && gapUnits > 1e-6) {
      const bhw = ((spec.bridgeWidthMm ?? Math.min(spec.tabWMm, 6)) / M) / 2;
      bridge = [
        [mid[0] + ux * bhw, mid[1] + uy * bhw],
        [innerC[0] + ux * bhw, innerC[1] + uy * bhw],
        [innerC[0] - ux * bhw, innerC[1] - uy * bhw],
        [mid[0] - ux * bhw, mid[1] - uy * bhw],
      ];
    }
    return { tab, pads, padW: spec.padWMm / M, padH: spec.padHMm / M,
             bridge, dir: [nx, ny], along: [ux, uy], faceIdx: fi0, edge: ei, gapMm: gapUnits * M };
  }

  const clears = (g) => !obstacles.some(o =>
    polysIntersect(g.tab, o) || (g.bridge && polysIntersect(g.bridge, o)));

  const baseGap = ct.attach === 'bridge' ? (ct.offsetMm ?? 6) / M : 0.5 / M;
  // Candidate edges: the requested one first (unless 'auto'), then the
  // rest — so a manual choice wins when it already clears.
  const order = [];
  if (ct.edge !== 'auto' && Number.isFinite(ct.edge)) order.push(((ct.edge % n) + n) % n);
  for (let i = 0; i < n; i++) if (!order.includes(i)) order.push(i);

  // For each candidate edge, push the tab outward until it clears the
  // other segments (bridge mode can grow the standoff; direct mode
  // gets a small search too). First fully-clear placement wins.
  let fallback = buildAt(order[0], baseGap);
  const maxGap = baseGap + 40 / M;
  for (const ei of order) {
    for (let gap = baseGap; gap <= maxGap; gap += 2 / M) {
      const g = buildAt(ei, gap);
      if (clears(g)) return g;
      if (gap === baseGap && ei === order[0]) fallback = g;
    }
  }
  return fallback; // nothing perfectly clear — return the requested placement
}

// Merge every board piece (panels + bridges + connector tab + its flex
// bridge) into clean, non-overlapping closed rings via a polygon union.
//
// This is what the exporters must use for the board outline: emitting
// each panel and bridge as its own loop leaves overlapping / coincident
// edges (bridges bond over panel edges; touching panels share edges),
// which downstream tools (KiCad → STEP/Blender) reject as a malformed
// outline. The union produces a single manifold silhouette instead.
//
// Returns an array of rings (each a closed polygon in normalized
// units); outer boundaries and any interior holes are all included.
export function boardOutlineRings(net, params, { widthMm, tabSpec, edgeLengthMm }) {
  const closeRing = (pts) => {
    const r = pts.map(p => [p[0], p[1]]);
    if (r.length && (r[0][0] !== r[r.length - 1][0] || r[0][1] !== r[r.length - 1][1])) r.push([r[0][0], r[0][1]]);
    return r;
  };
  const polys = [];
  for (let i = 0; i < net.faces.length; i++) {
    if (!net.faces[i]) continue;
    polys.push([closeRing(shapeToPolygon(panelOutline(net.faces[i].polygon2D, params.panel, edgeLengthMm)))]);
  }
  if (params.panel?.bridge?.enabled && widthMm > 0) {
    for (const b of bridgesForNet(net, params.panel, widthMm, edgeLengthMm)) polys.push([closeRing(b.points)]);
  }
  if (params.connectorTab?.enabled && tabSpec) {
    const g = connectorTabGeometry(net, params, tabSpec, edgeLengthMm);
    if (g) { polys.push([closeRing(g.tab)]); if (g.bridge) polys.push([closeRing(g.bridge)]); }
  }
  if (!polys.length) return [];
  let merged;
  try {
    merged = polygonClipping.union(polys[0], ...polys.slice(1));
  } catch {
    return polys.map(p => p[0]); // degenerate input — fall back to raw rings
  }
  const rings = [];
  for (const poly of merged) for (const ring of poly) rings.push(ring);
  return rings;
}

// Convert a panelOutline result into a plain polygon (tessellating a
// circle) for intersection tests.
function shapeToPolygon(shape) {
  if (shape.kind === 'circle') {
    return Array.from({ length: 24 }, (_, i) => {
      const a = (2 * Math.PI * i) / 24;
      return [shape.cx + Math.cos(a) * shape.r, shape.cy + Math.sin(a) * shape.r];
    });
  }
  return shape.points;
}

// Do two simple polygons overlap? True if any edges cross or either
// contains a vertex of the other.
function polysIntersect(A, B) {
  for (let i = 0; i < A.length; i++) {
    const a1 = A[i], a2 = A[(i + 1) % A.length];
    for (let j = 0; j < B.length; j++) {
      const b1 = B[j], b2 = B[(j + 1) % B.length];
      if (segsCross(a1, a2, b1, b2)) return true;
    }
  }
  if (pointInPolygon(A[0], B) || pointInPolygon(B[0], A)) return true;
  return false;
}
function segsCross(p1, p2, p3, p4) {
  const d = (a, b, c) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
  const d1 = d(p3, p4, p1), d2 = d(p3, p4, p2), d3 = d(p1, p2, p3), d4 = d(p1, p2, p4);
  return ((d1 > 0) !== (d2 > 0)) && ((d3 > 0) !== (d4 > 0));
}
function pointInPolygon(p, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if ((yi > p[1]) !== (yj > p[1]) &&
        p[0] < (xj - xi) * (p[1] - yi) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

// Point-in-shape test for a panelOutline result (normalized units).
export function insidePanelShape(pt, shape) {
  if (shape.kind === 'circle') {
    return Math.hypot(pt[0] - shape.cx, pt[1] - shape.cy) <= shape.r + 1e-12;
  }
  let inside = false;
  const pts = shape.points;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, yi] = pts[i], [xj, yj] = pts[j];
    if ((yi > pt[1]) !== (yj > pt[1]) &&
        pt[0] < (xj - xi) * (pt[1] - yi) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

// Resample a polyline to n roughly-equidistant points.
function resamplePolyline(pts, n) {
  if (pts.length < 2) return pts;
  const segLen = [];
  let total = 0;
  for (let i = 1; i < pts.length; i++) {
    const l = Math.hypot(pts[i][0]-pts[i-1][0], pts[i][1]-pts[i-1][1]);
    segLen.push(l); total += l;
  }
  if (total <= 0) return pts;
  const out = [pts[0]];
  let seg = 0, segStart = 0;
  for (let k = 1; k < n; k++) {
    const target = (total * k) / (n - 1);
    while (seg < segLen.length - 1 && segStart + segLen[seg] < target) {
      segStart += segLen[seg]; seg++;
    }
    const t = segLen[seg] > 0 ? (target - segStart) / segLen[seg] : 0;
    out.push([
      pts[seg][0] + (pts[seg+1][0] - pts[seg][0]) * t,
      pts[seg][1] + (pts[seg+1][1] - pts[seg][1]) * t,
    ]);
  }
  return out;
}

// Simulate the fold of every bridge and check flex bend radius.
//
// Physical model: at full fold the two panels meet at the polyhedron's
// dihedral angle, so the bridge material must bend through
// θ = π − dihedral. Only the FREE span — the stretch of centerline
// between the two panel boundaries — can bend; the ends are bonded to
// rigid panels. Approximating the bend as a uniform circular arc, the
// neutral-axis bend radius is
//
//     r = freePathLength / θ
//
// which must be ≥ the flex stack's minimum bend radius
// (designRules.minBendRadiusMm; flex vendors typically quote 6–10 ×
// stack thickness for static bends).
//
// The free path length is measured along the actual centerline, so an
// S-curve bridge — whose serpentine path is longer than the straight
// gap — earns a proportionally larger bend radius. That is the whole
// reason the S-curve pattern exists.
export function bridgeFoldStats({ net, panel, wireCount, designRules, edgeLengthMm, dihedralDeg }) {
  const tc = bridgeTraceCount(wireCount);
  const widthMm = computeBridgeWidthMm(tc, designRules);
  const bridges = bridgesForNet(net, panel, widthMm, edgeLengthMm);
  const theta = Math.PI - (dihedralDeg * Math.PI) / 180;
  const minReq = designRules?.minBendRadiusMm ?? 3;

  const stats = [];
  for (const b of bridges) {
    const shapeA = panelOutline(net.faces[b.faceA].polygon2D, panel, edgeLengthMm);
    const shapeB = panelOutline(net.faces[b.faceB].polygon2D, panel, edgeLengthMm);
    const line = resamplePolyline(b.centerline, 240);

    // Walk from the A end: the free span starts where the centerline
    // leaves panel A and ends where it enters panel B.
    let exitA = 0;
    for (let i = 0; i < line.length; i++) {
      if (insidePanelShape(line[i], shapeA)) exitA = i; else break;
    }
    let entryB = line.length - 1;
    for (let i = line.length - 1; i >= 0; i--) {
      if (insidePanelShape(line[i], shapeB)) entryB = i; else break;
    }

    let freePathUnits = 0;
    for (let i = Math.max(1, exitA + 1); i <= Math.min(entryB, line.length - 1); i++) {
      freePathUnits += Math.hypot(line[i][0]-line[i-1][0], line[i][1]-line[i-1][1]);
    }
    const gapUnits = entryB > exitA
      ? Math.hypot(line[entryB][0]-line[exitA][0], line[entryB][1]-line[exitA][1])
      : 0;

    const freePathMm = freePathUnits * edgeLengthMm;
    const gapMm = gapUnits * edgeLengthMm;
    const bendRadiusMm = theta > 1e-9 ? freePathMm / theta : Infinity;

    stats.push({
      faceA: b.faceA,
      faceB: b.faceB,
      gapMm,
      freePathMm,
      bendRadiusMm,
      ok: bendRadiusMm >= minReq,
    });
  }

  const worst = stats.length
    ? stats.reduce((w, s) => (s.bendRadiusMm < w.bendRadiusMm ? s : w))
    : null;
  const passCount = stats.filter(s => s.ok).length;

  return {
    foldAngleDeg: (theta * 180) / Math.PI,
    minReqMm: minReq,
    bridgeWidthMm: widthMm,
    stats,
    worst,
    passCount,
    total: stats.length,
    allPass: stats.length > 0 && passCount === stats.length,
  };
}

// DFS walk of the spanning tree. Returns the sequence of face
// indices visited in order, so consecutive entries are always
// connected by a fold edge (a physical bridge). Backtracking shows
// up as repeated face indices — useful when reasoning about which
// bridges actually carry the data line.
export function chainWalkFromConnector(net, connectorFaceIdx) {
  const adj = new Map();
  for (const e of net.foldEdges) {
    if (!adj.has(e.faceA)) adj.set(e.faceA, []);
    if (!adj.has(e.faceB)) adj.set(e.faceB, []);
    adj.get(e.faceA).push(e.faceB);
    adj.get(e.faceB).push(e.faceA);
  }
  const visited = new Set();
  const walk = [];
  function dfs(fi) {
    if (visited.has(fi) || !net.faces[fi]) return;
    visited.add(fi);
    walk.push(fi);
    for (const n of adj.get(fi) || []) {
      if (!visited.has(n)) {
        dfs(n);
        walk.push(fi); // backtrack
      }
    }
  }
  dfs(connectorFaceIdx);
  return walk;
}

// Chain order: unique DFS visit order from the connector. Position
// 0 is the LED nearest the connector; the last face is the chain
// terminator (DOUT dangles or wraps to a test pad). Consecutive
// entries are always one fold-edge bridge apart, so this is the
// order in which the data line physically passes through faces.
export function chainOrderFromConnector(net, connectorFaceIdx) {
  const walk = chainWalkFromConnector(net, connectorFaceIdx);
  const seen = new Set();
  const order = [];
  for (const fi of walk) {
    if (seen.has(fi)) continue;
    seen.add(fi);
    order.push(fi);
  }
  for (let i = 0; i < net.faces.length; i++) {
    if (net.faces[i] && !seen.has(i)) order.push(i);
  }
  return order;
}

// Plan copper routing: returns a list of trace polylines in mm.
// Each entry is { signal, points: [[x,y], ...], color }. Signals are
// laid out as parallel lanes through every bridge — VCC and GND on
// the outer lanes (always carried), DIN/DOUT (and CIN/COUT for 4-wire
// LEDs) on the inner lanes. Through any given bridge, the lanes share
// the same physical width so all bridges in the net are uniform.
//
// The data line snake-walks the spanning tree DFS-style from the
// connector. Each LED's DIN connects to its DOUT internally; we
// represent that as a tiny stub inside the LED footprint.
//
// Coordinates are in mm with Y-down (KiCad / screen convention).
export function planRouting({
  net, connectorFaceIdx, led, ledsPerFace,
  connector, panel, wireCount, designRules,
  edgeLengthMm,
}) {
  const tc = bridgeTraceCount(wireCount);
  const widthMm = computeBridgeWidthMm(tc, designRules);
  if (!panel?.bridge?.enabled || !led || ledsPerFace <= 0) return { traces: [], widthMm };

  // Lane offsets across the bridge width, centered on the fold edge.
  // For N traces with trace width tw and clearance cl, lane k sits at:
  //   y = -((N-1)/2 - k) * pitch
  // where pitch = tw + cl.
  const tw = designRules?.traceWidthMm ?? 0.25;
  const cl = designRules?.clearanceMm ?? 0.2;
  const pitch = tw + cl;
  const lane = (k) => (k - (tc - 1) / 2) * pitch;

  // Signal → lane index. Convention: outer lanes for power, inner
  // lanes for data round-trip.
  //   3-wire: VCC=0, DIN=1, DOUT=2, GND=3
  //   4-wire: VCC=0, CIN=1, DIN=2, DOUT=3, COUT=4, GND=5
  const signals = wireCount === 4
    ? ['VCC', 'CIN', 'DIN', 'DOUT', 'COUT', 'GND']
    : ['VCC', 'DIN', 'DOUT', 'GND'];
  const laneOf = (sig) => signals.indexOf(sig);
  const color = {
    VCC:  '#e23b3b', GND:  '#222222',
    DIN:  '#3a7bd5', DOUT: '#3fbf7f',
    CIN:  '#7b5cfa', COUT: '#ff6b35',
  };

  const chain = chainOrderFromConnector(net, connectorFaceIdx);
  // Map from face index → chain index, so we can look up LED positions
  // in order.
  const chainIdxByFace = new Map();
  chain.forEach((fi, i) => chainIdxByFace.set(fi, i));

  // Per-face LED positions in mm.
  const ledsByFace = new Map();
  for (const fi of chain) {
    const face = net.faces[fi];
    if (!face) continue;
    // Panel-aware so multi-LED rings stay inside inset/inscribed panels.
    const pts = ledPositions(face.polygon2D, led, ledsPerFace, edgeLengthMm, panel);
    ledsByFace.set(fi, pts.map(([x, y]) => [x * edgeLengthMm, -y * edgeLengthMm]));
  }

  // Per-bridge, per-signal lane POLYLINES in mm, stored A→B, built from
  // the ACTUAL trimmed bridge centerlines. Because a trimmed bridge
  // ends at the panel edges (not the centroids), the lanes stop there
  // too — so the lanes of different bridges no longer all funnel onto
  // the shared centroid and cross each other. Each face's interior
  // routing then connects those edge points via per-signal waypoints.
  const bridgeLanePath = new Map(); // key: `${fA}-${fB}/${sig}` → [[x,y], ...] A→B
  for (const b of bridgesForNet(net, panel, widthMm, edgeLengthMm)) {
    const center = b.centerline.map(([x, y]) => [x * edgeLengthMm, -y * edgeLengthMm]);
    for (const sig of signals) {
      const off = lane(laneOf(sig));
      bridgeLanePath.set(`${b.faceA}-${b.faceB}/${sig}`, offsetPolyline(center, off));
    }
  }

  // Fetch the lane polyline for a signal crossing prev→fi, oriented
  // in travel direction.
  function lanePathAcross(prevFace, toFace, sig) {
    const key = bridgeKey(net, prevFace, toFace, sig);
    if (!key) return [];
    const path = bridgeLanePath.get(`${key.id}/${sig}`) || [];
    return key.fromSide === 'A' ? path : [...path].reverse();
  }

  // Build traces per signal. Power rails (VCC, GND) walk every
  // spanning-tree edge — visit each face, drop in at one bridge and
  // out at every other neighbor bridge. Easiest is one polyline that
  // walks the DFS tree, picking up the centroid of each face along
  // the way.
  const traces = [];

  // Connector pad locations (mm). For the routing we approximate
  // them as the connector centroid + lane offset perpendicular to a
  // notional connector axis (just use horizontal lane spread).
  const connFace = net.faces[connectorFaceIdx];
  const cnCx = connFace ? centroid2D(connFace.polygon2D)[0] * edgeLengthMm : 0;
  const cnCy = connFace ? -centroid2D(connFace.polygon2D)[1] * edgeLengthMm : 0;

  // Each signal entry point at the connector — a compact fan centered
  // on the connector centroid, clamped to stay inside the panel.
  const connMarginUnits = (designRules?.edgeMarginMm ?? 0.5) / Math.max(edgeLengthMm, 0.001);
  function connEntryPoint(sig) {
    const idx = signals.indexOf(sig);
    const spread = (signals.length - 1) * pitch;
    const startX = cnCx - spread / 2;
    const ptMm = [startX + idx * pitch, cnCy];
    if (!connFace) return ptMm;
    // Clamp in normalized space, then back to mm (Y-flip).
    const norm = [ptMm[0] / edgeLengthMm, -ptMm[1] / edgeLengthMm];
    const cl = clampInsidePanel(norm, connFace.polygon2D, panel, edgeLengthMm, connMarginUnits);
    return [cl[0] * edgeLengthMm, -cl[1] * edgeLengthMm];
  }

  function pushPolyline(sig, points) {
    if (points.length < 2) return;
    traces.push({ signal: sig, color: color[sig] || '#888', points });
  }

  // Extend a lane polyline a short stub past each end along its own
  // direction, so the copper visibly terminates just past the segment
  // edge / bridge rather than stopping exactly on the boundary.
  const stub = Math.min(1.2, (designRules?.edgeMarginMm ?? 0.5) + 0.7); // mm
  function withStubs(path) {
    if (path.length < 2) return path;
    const a0 = path[0], a1 = path[1];
    const b1 = path[path.length - 2], b0 = path[path.length - 1];
    const ext = (from, to) => {
      const dx = from[0] - to[0], dy = from[1] - to[1];
      const l = Math.hypot(dx, dy) || 1;
      return [from[0] + (dx / l) * stub, from[1] + (dy / l) * stub];
    };
    return [ext(a0, a1), ...path, ext(b0, b1)];
  }

  // The bridge lanes already run from just past one segment edge to just
  // past the other (they are built from the trimmed bridge centerline,
  // which carries the bonded overlap). Emit one trace per bridge per
  // signal — the copper lives on the bridge + a small stub onto each
  // segment, and ends there instead of crossing the whole panel.
  for (const e of net.foldEdges) {
    if (!net.faces[e.faceA] || !net.faces[e.faceB]) continue;
    for (const sig of signals) {
      const path = bridgeLanePath.get(`${e.faceA}-${e.faceB}/${sig}`);
      if (path && path.length >= 2) pushPolyline(sig, withStubs(path));
    }
  }

  // Short connector fan-out: a stub from each connector pad to the first
  // bridge lane on the connector face, so the wire entry is shown
  // reaching the copper (still ending near the segment edge).
  const firstBridge = net.foldEdges.find(e => e.faceA === connectorFaceIdx || e.faceB === connectorFaceIdx);
  if (firstBridge) {
    for (const sig of signals) {
      const lp = lanePathAcross(connectorFaceIdx,
        firstBridge.faceA === connectorFaceIdx ? firstBridge.faceB : firstBridge.faceA, sig);
      if (lp && lp.length) pushPolyline(sig, [connEntryPoint(sig), lp[0]]);
    }
  }

  return { traces, widthMm };
}

// Resolve the bridge between two adjacent faces and return its key
// plus which side is which face's view.
function bridgeKey(net, fA, fB, _sig) {
  for (const e of net.foldEdges) {
    if (e.faceA === fA && e.faceB === fB) return { id: `${fA}-${fB}`, fromSide: 'A', toSide: 'B' };
    if (e.faceA === fB && e.faceB === fA) return { id: `${fB}-${fA}`, fromSide: 'B', toSide: 'A' };
  }
  return null;
}

// Inradius (normalized units) of the actual panel shape — the largest
// circle centered on the centroid that fits inside the rendered panel.
export function panelInradius(face2D, panel, edgeLengthMm) {
  const shape = panelOutline(face2D, panel || { shape: 'face' }, edgeLengthMm);
  if (shape.kind === 'circle') return shape.r;
  const c = centroid2D(shape.points);
  let r = Infinity;
  const pts = shape.points;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i], b = pts[(i + 1) % pts.length];
    const dx = b[0] - a[0], dy = b[1] - a[1];
    const len = Math.sqrt(dx * dx + dy * dy) || 1;
    const d = Math.abs(dy * c[0] - dx * c[1] + b[0] * a[1] - b[1] * a[0]) / len;
    if (d < r) r = d;
  }
  return r;
}

// Move a point inward toward the panel centroid until it sits inside
// the panel shape, keeping `marginUnits` of clearance from the edge.
export function clampInsidePanel(ptNorm, face2D, panel, edgeLengthMm, marginUnits = 0) {
  const shape = panelOutline(face2D, panel || { shape: 'face' }, edgeLengthMm);
  const c = shape.kind === 'circle' ? [shape.cx, shape.cy] : centroid2D(shape.points);
  if (shape.kind === 'circle') {
    const dx = ptNorm[0] - c[0], dy = ptNorm[1] - c[1];
    const d = Math.hypot(dx, dy);
    const rMax = Math.max(0, shape.r - marginUnits);
    if (d <= rMax || d < 1e-9) return ptNorm;
    return [c[0] + (dx / d) * rMax, c[1] + (dy / d) * rMax];
  }
  // Polygon: binary-search the fraction from centroid toward the point
  // that keeps it inside (minus margin via a shrunk test).
  if (insidePanelShape(ptNorm, shape) && distToBoundary(ptNorm, shape.points) >= marginUnits) return ptNorm;
  let lo = 0, hi = 1;
  for (let it = 0; it < 24; it++) {
    const mid = (lo + hi) / 2;
    const q = [c[0] + (ptNorm[0] - c[0]) * mid, c[1] + (ptNorm[1] - c[1]) * mid];
    if (insidePanelShape(q, shape) && distToBoundary(q, shape.points) >= marginUnits) lo = mid;
    else hi = mid;
  }
  return [c[0] + (ptNorm[0] - c[0]) * lo, c[1] + (ptNorm[1] - c[1]) * lo];
}

function distToBoundary(pt, poly) {
  let min = Infinity;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length];
    const dx = b[0] - a[0], dy = b[1] - a[1];
    const l2 = dx * dx + dy * dy || 1;
    let t = ((pt[0] - a[0]) * dx + (pt[1] - a[1]) * dy) / l2;
    t = Math.max(0, Math.min(1, t));
    const px = a[0] + dx * t, py = a[1] + dy * t;
    min = Math.min(min, Math.hypot(pt[0] - px, pt[1] - py));
  }
  return min;
}

// LED positions per face, in normalized units. Single LED → centroid;
// multiple LEDs → ring around the centroid sized by LED body so they
// don't overlap. When `panel` is given, the ring radius is capped so
// every LED (and its body) stays inside the panel boundary.
export function ledPositions(face2D, ledFootprint, ledsPerFace, edgeLengthMm, panel = null) {
  if (!ledFootprint || ledsPerFace <= 0) return [];
  const c = centroid2D(face2D);
  if (ledsPerFace === 1) return [c];
  const ledHalfUnits = (Math.max(ledFootprint.body.w, ledFootprint.body.h) / 2) / Math.max(edgeLengthMm, 0.001);
  let rUnits = (Math.max(ledFootprint.body.w, ledFootprint.body.h) * 0.9) / Math.max(edgeLengthMm, 0.001);
  if (panel) {
    const inr = panelInradius(face2D, panel, edgeLengthMm);
    rUnits = Math.min(rUnits, Math.max(0, inr - ledHalfUnits));
  }
  return Array.from({ length: ledsPerFace }, (_, i) => {
    const a = (2 * Math.PI * i) / ledsPerFace - Math.PI / 2;
    return [c[0] + Math.cos(a) * rUnits, c[1] + Math.sin(a) * rUnits];
  });
}
