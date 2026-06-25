// Unfold a polyhedron into a 2D net.
//
// Algorithm: BFS from a root face. The root is projected directly to the
// plane via an in-plane basis. For every other face, we walk across the
// shared edge from an already-placed neighbor: the two shared-edge
// endpoints are fixed in 2D (they were placed when the neighbor was
// placed), and the remaining vertices of the new face are reconstructed
// in 2D from their 3D distances to those endpoints (circle-circle
// intersection). The intersection on the far side of the shared edge
// from the neighbor's centroid is the unfolded position.

function sub(a, b)   { return [a[0]-b[0], a[1]-b[1], a[2]-b[2]]; }
function dot(a, b)   { return a[0]*b[0] + a[1]*b[1] + a[2]*b[2]; }
function cross(a, b) { return [a[1]*b[2]-a[2]*b[1], a[2]*b[0]-a[0]*b[2], a[0]*b[1]-a[1]*b[0]]; }
function len(a)      { return Math.sqrt(dot(a, a)); }
function norm(a)     { const l = len(a) || 1; return [a[0]/l, a[1]/l, a[2]/l]; }

function dist3(a, b) {
  const dx = a[0]-b[0], dy = a[1]-b[1], dz = a[2]-b[2];
  return Math.sqrt(dx*dx + dy*dy + dz*dz);
}

function dist2(a, b) {
  const dx = a[0]-b[0], dy = a[1]-b[1];
  return Math.sqrt(dx*dx + dy*dy);
}

// Project root face vertices into 2D using an orthonormal basis aligned
// with the face. The first edge becomes the +X direction of the basis,
// which keeps the orientation predictable when the user picks a root.
function projectRootFace(vertices, faceIdxs) {
  const p0 = vertices[faceIdxs[0]];
  const p1 = vertices[faceIdxs[1]];
  const p2 = vertices[faceIdxs[2]];
  const ex = norm(sub(p1, p0));
  const n  = norm(cross(sub(p1, p0), sub(p2, p0)));
  const ey = norm(cross(n, ex));
  return faceIdxs.map(vi => {
    const r = sub(vertices[vi], p0);
    return [dot(r, ex), dot(r, ey)];
  });
}

// Given the 2D positions of A and B (the shared-edge endpoints) and the
// known 3D distances dA, dB from the unknown point to A and B, return the
// two possible 2D positions of the unknown point.
function circleCircle(A, B, dA, dB) {
  const dx = B[0] - A[0];
  const dy = B[1] - A[1];
  const d = Math.sqrt(dx*dx + dy*dy);
  if (d === 0) return null;
  // Standard intersection of two circles centered at A and B.
  const a = (dA*dA - dB*dB + d*d) / (2*d);
  const h2 = dA*dA - a*a;
  const h = Math.sqrt(Math.max(0, h2));
  const px = A[0] + a * dx / d;
  const py = A[1] + a * dy / d;
  const rx = -dy * h / d;
  const ry =  dx * h / d;
  return [[px + rx, py + ry], [px - rx, py - ry]];
}

// Pick whichever of the two candidate points is on the OPPOSITE side of
// the AB line from the reference point (the neighbor's centroid). That
// guarantees the new face unfolds outward rather than overlapping its
// parent.
function pickOppositeSide(cands, A, B, refPoint) {
  const ex = B[0] - A[0], ey = B[1] - A[1];
  const sideRef = ex * (refPoint[1] - A[1]) - ey * (refPoint[0] - A[0]);
  const side0   = ex * (cands[0][1] - A[1]) - ey * (cands[0][0] - A[0]);
  return Math.sign(side0) !== Math.sign(sideRef) ? cands[0] : cands[1];
}

function centroid(pts) {
  let x = 0, y = 0;
  for (const p of pts) { x += p[0]; y += p[1]; }
  return [x / pts.length, y / pts.length];
}

// Build a map from edge-key 'min-max' to the list of incident face indices.
function buildEdgeFaceMap(faces) {
  const m = new Map();
  for (let fi = 0; fi < faces.length; fi++) {
    const f = faces[fi];
    for (let i = 0; i < f.length; i++) {
      const a = f[i], b = f[(i + 1) % f.length];
      const key = a < b ? `${a}-${b}` : `${b}-${a}`;
      if (!m.has(key)) m.set(key, []);
      m.get(key).push(fi);
    }
  }
  return m;
}

