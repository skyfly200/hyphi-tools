// Panel profiles: the printable cross-section of one face.
//
// Each face is a frustum-like prism printed outer-face-down:
//   bottom polygon (z = 0, the outer surface)  — ideal face inset by a per-edge OFFSET
//   top polygon    (z = t, the inner surface)  — inset further, so every wall leans inward going up
// so every layer is smaller than the one below it: no overhangs, no supports.
//
// Per edge:
//   hinge  bottom offset a = w·tan(φ/2)/φ  (room for the flexure strip, see net.js)
//          top offset    = t·tan(φ/2)      (the mitre line, so the inner edges meet flush when folded)
//   seam   wall parallel to the mitre plane, shifted by half the seam clearance
// φ is the exterior fold angle of that edge.

import { hingeTrimMm } from './net.js';

const EPS = 1e-9;

function lineIntersect(p, d, q, e) {
  const den = d[0] * e[1] - d[1] * e[0];
  if (Math.abs(den) < EPS) return null;
  const t = ((q[0] - p[0]) * e[1] - (q[1] - p[1]) * e[0]) / den;
  return [p[0] + d[0] * t, p[1] + d[1] * t];
}

/** Polygon obtained by moving every edge of CCW polygon V inward by offs[i]. null if it collapses. */
export function offsetPolygon(V, offs) {
  const n = V.length;
  const lines = V.map((a, i) => {
    const b = V[(i + 1) % n], dx = b[0] - a[0], dy = b[1] - a[1], l = Math.hypot(dx, dy);
    const d = [dx / l, dy / l], m = [-d[1], d[0]];                    // inward normal for CCW
    return { p: [a[0] + m[0] * offs[i], a[1] + m[1] * offs[i]], d };
  });
  const out = [];
  for (let i = 0; i < n; i++) {
    const q = lineIntersect(lines[(i + n - 1) % n].p, lines[(i + n - 1) % n].d, lines[i].p, lines[i].d);
    if (!q) return null;
    out.push(q);
  }
  // valid only if every edge keeps its direction and the area is positive
  let area = 0;
  for (let i = 0; i < n; i++) {
    const a = out[i], b = out[(i + 1) % n];
    area += a[0] * b[1] - b[0] * a[1];
    const o0 = V[i], o1 = V[(i + 1) % n];
    if ((b[0] - a[0]) * (o1[0] - o0[0]) + (b[1] - a[1]) * (o1[1] - o0[1]) <= 0) return null;
  }
  return area > 0 ? out : null;
}

/**
 * @returns {{ ideal, bottom, top, edges:[{i,kind,phi,bottomOffMm,topOffMm,runMm,tiltRad,overhang}], valid, issues }}
 */
export function panelProfile(net, face) {
  const { panelThicknessMm: t, hingeWidthMm: w, seamClearanceMm: clear } = net.params;
  const issues = [];
  const edges = face.edges.map(e => {
    let bottomOff, topOff;
    if (e.kind === 'hinge') { bottomOff = hingeTrimMm(w, e.phi); topOff = t * Math.tan(e.phi / 2); }
    else { bottomOff = clear / 2 / Math.cos(e.phi / 2); topOff = bottomOff + t * Math.tan(e.phi / 2); }
    const run = topOff - bottomOff;                                    // horizontal travel of the wall, + = leans inward
    return { i: e.i, kind: e.kind, phi: e.phi, bottomOffMm: bottomOff, topOffMm: topOff, runMm: run,
      tiltRad: Math.atan2(run, t), overhang: run < -1e-9 };
  });
  const bottom = offsetPolygon(face.outer, edges.map(e => e.bottomOffMm));
  const top = offsetPolygon(face.outer, edges.map(e => e.topOffMm));
  if (!bottom) issues.push({ level: 'error', code: 'panelTooSmall', face: face.id, message: `face ${face.id}: hinge/seam trims consume the panel at the outer surface` });
  if (!top) issues.push({ level: 'error', code: 'panelTooSmall', face: face.id, message: `face ${face.id}: wall mitres consume the panel at the inner surface — reduce thickness or increase edge length` });
  const tol = net.params.overhangToleranceMm ?? 0.2;     // about half an extrusion width bridges without support
  for (const e of edges) if (e.overhang && -e.runMm > tol) issues.push({ level: 'warning', code: 'overhang', face: face.id, edge: e.i,
    message: `face ${face.id} edge ${e.i}: wall leans OUTWARD by ${(-e.runMm).toFixed(2)} mm (needs support). Increase panel thickness or reduce hinge width.` });
  return { ideal: face.outer, bottom, top, edges, valid: !!(bottom && top), issues };
}
