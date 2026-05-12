// Inline SVG icon strings, sized for 18px buttons. All paths use
// stroke="currentColor" so they pick up the button text color.

export const Icons = {
  draw: `<path d="M3 17l4 -4l9 -9l4 4l-9 9z" /><path d="M14 6l4 4" />`,
  select: `<path d="M4 4l7 16l2 -7l7 -2z" />`,
  mirror: `<path d="M12 3v18" /><path d="M4 8l4 4l-4 4" /><path d="M20 8l-4 4l4 4" />`,
  rotate: `<path d="M19.95 11a8 8 0 1 0 -.5 4m.5 5v-5h-5" />`,
  angle: `<path d="M3 20h18" /><path d="M3 20l16 -8" />`,
  save: `<path d="M5 4h11l3 3v13H5z" /><path d="M8 4v5h7V4" /><path d="M8 14h8v6H8z" />`,
  open: `<path d="M3 7h6l2 2h10v10H3z" />`,
  upload: `<path d="M12 16V4" /><path d="M7 9l5 -5l5 5" /><path d="M5 18h14" />`,
  download: `<path d="M12 4v12" /><path d="M7 11l5 5l5 -5" /><path d="M5 20h14" />`,
  trash: `<path d="M5 7h14" /><path d="M9 7v-3h6v3" /><path d="M7 7v13h10v-13" /><path d="M10 11v6" /><path d="M14 11v6" />`,
  newDoc: `<path d="M14 3v5h5" /><path d="M14 3H6v18h12V8z" /><path d="M12 11v6" /><path d="M9 14h6" />`,
  undo: `<path d="M9 14l-4 -4l4 -4" /><path d="M5 10h11a4 4 0 1 1 0 8h-3" />`,
  redo: `<path d="M15 14l4 -4l-4 -4" /><path d="M19 10H8a4 4 0 1 0 0 8h3" />`,
  reset: `<path d="M4 4h16v16h-16z" />`,
  panelLeft: `<rect x="3" y="4" width="18" height="16" rx="1" /><line x1="9" y1="4" x2="9" y2="20" />`,
  panelRight: `<rect x="3" y="4" width="18" height="16" rx="1" /><line x1="15" y1="4" x2="15" y2="20" />`,
  close: `<line x1="6" y1="6" x2="18" y2="18" /><line x1="6" y1="18" x2="18" y2="6" />`,
  magnet: `<path d="M4 13V5h5v8a3 3 0 0 0 6 0V5h5v8a8 8 0 0 1 -16 0z" /><line x1="4" y1="9" x2="9" y2="9" /><line x1="15" y1="9" x2="20" y2="9" />`,
  broom: `<path d="M14 4l6 6" /><path d="M5 21l7 -7l5 5l-7 7z" /><path d="M14 11l-3 -3" /><path d="M3 21l3 -3" />`,
  // External-link arrow used by the Simulator handoff (open in new tab).
  external: `<path d="M11 7H6a2 2 0 0 0 -2 2v9a2 2 0 0 0 2 2h9a2 2 0 0 0 2 -2v-5"/><path d="M10 14L20 4"/><path d="M15 4h5v5"/>`,
  // Zigzag accordion stand-in for FoldForm (living-hinge model).
  foldform: `<path d="M3 8l4 -4l4 4l4 -4l4 4l2 -2"/><path d="M3 14l4 4l4 -4l4 4l4 -4l2 2"/>`,
  // Plate + downward arrows for FoldPress (press / stamp generator).
  foldpress: `<rect x="3" y="14" width="18" height="3" rx="0.5"/><path d="M8 11l4 -4l4 4"/><path d="M12 7v4"/><path d="M5 20h14"/>`,
  // Select-mode targets.
  pickEdge: `<line x1="4" y1="20" x2="20" y2="4"/>`,
  pickVertex: `<circle cx="12" cy="12" r="3.5" fill="currentColor"/>`,
  pickBoth: `<line x1="4" y1="20" x2="20" y2="4"/><circle cx="20" cy="4" r="3" fill="currentColor"/><circle cx="4" cy="20" r="3" fill="currentColor"/>`,
  // Swap arrows — used by Invert M/V action.
  invert: `<path d="M7 10l-4 -4l4 -4"/><path d="M3 6h13a4 4 0 0 1 4 4v0"/><path d="M17 14l4 4l-4 4"/><path d="M21 18H8a4 4 0 0 1 -4 -4v0"/>`,
};

export function iconSvg(name, size = 18) {
  const body = Icons[name] || '';
  return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;
}
