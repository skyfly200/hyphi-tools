import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parsePathData, parseSvg, normalizeColor, nearestSlot, strokePolygons, polygonArea, textShapes, loadFont, placeOnFace, resolveLayer } from '../../src/facetfold/lib/art.js';

const near = (a, b, e = 1e-6, m) => assert.ok(Math.abs(a - b) <= e, m || `${a} !≈ ${b}`);
const area = polys => polys.reduce((s, p) => s + Math.abs(polygonArea(p)), 0);
const bbox = polys => { const f = polys.flat(); return { w: Math.max(...f.map(p => p[0])) - Math.min(...f.map(p => p[0])), h: Math.max(...f.map(p => p[1])) - Math.min(...f.map(p => p[1])), cx: (Math.max(...f.map(p => p[0])) + Math.min(...f.map(p => p[0]))) / 2, cy: (Math.max(...f.map(p => p[1])) + Math.min(...f.map(p => p[1]))) / 2 }; };
const font = () => { const b = readFileSync(new URL('../../node_modules/@fontsource/open-sans/files/open-sans-latin-700-normal.woff', import.meta.url)); return loadFont(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength)); };

test('path data: all commands, relative/absolute, implicit repeats', () => {
  const s = parsePathData('M0 0 L10 0 10 10 H0 V0 Z');
  assert.equal(s.length, 1); assert.ok(s[0].closed); near(Math.abs(polygonArea(s[0].points)), 100, 1e-9);
  const r = parsePathData('m0 0 l10 0 0 10 h-10 z'); near(Math.abs(polygonArea(r[0].points)), 100, 1e-9);
  const q = parsePathData('M0 0 Q5 10 10 0 T20 0'); assert.ok(q[0].points.length > 6);
  const c = parsePathData('M0 0 C0 10 10 10 10 0 S20 -10 20 0'); assert.ok(c[0].points.at(-1)[0] === 20);
});

test('arcs: a circle built from two arcs has area πr², a half-circle half that, flags choose the right side', () => {
  const circ = parsePathData('M-5 0 A5 5 0 1 1 5 0 A5 5 0 1 1 -5 0 Z', 0.01)[0].points;
  near(Math.abs(polygonArea(circ)), Math.PI * 25, 0.25);
  const half = parsePathData('M-5 0 A5 5 0 0 1 5 0 Z', 0.01)[0].points; near(Math.abs(polygonArea(half)), (Math.PI * 25) / 2, 0.15);
  // SVG's y axis points DOWN: sweep=1 turns clockwise on screen, so from (−5,0) to (5,0) it bulges to negative y
  const sw1 = parsePathData('M-5 0 A5 5 0 0 1 5 0', 0.05)[0].points, sw0 = parsePathData('M-5 0 A5 5 0 0 0 5 0', 0.05)[0].points;
  assert.ok(Math.max(...sw1.map(p => p[1])) < 1e-9 && Math.min(...sw0.map(p => p[1])) > -1e-9, 'sweep flag picks the side');
  near(Math.min(...sw1.map(p => p[1])), -5, 0.01);
});

test('SVG: rect, circle, ellipse, polygon, rounded rect — areas and viewBox scaling to a requested width', () => {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 50"><rect x="0" y="0" width="100" height="50" fill="#ff0000"/></svg>`;
  const r = parseSvg(svg, { widthMm: 20 });
  near(r.widthMm, 20); near(r.heightMm, 10); near(area(r.shapes[0].polygons), 200, 1e-6);
  const b = bbox(r.shapes[0].polygons); near(b.cx, 0, 1e-9); near(b.cy, 0, 1e-9);                       // centred
  const c = parseSvg('<svg viewBox="0 0 20 20"><circle cx="10" cy="10" r="10" fill="blue"/></svg>', { widthMm: 10 });
  const cp = c.shapes[0].polygons[0];
  cp.forEach(q => near(Math.hypot(q[0], q[1]), 5, 1e-9));                                                 // every vertex is exactly on the circle
  const deficit = Math.PI * 25 - area(c.shapes[0].polygons); assert.ok(deficit > 0 && deficit < 0.15, `inscribed-polygon deficit ${deficit}`);   // chord error ≤ ~0.01 mm
  const chord = Math.max(...cp.map((q, i) => { const r = cp[(i + 1) % cp.length]; return 5 - Math.hypot((q[0] + r[0]) / 2, (q[1] + r[1]) / 2); })); assert.ok(chord < 0.011, `sagitta ${chord}`);
  const rr = parseSvg('<svg viewBox="0 0 20 20"><rect width="20" height="20" rx="5"/></svg>', { widthMm: 20 });
  near(area(rr.shapes[0].polygons), 400 - (4 - Math.PI) * 25, 0.2);                                       // corners rounded off
});

