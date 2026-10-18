// Minimal store-only ZIP writer for the browser.
//
// No compression (method 0 = STORED), no encryption, no Zip64. Just
// enough to bundle a handful of text files into a single download
// without pulling in JSZip. Files are encoded as UTF-8.
//
// Format references:
//   PKZIP APPNOTE.TXT §4.3 (Local file header / Central directory).

function crc32Table() {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
}
const CRC_TABLE = crc32Table();

function crc32(bytes) {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function utf8(str) { return new TextEncoder().encode(str); }

function u16(view, offset, value) { view.setUint16(offset, value, true); }
function u32(view, offset, value) { view.setUint32(offset, value, true); }

// files: { [name]: string }
export function buildZip(files) {
  const entries = [];
  let bodyOffset = 0;
  const bodyChunks = [];

  for (const [name, text] of Object.entries(files)) {
    const nameBytes = utf8(name);
    const data = utf8(text);
    const crc = crc32(data);

    // Local file header (30 bytes + name)
    const lh = new ArrayBuffer(30 + nameBytes.length);
    const lv = new DataView(lh);
    u32(lv, 0, 0x04034b50);       // local file header signature
    u16(lv, 4, 20);                // version needed
    u16(lv, 6, 0);                 // flags
    u16(lv, 8, 0);                 // method = stored
    u16(lv, 10, 0);                // mod time
    u16(lv, 12, 0x21);             // mod date (1 Jan 1980 + 1)
    u32(lv, 14, crc);              // crc32
    u32(lv, 18, data.length);      // compressed size
    u32(lv, 22, data.length);      // uncompressed size
    u16(lv, 26, nameBytes.length); // filename length
    u16(lv, 28, 0);                // extra field length
    new Uint8Array(lh, 30).set(nameBytes);

    bodyChunks.push(new Uint8Array(lh));
    bodyChunks.push(data);

    entries.push({
      name: nameBytes, crc, size: data.length, offset: bodyOffset,
    });
    bodyOffset += lh.byteLength + data.length;
  }

  // Central directory
  const cdChunks = [];
  let cdSize = 0;
  for (const e of entries) {
    const cd = new ArrayBuffer(46 + e.name.length);
    const cv = new DataView(cd);
    u32(cv, 0, 0x02014b50);       // central dir header signature
    u16(cv, 4, 20);                // version made by
    u16(cv, 6, 20);                // version needed
    u16(cv, 8, 0);                 // flags
    u16(cv, 10, 0);                // method
    u16(cv, 12, 0);                // mod time
    u16(cv, 14, 0x21);             // mod date
    u32(cv, 16, e.crc);            // crc32
    u32(cv, 20, e.size);           // compressed
    u32(cv, 24, e.size);           // uncompressed
    u16(cv, 28, e.name.length);    // filename length
    u16(cv, 30, 0);                // extra length
    u16(cv, 32, 0);                // comment length
    u16(cv, 34, 0);                // disk number
    u16(cv, 36, 0);                // internal attrs
    u32(cv, 38, 0);                // external attrs
    u32(cv, 42, e.offset);         // local header offset
    new Uint8Array(cd, 46).set(e.name);

    cdChunks.push(new Uint8Array(cd));
    cdSize += cd.byteLength;
  }

  // End of central directory record
  const eocd = new ArrayBuffer(22);
  const ev = new DataView(eocd);
  u32(ev, 0, 0x06054b50);          // end-of-central-dir signature
  u16(ev, 4, 0);                    // disk number
  u16(ev, 6, 0);                    // start disk
  u16(ev, 8, entries.length);       // entries on this disk
  u16(ev, 10, entries.length);      // total entries
  u32(ev, 12, cdSize);              // central dir size
  u32(ev, 16, bodyOffset);          // central dir offset
  u16(ev, 20, 0);                   // comment length

  const total = bodyOffset + cdSize + eocd.byteLength;
  const out = new Uint8Array(total);
  let off = 0;
  for (const c of bodyChunks) { out.set(c, off); off += c.length; }
  for (const c of cdChunks)   { out.set(c, off); off += c.length; }
  out.set(new Uint8Array(eocd), off);
  return out;
}
