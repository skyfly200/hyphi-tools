// Static exports: GLB (metres, per glTF), STL (millimetres), JSON, FOLD frames,
// and an STL reader for imported obstacles.
//
// Nothing here is labelled "print-ready": exportSTL reports manifold/boundary
// statistics and the caller decides. Intersections are not checked by this module.

import { meshStats, vertexNormals } from './mesh.js';
import { sub, cross, norm } from '../math.js';

const MM_TO_M = 0.001;

/**
 * Binary glTF. Geometry stays in ASSEMBLY coordinates (Z-up, origin preserved) scaled to
 * metres; a root node rotates Z-up → glTF's Y-up so viewers stand it upright and Blender's
 * importer round-trips back to the original orientation. One primitive per region/band,
 * named by its stable ID.
 */
export function exportGLB(mesh, { name = 'assembly', geometryHash = null, upAxis = 'Y' } = {}) {
  const nPos = mesh.positions.length / 3;
  const pos = new Float32Array(mesh.positions.length), nor = new Float32Array(mesh.positions.length), uv = new Float32Array(nPos * 2);
  const vn = vertexNormals(mesh);
  for (let i = 0; i < pos.length; i++) { pos[i] = mesh.positions[i] * MM_TO_M; nor[i] = vn[i]; }
  for (let i = 0; i < nPos; i++) { uv[2 * i] = mesh.uvs[2 * i]; uv[2 * i + 1] = 1 - mesh.uvs[2 * i + 1]; }  // glTF v origin is top-left
  const idx = Uint32Array.from(mesh.indices);

  // binary layout: positions | normals | uvs | indices (4-byte aligned by construction)
  const chunks = [pos, nor, uv, idx];
  const offsets = []; let off = 0;
  for (const c of chunks) { offsets.push(off); off += c.byteLength; }
  const bin = new Uint8Array(off);
  chunks.forEach((c, i) => bin.set(new Uint8Array(c.buffer, c.byteOffset, c.byteLength), offsets[i]));

  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < pos.length; i += 3) for (let k = 0; k < 3; k++) { min[k] = Math.min(min[k], pos[i + k]); max[k] = Math.max(max[k], pos[i + k]); }

  const bufferViews = [
    { buffer: 0, byteOffset: offsets[0], byteLength: pos.byteLength, target: 34962 },
    { buffer: 0, byteOffset: offsets[1], byteLength: nor.byteLength, target: 34962 },
    { buffer: 0, byteOffset: offsets[2], byteLength: uv.byteLength, target: 34962 },
    { buffer: 0, byteOffset: offsets[3], byteLength: idx.byteLength, target: 34963 },
  ];
  const accessors = [
    { bufferView: 0, componentType: 5126, count: nPos, type: 'VEC3', min, max },
    { bufferView: 1, componentType: 5126, count: nPos, type: 'VEC3' },
    { bufferView: 2, componentType: 5126, count: nPos, type: 'VEC2' },
  ];
  const primitives = [];
  for (const part of mesh.parts) {
    const ai = accessors.length;
    accessors.push({ bufferView: 3, byteOffset: part.triStart * 3 * 4, componentType: 5125, count: part.triCount * 3, type: 'SCALAR' });
    primitives.push({ attributes: { POSITION: 0, NORMAL: 1, TEXCOORD_0: 2 }, indices: ai, mode: 4, extras: { id: part.id, kind: part.kind } });
  }
  const json = {
    asset: { version: '2.0', generator: 'hyphi-tools folding engine' },
    scene: 0, scenes: [{ nodes: [0] }],
    nodes: [{ name, mesh: 0, ...(upAxis === 'Y' ? { rotation: [-Math.SQRT1_2, 0, 0, Math.SQRT1_2] } : {}) }],
    meshes: [{ name, primitives, extras: { sourceUnits: 'mm', exportUnits: 'm', geometryHash, parts: mesh.parts.map(p => ({ id: p.id, kind: p.kind })) } }],
    accessors, bufferViews, buffers: [{ byteLength: bin.byteLength }],
  };
  let js = new TextEncoder().encode(JSON.stringify(json));
  const jpad = (4 - (js.length % 4)) % 4;
  if (jpad) { const t = new Uint8Array(js.length + jpad); t.set(js); t.fill(0x20, js.length); js = t; }
  const total = 12 + 8 + js.length + 8 + bin.length;
  const out = new Uint8Array(total), dv = new DataView(out.buffer);
  dv.setUint32(0, 0x46546c67, true); dv.setUint32(4, 2, true); dv.setUint32(8, total, true);
  dv.setUint32(12, js.length, true); dv.setUint32(16, 0x4e4f534a, true); out.set(js, 20);
  const bo = 20 + js.length;
  dv.setUint32(bo, bin.length, true); dv.setUint32(bo + 4, 0x004e4942, true); out.set(bin, bo + 8);
  return out;
}

