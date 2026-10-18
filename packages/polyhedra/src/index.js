export { POLYHEDRA, listPolyhedra, buildEdges } from './polyhedra.js';
export { unfold, _utils } from './unfold.js';
export { convexHull, normalizeShortestEdge, ensureOutward } from './hull.js';
import * as S from './solids.js';
export { S as solids };
/** Named catalogue of ornament-ready solids beyond the Platonic five. build() -> { vertices, faces }. */
export const EXTRA_POLYHEDRA = {
  tprism:   { id: 'tprism', label: 'Triangular prism', build: () => S.prism(3) },
  pprism:   { id: 'pprism', label: 'Pentagonal prism', build: () => S.prism(5) },
  hprism:   { id: 'hprism', label: 'Hexagonal prism', build: () => S.prism(6) },
  squareAnti: { id: 'squareAnti', label: 'Square antiprism', build: () => S.antiprism(4) },
  pentaAnti:  { id: 'pentaAnti', label: 'Pentagonal antiprism', build: () => S.antiprism(5) },
  hexaAnti:   { id: 'hexaAnti', label: 'Hexagonal antiprism', build: () => S.antiprism(6) },
  spyramid: { id: 'spyramid', label: 'Square pyramid', build: () => S.pyramid(4) },
  ppyramid: { id: 'ppyramid', label: 'Pentagonal pyramid', build: () => S.pyramid(5) },
  sbipyramid: { id: 'sbipyramid', label: 'Square bipyramid', build: () => S.bipyramid(4) },
  pbipyramid: { id: 'pbipyramid', label: 'Pentagonal bipyramid', build: () => S.bipyramid(5) },
  cubocta:  { id: 'cubocta', label: 'Cuboctahedron', build: S.cuboctahedron },
  ttetra:   { id: 'ttetra', label: 'Truncated tetrahedron', build: S.truncatedTetrahedron },
  tcube:    { id: 'tcube', label: 'Truncated cube', build: S.truncatedCube },
  tocta:    { id: 'tocta', label: 'Truncated octahedron', build: S.truncatedOctahedron },
  rhombic:  { id: 'rhombic', label: 'Rhombic dodecahedron', build: S.rhombicDodecahedron },
  icosidodeca: { id: 'icosidodeca', label: 'Icosidodecahedron', build: S.icosidodecahedron },
};
