// Lighting / wiring geometry.
//
//  • Vertex port: truncate ONE vertex with a plane. The cut becomes a small new face (an n-gon) that can host
//    a cable gland hole; everything downstream (net, hinges, verification) treats it as an ordinary face.
//  • Face mount: a round or rectangular opening in a face with an inner retaining collar (and optional
//    retention lugs) for an LED, a module, or a light pipe.
//  • Tie slots: pairs of slots near a port so a cable tie anchors the cable (strain relief).

import { convexHull, ensureOutward } from '@hyphi/polyhedra';

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const scale = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const norm = a => Math.hypot(a[0], a[1], a[2]);

/**
 * Cut off vertex v with a plane perpendicular to the centre→vertex direction, `depthMm` below the vertex
 * (in the solid's own units — scale first). Returns the new solid and the index of the new port face.
 * The new face has one edge per original edge meeting at v.
 */
export function truncateVertex(solid, v, depthMm) {
  const S = ensureOutward(solid);
  const n = S.vertices.length;
  const c = S.vertices.reduce((s, p) => add(s, scale(p, 1 / n)), [0, 0, 0]);
  const V = S.vertices[v];
  const dir = scale(sub(V, c), 1 / norm(sub(V, c)));
  // neighbours of v along edges
  const nbrs = new Set();
  for (const f of S.faces) { const i = f.indexOf(v); if (i >= 0) { nbrs.add(f[(i + 1) % f.length]); nbrs.add(f[(i + f.length - 1) % f.length]); } }
  const pts = S.vertices.filter((_, i) => i !== v).map(p => p.slice());
  for (const u of nbrs) {
    const U = S.vertices[u], e = sub(U, V), along = -dot(e, dir);            // how far U sits below V along −dir
    if (along <= depthMm + 1e-9) throw new Error(`port depth ${depthMm} mm reaches past a neighbouring vertex (${along.toFixed(2)} mm)`);
    pts.push(add(V, scale(e, depthMm / along)));
  }
  const hull = convexHull(pts);
  // the port face: the face whose plane is perpendicular to dir at the cut and that has |nbrs| vertices
  let port = -1, best = Infinity;
  hull.faces.forEach((f, fi) => {
    if (f.length !== nbrs.size) return;
    const fc = f.reduce((s, i) => add(s, scale(hull.vertices[i], 1 / f.length)), [0, 0, 0]);
    const d = norm(sub(fc, add(V, scale(dir, -depthMm))));
    // centroid sits on the cut plane axis
    const off = Math.abs(dot(sub(fc, V), dir) + depthMm);
    if (off < 1e-6 && d < best) { best = d; port = fi; }
  });
  if (port < 0) throw new Error('could not identify the port face');
  return { solid: hull, portFace: port, vertexIndex: v, depthMm };
}

/** Largest circle that fits in a convex polygon (distance from centroid to the nearest edge). */
export function inscribedRadius(poly) {
  const c = poly.reduce((s, p) => [s[0] + p[0] / poly.length, s[1] + p[1] / poly.length], [0, 0]);
  let r = Infinity;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length], dx = b[0] - a[0], dy = b[1] - a[1];
    r = Math.min(r, Math.abs((c[0] - a[0]) * dy - (c[1] - a[1]) * dx) / Math.hypot(dx, dy));
  }
  return r;
}

export const centroid2 = poly => poly.reduce((s, p) => [s[0] + p[0] / poly.length, s[1] + p[1] / poly.length], [0, 0]);

/**
 * Default feature set for a gland on `faceId`: a round through-hole with a retaining collar and tie slots on the neighbours.
 * Sizes are checked against the room available; problems come back as issues rather than silently bad geometry.
 */
export function faceMountSpec(net, faceId, { type = 'round', diameterMm = 5, widthMm = 8, heightMm = 5, collarWallMm = 1.2, collarHeightMm = 3, lugs = 3, offset = [0, 0] } = {}) {
  const f = net.faces[faceId];
  const issues = [];
  const room = inscribedRadius(f.outer);
  const needed = (type === 'round' ? diameterMm / 2 : Math.hypot(widthMm, heightMm) / 2) + collarWallMm + Math.hypot(...offset);
  if (needed > room - 0.5) issues.push({ level: 'error', code: 'mountTooBig', face: faceId, message: `face ${faceId}: mount needs ${needed.toFixed(1)} mm of room but only ${(room - 0.5).toFixed(1)} mm is free` });
  return { face: faceId, type, diameterMm, widthMm, heightMm, collarWallMm, collarHeightMm, lugs, offset, issues };
}

/** Tie-slot pair positions on faces adjacent to a face: along the line from the port to each neighbour's centroid. */
export function tieSlotSpecs(net, portFaceId, { count = 2, lengthMm = 4, widthMm = 1.6, distanceMm = 6 } = {}) {
  const port = net.faces[portFaceId], out = [];
  const nb = [...new Set(port.edges.map(e => e.neighbor))].slice(0, count);
  for (const fid of nb) out.push({ face: fid, lengthMm, widthMm, fromEdgeMm: distanceMm, edgeKey: port.edges.find(e => e.neighbor === fid).key });
  return out;
}
