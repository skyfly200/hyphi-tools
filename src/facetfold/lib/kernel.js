// Geometry kernel: manifold-3d (WASM). Boolean results are guaranteed manifold, which is what a print
// tool needs. Loaded once and shared. In the browser pass the wasm URL (Vite: `import url from
// 'manifold-3d/manifold.wasm?url'`); in Node it is found automatically.

let cached = null;

export async function loadKernel({ wasmUrl } = {}) {
  if (cached) return cached;
  cached = (async () => {
    const Module = (await import('manifold-3d')).default;
    const wasm = await Module(wasmUrl ? { locateFile: () => wasmUrl } : {});
    wasm.setup();
    return wasm;
  })();
  try { return await cached; } catch (e) { cached = null; throw e; }
}

/** Plain mesh of a Manifold: { positions: Float64Array(3n), indices: Uint32Array(3t) } in mm. */
export function meshOf(m) {
  const g = m.getMesh();
  const n = g.numVert, np = g.numProp, positions = new Float64Array(n * 3);
  for (let i = 0; i < n; i++) { positions[3 * i] = g.vertProperties[i * np]; positions[3 * i + 1] = g.vertProperties[i * np + 1]; positions[3 * i + 2] = g.vertProperties[i * np + 2]; }
  return { positions, indices: Uint32Array.from(g.triVerts), parts: [] };
}
