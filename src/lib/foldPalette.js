// Canonical palette + stroke style for crease-pattern visualization.
// Imported by FoldForm.jsx, FoldPress.jsx, and FoldStudio so all three tools
// render the same pattern identically.

// Mid-gray boundary so it reads against both white paper and the dark
// editor workspace. Stroke-width does the heavy lifting to set B apart from
// F/U on white paper.
export const EDGE_COLOR = {
  M: '#e23b3b', // mountain — folds away from viewer
  V: '#3a7bd5', // valley   — folds toward viewer
  B: '#5c6478', // boundary — paper edge / cut
  F: '#9aa0aa', // flat / reference
  U: '#6e7382', // unknown / unassigned
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
