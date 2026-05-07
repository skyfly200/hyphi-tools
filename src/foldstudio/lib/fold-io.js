// FOLD <-> internal model conversion. FOLD spec:
// https://github.com/edemaine/fold/blob/master/doc/spec.md

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

// Brand colors for on-screen rendering.
const STROKE_UI = { M: '#e23b3b', V: '#3a7bd5', B: '#111111', F: '#999999', U: '#666666' };
// Origami Simulator's SVG importer matches creases by exact stroke color:
// pure red = mountain, pure blue = valley, black = boundary,
// yellow = unfolded/flat reference, green = unknown.
const STROKE_OS = { M: '#FF0000', V: '#0000FF', B: '#000000', F: '#FFFF00', U: '#00FF00' };

export function modelToSVG(model, { size = 600, simulator = true } = {}) {
  const palette = simulator ? STROKE_OS : STROKE_UI;
  const lines = model.edges.map(e => {
    const a = model.vertices[e.v1], b = model.vertices[e.v2];
    return `<line x1="${a[0] * size}" y1="${(1 - a[1]) * size}" x2="${b[0] * size}" y2="${(1 - b[1]) * size}" stroke="${palette[e.assignment] || '#000'}" stroke-width="1.5" />`;
  }).join('\n');
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" width="${size}" height="${size}">
<rect x="0" y="0" width="${size}" height="${size}" fill="white" stroke="none"/>
${lines}
</svg>`;
}
