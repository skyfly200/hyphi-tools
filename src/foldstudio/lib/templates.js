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
  // Diagonals (V) + mid-edge crosses (M) meeting at center.
  return buildFromEdges([
    [[0, 0], [0.5, 0.5], 'V'],
    [[1, 0], [0.5, 0.5], 'V'],
    [[1, 1], [0.5, 0.5], 'V'],
    [[0, 1], [0.5, 0.5], 'V'],
    [[0.5, 0], [0.5, 0.5], 'M'],
    [[0.5, 1], [0.5, 0.5], 'M'],
    [[0, 0.5], [0.5, 0.5], 'M'],
    [[1, 0.5], [0.5, 0.5], 'M'],
  ]);
}

function waterbomb() {
  // Preliminary's twin: diagonals are M, mid-edge crosses are V.
  return buildFromEdges([
    [[0, 0], [0.5, 0.5], 'M'],
    [[1, 0], [0.5, 0.5], 'M'],
    [[1, 1], [0.5, 0.5], 'M'],
    [[0, 1], [0.5, 0.5], 'M'],
    [[0.5, 0], [0.5, 0.5], 'V'],
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
  // Central rotated square (V) plus four spokes from corners (M).
  const c = 0.5;
  const r = 0.18;
  const pts = [
    [c + r, c], [c, c + r], [c - r, c], [c, c - r],
  ];
  const edges = [
    [pts[0], pts[1], 'V'],
    [pts[1], pts[2], 'V'],
    [pts[2], pts[3], 'V'],
    [pts[3], pts[0], 'V'],
    [[0, 0], pts[2], 'M'],
    [[1, 0], pts[3], 'M'],
    [[1, 1], pts[0], 'M'],
    [[0, 1], pts[1], 'M'],
  ];
  return buildFromEdges(edges);
}

function radialStar(spokes = 16) {
  const edges = [];
  const cx = 0.5, cy = 0.5;
  // Spokes from center to the boundary, alternating M/V.
  for (let i = 0; i < spokes; i++) {
    const a = (i / spokes) * Math.PI * 2;
    const dx = Math.cos(a), dy = Math.sin(a);
    // Distance to boundary along the ray.
    const tx = dx > 0 ? (1 - cx) / dx : (dx < 0 ? -cx / dx : Infinity);
    const ty = dy > 0 ? (1 - cy) / dy : (dy < 0 ? -cy / dy : Infinity);
    const t = Math.min(Math.abs(tx), Math.abs(ty));
    edges.push([[cx, cy], [cx + dx * t, cy + dy * t], i % 2 === 0 ? 'M' : 'V']);
  }
  return buildFromEdges(edges);
}

export const TEMPLATES = [
  { id: 'blank', name: 'Blank paper', tagline: 'Just the boundary',           build: blank },
  { id: 'preliminary', name: 'Preliminary base', tagline: 'Diagonals + mid-edge cross', build: preliminary },
  { id: 'waterbomb', name: 'Waterbomb base', tagline: 'Inverse of preliminary',         build: waterbomb },
  { id: 'accordion', name: 'Accordion fold (8)', tagline: 'Parallel M/V pleats',        build: () => accordion(8) },
  { id: 'square-twist', name: 'Square twist', tagline: 'Central twist + 4 spokes',      build: squareTwist },
  { id: 'radial-16', name: 'Radial star (16)', tagline: '16 spokes from center',        build: () => radialStar(16) },
];

export function buildTemplate(id) {
  const t = TEMPLATES.find(t => t.id === id);
  return t ? t.build() : emptyModel();
}
