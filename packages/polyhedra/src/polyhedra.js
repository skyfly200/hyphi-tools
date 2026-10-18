// Polyhedron definitions for PolyForge.
//
// Each entry returns { vertices, faces } where vertices is a list of
// [x,y,z] coordinates and faces is a list of vertex-index arrays wound
// counter-clockwise when viewed from outside the solid. The edge length
// is normalized to 1 so that callers can scale to whatever physical size
// they need without having to know the underlying construction radius.

function normalizeEdgeLength(vertices, faces) {
  // Sample one edge of the first face and scale the whole solid so that
  // edge length is exactly 1. Every Platonic solid has uniform edges, so
  // measuring any one of them suffices.
  const [a, b] = faces[0];
  const dx = vertices[a][0] - vertices[b][0];
  const dy = vertices[a][1] - vertices[b][1];
  const dz = vertices[a][2] - vertices[b][2];
  const len = Math.sqrt(dx*dx + dy*dy + dz*dz);
  const k = 1 / len;
  return vertices.map(v => [v[0]*k, v[1]*k, v[2]*k]);
}

function buildTetra() {
  // Pick four alternating corners of a cube — gives a regular tetrahedron.
  const v = [[1,1,1],[1,-1,-1],[-1,1,-1],[-1,-1,1]];
  const f = [[0,2,1],[0,1,3],[0,3,2],[1,2,3]];
  return { vertices: normalizeEdgeLength(v, f), faces: f };
}

function buildCube() {
  // Unit cube centered on origin, faces wound CCW when viewed from outside.
  const v = [
    [-0.5,-0.5,-0.5],[ 0.5,-0.5,-0.5],[ 0.5, 0.5,-0.5],[-0.5, 0.5,-0.5],
    [-0.5,-0.5, 0.5],[ 0.5,-0.5, 0.5],[ 0.5, 0.5, 0.5],[-0.5, 0.5, 0.5],
  ];
  const f = [
    [0,3,2,1], // -Z
    [4,5,6,7], // +Z
    [0,1,5,4], // -Y
    [2,3,7,6], // +Y
    [0,4,7,3], // -X
    [1,2,6,5], // +X
  ];
  return { vertices: v, faces: f };
}

// Ensure every face is wound CCW when viewed from outside: the face
// normal (right-hand rule) must point away from the solid's center.
// All our solids are origin-centered, so "away" = same side as the
// face centroid.
function orientOutward(vertices, faces) {
  return faces.map(f => {
    const [a, b, c] = [vertices[f[0]], vertices[f[1]], vertices[f[2]]];
    const u = [b[0]-a[0], b[1]-a[1], b[2]-a[2]];
    const v = [c[0]-a[0], c[1]-a[1], c[2]-a[2]];
    const nrm = [u[1]*v[2]-u[2]*v[1], u[2]*v[0]-u[0]*v[2], u[0]*v[1]-u[1]*v[0]];
    let cx = 0, cy = 0, cz = 0;
    for (const vi of f) { cx += vertices[vi][0]; cy += vertices[vi][1]; cz += vertices[vi][2]; }
    const dot = nrm[0]*cx + nrm[1]*cy + nrm[2]*cz;
    return dot >= 0 ? f : [...f].reverse();
  });
}

function buildOcta() {
  const v = [
    [1,0,0],[-1,0,0],[0,1,0],[0,-1,0],[0,0,1],[0,0,-1],
  ];
  let f = [
    [0,2,4],[2,1,4],[1,3,4],[3,0,4],
    [2,0,5],[1,2,5],[3,1,5],[0,3,5],
  ];
  f = orientOutward(v, f);
  return { vertices: normalizeEdgeLength(v, f), faces: f };
}

const PHI = (1 + Math.sqrt(5)) / 2;

function buildIcosa() {
  // Standard construction: three orthogonal golden rectangles.
  const v = [];
  for (const s1 of [1, -1]) for (const s2 of [1, -1]) {
    v.push([0, s1, s2 * PHI]);
    v.push([s1, s2 * PHI, 0]);
    v.push([s1 * PHI, 0, s2]);
  }
  // Faces = every vertex triple whose pairwise distances all equal the
  // minimum edge length (2 in this construction). 220 combos — cheap.
  const d2 = (a, b) => (a[0]-b[0])**2 + (a[1]-b[1])**2 + (a[2]-b[2])**2;
  let minD2 = Infinity;
  for (let i = 0; i < v.length; i++) for (let j = i+1; j < v.length; j++) {
    minD2 = Math.min(minD2, d2(v[i], v[j]));
  }
  const isEdge = (i, j) => Math.abs(d2(v[i], v[j]) - minD2) < 1e-9;
  let f = [];
  for (let i = 0; i < v.length; i++)
    for (let j = i+1; j < v.length; j++)
      for (let k = j+1; k < v.length; k++)
        if (isEdge(i,j) && isEdge(j,k) && isEdge(i,k)) f.push([i,j,k]);
  f = orientOutward(v, f);
  return { vertices: normalizeEdgeLength(v, f), faces: f };
}

