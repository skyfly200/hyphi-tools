// FOLD <-> internal model conversion. FOLD spec:
// https://github.com/edemaine/fold/blob/master/doc/spec.md

import { EDGE_COLOR, EDGE_COLOR_OS } from '../../lib/foldPalette.js';

const ASSIGN_TO_FOLD = { M: 'M', V: 'V', B: 'B', F: 'F', U: 'U' };

// Default fold angle (degrees) when an edge has no explicit override.
// Origami Simulator expects negative for mountain, positive for valley.
const DEFAULT_ANGLE = { M: -180, V: 180, F: 0, B: 0, U: 0 };

export function defaultFoldAngle(assignment) {
  return DEFAULT_ANGLE[assignment] ?? 0;
}

export function effectiveFoldAngle(edge) {
  return Number.isFinite(edge.foldAngle) ? edge.foldAngle : defaultFoldAngle(edge.assignment);
}

export function modelToFOLD(model, opts = {}) {
  const out = {
    file_spec: 1.1,
    file_creator: 'FoldStudio (hyphi-tools)',
    file_classes: ['creasePattern'],
    frame_classes: ['creasePattern'],
    frame_attributes: ['2D'],
    vertices_coords: model.vertices.map(v => [v[0], v[1]]),
    edges_vertices: model.edges.map(e => [e.v1, e.v2]),
    edges_assignment: model.edges.map(e => ASSIGN_TO_FOLD[e.assignment] || 'U'),
    edges_foldAngle: model.edges.map(effectiveFoldAngle),
  };
  if (model.faces && model.faces.length) {
    out.faces_vertices = model.faces.map(f => f.slice());
  }
  if (opts.ids) {
    out['hyphi:vertex_ids'] = model.vertices.map((_, i) => i);
    out['hyphi:edge_ids'] = model.edges.map((_, i) => i);
    if (model.faces?.length) out['hyphi:face_ids'] = model.faces.map((_, i) => i);
  }
  return out;
}

export function foldToModel(fold) {
  const vc = fold.vertices_coords || [];
  const ev = fold.edges_vertices || [];
  const ea = fold.edges_assignment || ev.map(() => 'U');
  const ef = fold.edges_foldAngle || [];
  return {
    vertices: vc.map(v => [v[0], v[1]]),
    edges: ev.map((e, i) => {
      const edge = { v1: e[0], v2: e[1], assignment: (ea[i] || 'U').toUpperCase() };
      if (Number.isFinite(ef[i]) && ef[i] !== defaultFoldAngle(edge.assignment)) {
        edge.foldAngle = ef[i];
      }
      return edge;
    }),
    faces: (fold.faces_vertices || []).map(f => f.slice()),
  };
}

export function downloadJSON(filename, obj) {
  const blob = new Blob([JSON.stringify(obj, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click();
  setTimeout(() => { document.body.removeChild(a); URL.revokeObjectURL(url); }, 0);
}

export function downloadText(filename, text, mime = 'image/svg+xml') {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click();
  setTimeout(() => { document.body.removeChild(a); URL.revokeObjectURL(url); }, 0);
}

// CP (Oripa-style) text format. Each non-empty line:
//   type x1 y1 x2 y2
// Types follow Oripa: 1 = border, 2 = mountain, 3 = valley, 4 = flat, 5 = unknown.
const ASSIGN_TO_CP = { B: 1, M: 2, V: 3, F: 4, U: 5 };
const CP_TO_ASSIGN = { 1: 'B', 2: 'M', 3: 'V', 4: 'F', 5: 'U' };

export function modelToCP(model) {
  const lines = ['# FoldStudio CP export'];
  for (const e of model.edges) {
    const a = model.vertices[e.v1], b = model.vertices[e.v2];
    const t = ASSIGN_TO_CP[e.assignment] ?? 5;
    lines.push(`${t} ${a[0]} ${a[1]} ${b[0]} ${b[1]}`);
  }
  return lines.join('\n') + '\n';
}

export function cpToModel(text) {
  const vertices = [];
  const vIdx = new Map();
  const get = (x, y) => {
    const k = `${x.toFixed(6)},${y.toFixed(6)}`;
    if (vIdx.has(k)) return vIdx.get(k);
    vIdx.set(k, vertices.length);
    vertices.push([x, y]);
    return vertices.length - 1;
  };
  const edges = [];
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  // First pass to collect coords + bounds.
  const raw = [];
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const parts = trimmed.split(/\s+/).map(Number);
    if (parts.length < 5 || parts.some(Number.isNaN)) continue;
    const [t, x1, y1, x2, y2] = parts;
    raw.push([t, x1, y1, x2, y2]);
    if (x1 < minX) minX = x1; if (x1 > maxX) maxX = x1;
    if (x2 < minX) minX = x2; if (x2 > maxX) maxX = x2;
    if (y1 < minY) minY = y1; if (y1 > maxY) maxY = y1;
    if (y2 < minY) minY = y2; if (y2 > maxY) maxY = y2;
  }
  if (!raw.length) return null;
  const span = Math.max(maxX - minX, maxY - minY) || 1;
  // Normalise into [0,1]² so it matches FoldStudio's model space.
  for (const [t, x1, y1, x2, y2] of raw) {
    const v1 = get((x1 - minX) / span, (y1 - minY) / span);
    const v2 = get((x2 - minX) / span, (y2 - minY) / span);
    if (v1 === v2) continue;
    edges.push({ v1, v2, assignment: CP_TO_ASSIGN[t] || 'U' });
  }
  return { vertices, edges, faces: [] };
}

export function modelToSVG(model, { size = 600, simulator = true } = {}) {
  const palette = simulator ? EDGE_COLOR_OS : EDGE_COLOR;
  const lines = model.edges.map(e => {
    const a = model.vertices[e.v1], b = model.vertices[e.v2];
    return `<line x1="${a[0] * size}" y1="${(1 - a[1]) * size}" x2="${b[0] * size}" y2="${(1 - b[1]) * size}" stroke="${palette[e.assignment] || '#000'}" stroke-width="1.5" />`;
  }).join('\n');
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" width="${size}" height="${size}">
<rect x="0" y="0" width="${size}" height="${size}" fill="white" stroke="none"/>
${lines}
</svg>`;
}