/** Binary STL in millimetres. Header records the unit convention. */
export function exportSTL(mesh, { name = 'assembly' } = {}) {
  const T = mesh.indices.length / 3;
  const buf = new ArrayBuffer(84 + T * 50), dv = new DataView(buf);
  const hdr = new TextEncoder().encode(`${name} units=mm (hyphi-tools folding engine)`.slice(0, 79));
  new Uint8Array(buf).set(hdr, 0);
  dv.setUint32(80, T, true);
  const P = mesh.positions; let o = 84;
  for (let t = 0; t < T; t++) {
    const [a, b, c] = [mesh.indices[3 * t], mesh.indices[3 * t + 1], mesh.indices[3 * t + 2]].map(i => [P[3 * i], P[3 * i + 1], P[3 * i + 2]]);
    const n = cross(sub(b, a), sub(c, a)); const l = norm(n) || 1;
    [n[0] / l, n[1] / l, n[2] / l].forEach((v, k) => dv.setFloat32(o + 4 * k, v, true));
    [a, b, c].forEach((p, i) => p.forEach((v, k) => dv.setFloat32(o + 12 + 12 * i + 4 * k, v, true)));
    o += 50;
  }
  return { bytes: new Uint8Array(buf), stats: meshStats(mesh), units: 'mm', printReady: false,
    note: 'printReady is never asserted: check manifoldness, self-intersection and minimum feature size separately' };
}

/** Parse binary or ASCII STL into [[[x,y,z]*3]...] (units are the caller's responsibility). */
export function parseSTL(data) {
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.byteLength >= 84) {
    const T = dv.getUint32(80, true);
    if (84 + T * 50 === bytes.byteLength) {
      const tris = [];
      for (let t = 0; t < T; t++) {
        const o = 84 + t * 50 + 12;
        tris.push([0, 1, 2].map(i => [0, 1, 2].map(k => dv.getFloat32(o + 12 * i + 4 * k, true))));
      }
      return tris;
    }
  }
  const text = new TextDecoder().decode(bytes);
  const v = [...text.matchAll(/vertex\s+(\S+)\s+(\S+)\s+(\S+)/g)].map(m => [+m[1], +m[2], +m[3]]);
  const tris = []; for (let i = 0; i + 2 < v.length; i += 3) tris.push([v[i], v[i + 1], v[i + 2]]);
  return tris;
}

export const exportJSON = obj => JSON.stringify(obj, null, 2);

/**
 * A FOLD "foldedForm" frame for a solved configuration: 3D vertices_coords for the authored
 * crease-pattern vertices. `vertexRegions` maps each model vertex index to a region id
 * (adapter output); vertices on a hinge take either side (identical for rigid hinges).
 * Returns { frame, unmapped } — unmapped vertices (e.g. inside band geometry) are listed
 * rather than invented.
 */
export function foldFrameFor(poses, model, vertexRegions, { title = 'folded', sheetMm = 100, units = 'mm' } = {}) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const [x, y] of model.vertices) { minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y); }
  const k = sheetMm / (Math.max(maxX - minX, maxY - minY) || 1);
  const coords = [], unmapped = [];
  model.vertices.forEach(([x, y], i) => {
    const region = vertexRegions[i];
    const P = region ? poses.get(region) : null;
    if (!P) { coords.push([ (x - minX) * k, (y - minY) * k, 0 ]); unmapped.push(i); return; }
    coords.push(applyPoseLocal(P, [(x - minX) * k, (y - minY) * k, 0]));
  });
  return { frame: { frame_title: title, frame_classes: ['foldedForm'], frame_attributes: ['3D'], frame_unit: units, vertices_coords: coords }, unmapped };
}

function applyPoseLocal(P, p) {
  const R = P.R;
  return [R[0] * p[0] + R[1] * p[1] + R[2] * p[2] + P.t[0], R[3] * p[0] + R[4] * p[1] + R[5] * p[2] + P.t[1], R[6] * p[0] + R[7] * p[1] + R[8] * p[2] + P.t[2]];
}
