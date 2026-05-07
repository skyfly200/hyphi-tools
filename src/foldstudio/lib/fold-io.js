// FOLD <-> internal model conversion. FOLD spec:
// https://github.com/edemaine/fold/blob/master/doc/spec.md

const ASSIGN_TO_FOLD = { M: 'M', V: 'V', B: 'B', F: 'F', U: 'U' };

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
  return {
    vertices: vc.map(v => [v[0], v[1]]),
    edges: ev.map((e, i) => ({
      v1: e[0], v2: e[1],
      assignment: (ea[i] || 'U').toUpperCase(),
    })),
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

const STROKE = { M: '#e23b3b', V: '#3a7bd5', B: '#111111', F: '#999999', U: '#666666' };

export function modelToSVG(model, size = 600) {
  const lines = model.edges.map(e => {
    const a = model.vertices[e.v1], b = model.vertices[e.v2];
    const dash = e.assignment === 'F' ? ' stroke-dasharray="4 3"' : '';
    return `<line x1="${a[0] * size}" y1="${(1 - a[1]) * size}" x2="${b[0] * size}" y2="${(1 - b[1]) * size}" stroke="${STROKE[e.assignment] || '#333'}" stroke-width="1.5"${dash} />`;
  }).join('\n');
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" width="${size}" height="${size}">
<rect x="0" y="0" width="${size}" height="${size}" fill="white"/>
${lines}
</svg>`;
}
