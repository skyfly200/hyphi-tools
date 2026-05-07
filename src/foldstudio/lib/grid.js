// Grid generators. Each returns { nodes: [[x,y]...], lines: [[[x,y],[x,y]]...] }
// in unit-square model space [0,1] x [0,1] (paper) by default. When `range`
// is provided ([xMin, xMax, yMin, yMax]), the grid is generated to fill that
// range so callers can extend the grid beyond the paper into the workspace.

const clamp01 = v => Math.max(0, Math.min(1, v));

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

export function radialGrid(rings, sectors, range = [0, 1, 0, 1]) {
  const [x0, x1, y0, y1] = range;
  const cx = 0.5, cy = 0.5;
  // Reach the farthest corner of the requested range so the grid covers the
  // whole paper and any workspace beyond it.
  const rMax = Math.max(
    Math.hypot(cx - x0, cy - y0),
    Math.hypot(cx - x1, cy - y0),
    Math.hypot(cx - x0, cy - y1),
    Math.hypot(cx - x1, cy - y1),
  );
  const nodes = [], lines = [];
  const inRange = (x, y) =>
    x >= x0 - 1e-9 && x <= x1 + 1e-9 && y >= y0 - 1e-9 && y <= y1 + 1e-9;

  for (let r = 1; r <= rings; r++) {
    const radius = (r / rings) * rMax;
    const segs = Math.max(48, sectors * 4);
    for (let i = 0; i < segs; i++) {
      const a1 = (i / segs) * Math.PI * 2;
      const a2 = ((i + 1) / segs) * Math.PI * 2;
      const p1 = [cx + Math.cos(a1) * radius, cy + Math.sin(a1) * radius];
      const p2 = [cx + Math.cos(a2) * radius, cy + Math.sin(a2) * radius];
      // Render only the arc segments that are inside the range.
      if (inRange(p1[0], p1[1]) || inRange(p2[0], p2[1])) {
        lines.push([p1, p2]);
      }
    }
    for (let s = 0; s < sectors; s++) {
      const a = (s / sectors) * Math.PI * 2;
      const n = [cx + Math.cos(a) * radius, cy + Math.sin(a) * radius];
      if (inRange(n[0], n[1])) nodes.push(n);
    }
  }
  for (let s = 0; s < sectors; s++) {
    const a = (s / sectors) * Math.PI * 2;
    lines.push([[cx, cy], [cx + Math.cos(a) * rMax, cy + Math.sin(a) * rMax]]);
  }
  nodes.push([cx, cy]);

  // Snap targets at the paper boundary [0,1]² where each ring or spoke crosses.
  // Independent of the workspace range — these reflect where the radial grid
  // visually meets the paper edge so users can grab those intersections.
  const PAPER = [
    { kind: 'h', y: 0, x0: 0, x1: 1 },
    { kind: 'h', y: 1, x0: 0, x1: 1 },
    { kind: 'v', x: 0, y0: 0, y1: 1 },
    { kind: 'v', x: 1, y0: 0, y1: 1 },
  ];
  // Spoke × paper edge.
  for (let s = 0; s < sectors; s++) {
    const a = (s / sectors) * Math.PI * 2;
    const dx = Math.cos(a), dy = Math.sin(a);
    const ts = [];
    if (Math.abs(dx) > 1e-9) {
      ts.push((0 - cx) / dx, (1 - cx) / dx);
    }
    if (Math.abs(dy) > 1e-9) {
      ts.push((0 - cy) / dy, (1 - cy) / dy);
    }
    for (const t of ts) {
      if (t < 1e-9 || t > rMax + 1e-9) continue;
      const x = cx + dx * t, y = cy + dy * t;
      if (x >= -1e-9 && x <= 1 + 1e-9 && y >= -1e-9 && y <= 1 + 1e-9) {
        nodes.push([clamp01(x), clamp01(y)]);
      }
    }
  }
  // Ring × paper edge.
  for (let r = 1; r <= rings; r++) {
    const radius = (r / rings) * rMax;
    for (const e of PAPER) {
      if (e.kind === 'h') {
        const dy = e.y - cy;
        const inside = radius * radius - dy * dy;
        if (inside < 0) continue;
        const dx = Math.sqrt(inside);
        for (const x of [cx - dx, cx + dx]) {
          if (x >= e.x0 - 1e-9 && x <= e.x1 + 1e-9) nodes.push([clamp01(x), e.y]);
        }
      } else {
        const dx = e.x - cx;
        const inside = radius * radius - dx * dx;
        if (inside < 0) continue;
        const dy = Math.sqrt(inside);
        for (const y of [cy - dy, cy + dy]) {
          if (y >= e.y0 - 1e-9 && y <= e.y1 + 1e-9) nodes.push([e.x, clamp01(y)]);
        }
      }
    }
  }
  return { nodes, lines };
}

const SINGLE_GRID = {
  square: (d, r) => squareGrid(d, r),
  triangular: (d, r) => triangularGrid(d, r),
  radial: (d, r) => radialGrid(Math.max(2, Math.floor(d / 2)), Math.max(4, d * 2), r),
};

// Accepts a single type string for back-compat or an array of types to merge.
export function buildGrid(typeOrTypes, density, range = [0, 1, 0, 1]) {
  const types = Array.isArray(typeOrTypes) ? typeOrTypes : [typeOrTypes];
  const nodes = [], lines = [];
  for (const t of types) {
    const g = SINGLE_GRID[t];
    if (!g) continue;
    const out = g(density, range);
    nodes.push(...out.nodes);
    lines.push(...out.lines);
  }
  return { nodes, lines };
}
