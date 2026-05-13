// A handful of starter crease patterns. Each builder returns a new model.

import { emptyModel } from './model.js';

function buildFromEdges(edges) {
  // Vertices and edges in unit-square space [0,1]^2.
  // Adds the four boundary corners + supplied creases, dedupes vertices.
  const vertices = [[0, 0], [1, 0], [1, 1], [0, 1]];
  const idx = new Map([['0,0', 0], ['1,0', 1], ['1,1', 2], ['0,1', 3]]);
  const get = p => {
    const k = `${p[0].toFixed(6)},${p[1].toFixed(6)}`;
    if (idx.has(k)) return idx.get(k);
    idx.set(k, vertices.length);
    vertices.push([p[0], p[1]]);
    return vertices.length - 1;
  };
  const out = {
    vertices,
    edges: [
      { v1: 0, v2: 1, assignment: 'B' },
      { v1: 1, v2: 2, assignment: 'B' },
      { v1: 2, v2: 3, assignment: 'B' },
      { v1: 3, v2: 0, assignment: 'B' },
    ],
    faces: [],
  };
  for (const [p1, p2, a] of edges) {
    out.edges.push({ v1: get(p1), v2: get(p2), assignment: a });
  }
  return out;
}

function blank() {
  return emptyModel();
}

function preliminary() {
  // Classic preliminary base: 4 diagonals V + 4 mid-edge crosses M.
  // With 4V + 4M at the centre it fails Maekawa (needs |M-V|=2). The
  // bottom mid-edge crease is flipped to V so the centre becomes
  // 5V + 3M and the pattern actually folds flat.
  return buildFromEdges([
    [[0, 0], [0.5, 0.5], 'V'],
    [[1, 0], [0.5, 0.5], 'V'],
    [[1, 1], [0.5, 0.5], 'V'],
    [[0, 1], [0.5, 0.5], 'V'],
    [[0.5, 0], [0.5, 0.5], 'V'],   // flipped from M for Maekawa
    [[0.5, 1], [0.5, 0.5], 'M'],
    [[0, 0.5], [0.5, 0.5], 'M'],
    [[1, 0.5], [0.5, 0.5], 'M'],
  ]);
}

function waterbomb() {
  // Inverse of preliminary: 4 diagonals M + 4 mid-edge crosses V, with
  // the bottom mid-edge crease flipped to M to give 5M + 3V at centre.
  return buildFromEdges([
    [[0, 0], [0.5, 0.5], 'M'],
    [[1, 0], [0.5, 0.5], 'M'],
    [[1, 1], [0.5, 0.5], 'M'],
    [[0, 1], [0.5, 0.5], 'M'],
    [[0.5, 0], [0.5, 0.5], 'M'],   // flipped from V for Maekawa
    [[0.5, 1], [0.5, 0.5], 'V'],
    [[0, 0.5], [0.5, 0.5], 'V'],
    [[1, 0.5], [0.5, 0.5], 'V'],
  ]);
}

function accordion(n = 8) {
  const edges = [];
  for (let i = 1; i < n; i++) {
    const y = i / n;
    edges.push([[0, y], [1, y], i % 2 === 0 ? 'V' : 'M']);
  }
  return buildFromEdges(edges);
}

function squareTwist() {
  // Central rotated square + spokes from each paper corner. Each square
  // corner ends up with three meeting creases — that doesn't fold flat
  // without extra pleats, so we ship as 'U' and let the user paint.
  const c = 0.5;
  const r = 0.18;
  const pts = [
    [c + r, c], [c, c + r], [c - r, c], [c, c - r],
  ];
  const edges = [
    [pts[0], pts[1], 'U'],
    [pts[1], pts[2], 'U'],
    [pts[2], pts[3], 'U'],
    [pts[3], pts[0], 'U'],
    [[0, 0], pts[2], 'U'],
    [[1, 0], pts[3], 'U'],
    [[1, 1], pts[0], 'U'],
    [[0, 1], pts[1], 'U'],
  ];
  return buildFromEdges(edges);
}

function radialStar(spokes = 16) {
  const edges = [];
  const cx = 0.5, cy = 0.5;
  // Alternate M/V around the star. Pure alternation gives equal counts
  // (8+8) at the centre and fails Maekawa — flip the first spoke so the
  // centre splits 9M+7V and the pattern folds flat.
  for (let i = 0; i < spokes; i++) {
    const a = (i / spokes) * Math.PI * 2;
    const dx = Math.cos(a), dy = Math.sin(a);
    const tx = dx > 0 ? (1 - cx) / dx : (dx < 0 ? -cx / dx : Infinity);
    const ty = dy > 0 ? (1 - cy) / dy : (dy < 0 ? -cy / dy : Infinity);
    const t = Math.min(Math.abs(tx), Math.abs(ty));
    // Even spokes M, odd spokes V — flip spoke 1 to M so the centre is
    // 9M + 7V instead of the failing 8M + 8V.
    const assignment = (i % 2 === 0 || i === 1) ? 'M' : 'V';
    edges.push([[cx, cy], [cx + dx * t, cy + dy * t], assignment]);
  }
  return buildFromEdges(edges);
}

export const TEMPLATES = [
  { id: 'blank', name: 'Blank paper', tagline: 'Just the boundary',           build: blank },
  { id: 'preliminary', name: 'Preliminary base', tagline: 'Diagonals + mid-edge cross · flat-foldable', build: preliminary },
  { id: 'waterbomb', name: 'Waterbomb base', tagline: 'Inverse of preliminary · flat-foldable',         build: waterbomb },
  { id: 'accordion', name: 'Accordion fold (8)', tagline: 'Parallel M/V pleats',                        build: () => accordion(8) },
  { id: 'square-twist', name: 'Square twist', tagline: 'Central twist + 4 spokes · paint M/V to fold',  build: squareTwist },
  { id: 'radial-16', name: 'Radial star (16)', tagline: '16 alternating spokes · flat-foldable',        build: () => radialStar(16) },
];

export function buildTemplate(id) {
  const t = TEMPLATES.find(t => t.id === id);
  return t ? t.build() : emptyModel();
}