test('SVG: y is flipped to y-up, transforms compose, groups inherit style', () => {
  const svg = `<svg viewBox="0 0 10 10"><g fill="#00ff00" transform="translate(2 0)"><rect x="0" y="0" width="4" height="2" transform="scale(2)"/></g></svg>`;
  const s = parseSvg(svg, { widthMm: 10 }); const sh = s.shapes[0];
  assert.equal(sh.color, '#00ff00');
  const b = bbox(sh.polygons); near(b.w, 8); near(b.h, 4);                                                // 4×2 scaled by 2
  // top of the SVG (y small) must end up at the top (y large) after the flip
  near(Math.max(...sh.polygons.flat().map(p => p[1])), 5, 1e-9);
  const rot = parseSvg(`<svg viewBox="0 0 10 10"><rect x="0" y="0" width="4" height="2" transform="rotate(90)"/></svg>`, { widthMm: 10 });
  const rb = bbox(rot.shapes[0].polygons); near(rb.w, 2); near(rb.h, 4);
});

test('SVG: evenodd holes, colours are grouped in paint order, CSS classes and named/rgb colours resolve', () => {
  const svg = `<svg viewBox="0 0 20 20"><style>.a{fill:#112233}</style>
    <path class="a" fill-rule="evenodd" d="M0 0H20V20H0Z M5 5H15V15H5Z"/><circle cx="10" cy="10" r="3" style="fill:rgb(255,0,0)"/><rect width="2" height="2" fill="Teal"/></svg>`;
  const s = parseSvg(svg, { widthMm: 20 });
  assert.deepEqual(s.shapes.map(x => x.color), ['#112233', '#ff0000', '#008080']);
  assert.equal(s.shapes[0].fillRule, 'EvenOdd'); assert.equal(s.shapes[0].polygons.length, 2);
  assert.deepEqual(s.colors, ['#112233', '#ff0000', '#008080']);
});

test('SVG: strokes become geometry; unsupported features are reported, never silently dropped', () => {
  const st = parseSvg('<svg viewBox="0 0 10 10"><path d="M1 5 H9" stroke="#000" stroke-width="2" fill="none"/></svg>', { widthMm: 10 });
  assert.equal(st.shapes.length, 1); near(bbox(st.shapes[0].polygons).h, 2, 0.05);
  const w = parseSvg('<svg viewBox="0 0 10 10"><defs><linearGradient id="g"/></defs><text x="1" y="5">hi</text><rect width="4" height="4"/></svg>', { widthMm: 10 });
  assert.ok(w.warnings.some(x => /text/.test(x)) && w.warnings.some(x => /linearGradient/.test(x)));
  const g = parseSvg('<svg viewBox="0 0 10 10"><defs><linearGradient id="g"><stop offset="0" stop-color="#ff8800"/></linearGradient></defs><rect width="5" height="5" fill="url(#g)"/></svg>', { widthMm: 10 });
  assert.equal(g.shapes[0].color, '#ff8800'); assert.ok(g.warnings.some(x => /gradient/.test(x)));
  assert.throws(() => parseSvg('<svg viewBox="0 0 10 10"><text>only text</text></svg>'), /no fillable shapes/);
  assert.throws(() => parseSvg('<html></html>'), /not an SVG/);
});

