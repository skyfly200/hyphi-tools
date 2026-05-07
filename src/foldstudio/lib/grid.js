// Grid generators. Each returns { nodes: [[x,y]...], lines: [[[x,y],[x,y]]...] }
// in unit-square model space [0,1] x [0,1] (paper) by default. When `range`
// is provided ([xMin, xMax, yMin, yMax]), the grid is generated to fill that
// range so callers can extend the grid beyond the paper into the workspace.

export function squareGrid(n, range = [0, 1, 0, 1]) {
  const [x0, x1, y0, y1] = range;
  const step = 1 / n;
  const nodes = [], lines = [];
  // x lines run vertically; sweep i so x = i*step within range.
  const iMin = Math.floor(x0 / step), iMax = Math.ceil(x1 / step);
  const jMin = Math.floor(y0 / step), jMax = Math.ceil(y1 / step);
  for (let i = iMin; i <= iMax; i++) {
    const x = i * step;
    if (x < x0 - 1e-9 || x > x1 + 1e-9) continue;
    lines.push([[x, y0], [x, y1]]);
  }
  for (let j = jMin; j <= jMax; j++) {
    const y = j * step;
    if (y < y0 - 1e-9 || y > y1 + 1e-9) continue;
    lines.push([[x0, y], [x1, y]]);
  }
  for (let i = iMin; i <= iMax; i++) {
    const x = i * step;
    if (x < x0 - 1e-9 || x > x1 + 1e-9) continue;
    for (let j = jMin; j <= jMax; j++) {
      const y = j * step;
      if (y < y0 - 1e-9 || y > y1 + 1e-9) continue;
      nodes.push([x, y]);
    }
  }
  return { nodes, lines };
}

export function triangularGrid(n, range = [0, 1, 0, 1]) {
  const [x0, x1, y0, y1] = range;
  const h = Math.sqrt(3) / 2 / n;
  const step = 1 / n;
  const nodes = [], lines = [];
  const rMin = Math.floor(y0 / h), rMax = Math.ceil(y1 / h);
  for (let r = rMin; r <= rMax; r++) {
    const y = r * h;
    if (y < y0 - 1e-9 || y > y1 + 1e-9) continue;
    lines.push([[x0, y], [x1, y]]);
    const offset = (((r % 2) + 2) % 2) * (step / 2);
    const iMin = Math.floor((x0 - offset) / step) - 1;
    const iMax = Math.ceil((x1 - offset) / step) + 1;
    for (let i = iMin; i <= iMax; i++) {
      const x = i * step + offset;
      if (x < x0 - 1e-9 || x > x1 + 1e-9) continue;
      nodes.push([x, y]);
    }
  }
  // Diagonals at ±60°.
  const slope = Math.sqrt(3);
  const kMin = Math.floor((x0 - y1 / slope) / step) - 1;
  const kMax = Math.ceil((x1 + y1 / slope) / step) + 1;
  for (let k = kMin; k <= kMax; k++) {
    const xk = k * step;
    const seg1 = clipLineToBox(xk, 0, slope, range);
    if (seg1) lines.push(seg1);
    const seg2 = clipLineToBox(xk, 0, -slope, range);
    if (seg2) lines.push(seg2);
  }
  return { nodes, lines };
}

function clipLineToBox(x0, y0, m, [xMin, xMax, yMin, yMax]) {
  // y - y0 = m(x - x0). Clip to box.
  const pts = [];
  for (const x of [xMin, xMax]) {
    const y = y0 + m * (x - x0);
    if (y >= yMin - 1e-9 && y <= yMax + 1e-9) pts.push([x, y]);
  }
  if (Math.abs(m) > 1e-9) {
    for (const y of [yMin, yMax]) {
      const x = x0 + (y - y0) / m;
      if (x >= xMin - 1e-9 && x <= xMax + 1e-9) pts.push([x, y]);
    }
  }
  if (pts.length < 2) return null;
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

export function buildGrid(type, density, range = [0, 1, 0, 1]) {
  if (type === 'triangular') return triangularGrid(density, range);
  if (type === 'radial') return radialGrid(Math.max(1, Math.floor(density / 2)), Math.max(4, density * 2));
  return squareGrid(density, range);
}
