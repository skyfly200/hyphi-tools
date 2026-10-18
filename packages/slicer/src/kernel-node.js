// manifold-3d loader for Node (server, workers, CLI). The browser app loads the same module with its own wasm URL.
let cached = null;
export async function loadKernelNode() {
  if (cached) return cached;
  cached = (async () => { const wasm = await (await import('manifold-3d')).default(); wasm.setup(); return wasm; })();
  try { return await cached; } catch (e) { cached = null; throw e; }
}