test('colours: normalisation and nearest palette slot', () => {
  assert.equal(normalizeColor('#abc'), '#aabbcc'); assert.equal(normalizeColor('none'), null); assert.equal(normalizeColor('rgb(0,128,255)'), '#0080ff');
  const pal = [{ hex: '#f2f2f2' }, { hex: '#d9372a' }, { hex: '#2a62d9' }];
  assert.equal(nearestSlot('#ff0000', pal), 1); assert.equal(nearestSlot('#0000ff', pal), 2); assert.equal(nearestSlot('#ffffff', pal), 0);
});

test('stroke polygons are CCW quads and joins', () => {
  const p = strokePolygons([[0, 0], [10, 0]], 2, false);
  assert.ok(p.some(q => q.length === 4)); near(Math.abs(polygonArea(p[0])), 20, 1e-9);
});

test('text: real glyph outlines at the requested size, centred, multi-line grows taller', () => {
  const f = font();
  const one = textShapes(f, 'HI', { sizeMm: 10 }), b = bbox(one.shapes[0].polygons);
  assert.ok(b.h > 6 && b.h < 8, `cap height ${b.h}`);                                                      // ≈ 0.71 em
  near(b.cx, 0, 1e-6); near(b.cy, 0, 1e-6);
  const two = textShapes(f, 'HI\nHI', { sizeMm: 10 }); assert.ok(bbox(two.shapes[0].polygons).h > 1.9 * b.h);
  const o = textShapes(f, 'O', { sizeMm: 20 }); assert.equal(o.shapes[0].polygons.length, 2, 'O has an outer contour and a counter');
  assert.throws(() => textShapes(f, '   '), /no visible glyphs/);
});

test('an unreadable font gives a plain-language error', () => { assert.throws(() => loadFont(new ArrayBuffer(16)), /cannot be read/); });

test('placement: art is MIRRORED onto the plate so it reads correctly from outside', () => {
  const face = { outer: [[0, 0], [10, 0], [10, 10], [0, 10]] };
  const shape = [[[-1, -1], [3, -1], [3, 1], [-1, 1]]];                         // art: wider to the right, CCW
  const placed = placeOnFace(shape, face);
  assert.ok(polygonArea(placed[0]) < 0, 'orientation flips (a mirror)');       // CCW art → CW on the plate
  // viewed from outside (mirror the plate back) the right-hand end of the art is still on the right
  const c = [5, 5], back = placed[0].map(p => [-(p[0] - c[0]), p[1] - c[1]]);   // u = +x here, so outside-x = −(plate − c)·u
  assert.ok(Math.max(...back.map(p => p[0])) > 2.9 && Math.min(...back.map(p => p[0])) > -1.1 - 1e-9);
  near(Math.max(...back.map(p => p[0])), 3, 1e-9);
  // rotation is CCW as seen from outside; scale and offset apply in the outside frame
  const r = placeOnFace([[[1, 0]]], face, { rotDeg: 90 })[0][0]; near(r[0], 5, 1e-9); near(r[1], 6, 1e-9);        // art (1,0)→(0,1): outside-up → plate +v
  const o = placeOnFace([[[0, 0]]], face, { dx: 2, dy: 1, scale: 3 })[0][0]; near(o[0], 3, 1e-9); near(o[1], 6, 1e-9);
});

test('resolveLayer maps each SVG colour to a palette slot (override or nearest), text to the default slot', () => {
  const face = { outer: [[0, 0], [10, 0], [10, 10], [0, 10]] };
  const pal = [{ hex: '#f2f2f2' }, { hex: '#d9372a' }, { hex: '#2a62d9' }];
  const shapes = [{ color: '#ff0000', fillRule: 'NonZero', polygons: [[[0, 0], [1, 0], [1, 1]]] }, { color: '#0000ff', fillRule: 'NonZero', polygons: [[[0, 0], [1, 0], [1, 1]]] }];
  assert.deepEqual(resolveLayer(shapes, face, { palette: pal }).map(g => g.slot), [1, 2]);
  assert.deepEqual(resolveLayer(shapes, face, { palette: pal, slotMap: { '#ff0000': 0 } }).map(g => g.slot), [0, 2]);
  assert.equal(resolveLayer([{ color: null, fillRule: 'NonZero', polygons: [[[0, 0], [1, 0], [1, 1]]] }], face, { defaultSlot: 2 })[0].slot, 2);
});
