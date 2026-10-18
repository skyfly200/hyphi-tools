# @hyphi/polyhedra

Polyhedron definitions and net unfolding, shared by PolyForge (flexible PCBs) and FacetFold (printed ornaments).

```js
import { POLYHEDRA, listPolyhedra, buildEdges, unfold } from '@hyphi/polyhedra';

const { vertices, faces } = POLYHEDRA.cube.build();   // unit edge length, faces CCW seen from outside
const net = unfold({ vertices, faces }, 0);           // { faces: [{ polygon2D, vertIdx }], foldEdges: [{ faceA, faceB, a0, a1 }], ... }
```

`net.foldEdges` form a spanning tree over the faces; `unfold` also reports the edges that become seams.
Pure functions, no DOM, no framework.
