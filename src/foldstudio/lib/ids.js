// ID formatting + label positioning helpers.

export function formatId(prefix, i, oneBased = false) {
  return `${prefix}${oneBased ? i + 1 : i}`;
}

export function vertexLabelPos(v) {
  return [v[0] + 0.008, v[1] + 0.008];
}

export function edgeMidpoint(model, e) {
  const a = model.vertices[e.v1], b = model.vertices[e.v2];
  return [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
}

export function faceCentroid(model, face) {
  let x = 0, y = 0;
  for (const vi of face) { x += model.vertices[vi][0]; y += model.vertices[vi][1]; }
  return [x / face.length, y / face.length];
}
