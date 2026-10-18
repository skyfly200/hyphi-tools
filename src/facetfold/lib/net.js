// Net layout for a printable folding polyhedron.
//
// Print orientation: every face is printed with its OUTER surface on the bed (z = 0) and its inner
// surface up. Viewed from above (+z) the net is therefore the mirror image of the usual "seen from
// outside" net; this module returns TOP-VIEW coordinates, polygons counter-clockwise, in millimetres.
//
// Hinge geometry. A hinge is a thin strip of flat length w at the outer surface. Folding a hinge by the
// exterior angle φ bends the strip around a rounded corner (arc length w, radius w/φ), which places each
// panel's bottom edge a = w·tan(φ/2)/φ from the ideal (sharp) edge. We lay the net out so that, when every
// hinge is folded by its φ, every panel lands EXACTLY on its ideal face. Seams (non-hinge edges) therefore
// close without accumulated error; the folding engine verifies this (see verify.js).

import { buildEdges, unfold, ensureOutward } from '@hyphi/polyhedra';

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const scale = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
const norm = a => Math.hypot(a[0], a[1], a[2]);
const unit = a => { const l = norm(a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
export const edgeKey = (a, b) => (a < b ? `${a}-${b}` : `${b}-${a}`);

export const DEFAULT_PARAMS = Object.freeze({
  edgeLengthMm: 40,          // shortest edge of the solid
  panelThicknessMm: 1.6,
  hingeWidthMm: 0.8,         // flat length of the flexure strip (w)
  hingeThicknessMm: 0.2,
  seamClearanceMm: 0.15,     // total gap left at a closing seam
  plateSpacingMm: 6,         // spacing between separate net pieces on the plate
});

/** Distance of a hinge panel's bottom edge from the ideal edge so the folded result is exact. */
export function hingeTrimMm(w, phi) { return phi < 1e-9 ? w / 2 : (w * Math.tan(phi / 2)) / phi; }

/** Per-edge facts for an outward-wound convex solid. */
export function analyzeEdges(solid) {
  const { vertices, faces } = solid;
  const normals = faces.map(f => unit(cross(sub(vertices[f[1]], vertices[f[0]]), sub(vertices[f[2]], vertices[f[0]]))));
  return buildEdges(faces).map(e => {
    const [f1, f2] = e.faces;
    const phi = Math.acos(Math.max(-1, Math.min(1, dot(normals[f1], normals[f2]))));   // exterior fold angle
    return { key: edgeKey(e.v1, e.v2), v1: e.v1, v2: e.v2, faces: [f1, f2], phi, dihedral: Math.PI - phi,
      lengthMm: norm(sub(vertices[e.v1], vertices[e.v2])) };
  });
}

/** Default hinge set: the BFS spanning tree that @hyphi/polyhedra's unfold would use. */
export function defaultHingeKeys(solid, root = 0) {
  return new Set(unfold(solid, root).foldEdges.map(e => edgeKey(e.v1, e.v2)));
}

/** Throws if the chosen hinge edges contain a cycle (a net must be a forest over the faces). */
function components(faceCount, edges, hingeKeys) {
  const parent = Array.from({ length: faceCount }, (_, i) => i);
  const find = i => { while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i]; } return i; };
  for (const e of edges) if (hingeKeys.has(e.key)) {
    const a = find(e.faces[0]), b = find(e.faces[1]);
    if (a === b) throw new Error(`hinge edges form a cycle at edge ${e.key}`);
    parent[a] = b;
  }
  const groups = new Map();
  for (let f = 0; f < faceCount; f++) { const r = find(f); if (!groups.has(r)) groups.set(r, []); groups.get(r).push(f); }
  return [...groups.values()];
}

// Face-local isometric 2D embedding, CCW seen from outside.
function localPolygon(solid, fi) {
  const { vertices, faces } = solid, f = faces[fi];
  const n = unit(cross(sub(vertices[f[1]], vertices[f[0]]), sub(vertices[f[2]], vertices[f[0]])));
  const u = unit(sub(vertices[f[1]], vertices[f[0]])), v = cross(n, u);
  return { n, pts: f.map(i => { const d = sub(vertices[i], vertices[f[0]]); return [dot(d, u), dot(d, v)]; }) };
}

const rot = (p, th) => [p[0] * Math.cos(th) - p[1] * Math.sin(th), p[0] * Math.sin(th) + p[1] * Math.cos(th)];
const centroid2 = pts => pts.reduce((s, p) => [s[0] + p[0] / pts.length, s[1] + p[1] / pts.length], [0, 0]);

/**
 * @param solid   { vertices, faces } (any winding; normalised to outward)
 * @param params  see DEFAULT_PARAMS
 * @param opts    { hingeKeys?: Set<string> (default BFS tree), root?: number, optimizeRotation?: boolean }
 */