export function unfold({ vertices, faces }, rootFace = 0) {
  const edgeFaces = buildEdgeFaceMap(faces);
  // placed[fi] = { polygon2D: [[x,y], ...], vertIdx: [3DVertIdx, ...] }
  const placed = new Array(faces.length).fill(null);

  // Seed the BFS by projecting the root face.
  placed[rootFace] = {
    polygon2D: projectRootFace(vertices, faces[rootFace]),
    vertIdx: [...faces[rootFace]],
  };

  // Track which edges in the unfolded net are folds (still attached
  // between two faces) vs boundary cuts (introduced when the BFS spans
  // a non-tree neighbor). Edges in the spanning tree are folds, all
  // other shared edges become boundary cuts. For the MVP we ignore the
  // cut-edge case in fold rendering — they show as outline only.
  const foldEdges = []; // { faceA, faceB, ai, bi } where ai/bi are positions in each face's 2D polygon
  const queue = [rootFace];

  while (queue.length) {
    const fi = queue.shift();
    const face = faces[fi];
    const placedFace = placed[fi];

    for (let i = 0; i < face.length; i++) {
      const va = face[i];
      const vb = face[(i + 1) % face.length];
      const key = va < vb ? `${va}-${vb}` : `${vb}-${va}`;
      const incident = edgeFaces.get(key) || [];
      const neighborIdx = incident.find(x => x !== fi);
      if (neighborIdx == null) continue;
      if (placed[neighborIdx]) continue;

      // 2D positions of the shared edge endpoints, as already placed.
      const A2 = placedFace.polygon2D[i];
      const B2 = placedFace.polygon2D[(i + 1) % face.length];

      // Reconstruct the neighbor in 2D starting from the shared edge.
      const nface = faces[neighborIdx];
      // Find where va, vb sit inside the neighbor's vertex list.
      const ia = nface.indexOf(va);
      const ib = nface.indexOf(vb);
      const npoly = new Array(nface.length).fill(null);
      npoly[ia] = A2;
      npoly[ib] = B2;

      // For each remaining vertex of the neighbor, use circle-circle
      // intersection from A and B (the two endpoints we just placed) to
      // get its 2D position. The neighbor's centroid is on the opposite
      // side of AB from the parent's centroid, so we pick accordingly.
      const parentCentroid = centroid(placedFace.polygon2D);
      for (let j = 0; j < nface.length; j++) {
        if (j === ia || j === ib) continue;
        const vj = nface[j];
        const dA = dist3(vertices[vj], vertices[va]);
        const dB = dist3(vertices[vj], vertices[vb]);
        const cands = circleCircle(A2, B2, dA, dB);
        if (!cands) { npoly[j] = A2; continue; }
        npoly[j] = pickOppositeSide(cands, A2, B2, parentCentroid);
      }

      placed[neighborIdx] = { polygon2D: npoly, vertIdx: [...nface] };
      foldEdges.push({
        faceA: fi, faceB: neighborIdx,
        a0: A2, a1: B2,
        v1: Math.min(va, vb), v2: Math.max(va, vb),
      });
      queue.push(neighborIdx);
    }
  }

  // Translate the net so its bounding box is centered on the origin —
  // makes downstream layout / DXF export deterministic.
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of placed) {
    if (!p) continue;
    for (const [x, y] of p.polygon2D) {
      if (x < minX) minX = x; if (x > maxX) maxX = x;
      if (y < minY) minY = y; if (y > maxY) maxY = y;
    }
  }
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  for (const p of placed) {
    if (!p) continue;
    p.polygon2D = p.polygon2D.map(([x, y]) => [x - cx, y - cy]);
  }
  for (const e of foldEdges) {
    e.a0 = [e.a0[0] - cx, e.a0[1] - cy];
    e.a1 = [e.a1[0] - cx, e.a1[1] - cy];
  }

  return {
    faces: placed, // index-aligned with the input faces
    foldEdges,
    bbox: { width: maxX - minX, height: maxY - minY },
  };
}

// Distance helpers exported for downstream consumers that want to do
// their own layout math on the unfolded net.
export const _utils = { dist2, dist3 };
