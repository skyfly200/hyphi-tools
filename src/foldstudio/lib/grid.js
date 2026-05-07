// Grid generators. Each returns { nodes: [[x,y]...], lines: [[[x,y],[x,y]]...] }
// in unit-square model space [0,1] x [0,1] (paper).

export function squareGrid(n) {
  const nodes = [], lines = [];
  for (let i = 0; i <= n; i++) {
    for (let j = 0; j <= n; j++) nodes.push([i / n, j / n]);
    lines.push([[i / n, 0], [i / n, 1]]);
    lines.push([[0, i / n], [1, i / n]]);
  }
  return { nodes, lines };
}

export function triangularGrid(n) {
  // n divisions along x; rows offset by 0.5 every other row.
  const h = Math.sqrt(3) / 2 / n;
  const rows = Math.max(1, Math.ceil(1 / h));
  const nodes = [], lines = [];
  for (let r = 0; r <= rows; r++) {
    const y = r * h;
    if (y > 1 + 1e-9) break;
    const offset = (r % 2) * (0.5 / n);
    for (let i = 0; i <= n + 1; i++) {
      const x = i / n + offset - 0.5 / n;
      if (x < -1e-9 || x > 1 + 1e-9) continue;
      nodes.push([x, y]);
    }
  }
  // Generate lines: horizontals plus two diagonal families.
  for (let r = 0; r <= rows; r++) {
    const y = r * h;
    if (y > 1 + 1e-9) break;
    lines.push([[0, y], [1, y]]);
  }
  // Diagonals: slope = +/- sqrt(3) (60deg)
  const slope = Math.sqrt(3);
  const step = 1 / n;
  for (let k = -n - 2; k <= n * 2 + 2; k++) {
    const x0 = k * step;
    // y = slope * (x - x0) clipped to [0,1] x [0,1]
    const seg = clipLineToUnit(x0, 0, slope);
    if (seg) lines.push(seg);
    const seg2 = clipLineToUnit(x0, 0, -slope);
    if (seg2) lines.push(seg2);
  }
  return { nodes, lines };
}

function clipLineToUnit(x0, y0, m) {
  // y - y0 = m (x - x0); intersect with x=0,x=1,y=0,y=1
  const pts = [];
  for (const x of [0, 1]) {
    const y = y0 + m * (x - x0);
    if (y >= -1e-9 && y <= 1 + 1e-9) pts.push([x, Math.max(0, Math.min(1, y))]);
  }
  for (const y of [0, 1]) {
    if (Math.abs(m) < 1e-9) continue;
    const x = x0 + (y - y0) / m;
    if (x >= -1e-9 && x <= 1 + 1e-9) pts.push([Math.max(0, Math.min(1, x)), y]);
  }
  if (pts.length < 2) return null;
  // Pick the two most distant.
  let best = null, bd = -1;
  for (let i = 0; i < pts.length; i++)
    for (let j = i + 1; j < pts.length; j++) {
      const d = Math.hypot(pts[i][0] - pts[j][0], pts[i][1] - pts[j][1]);
      if (d > bd) { bd = d; best = [pts[i], pts[j]]; }
    }
  return bd > 1e-6 ? best : null;
}

export function radialGrid(rings, sectors) {
  const nodes = [], lines = [];
  const cx = 0.5, cy = 0.5;
  const rMax = 0.5;
  for (let r = 1; r <= rings; r++) {
    const radius = (r / rings) * rMax;
    // approximate circle as polyline
    const segs = Math.max(24, sectors * 4);
    for (let i = 0; i < segs; i++) {
      const a1 = (i / segs) * Math.PI * 2;
      const a2 = ((i + 1) / segs) * Math.PI * 2;
      lines.push([
        [cx + Math.cos(a1) * radius, cy + Math.sin(a1) * radius],
        [cx + Math.cos(a2) * radius, cy + Math.sin(a2) * radius],
      ]);
    }
    for (let s = 0; s < sectors; s++) {
      const a = (s / sectors) * Math.PI * 2;
      nodes.push([cx + Math.cos(a) * radius, cy + Math.sin(a) * radius]);
    }
  }
  for (let s = 0; s < sectors; s++) {
    const a = (s / sectors) * Math.PI * 2;
    lines.push([[cx, cy], [cx + Math.cos(a) * rMax, cy + Math.sin(a) * rMax]]);
  }
  nodes.push([cx, cy]);
  return { nodes, lines };
}

export function buildGrid(type, density) {
  if (type === 'triangular') return triangularGrid(density);
  if (type === 'radial') return radialGrid(Math.max(1, Math.floor(density / 2)), Math.max(4, density * 2));
  return squareGrid(density);
}
