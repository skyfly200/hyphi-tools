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
};

export function iconSvg(name, size = 18) {
  const body = Icons[name] || '';
  return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;
}
