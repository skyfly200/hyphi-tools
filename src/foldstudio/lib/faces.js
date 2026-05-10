// Self-contained planar face extraction. Replaces rabbit-ear's graph.populate
// so we can drop the ~50 KB gzipped dep. Algorithm: build CCW-sorted
// adjacency, walk half-edges, keep faces with positive signed area
// (CCW = bounded interior face).

export function computeFaces(model) {
  const { vertices, edges } = model;
  const adj = Array.from({ length: vertices.length }, () => []);
  for (const e of edges) {
    if (!adj[e.v1].includes(e.v2)) adj[e.v1].push(e.v2);
    if (!adj[e.v2].includes(e.v1)) adj[e.v2].push(e.v1);
  }
  for (let v = 0; v < vertices.length; v++) {
    const [px, py] = vertices[v];
    adj[v].sort((a, b) =>
      Math.atan2(vertices[a][1] - py, vertices[a][0] - px) -
      Math.atan2(vertices[b][1] - py, vertices[b][0] - px)
    );
  }
  const used = new Set();
  const faces = [];
  for (const e of edges) {
    for (const [u0, v0] of [[e.v1, e.v2], [e.v2, e.v1]]) {
      if (used.has(`${u0},${v0}`)) continue;
      const fv = []; let u = u0, v = v0, iter = 0;
      while (!used.has(`${u},${v}`) && iter++ < 2000) {
        used.add(`${u},${v}`); fv.push(u);
        const nb = adj[v], idx = nb.indexOf(u);
        [u, v] = [v, nb[(idx - 1 + nb.length) % nb.length]];
      }
      if (fv.length >= 3) {
        let area = 0;
        for (let i = 0; i < fv.length; i++) {
          const [x1, y1] = vertices[fv[i]], [x2, y2] = vertices[fv[(i + 1) % fv.length]];
          area += x1 * y2 - x2 * y1;
        }
        if (area > 0) faces.push(fv);
      }
    }
  }
  return faces;
}
