// PolyForge unfolded net → folding assembly (preserves the existing panel tree).
//
// net:    { faces: [null | { polygon2D:[[x,y]..], vertIdx:[..] }], foldEdges: [{ faceA, faceB, a0:[x,y], a1:[x,y] }] }
// The legacy folder rotates each child subtree about the axis a0→a1 by +θ (no
// canonical side). The engine canonicalises the axis so +θ is always a valley;
// `legacyAnglesToEngine` converts so existing behaviour is reproduced exactly.

export function polyForgeToAssembly(net, { scaleMm = 1, rootFace } = {}) {
  const s = scaleMm;
  const P = p => [p[0] * s, p[1] * s];
  const regions = [];
  net.faces.forEach((f, i) => { if (f) regions.push({ id: `face:${i}`, polygon: f.polygon2D.map(P), source: { face: i, vertIdx: f.vertIdx } }); });
  const connections = net.foldEdges.map((e, i) => ({
    id: `fold:${i}`, type: 'idealHinge', a: `face:${e.faceA}`, b: `face:${e.faceB}`,
    edge: { p0: P(e.a0), p1: P(e.a1), sideB: centroid(net.faces[e.faceB].polygon2D.map(P)) },
    source: { foldEdge: i },
  }));
  const first = rootFace ?? net.faces.findIndex(Boolean);
  return { units: 'mm', anchor: `face:${first}`, regions, connections };
}

function centroid(pts) {
  let x = 0, y = 0; for (const p of pts) { x += p[0]; y += p[1]; }
  return [x / pts.length, y / pts.length];
}

/** Legacy per-fold angle θ (radians, same for every fold) → engine angle vector. */
export function legacyAnglesToEngine(compiled, theta) {
  return compiled.variableConnIds.map(id => (compiled.frames.get(id)?.flipped ? -theta : theta));
}