export function buildNet(solid, params = {}, opts = {}) {
  const P = { ...DEFAULT_PARAMS, ...params };
  const S0 = ensureOutward(solid);
  // scale so the shortest edge equals edgeLengthMm
  const raw = analyzeEdges(S0);
  const k = P.edgeLengthMm / Math.min(...raw.map(e => e.lengthMm));
  const S = { vertices: S0.vertices.map(v => scale(v, k)), faces: S0.faces };
  const edges = analyzeEdges(S);
  const hingeKeys = opts.hingeKeys ?? defaultHingeKeys(S, opts.root ?? 0);
  const comps = components(S.faces.length, edges, hingeKeys);
  const byKey = new Map(edges.map(e => [e.key, e]));
  const w = P.hingeWidthMm;

  // place each component in "outside-view" coordinates
  const placed = new Array(S.faces.length).fill(null);   // { poly:[[x,y]] aligned with S.faces[fi], comp }
  const hinges = [];
  comps.forEach((faceIds, ci) => {
    const rootFace = opts.root !== undefined && faceIds.includes(opts.root) ? opts.root : faceIds[0];
    const loc = localPolygon(S, rootFace);
    placed[rootFace] = { poly: loc.pts, comp: ci };
    const queue = [rootFace];
    while (queue.length) {
      const fi = queue.shift(), face = S.faces[fi];
      for (let i = 0; i < face.length; i++) {
        const va = face[i], vb = face[(i + 1) % face.length];
        const key = edgeKey(va, vb);
        if (!hingeKeys.has(key)) continue;
        const e = byKey.get(key);
        const ni = e.faces.find(x => x !== fi);
        if (placed[ni]) continue;
        const cl = localPolygon(S, ni), nface = S.faces[ni];
        const ca = cl.pts[nface.indexOf(va)], cb = cl.pts[nface.indexOf(vb)];
        const A = placed[fi].poly[i], B = placed[fi].poly[(i + 1) % face.length];
        const th = Math.atan2(B[1] - A[1], B[0] - A[0]) - Math.atan2(cb[1] - ca[1], cb[0] - ca[0]);
        const r0 = rot(ca, th);
        let poly = cl.pts.map(p => { const q = rot(p, th); return [q[0] + A[0] - r0[0], q[1] + A[1] - r0[1]]; });
        // spread the subtree so the two trimmed bottom edges are exactly w apart (see header)
        const a = hingeTrimMm(w, e.phi), gap = w - 2 * a;
        const ex = [B[0] - A[0], B[1] - A[1]], el = Math.hypot(...ex);
        let nrm = [-ex[1] / el, ex[0] / el];
        const pc = centroid2(placed[fi].poly);
        if ((pc[0] - A[0]) * nrm[0] + (pc[1] - A[1]) * nrm[1] > 0) nrm = [-nrm[0], -nrm[1]];   // away from parent
        poly = poly.map(p => [p[0] + nrm[0] * gap, p[1] + nrm[1] * gap]);
        placed[ni] = { poly, comp: ci };
        hinges.push({ key, parent: fi, child: ni, phi: e.phi, trimMm: a, flatGapMm: w, normal: nrm });
        queue.push(ni);
      }
    }
  });

  // mirror to TOP view (outer face down), keep CCW by reversing vertex order
  const faces = S.faces.map((f, fi) => {
    const mirrored = placed[fi].poly.map(p => [-p[0], p[1]]);
    const order = f.map((_, i) => i).reverse();           // new index j -> old index order[j]
    return { id: fi, vertIdx: order.map(i => f[i]), outer: order.map(i => mirrored[i]), comp: placed[fi].comp,
      normal: localPolygon(S, fi).n };
  });
  for (const h of hinges) h.normal = [-h.normal[0], h.normal[1]];

  // classify every face edge (by vertex pair) as hinge / seam
  const edgeInfo = edges.map(e => ({ ...e, kind: hingeKeys.has(e.key) ? 'hinge' : 'seam' }));
  const infoByKey = new Map(edgeInfo.map(e => [e.key, e]));
  for (const f of faces) {
    f.edges = f.vertIdx.map((va, i) => {
      const vb = f.vertIdx[(i + 1) % f.vertIdx.length];
      const info = infoByKey.get(edgeKey(va, vb));
      return { i, key: info.key, kind: info.kind, phi: info.phi, neighbor: info.faces.find(x => x !== f.id) };
    });
  }

  // arrange components on the plate (optionally rotating each to its tightest box)
  const compFaces = comps.map(ids => ids.map(i => faces[i]));
  const plate = arrange(compFaces, P.plateSpacingMm, opts.optimizeRotation !== false);
  // carry the same transforms onto hinge normals (rotation only)
  for (const h of hinges) { const t = plate.rotations[faces[h.parent].comp]; h.normal = rot(h.normal, t); }

  return { params: P, solid: S, faces, edges: edgeInfo, hinges, seams: edgeInfo.filter(e => e.kind === 'seam'),
    components: comps.map((ids, i) => ({ faces: ids, rotation: plate.rotations[i], bbox: plate.boxes[i] })), plate: { width: plate.width, height: plate.height } };
}

function polygonsBox(polys, th) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const poly of polys) for (const p of poly) { const q = rot(p, th); minX = Math.min(minX, q[0]); maxX = Math.max(maxX, q[0]); minY = Math.min(minY, q[1]); maxY = Math.max(maxY, q[1]); }
  return { minX, minY, maxX, maxY, w: maxX - minX, h: maxY - minY };
}

// Rotate each component to its smallest bounding box, then shelf-pack left to right.
function arrange(compFaces, spacing, optimize) {
  const rotations = [], boxes = [];
  compFaces.forEach(faces => {
    const polys = faces.map(f => f.outer);
    let best = { th: 0, box: polygonsBox(polys, 0) };
    if (optimize) for (let d = 1; d < 180; d++) { const th = (d * Math.PI) / 180, b = polygonsBox(polys, th); if (b.w * b.h < best.box.w * best.box.h - 1e-9) best = { th, box: b }; }
    rotations.push(best.th); boxes.push(best.box);
  });
  let x = 0, height = 0;
  compFaces.forEach((faces, ci) => {
    const th = rotations[ci], b = boxes[ci];
    for (const f of faces) f.outer = f.outer.map(p => { const q = rot(p, th); return [q[0] - b.minX + x, q[1] - b.minY]; });
    boxes[ci] = { x, y: 0, w: b.w, h: b.h };
    x += b.w + spacing; height = Math.max(height, b.h);
  });
  return { width: Math.max(0, x - spacing), height, rotations, boxes };
}
