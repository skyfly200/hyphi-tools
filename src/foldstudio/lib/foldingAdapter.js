// FoldStudio crease-pattern model → folding assembly.
//
// Faces that are only separated by non-fold edges (F / FOLD `J` / author-classified
// 'join') are merged into one rigid region. M and V edges become ideal hinges.
// `U` (unassigned) edges are NEVER guessed: unless the author classifies them they
// are reported as issues and compilation of the assembly will not be trusted.
//
// Classification map: { [creaseId or edgeId]: 'fold' | 'join' | 'boundary' | 'bendable' }

import { cloneModel, ensureIds, creaseIdOf } from './model.js';
import { computeFaces } from './faces.js';

const edgeKey = (a, b) => (a < b ? `${a},${b}` : `${b},${a}`);

class DSU {
  constructor(n) { this.p = Array.from({ length: n }, (_, i) => i); }
  find(i) { while (this.p[i] !== i) { this.p[i] = this.p[this.p[i]]; i = this.p[i]; } return i; }
  union(a, b) { this.p[this.find(a)] = this.find(b); }
}

/**
 * @param model  FoldStudio model (vertices, edges, optional faces)
 * @param opts   { sheetMm = 100, classification = {}, anchorRegionId?, thicknessMm?, hingeWidthMm? }
 * @returns { assembly, issues, groups, edgeToConnection, scale }
 */
export function foldStudioToAssembly(model, opts = {}) {
  const m = ensureIds(cloneModel(model));
  const { sheetMm = 100, classification = {} } = opts;
  const issues = [];
  const faces = (m.faces && m.faces.length ? m.faces : computeFaces(m)).map(f => f.slice());

  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const [x, y] of m.vertices) { minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y); }
  const span = Math.max(maxX - minX, maxY - minY) || 1;
  const scale = sheetMm / span;
  const toMm = i => [(m.vertices[i][0] - minX) * scale, (m.vertices[i][1] - minY) * scale];

  // edge -> incident faces
  const edgeFaces = new Map();
  faces.forEach((f, fi) => {
    for (let i = 0; i < f.length; i++) {
      const k = edgeKey(f[i], f[(i + 1) % f.length]);
      if (!edgeFaces.has(k)) edgeFaces.set(k, []);
      edgeFaces.get(k).push(fi);
    }
  });

  // classify each interior edge
  const kindOf = e => {
    const cls = classification[e.id] ?? classification[creaseIdOf(m, e)];
    if (cls) return cls;
    if (e.assignment === 'M' || e.assignment === 'V') return 'fold';
    if (e.assignment === 'F' || e.assignment === 'J') return 'join';
    if (e.assignment === 'B') return 'boundary';
    return 'unresolved';
  };
  const dsu = new DSU(faces.length);
  const hingeEdges = [];
  for (const e of m.edges) {
    const fs = edgeFaces.get(edgeKey(e.v1, e.v2)) || [];
    const kind = kindOf(e);
    if (kind === 'unresolved') {
      issues.push({ level: 'error', code: 'ambiguousEdge', edgeId: e.id, crease: creaseIdOf(m, e),
        message: `edge ${e.id} is unassigned (U); classify it as fold, join, bendable or boundary` });
      continue;
    }
    if (fs.length !== 2) continue;                    // boundary or degenerate
    if (kind === 'join') dsu.union(fs[0], fs[1]);
    else if (kind === 'fold') hingeEdges.push({ e, fs });
    else if (kind === 'bendable') issues.push({ level: 'warning', code: 'bendableUnsupported', edgeId: e.id, message: `edge ${e.id} classified bendable: needs the flexible-surface model (M6); treated as rigid join`, });
    if (kind === 'bendable') dsu.union(fs[0], fs[1]);
  }

  // regions
  const byRoot = new Map();
  faces.forEach((f, fi) => { const r = dsu.find(fi); if (!byRoot.has(r)) byRoot.set(r, []); byRoot.get(r).push(fi); });
  const regionOfFace = new Map();
  const regions = [];
  for (const members of byRoot.values()) {
    const keyOf = fi => faces[fi].map(v => m.vertexIds[v]).sort().join('-');
    const first = members.slice().sort((a, b) => (keyOf(a) < keyOf(b) ? -1 : 1))[0];
    const id = `r:${keyOf(first)}`;
    members.forEach(fi => regionOfFace.set(fi, id));
    regions.push({
      id,
      polygon: faces[first].map(toMm),
      polygons: members.map(fi => faces[fi].map(toMm)),
      thicknessMm: opts.thicknessMm,
      source: { faceCount: members.length },
    });
  }

  const area = poly => Math.abs(poly.reduce((s, p, i) => { const q = poly[(i + 1) % poly.length]; return s + p[0] * q[1] - q[0] * p[1]; }, 0)) / 2;
  const anchor = opts.anchorRegionId
    || regions.slice().sort((a, b) => b.polygons.reduce((s, p) => s + area(p), 0) - a.polygons.reduce((s, p) => s + area(p), 0))[0]?.id;

  const connections = [], edgeToConnection = {}, groups = {};
  for (const { e, fs } of hingeEdges) {
    const [fa, fb] = fs;
    const ra = regionOfFace.get(fa), rb = regionOfFace.get(fb);
    if (ra === rb) {
      issues.push({ level: 'warning', code: 'foldInsideRegion', edgeId: e.id, message: `fold edge ${e.id} lies inside one rigid region (its faces are joined elsewhere)` });
      continue;
    }
    const sideFace = faces[fb];
    const sc = sideFace.reduce((s, v) => { const p = toMm(v); return [s[0] + p[0], s[1] + p[1]]; }, [0, 0]).map(x => x / sideFace.length);
    const id = e.id;
    connections.push({
      id, type: 'idealHinge', a: ra, b: rb,
      edge: { p0: toMm(e.v1), p1: toMm(e.v2), sideB: sc },
      widthMm: opts.hingeWidthMm,
      source: { edgeId: e.id, crease: creaseIdOf(m, e), assignment: e.assignment },
      meta: Number.isFinite(e.foldAngle) ? { authoredFoldAngleDeg: e.foldAngle } : undefined,
    });
    edgeToConnection[e.id] = id;
    const crease = creaseIdOf(m, e);
    (groups[crease] ||= []).push(id);
  }

  return {
    assembly: { units: 'mm', anchor, regions, connections },
    issues, groups, edgeToConnection, scale,
  };
}
