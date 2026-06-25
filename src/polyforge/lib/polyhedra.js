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