// Generic convex-hull face extraction. For every vertex triple,
// build the plane; if every other vertex lies on or below it, the
// coplanar vertex set is a hull face. Faces are deduped by their
// sorted vertex set and wound by angle around the face centroid.
// O(n³·n) — trivially fast for n ≤ 20.
function facesFromHull(v) {
  const seen = new Set();
  const faces = [];
  const EPS = 1e-9;
  for (let i = 0; i < v.length; i++)
    for (let j = i + 1; j < v.length; j++)
      for (let k = j + 1; k < v.length; k++) {
        const u = [v[j][0]-v[i][0], v[j][1]-v[i][1], v[j][2]-v[i][2]];
        const w = [v[k][0]-v[i][0], v[k][1]-v[i][1], v[k][2]-v[i][2]];
        let nrm = cross3(u, w);
        const nl = Math.hypot(...nrm);
        if (nl < EPS) continue; // degenerate triple
        nrm = nrm.map(c => c / nl);
        const d0 = nrm[0]*v[i][0] + nrm[1]*v[i][1] + nrm[2]*v[i][2];
        // Flip so the plane normal points away from the origin
        // (all our solids are origin-centered and convex).
        const [n1, dPlane] = d0 < 0 ? [nrm.map(c => -c), -d0] : [nrm, d0];
        let supporting = true;
        const onPlane = [];
        for (let m = 0; m < v.length; m++) {
          const d = n1[0]*v[m][0] + n1[1]*v[m][1] + n1[2]*v[m][2] - dPlane;
          if (d > 1e-7) { supporting = false; break; }
          if (Math.abs(d) < 1e-7) onPlane.push(m);
        }
        if (!supporting || onPlane.length < 3) continue;
        const key = onPlane.slice().sort((a, b) => a - b).join(',');
        if (seen.has(key)) continue;
        seen.add(key);
        // Sort face vertices by angle around the centroid.
        let cx = 0, cy = 0, cz = 0;
        for (const m of onPlane) { cx += v[m][0]/onPlane.length; cy += v[m][1]/onPlane.length; cz += v[m][2]/onPlane.length; }
        const ref = Math.abs(n1[0]) < 0.9 ? [1,0,0] : [0,1,0];
        const e1 = cross3(n1, ref);
        const e1n = e1.map(c => c / Math.hypot(...e1));
        const e2 = cross3(n1, e1n);
        const angleOf = (m) => {
          const r = [v[m][0]-cx, v[m][1]-cy, v[m][2]-cz];
          return Math.atan2(
            r[0]*e2[0] + r[1]*e2[1] + r[2]*e2[2],
            r[0]*e1n[0] + r[1]*e1n[1] + r[2]*e1n[2],
          );
        };
        faces.push(onPlane.slice().sort((a, b) => angleOf(a) - angleOf(b)));
      }
  return faces;
}

function buildDodeca() {
  // 20 vertices: cube corners + three golden rectangles.
  const v = [];
  for (const s1 of [1,-1]) for (const s2 of [1,-1]) for (const s3 of [1,-1]) {
    v.push([s1, s2, s3]);
  }
  for (const s1 of [1,-1]) for (const s2 of [1,-1]) {
    v.push([0, s1 / PHI, s2 * PHI]);
    v.push([s1 / PHI, s2 * PHI, 0]);
    v.push([s1 * PHI, 0, s2 / PHI]);
  }
  const f = orientOutward(v, facesFromHull(v));
  return { vertices: normalizeEdgeLength(v, f), faces: f };
}

function cross3(a, b) {
  return [a[1]*b[2]-a[2]*b[1], a[2]*b[0]-a[0]*b[2], a[0]*b[1]-a[1]*b[0]];
}

export const POLYHEDRA = {
  tetra: {
    id: 'tetra',
    label: 'Tetrahedron',
    faceLabel: 'triangle',
    sides: 3,
    dihedralDeg: Math.acos(1/3) * 180 / Math.PI,
    build: buildTetra,
  },
  cube: {
    id: 'cube',
    label: 'Cube',
    faceLabel: 'square',
    sides: 4,
    dihedralDeg: 90,
    build: buildCube,
  },
  octa: {
    id: 'octa',
    label: 'Octahedron',
    faceLabel: 'triangle',
    sides: 3,
    dihedralDeg: Math.acos(-1/3) * 180 / Math.PI,
    build: buildOcta,
  },
  dodeca: {
    id: 'dodeca',
    label: 'Dodecahedron',
    faceLabel: 'pentagon',
    sides: 5,
    dihedralDeg: Math.acos(-1/Math.sqrt(5)) * 180 / Math.PI,
    build: buildDodeca,
  },
  icosa: {
    id: 'icosa',
    label: 'Icosahedron',
    faceLabel: 'triangle',
    sides: 3,
    dihedralDeg: Math.acos(-Math.sqrt(5)/3) * 180 / Math.PI,
    build: buildIcosa,
  },
};

export function listPolyhedra() {
  return Object.values(POLYHEDRA).map(p => ({ id: p.id, label: p.label }));
}

// Build the per-polyhedron edge list with the pair of incident face indices
// for each edge. Used by the unfolder to walk neighbors and by the UI to
// label fold lines.
export function buildEdges(faces) {
  const edges = new Map(); // 'a-b' -> { v1, v2, faces: [fi, ...] }
  for (let fi = 0; fi < faces.length; fi++) {
    const face = faces[fi];
    for (let i = 0; i < face.length; i++) {
      const a = face[i];
      const b = face[(i + 1) % face.length];
      const key = a < b ? `${a}-${b}` : `${b}-${a}`;
      let e = edges.get(key);
      if (!e) { e = { v1: Math.min(a, b), v2: Math.max(a, b), faces: [] }; edges.set(key, e); }
      e.faces.push(fi);
    }
  }
  return Array.from(edges.values());
}
