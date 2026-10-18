// Minimal STL reader (binary or ASCII) -> { positions, indices }; vertices are not merged (use meshToManifold).
export function parseSTL(buf) {
  const u8 = buf instanceof Uint8Array ? buf : new Uint8Array(buf), dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  const n = u8.byteLength >= 84 ? dv.getUint32(80, true) : 0;
  const positions = [];
  if (84 + n * 50 === u8.byteLength && n > 0) {
    for (let t = 0; t < n; t++) for (let v = 0; v < 3; v++) for (let k = 0; k < 3; k++) positions.push(dv.getFloat32(84 + t * 50 + 12 + v * 12 + k * 4, true));
  } else {
    const re = /vertex\s+(\S+)\s+(\S+)\s+(\S+)/g, txt = new TextDecoder().decode(u8); let m;
    while ((m = re.exec(txt))) positions.push(+m[1], +m[2], +m[3]);
  }
  if (!positions.length || (positions.length / 3) % 3) throw new Error('not a readable STL');
  return { positions, indices: Array.from({ length: positions.length / 3 }, (_, i) => i) };
}
