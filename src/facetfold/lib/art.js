// Artwork for multi-colour faces: SVG and text -> polygons.
//
// Coordinate convention for ALL artwork here ("art space"): millimetres, y UP, origin at the centre of the artwork's
// bounding box, as seen from OUTSIDE the finished object. placeOnFace() maps it onto a panel in plate coordinates
// (the plate is a top view of the INSIDE, so x is mirrored there — that is what makes text read correctly on the
// finished solid).

import * as OT from 'opentype.js';
// Node resolves this package as CommonJS (parse lives on .default); bundlers expose a named export.
const parseFont = (...a) => (OT.parse || OT.default.parse)(...a);

// ── small matrix helpers (a b c d e f, SVG order) ──────────────────────────
const IDENT = [1, 0, 0, 1, 0, 0];
const mul = (m, n) => [m[0] * n[0] + m[2] * n[1], m[1] * n[0] + m[3] * n[1], m[0] * n[2] + m[2] * n[3], m[1] * n[2] + m[3] * n[3], m[0] * n[4] + m[2] * n[5] + m[4], m[1] * n[4] + m[3] * n[5] + m[5]];
const apply = (m, p) => [m[0] * p[0] + m[2] * p[1] + m[4], m[1] * p[0] + m[3] * p[1] + m[5]];
const det = m => m[0] * m[3] - m[1] * m[2];

function parseTransform(str) {
  let m = IDENT;
  for (const t of (str || '').matchAll(/(matrix|translate|scale|rotate|skewX|skewY)\s*\(([^)]*)\)/g)) {
    const a = t[2].split(/[\s,]+/).filter(Boolean).map(Number);
    let n = IDENT;
    if (t[1] === 'matrix') n = a.slice(0, 6);
    else if (t[1] === 'translate') n = [1, 0, 0, 1, a[0] || 0, a[1] || 0];
    else if (t[1] === 'scale') n = [a[0], 0, 0, a[1] ?? a[0], 0, 0];
    else if (t[1] === 'rotate') { const r = ((a[0] || 0) * Math.PI) / 180, c = Math.cos(r), s = Math.sin(r), cx = a[1] || 0, cy = a[2] || 0; n = [c, s, -s, c, cx - c * cx + s * cy, cy - s * cx - c * cy]; }
    else if (t[1] === 'skewX') n = [1, 0, Math.tan(((a[0] || 0) * Math.PI) / 180), 1, 0, 0];
    else if (t[1] === 'skewY') n = [1, Math.tan(((a[0] || 0) * Math.PI) / 180), 0, 1, 0, 0];
    m = mul(m, n);
  }
  return m;
}

// ── curve flattening ───────────────────────────────────────────────────────
const segCount = (len, tol) => Math.max(2, Math.min(200, Math.ceil(Math.sqrt(len / tol))));
function flattenCubic(p0, p1, p2, p3, tol, out) {
  const len = Math.hypot(p1[0] - p0[0], p1[1] - p0[1]) + Math.hypot(p2[0] - p1[0], p2[1] - p1[1]) + Math.hypot(p3[0] - p2[0], p3[1] - p2[1]);
  const n = segCount(len, tol);
  for (let i = 1; i <= n; i++) { const t = i / n, u = 1 - t;
    out.push([u * u * u * p0[0] + 3 * u * u * t * p1[0] + 3 * u * t * t * p2[0] + t * t * t * p3[0], u * u * u * p0[1] + 3 * u * u * t * p1[1] + 3 * u * t * t * p2[1] + t * t * t * p3[1]]); }
}
const flattenQuad = (p0, p1, p2, tol, out) => flattenCubic(p0, [p0[0] + (2 / 3) * (p1[0] - p0[0]), p0[1] + (2 / 3) * (p1[1] - p0[1])], [p2[0] + (2 / 3) * (p1[0] - p2[0]), p2[1] + (2 / 3) * (p1[1] - p2[1])], p2, tol, out);

