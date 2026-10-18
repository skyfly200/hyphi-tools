// Convex hull of a small point set -> polygonal faces (coplanar triangles merged), outward-wound.
// Brute force O(n^4); intended for the tens of vertices of ornament-scale solids.

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const norm = a => Math.hypot(a[0], a[1], a[2]);

/**
 * @param {number[][]} pts 3D points (duplicates within eps are merged)
 * @returns {{ vertices:number[][], faces:number[][] }} faces CCW seen from outside; interior points dropped
 */
export function convexHull(pts, eps = 1e-7) {
  // merge duplicates
  const vertices = [];
  for (const p of pts) if (!vertices.some(q => norm(sub(p, q)) < eps)) vertices.push(p.slice());
  const n = vertices.length;
  const c = vertices.reduce((s, p) => [s[0] + p[0] / n, s[1] + p[1] / n, s[2] + p[2] / n], [0, 0, 0]);
  // all supporting planes (normal, offset), merged by plane equality
  const planes = [];
  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) for (let k = j + 1; k < n; k++) {
    let nn = cross(sub(vertices[j], vertices[i]), sub(vertices[k], vertices[i]));
    const l = norm(nn); if (l < eps) continue;
    nn = nn.map(x => x / l);
    const d = dot(nn, vertices[i]);
    let side = 0, ok = true;
    for (let m = 0; m < n && ok; m++) { const s = dot(nn, vertices[m]) - d; if (Math.abs(s) < 1e-6) continue; if (side === 0) side = Math.sign(s); else if (Math.sign(s) !== side) ok = false; }
    if (!ok) continue;
    // orient outward (away from the centroid)
    const out = dot(nn, c) - d > 0 ? -1 : 1;
    const N = nn.map(x => x * out), D = d * out;
    if (!planes.some(p => norm(sub(p.n, N)) < 1e-6 && Math.abs(p.d - D) < 1e-6)) planes.push({ n: N, d: D });
  }
  const faces = planes.map(({ n: N, d: D }) => {
    const idx = []; for (let m = 0; m < n; m++) if (Math.abs(dot(N, vertices[m]) - D) < 1e-6) idx.push(m);
    const cc = idx.reduce((s, m) => [s[0] + vertices[m][0] / idx.length, s[1] + vertices[m][1] / idx.length, s[2] + vertices[m][2] / idx.length], [0, 0, 0]);
    const ref = sub(vertices[idx[0]], cc), u = ref.map(x => x / (norm(ref) || 1)), v = cross(N, u);
    idx.sort((a, b) => Math.atan2(dot(sub(vertices[a], cc), v), dot(sub(vertices[a], cc), u)) - Math.atan2(dot(sub(vertices[b], cc), v), dot(sub(vertices[b], cc), u)));
    return idx;                                   // CCW about the outward normal
  });
  // drop vertices not on the hull and re-index
  const used = [...new Set(faces.flat())].sort((a, b) => a - b);
  const remap = new Map(used.map((o, i) => [o, i]));
  return { vertices: used.map(i => vertices[i]), faces: faces.map(f => f.map(i => remap.get(i))) };
}

/** Scale so the shortest edge has the given length (1 by default). */
export function normalizeShortestEdge(solid, target = 1) {
  let min = Infinity;
  for (const f of solid.faces) for (let i = 0; i < f.length; i++) min = Math.min(min, norm(sub(solid.vertices[f[i]], solid.vertices[f[(i + 1) % f.length]])));
  const k = target / min;
  return { vertices: solid.vertices.map(v => v.map(x => x * k)), faces: solid.faces };
}

/**
 * Return the solid with every face wound CCW seen from OUTSIDE (flipping any that are not).
 * Needed by tools that depend on outward normals. Note: POLYHEDRA.tetra is stored wound inward (kept
 * as-is so existing PolyForge designs do not mirror); use this when orientation matters.
 */
export function ensureOutward(solid) {
  const { vertices, faces } = solid;
  const c = vertices.reduce((s, v) => [s[0] + v[0] / vertices.length, s[1] + v[1] / vertices.length, s[2] + v[2] / vertices.length], [0, 0, 0]);
  return { vertices, faces: faces.map(f => {
    const n = cross(sub(vertices[f[1]], vertices[f[0]]), sub(vertices[f[2]], vertices[f[0]]));
    return dot(n, sub(vertices[f[0]], c)) < 0 ? f.slice().reverse() : f;
  }) };
}
