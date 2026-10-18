// Additional convex solids built from vertex formulas via the convex hull. Every face is planar
// and convex; edge lengths are normalised so the SHORTEST edge is 1.

import { convexHull, normalizeShortestEdge } from './hull.js';

const perms3 = (a, b, c) => { const out = new Set(); const base = [a, b, c];
  const p = [[0,1,2],[0,2,1],[1,0,2],[1,2,0],[2,0,1],[2,1,0]];
  for (const q of p) for (const sa of [1,-1]) for (const sb of [1,-1]) for (const sc of [1,-1]) out.add(JSON.stringify([base[q[0]]*sa, base[q[1]]*sb, base[q[2]]*sc].map(x => x === 0 ? 0 : x)));
  return [...out].map(s => JSON.parse(s)); };
const ring = (n, r, z, phase = 0) => Array.from({ length: n }, (_, i) => [r * Math.cos(phase + (2 * Math.PI * i) / n), r * Math.sin(phase + (2 * Math.PI * i) / n), z]);
const build = pts => normalizeShortestEdge(convexHull(pts));

export const prism = n => { const R = 1 / (2 * Math.sin(Math.PI / n)); return build([...ring(n, R, -0.5), ...ring(n, R, 0.5)]); };
export const antiprism = n => { const R = 1 / (2 * Math.sin(Math.PI / n)); const h = Math.sqrt(1 - 1 / (4 * Math.cos(Math.PI / (2 * n)) ** 2)); return build([...ring(n, R, -h / 2), ...ring(n, R, h / 2, Math.PI / n)]); };
export const pyramid = n => { const R = 1 / (2 * Math.sin(Math.PI / n)); const h = Math.sqrt(Math.max(1 - R * R, 0.01)); return build([...ring(n, R, 0), [0, 0, h]]); };
export const bipyramid = n => { const R = 1 / (2 * Math.sin(Math.PI / n)); const h = Math.sqrt(Math.max(1 - R * R, 0.01)); return build([...ring(n, R, 0), [0, 0, h], [0, 0, -h]]); };
export const cuboctahedron = () => build(perms3(1, 1, 0));
export const truncatedTetrahedron = () => build([[3,1,1],[1,3,1],[1,1,3],[-3,-1,1],[-1,-3,1],[-1,-1,3],[-3,1,-1],[-1,3,-1],[-1,1,-3],[3,-1,-1],[1,-3,-1],[1,-1,-3]]);
export const truncatedCube = () => { const t = Math.SQRT2 - 1; return build(perms3(t, 1, 1).filter(p => p.filter(x => Math.abs(Math.abs(x) - t) < 1e-9).length === 1)); };
export const truncatedOctahedron = () => build(perms3(0, 1, 2));
export const rhombicDodecahedron = () => build([...[[1,1,1],[1,1,-1],[1,-1,1],[1,-1,-1],[-1,1,1],[-1,1,-1],[-1,-1,1],[-1,-1,-1]], [2,0,0],[-2,0,0],[0,2,0],[0,-2,0],[0,0,2],[0,0,-2]]);
const PHI = (1 + Math.sqrt(5)) / 2;
export const icosidodecahedron = () => { const pts = [[0,0,PHI],[0,0,-PHI],[0,PHI,0],[0,-PHI,0],[PHI,0,0],[-PHI,0,0]];
  const even = [[0.5,PHI/2,PHI*PHI/2],[0.5,PHI/2,-PHI*PHI/2],[0.5,-PHI/2,PHI*PHI/2],[0.5,-PHI/2,-PHI*PHI/2],[-0.5,PHI/2,PHI*PHI/2],[-0.5,PHI/2,-PHI*PHI/2],[-0.5,-PHI/2,PHI*PHI/2],[-0.5,-PHI/2,-PHI*PHI/2]];
  for (const [a,b,c] of even) pts.push([a,b,c],[b,c,a],[c,a,b]);
  return build(pts); };