function flattenArc(p0, rx, ry, phiDeg, large, sweep, p1, tol, out) {
  if (rx === 0 || ry === 0) { out.push(p1); return; }
  rx = Math.abs(rx); ry = Math.abs(ry);
  const phi = (phiDeg * Math.PI) / 180, c = Math.cos(phi), s = Math.sin(phi);
  const dx = (p0[0] - p1[0]) / 2, dy = (p0[1] - p1[1]) / 2;
  const x1 = c * dx + s * dy, y1 = -s * dx + c * dy;
  const lam = (x1 * x1) / (rx * rx) + (y1 * y1) / (ry * ry);
  if (lam > 1) { const k = Math.sqrt(lam); rx *= k; ry *= k; }
  const sign = large === sweep ? -1 : 1;
  const num = rx * rx * ry * ry - rx * rx * y1 * y1 - ry * ry * x1 * x1, den = rx * rx * y1 * y1 + ry * ry * x1 * x1;
  const co = sign * Math.sqrt(Math.max(0, num / den));
  const cxp = (co * rx * y1) / ry, cyp = (-co * ry * x1) / rx;
  const cx = c * cxp - s * cyp + (p0[0] + p1[0]) / 2, cy = s * cxp + c * cyp + (p0[1] + p1[1]) / 2;
  const ang = (ux, uy, vx, vy) => { const a = Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy); return a; };
  const th1 = ang(1, 0, (x1 - cxp) / rx, (y1 - cyp) / ry);
  let dth = ang((x1 - cxp) / rx, (y1 - cyp) / ry, (-x1 - cxp) / rx, (-y1 - cyp) / ry);
  if (!sweep && dth > 0) dth -= 2 * Math.PI; else if (sweep && dth < 0) dth += 2 * Math.PI;
  const n = segCount(Math.abs(dth) * Math.max(rx, ry), tol);
  for (let i = 1; i <= n; i++) { const th = th1 + (dth * i) / n; out.push([c * rx * Math.cos(th) - s * ry * Math.sin(th) + cx, s * rx * Math.cos(th) + c * ry * Math.sin(th) + cy]); }
}

/** SVG path data -> subpaths [{ points, closed }] in user units. */
export function parsePathData(d, tol = 0.05) {
  const tokens = [...d.matchAll(/([MmLlHhVvCcSsQqTtAaZz])|(-?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?)/g)].map(m => (m[1] ? m[1] : Number(m[2])));
  const subs = []; let cur = null, i = 0, cmd = null, x = 0, y = 0, sx = 0, sy = 0, lastC = null, lastQ = null;
  const num = () => tokens[i++];
  const flag = () => { const t = tokens[i++]; return t !== 0; };
  const start = (px, py) => { cur = { points: [[px, py]], closed: false }; subs.push(cur); sx = px; sy = py; };
  while (i < tokens.length) {
    if (typeof tokens[i] === 'string') cmd = tokens[i++];
    else if (cmd === 'M') cmd = 'L'; else if (cmd === 'm') cmd = 'l';
    const rel = cmd === cmd.toLowerCase(), C = cmd.toUpperCase();
    if (C === 'Z') { if (cur) { cur.closed = true; x = sx; y = sy; } lastC = lastQ = null; continue; }
    if (C === 'M') { const a = num(), b = num(); x = rel ? x + a : a; y = rel ? y + b : b; start(x, y); lastC = lastQ = null; continue; }
    if (!cur) start(x, y);
    if (C === 'L') { const a = num(), b = num(); x = rel ? x + a : a; y = rel ? y + b : b; cur.points.push([x, y]); lastC = lastQ = null; }
    else if (C === 'H') { const a = num(); x = rel ? x + a : a; cur.points.push([x, y]); lastC = lastQ = null; }
    else if (C === 'V') { const a = num(); y = rel ? y + a : a; cur.points.push([x, y]); lastC = lastQ = null; }
    else if (C === 'C') { const a = [num(), num(), num(), num(), num(), num()].map((v, k) => (rel ? v + (k % 2 ? y : x) : v)); flattenCubic([x, y], [a[0], a[1]], [a[2], a[3]], [a[4], a[5]], tol, cur.points); lastC = [a[2], a[3]]; lastQ = null; x = a[4]; y = a[5]; }
    else if (C === 'S') { const a = [num(), num(), num(), num()].map((v, k) => (rel ? v + (k % 2 ? y : x) : v)); const c1 = lastC ? [2 * x - lastC[0], 2 * y - lastC[1]] : [x, y]; flattenCubic([x, y], c1, [a[0], a[1]], [a[2], a[3]], tol, cur.points); lastC = [a[0], a[1]]; lastQ = null; x = a[2]; y = a[3]; }
    else if (C === 'Q') { const a = [num(), num(), num(), num()].map((v, k) => (rel ? v + (k % 2 ? y : x) : v)); flattenQuad([x, y], [a[0], a[1]], [a[2], a[3]], tol, cur.points); lastQ = [a[0], a[1]]; lastC = null; x = a[2]; y = a[3]; }
    else if (C === 'T') { const a = [num(), num()].map((v, k) => (rel ? v + (k % 2 ? y : x) : v)); const c1 = lastQ ? [2 * x - lastQ[0], 2 * y - lastQ[1]] : [x, y]; flattenQuad([x, y], c1, [a[0], a[1]], tol, cur.points); lastQ = c1; lastC = null; x = a[0]; y = a[1]; }
    else if (C === 'A') { const rx = num(), ry = num(), rot = num(), large = flag(), sweep = flag(); let ex = num(), ey = num(); if (rel) { ex += x; ey += y; } flattenArc([x, y], rx, ry, rot, large, sweep, [ex, ey], tol, cur.points); x = ex; y = ey; lastC = lastQ = null; }
    else break;
  }
  return subs;
}

