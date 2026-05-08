// Canonical palette + stroke style for crease-pattern visualization.
// Imported by FoldForm.jsx, FoldPress.jsx, and FoldStudio so all three tools
// render the same pattern identically.

export const EDGE_COLOR = {
  M: '#e23b3b', // mountain — folds away from viewer
  V: '#3a7bd5', // valley   — folds toward viewer
  B: '#222222', // boundary — paper edge / cut
  F: '#999999', // flat / reference
  U: '#666666', // unknown / unassigned
};

export const EDGE_DASH = {
  F: '5 4', // flat creases dashed so they read as construction lines
};

// Origami Simulator's SVG importer matches by exact stroke color. These are
// the colors it expects. Used only by FoldStudio's SVG export.
export const EDGE_COLOR_OS = {
  M: '#FF0000',
  V: '#0000FF',
  B: '#000000',
  F: '#FFFF00',
  U: '#00FF00',
};

export function strokeFor(type) {
  return EDGE_COLOR[type] || '#666';
}

export function dashFor(type) {
  return EDGE_DASH[type] || null;
}