// ── colours ────────────────────────────────────────────────────────────────
const NAMED = { black: '#000000', white: '#ffffff', red: '#ff0000', green: '#008000', lime: '#00ff00', blue: '#0000ff', yellow: '#ffff00', cyan: '#00ffff', aqua: '#00ffff', magenta: '#ff00ff', fuchsia: '#ff00ff', gray: '#808080', grey: '#808080', silver: '#c0c0c0', maroon: '#800000', olive: '#808000', purple: '#800080', teal: '#008080', navy: '#000080', orange: '#ffa500', pink: '#ffc0cb', brown: '#a52a2a', gold: '#ffd700' };
export function normalizeColor(c) {
  if (!c) return null; c = c.trim().toLowerCase();
  if (c === 'none' || c === 'transparent') return null;
  if (c === 'currentcolor') return '#000000';
  if (NAMED[c]) return NAMED[c];
  let m = c.match(/^#([0-9a-f]{3})$/); if (m) return '#' + [...m[1]].map(x => x + x).join('');
  m = c.match(/^#([0-9a-f]{6})/); if (m) return '#' + m[1];
  m = c.match(/^rgb\(\s*([\d.]+)(%?)\s*,\s*([\d.]+)(%?)\s*,\s*([\d.]+)(%?)\s*\)$/);
  if (m) { const f = (v, p) => Math.round(p ? (Number(v) * 255) / 100 : Number(v)).toString(16).padStart(2, '0'); return '#' + f(m[1], m[2]) + f(m[3], m[4]) + f(m[5], m[6]); }
  return '#000000';
}
const rgb = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));
/** Index of the palette entry nearest to a hex colour (RGB distance). */
export function nearestSlot(hex, palette) {
  const a = rgb(hex); let best = 0, bd = Infinity;
  palette.forEach((p, i) => { const b = rgb(p.hex.length === 4 ? '#' + [...p.hex.slice(1)].map(x => x + x).join('') : p.hex); const d = (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2; if (d < bd) { bd = d; best = i; } });
  return best;
}

// ── minimal XML (enough for SVG) ───────────────────────────────────────────
function parseXml(text) {
  const root = { name: '#root', attrs: {}, children: [] }, stack = [root];
  const src = text.replace(/<!--[\s\S]*?-->/g, '').replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').replace(/<\?[\s\S]*?\?>/g, '').replace(/<!DOCTYPE[^>]*>/gi, '');
  const re = /<(\/?)([A-Za-z_][\w:.-]*)((?:\s+[^\s=>\/]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>|([^<]+)/g;
  let m;
  while ((m = re.exec(src))) {
    if (m[5] !== undefined) { const top = stack.at(-1); if (top.name === 'style') top.text = (top.text || '') + m[5]; continue; }
    const [, close, name, attrStr, selfClose] = m;
    if (close) { if (stack.length > 1) stack.pop(); continue; }
    const attrs = {}; for (const a of attrStr.matchAll(/([^\s=]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) attrs[a[1]] = a[2] ?? a[3];
    const node = { name: name.replace(/^svg:/, ''), attrs, children: [] };
    stack.at(-1).children.push(node);
    if (!selfClose) stack.push(node);
  }
  return root;
}
function cssRules(root) {
  const rules = {};
  (function walk(n) { if (n.name === 'style' && n.text) for (const r of n.text.matchAll(/([^{}]+)\{([^}]*)\}/g)) for (const sel of r[1].split(',')) rules[sel.trim()] = r[2]; n.children.forEach(walk); })(root);
  return rules;
}
const styleMap = s => Object.fromEntries((s || '').split(';').map(x => x.split(':').map(y => y.trim())).filter(x => x[0] && x[1] !== undefined));

// ── SVG -> shapes ──────────────────────────────────────────────────────────
function rectPolys(a, tol = 0.05) {
  const x = +a.x || 0, y = +a.y || 0, w = +a.width, h = +a.height; if (!(w > 0 && h > 0)) return [];
  let rx = a.rx !== undefined ? +a.rx : a.ry !== undefined ? +a.ry : 0, ry = a.ry !== undefined ? +a.ry : rx;
  rx = Math.min(rx, w / 2); ry = Math.min(ry, h / 2);
  if (!rx || !ry) return [{ points: [[x, y], [x + w, y], [x + w, y + h], [x, y + h]], closed: true }];
  const d = `M${x + rx},${y} H${x + w - rx} A${rx},${ry} 0 0 1 ${x + w},${y + ry} V${y + h - ry} A${rx},${ry} 0 0 1 ${x + w - rx},${y + h} H${x + rx} A${rx},${ry} 0 0 1 ${x},${y + h - ry} V${y + ry} A${rx},${ry} 0 0 1 ${x + rx},${y} Z`;
  return parsePathData(d, tol);
}
const ellipsePolys = (cx, cy, rx, ry, tol = 0.05) => (rx > 0 && ry > 0 ? parsePathData(`M${cx - rx},${cy} A${rx},${ry} 0 1 1 ${cx + rx},${cy} A${rx},${ry} 0 1 1 ${cx - rx},${cy} Z`, tol) : []);

/** Stroke a polyline as a union of CCW quads + join discs (use with NonZero fill). */
export function strokePolygons(points, width, closed) {
  const out = [], h = width / 2, pts = closed && points.length > 2 ? [...points, points[0]] : points;
  for (let i = 0; i + 1 < pts.length; i++) {
    const a = pts[i], b = pts[i + 1], dx = b[0] - a[0], dy = b[1] - a[1], l = Math.hypot(dx, dy); if (l < 1e-9) continue;
    const nx = (-dy / l) * h, ny = (dx / l) * h;
    out.push([[a[0] - nx, a[1] - ny], [b[0] - nx, b[1] - ny], [b[0] + nx, b[1] + ny], [a[0] + nx, a[1] + ny]]);
  }
  for (const p of pts) out.push(Array.from({ length: 12 }, (_, k) => [p[0] + h * Math.cos((2 * Math.PI * k) / 12), p[1] + h * Math.sin((2 * Math.PI * k) / 12)]));
  return out;
}

const signedArea = poly => poly.reduce((s, p, i) => { const q = poly[(i + 1) % poly.length]; return s + p[0] * q[1] - q[0] * p[1]; }, 0) / 2;
export const polygonArea = signedArea;

/**
 * @param {string} text SVG source
 * @param {{ widthMm:number }} opts  the artwork's width in mm (the viewBox / content width is scaled to it)
 * @returns {{ shapes:[{color,fillRule,polygons}], widthMm, heightMm, warnings:string[], colors:string[] }}
 *   polygons are in ART SPACE (mm, y up, centred).
 */
export function parseSvg(text, { widthMm = 20 } = {}, tolOverride = null) {
  const warnings = [], root = parseXml(text), svg = root.children.find(n => n.name === 'svg');
  if (!svg) throw new Error('not an SVG document (no <svg> element)');
  const css = cssRules(root);
  const raw = [];                                                    // shapes in user units, paint order
  const vb = (svg.attrs.viewBox || '').split(/[\s,]+/).map(Number);
  const hasVB = vb.length === 4 && vb.every(Number.isFinite) && vb[2] > 0 && vb[3] > 0;
  const unsupported = new Set();
  const tolUser = tolOverride ?? (hasVB ? (0.01 * vb[2]) / widthMm : 0.05);          // curves flattened to ~0.01 mm on the print
  const gradients = {};
  (function scan(n) { if (['linearGradient', 'radialGradient'].includes(n.name) && n.attrs.id) { const stop = n.children.find(c => c.name === 'stop'); const sc = stop && (styleMap(stop.attrs.style)['stop-color'] || stop.attrs['stop-color']); gradients[n.attrs.id] = normalizeColor(sc) || '#000000'; } n.children.forEach(scan); })(svg);
  const paint = v => { if (v === undefined) return '#000000'; const m = String(v).match(/^url\(\s*#([^)]+)\)/); if (m) { unsupported.add('gradient/pattern fill (using the first stop colour)'); return gradients[m[1]] ?? '#000000'; } return normalizeColor(v); };
  const walk = (n, inh, M) => {
    if (['defs', 'style', 'title', 'desc', 'metadata', 'clipPath', 'mask', 'symbol', 'linearGradient', 'radialGradient', 'pattern', 'filter'].includes(n.name)) {
      const flag = x => { if (['clipPath', 'mask', 'pattern', 'filter'].includes(x.name)) unsupported.add(x.name); if (['linearGradient', 'radialGradient'].includes(x.name)) unsupported.add(x.name + ' (first stop colour used where referenced)'); x.children.forEach(flag); };
      flag(n); return;
    }
    const sel = [n.name, n.attrs.class ? '.' + n.attrs.class.split(/\s+/).join('.') : null, n.attrs.id ? '#' + n.attrs.id : null].filter(Boolean);
    const classRules = Object.assign({}, css[n.name] && styleMap(css[n.name]), ...((n.attrs.class || '').split(/\s+/).filter(Boolean).map(c => styleMap(css['.' + c] || ''))));
    const st = { ...inh, ...classRules, ...styleMap(n.attrs.style) };
    for (const k of ['fill', 'fill-rule', 'stroke', 'stroke-width', 'display', 'opacity']) if (n.attrs[k] !== undefined && classRules[k] === undefined && !(styleMap(n.attrs.style))[k]) st[k] = n.attrs[k];
    void sel;
    const T = n.attrs.transform ? mul(M, parseTransform(n.attrs.transform)) : M;
    if (st.display === 'none') return;
    const a = n.attrs; let subs = null;
    if (n.name === 'path' && a.d) subs = parsePathData(a.d, tolUser);
    else if (n.name === 'rect') subs = rectPolys(a, tolUser);
    else if (n.name === 'circle') subs = ellipsePolys(+a.cx || 0, +a.cy || 0, +a.r, +a.r, tolUser);
    else if (n.name === 'ellipse') subs = ellipsePolys(+a.cx || 0, +a.cy || 0, +a.rx, +a.ry, tolUser);
    else if (n.name === 'line') subs = [{ points: [[+a.x1 || 0, +a.y1 || 0], [+a.x2 || 0, +a.y2 || 0]], closed: false }];
    else if (n.name === 'polygon' || n.name === 'polyline') { const v = (a.points || '').trim().split(/[\s,]+/).map(Number); const pts = []; for (let i = 0; i + 1 < v.length; i += 2) pts.push([v[i], v[i + 1]]); subs = [{ points: pts, closed: n.name === 'polygon' }]; }
    else if (n.name === 'text') unsupported.add('text (convert to outlines or use a Text layer)');
    else if (n.name === 'image') unsupported.add('image');
    else if (n.name === 'use') unsupported.add('use');
    if (subs && subs.length) {
      const fill = paint(st.fill), stroke = st.stroke === undefined ? null : paint(st.stroke);
      const tp = subs.map(s => ({ points: s.points.map(p => apply(T, p)), closed: s.closed })).filter(s => s.points.length > 1);
      if (fill && n.name !== 'line' && n.name !== 'polyline') {
        const polys = tp.filter(s => s.points.length > 2).map(s => s.points);
        if (polys.length) raw.push({ color: fill, fillRule: st['fill-rule'] === 'evenodd' ? 'EvenOdd' : 'NonZero', polygons: polys });
      } else if (fill && n.name === 'polyline') { const polys = tp.filter(s => s.points.length > 2).map(s => s.points); if (polys.length) raw.push({ color: fill, fillRule: 'NonZero', polygons: polys }); }
      if (stroke) {
        const w = (Number(st['stroke-width']) || 1) * Math.sqrt(Math.abs(det(T)) || 1);
        const polys = tp.flatMap(s => strokePolygons(s.points, w, s.closed)).map(p => (signedArea(p) < 0 ? p.slice().reverse() : p));
        if (polys.length) raw.push({ color: stroke, fillRule: 'NonZero', polygons: polys });
      }
    }
    for (const c of n.children) walk(c, st, T);
  };
  walk(svg, {}, IDENT);
  for (const u of unsupported) warnings.push(`unsupported SVG feature ignored: ${u}`);
  if (!raw.length) throw new Error('the SVG has no fillable shapes (check for text, images or gradients)');
  // bounds + scale
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const s of raw) for (const p of s.polygons) for (const q of p) { minX = Math.min(minX, q[0]); maxX = Math.max(maxX, q[0]); minY = Math.min(minY, q[1]); maxY = Math.max(maxY, q[1]); }
  const box = hasVB ? { x: vb[0], y: vb[1], w: vb[2], h: vb[3] } : { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
  const k = widthMm / box.w, cx = box.x + box.w / 2, cy = box.y + box.h / 2;
  if (!hasVB && tolOverride === null && 0.01 / k < 0.05) return parseSvg(text, { widthMm }, 0.01 / k);
  const shapes = raw.map(s => ({ color: s.color, fillRule: s.fillRule, polygons: s.polygons.map(p => p.map(q => [(q[0] - cx) * k, -(q[1] - cy) * k])) }));   // y up
  return { shapes, widthMm, heightMm: box.h * k, warnings, colors: [...new Set(shapes.map(s => s.color))] };
}

// ── text ───────────────────────────────────────────────────────────────────
/** Parse a font file (TTF/OTF/WOFF). Throws a friendly error for fonts the parser cannot read. */
export function loadFont(buffer) {
  try { return parseFont(buffer); }
  catch (e) { throw new Error(`this font cannot be read (${e.message.slice(0, 80)}). Fonts using advanced OpenType substitution tables are not supported; try a simpler font such as Open Sans or Montserrat.`); }
}

/** Text -> polygons in art space (mm, y up, centred). `sizeMm` is the em size; cap height is ≈ 0.7 of it. */
export function textShapes(font, text, { sizeMm = 8, align = 'center', lineHeight = 1.2 } = {}) {
  const lines = String(text).split('\n'), raw = [];
  const widths = lines.map(l => font.getAdvanceWidth(l, sizeMm));
  const maxW = Math.max(...widths, 1e-6);
  lines.forEach((line, li) => {
    if (!line.trim()) return;
    const ox = align === 'left' ? 0 : align === 'right' ? maxW - widths[li] : (maxW - widths[li]) / 2;
    const path = font.getPath(line, ox, li * sizeMm * lineHeight, sizeMm);
    let cur = null, prev = null;
    const push = () => { if (cur && cur.length > 2) raw.push(cur); cur = null; };
    for (const c of path.commands) {
      if (c.type === 'M') { push(); cur = [[c.x, c.y]]; prev = [c.x, c.y]; }
      else if (c.type === 'L') { cur.push([c.x, c.y]); prev = [c.x, c.y]; }
      else if (c.type === 'Q') { flattenQuad(prev, [c.x1, c.y1], [c.x, c.y], 0.02, cur); prev = [c.x, c.y]; }
      else if (c.type === 'C') { flattenCubic(prev, [c.x1, c.y1], [c.x2, c.y2], [c.x, c.y], 0.02, cur); prev = [c.x, c.y]; }
      else if (c.type === 'Z') push();
    }
    push();
  });
  if (!raw.length) throw new Error('the text has no visible glyphs in this font');
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of raw) for (const q of p) { minX = Math.min(minX, q[0]); maxX = Math.max(maxX, q[0]); minY = Math.min(minY, q[1]); maxY = Math.max(maxY, q[1]); }
  const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2;
  return { shapes: [{ color: null, fillRule: 'NonZero', polygons: raw.map(p => p.map(q => [q[0] - cx, -(q[1] - cy)])) }], widthMm: maxX - minX, heightMm: maxY - minY, warnings: [], colors: [] };
}

// ── placement on a face ────────────────────────────────────────────────────
/**
 * Map art-space polygons onto a face in PLATE coordinates.
 *  placement: { dx, dy (mm, outside view: x right, y up in the face's frame), rotDeg (CCW seen from outside), scale }
 * The face frame: origin at the face centroid, u = direction of the face's first edge, v = u rotated +90°. The plate is a
 * top view of the INSIDE, so art x maps to −u: that is the mirroring that makes text readable from outside.
 */
export function placeOnFace(polygons, face, placement = {}) {
  const { dx = 0, dy = 0, rotDeg = 0, scale = 1 } = placement;
  const o = face.outer, c = o.reduce((s, q) => [s[0] + q[0] / o.length, s[1] + q[1] / o.length], [0, 0]);
  const e = [o[1][0] - o[0][0], o[1][1] - o[0][1]], l = Math.hypot(...e), u = [e[0] / l, e[1] / l], v = [-u[1], u[0]];
  const r = (rotDeg * Math.PI) / 180, cr = Math.cos(r), sr = Math.sin(r);
  const map = p => { const X = scale * (cr * p[0] - sr * p[1]) + dx, Y = scale * (sr * p[0] + cr * p[1]) + dy; return [c[0] - X * u[0] + Y * v[0], c[1] - X * u[1] + Y * v[1]]; };
  return polygons.map(poly => poly.map(map));
}

/**
 * Turn parsed shapes into resolved layer groups: [{ slot, fillRule, polygons(plate coords) }].
 * @param shapes   from parseSvg / textShapes
 * @param spec     { placement, slotMap:{ '#hex': slot }, defaultSlot, palette }
 */
export function resolveLayer(shapes, face, spec) {
  const { placement, slotMap = {}, defaultSlot = 1, palette = [] } = spec;
  return shapes.map(s => ({
    slot: s.color === null ? defaultSlot : (slotMap[s.color] ?? (palette.length ? nearestSlot(s.color, palette) : defaultSlot)),
    fillRule: s.fillRule, polygons: placeOnFace(s.polygons, face, placement),
  }));
}
