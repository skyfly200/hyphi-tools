import { useState, useRef, useEffect } from 'react';

// ── Parsers ────────────────────────────────────────────────────────────────
function parseFOLD(text) {
  try {
    const d = JSON.parse(text);
    const vc = d.vertices_coords;
    if (!vc?.length) return null;
    const ev = d.edges_vertices || [], ea = d.edges_assignment || ev.map(() => 'U');
    const xs = vc.map(v => v[0]), ys = vc.map(v => v[1]);
    const minX = Math.min(...xs), maxX = Math.max(...xs);
    const minY = Math.min(...ys), maxY = Math.max(...ys);
    const span = Math.max(maxX - minX, maxY - minY) || 1;
    const vertices = vc.map(([x, y]) => [(x - minX) / span, (y - minY) / span]);
    const edges = ev.map((e, i) => ({ v1: e[0], v2: e[1], type: (ea[i] || 'U').toUpperCase() }));
    return { vertices, edges };
  } catch { return null; }
}

function parseSVGPattern(text) {
  try {
    const doc = new DOMParser().parseFromString(text, 'image/svg+xml');
    if (doc.querySelector('parsererror')) return null;
    const svg = doc.querySelector('svg');
    const vb = svg?.getAttribute('viewBox')?.split(/[\s,]+/).map(Number);
    const W = vb?.[2] || parseFloat(svg?.getAttribute('width') || '1');
    const H = vb?.[3] || parseFloat(svg?.getAttribute('height') || '1');
    const span = Math.max(W, H) || 1;
    const vertices = [], edges = [], vMap = new Map();
    const addV = (x, y) => {
      const k = `${x.toFixed(2)},${y.toFixed(2)}`;
      if (!vMap.has(k)) { vMap.set(k, vertices.length); vertices.push([x / span, (H - y) / span]); }
      return vMap.get(k);
    };
    const getType = el => {
      const s = (el.getAttribute('stroke') || '').toLowerCase();
      const cls = (el.getAttribute('class') || '').toLowerCase();
      if (s.includes('red') || s.startsWith('#f') || /mountain|mtn/.test(cls)) return 'M';
      if (s.includes('blue') || /valley|vly/.test(cls)) return 'V';
      if (/boundary|border/.test(cls)) return 'B';
      return 'F';
    };
    for (const el of doc.querySelectorAll('line')) {
      const [x1, y1, x2, y2] = ['x1', 'y1', 'x2', 'y2'].map(a => parseFloat(el.getAttribute(a) || 0));
      edges.push({ v1: addV(x1, y1), v2: addV(x2, y2), type: getType(el) });
    }
    for (const el of doc.querySelectorAll('path')) {
      const m = (el.getAttribute('d') || '').match(/M[\s,]*([\d.e+-]+)[\s,]+([\d.e+-]+)[\s,]*L[\s,]*([\d.e+-]+)[\s,]+([\d.e+-]+)/i);
      if (m) edges.push({ v1: addV(+m[1], +m[2]), v2: addV(+m[3], +m[4]), type: getType(el) });
    }
    return vertices.length ? { vertices, edges } : null;
  } catch { return null; }
}

// ── Shared heightfield → binary STL ───────────────────────────────────────
function heightfieldToSTL(H, N, step) {
  const S = N * step;
  const nTris = N * N * 2 + N * 4 * 2 + 2;
  const buf = new ArrayBuffer(80 + 4 + nTris * 50);
  const dv = new DataView(buf);
  dv.setUint32(80, nTris, true);
  let p = 84;

  const wv = (x, y, z) => {
    dv.setFloat32(p, x, true); p += 4;
    dv.setFloat32(p, y, true); p += 4;
    dv.setFloat32(p, z, true); p += 4;
  };
  const wn = (ax, ay, az, bx, by, bz, cx, cy, cz) => {
    const ux = bx-ax, uy = by-ay, uz = bz-az, vx = cx-ax, vy = cy-ay, vz = cz-az;
    const nx = uy*vz - uz*vy, ny = uz*vx - ux*vz, nz = ux*vy - uy*vx;
    const l = Math.hypot(nx, ny, nz) || 1;
    dv.setFloat32(p, nx/l, true); p += 4;
    dv.setFloat32(p, ny/l, true); p += 4;
    dv.setFloat32(p, nz/l, true); p += 4;
  };
  const tri = (ax, ay, az, bx, by, bz, cx, cy, cz) => {
    wn(ax, ay, az, bx, by, bz, cx, cy, cz);
    wv(ax, ay, az); wv(bx, by, bz); wv(cx, cy, cz);
    dv.setUint16(p, 0, true); p += 2;
  };

  // Top surface — adaptive diagonal
  for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) {
    const h00 = H[r*(N+1)+c], h10 = H[r*(N+1)+c+1];
    const h01 = H[(r+1)*(N+1)+c], h11 = H[(r+1)*(N+1)+c+1];
    const x0 = c*step, x1 = (c+1)*step, y0 = r*step, y1 = (r+1)*step;
    if (Math.abs(h00-h11) <= Math.abs(h10-h01)) {
      tri(x0,y0,h00, x1,y0,h10, x1,y1,h11);
      tri(x0,y0,h00, x1,y1,h11, x0,y1,h01);
    } else {
      tri(x0,y0,h00, x1,y0,h10, x0,y1,h01);
      tri(x1,y0,h10, x1,y1,h11, x0,y1,h01);
    }
  }
  // Bottom (z=0)
  tri(0,0,0, S,S,0, S,0,0); tri(0,0,0, 0,S,0, S,S,0);
  // Front (y=0)
  for (let c = 0; c < N; c++) {
    const x0=c*step, x1=(c+1)*step, h0=H[c], h1=H[c+1];
    tri(x0,0,0, x1,0,0, x1,0,h1); tri(x0,0,0, x1,0,h1, x0,0,h0);
  }
  // Back (y=S)
  for (let c = 0; c < N; c++) {
    const x0=c*step, x1=(c+1)*step, h0=H[N*(N+1)+c], h1=H[N*(N+1)+c+1];
    tri(x0,S,0, x0,S,h0, x1,S,h1); tri(x0,S,0, x1,S,h1, x1,S,0);
  }
  // Left (x=0)
  for (let r = 0; r < N; r++) {
    const y0=r*step, y1=(r+1)*step, h0=H[r*(N+1)], h1=H[(r+1)*(N+1)];
    tri(0,y0,0, 0,y1,h1, 0,y1,0); tri(0,y0,0, 0,y0,h0, 0,y1,h1);
  }
  // Right (x=S)
  for (let r = 0; r < N; r++) {
    const y0=r*step, y1=(r+1)*step, h0=H[r*(N+1)+N], h1=H[(r+1)*(N+1)+N];
    tri(S,y0,0, S,y1,0, S,y1,h1); tri(S,y0,0, S,y1,h1, S,y0,h0);
  }

  return new Uint8Array(buf);
}

// ── Living-hinge model STL ─────────────────────────────────────────────────
// Panels are panelH thick; a strip of hingeW mm either side of every
// non-boundary fold line is thinned to hingeH so it can flex.
function buildModelSTL(pattern, { paperMM: S, panelH, hingeH, hingeW }) {
  const N = 300;
  const step = S / N;
  const H = new Float32Array((N+1)*(N+1)).fill(panelH);

  for (const e of pattern.edges) {
    if (e.type === 'B') continue;
    const [x1, y1] = [pattern.vertices[e.v1][0] * S, pattern.vertices[e.v1][1] * S];
    const [x2, y2] = [pattern.vertices[e.v2][0] * S, pattern.vertices[e.v2][1] * S];
    const len = Math.hypot(x2-x1, y2-y1);
    if (len < 1e-6) continue;
    const dx = (x2-x1)/len, dy = (y2-y1)/len;
    const half = hingeW / 2;
    const pad  = half + step;

    const c0 = Math.max(0, Math.floor((Math.min(x1,x2) - pad) / step));
    const c1 = Math.min(N, Math.ceil( (Math.max(x1,x2) + pad) / step));
    const r0 = Math.max(0, Math.floor((Math.min(y1,y2) - pad) / step));
    const r1 = Math.min(N, Math.ceil( (Math.max(y1,y2) + pad) / step));

    for (let row = r0; row <= r1; row++) {
      for (let col = c0; col <= c1; col++) {
        const px = col*step, py = row*step;
        const t = Math.max(0, Math.min(len, (px-x1)*dx + (py-y1)*dy));
        const dist = Math.hypot(px-x1 - t*dx, py-y1 - t*dy);
        if (dist < half) H[row*(N+1)+col] = hingeH;
      }
    }
  }

  return heightfieldToSTL(H, N, step);
}

// ── SVG design rasterizer ──────────────────────────────────────────────────
// Renders the SVG onto a canvas and returns a Uint8Array where 1 = filled
// (any non-white pixel). mirror=true flips horizontally for the back face.
function rasterizeSVG(svgText, N, mirror) {
  return new Promise((resolve, reject) => {
    const blob = new Blob([svgText], { type: 'image/svg+xml' });
    const url  = URL.createObjectURL(blob);
    const img  = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = N;
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, N, N);
      if (mirror) { ctx.translate(N, 0); ctx.scale(-1, 1); }
      ctx.drawImage(img, 0, 0, N, N);
      const px = ctx.getImageData(0, 0, N, N).data;
      URL.revokeObjectURL(url);
      const filled = new Uint8Array(N * N);
      for (let i = 0; i < N * N; i++)
        filled[i] = (px[i*4] < 240 || px[i*4+1] < 240 || px[i*4+2] < 240) ? 1 : 0;
      resolve(filled);
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('SVG render failed')); };
    img.src = url;
  });
}

// ── Design layer STL ───────────────────────────────────────────────────────
// Flat slab of designBaseH with SVG-filled areas raised by designEmbossH.
async function buildDesignSTL(svgText, { paperMM: S, designBaseH, designEmbossH, mirror = false }) {
  const N    = 300;
  const step = S / N;
  const filled = await rasterizeSVG(svgText, N, mirror);
  const H = new Float32Array((N+1)*(N+1));
  for (let row = 0; row <= N; row++) {
    for (let col = 0; col <= N; col++) {
      const r = Math.min(row, N-1), c = Math.min(col, N-1);
      H[row*(N+1)+col] = filled[r*N+c] ? designBaseH + designEmbossH : designBaseH;
    }
  }
  return heightfieldToSTL(H, N, step);
}

// ── ZIP builder ────────────────────────────────────────────────────────────
function makeZip(files) {
  const enc = new TextEncoder();
  const toU8 = d => typeof d === 'string' ? enc.encode(d) : d;
  const crcT = new Uint32Array(256);
  for (let i = 0; i < 256; i++) { let c = i; for (let j = 0; j < 8; j++) c = (c&1) ? 0xEDB88320^(c>>>1) : c>>>1; crcT[i] = c; }
  const crc32 = b => { let c = 0xFFFFFFFF; for (let i = 0; i < b.length; i++) c = crcT[(c^b[i])&0xFF]^(c>>>8); return (c^0xFFFFFFFF)>>>0; };
  const w16 = (v,b,o) => { b[o]=v&0xFF; b[o+1]=(v>>8)&0xFF; };
  const w32 = (v,b,o) => { b[o]=v&0xFF; b[o+1]=(v>>8)&0xFF; b[o+2]=(v>>16)&0xFF; b[o+3]=(v>>24)&0xFF; };
  const entries = files.map(({name,data}) => { const nU8=enc.encode(name), dU8=toU8(data); return {nU8,dU8,crc:crc32(dU8)}; });
  const cdOff = entries.reduce((s,e) => s+30+e.nU8.length+e.dU8.length, 0);
  const cdSz  = entries.reduce((s,e) => s+46+e.nU8.length, 0);
  const buf = new Uint8Array(cdOff+cdSz+22); let pos = 0;
  const lOff = [];
  for (const {nU8,dU8,crc} of entries) {
    lOff.push(pos); const sz = dU8.length;
    buf.set([0x50,0x4B,0x03,0x04], pos); pos+=4;
    w16(20,buf,pos); pos+=2; w16(0,buf,pos); pos+=2; w16(0,buf,pos); pos+=2;
    w16(0,buf,pos); pos+=2; w16(0,buf,pos); pos+=2;
    w32(crc,buf,pos); pos+=4; w32(sz,buf,pos); pos+=4; w32(sz,buf,pos); pos+=4;
    w16(nU8.length,buf,pos); pos+=2; w16(0,buf,pos); pos+=2;
    buf.set(nU8,pos); pos+=nU8.length; buf.set(dU8,pos); pos+=sz;
  }
  const cdStart = pos;
  for (let i = 0; i < entries.length; i++) {
    const {nU8,dU8,crc} = entries[i], sz = dU8.length;
    buf.set([0x50,0x4B,0x01,0x02], pos); pos+=4;
    w16(20,buf,pos); pos+=2; w16(20,buf,pos); pos+=2; w16(0,buf,pos); pos+=2; w16(0,buf,pos); pos+=2;
    w16(0,buf,pos); pos+=2; w16(0,buf,pos); pos+=2;
    w32(crc,buf,pos); pos+=4; w32(sz,buf,pos); pos+=4; w32(sz,buf,pos); pos+=4;
    w16(nU8.length,buf,pos); pos+=2; w16(0,buf,pos); pos+=2; w16(0,buf,pos); pos+=2;
    w16(0,buf,pos); pos+=2; w16(0,buf,pos); pos+=2; w32(0,buf,pos); pos+=4;
    w32(lOff[i],buf,pos); pos+=4; buf.set(nU8,pos); pos+=nU8.length;
  }
  buf.set([0x50,0x4B,0x05,0x06], pos); pos+=4;
  w16(0,buf,pos); pos+=2; w16(0,buf,pos); pos+=2;
  w16(entries.length,buf,pos); pos+=2; w16(entries.length,buf,pos); pos+=2;
  w32(cdSz,buf,pos); pos+=4; w32(cdStart,buf,pos); pos+=4;
  w16(0,buf,pos);
  return buf;
}

// ── Demo pattern (lily / preliminary base) ────────────────────────────────
const LILY_DEMO = (() => {
  const v = [[0,0],[1,0],[1,1],[0,1],[0.5,0],[1,0.5],[0.5,1],[0,0.5],[0.5,0.5]];
  const raw = [
    {v1:0,v2:4,type:'B'},{v1:4,v2:1,type:'B'},{v1:1,v2:5,type:'B'},{v1:5,v2:2,type:'B'},
    {v1:2,v2:6,type:'B'},{v1:6,v2:3,type:'B'},{v1:3,v2:7,type:'B'},{v1:7,v2:0,type:'B'},
    {v1:4,v2:8,type:'V'},{v1:8,v2:6,type:'V'},{v1:7,v2:8,type:'V'},{v1:8,v2:5,type:'V'},
    {v1:0,v2:8,type:'M'},{v1:8,v2:2,type:'M'},{v1:1,v2:8,type:'M'},{v1:8,v2:3,type:'M'},
    {v1:0,v2:4,type:'V'},{v1:0,v2:7,type:'V'},{v1:1,v2:4,type:'V'},{v1:1,v2:5,type:'V'},
    {v1:2,v2:5,type:'V'},{v1:2,v2:6,type:'V'},{v1:3,v2:6,type:'V'},{v1:3,v2:7,type:'V'},
  ];
  const edges = raw.filter((e,i,arr) => {
    const k = `${Math.min(e.v1,e.v2)}-${Math.max(e.v1,e.v2)}`;
    return arr.findIndex(x => `${Math.min(x.v1,x.v2)}-${Math.max(x.v1,x.v2)}` === k) === i;
  });
  return { vertices: v, edges };
})();

// ── Pattern preview ────────────────────────────────────────────────────────
const EDGE_COLOR = { M:'#ff5555', V:'#5599ff', B:'#444', F:'#888', U:'#666' };

function PatternPreview({ pattern }) {
  if (!pattern) return (
    <div style={{display:'flex',alignItems:'center',justifyContent:'center',width:'100%',aspectRatio:'1',background:'var(--s)',border:'1px solid var(--bd)',borderRadius:12,color:'var(--mu)',fontSize:'.8rem'}}>
      upload a .fold or .svg to preview
    </div>
  );
  const sz = 300;
  return (
    <svg viewBox={`0 0 ${sz} ${sz}`} width="100%" style={{display:'block',borderRadius:12,background:'var(--s)',border:'1px solid var(--bd)'}}>
      {pattern.edges.map((e, i) => {
        const [x1,y1] = pattern.vertices[e.v1], [x2,y2] = pattern.vertices[e.v2];
        return <line key={i}
          x1={x1*sz} y1={(1-y1)*sz} x2={x2*sz} y2={(1-y2)*sz}
          stroke={EDGE_COLOR[e.type] || '#888'}
          strokeWidth={e.type==='B' ? 1.5 : 1}
          strokeDasharray={e.type==='V' ? '4,3' : undefined}
        />;
      })}
    </svg>
  );
}

// ── Component ──────────────────────────────────────────────────────────────
export default function FoldForm() {
  const [pattern,     setPattern]     = useState(null);
  const [fileName,    setFileName]    = useState('');
  const [designSVG,   setDesignSVG]   = useState(null);
  const [designName,  setDesignName]  = useState('');
  const [paperMM,     setPaperMM]     = useState(150);
  const [panelH,      setPanelH]      = useState(2.0);
  const [hingeH,      setHingeH]      = useState(0.4);
  const [hingeW,      setHingeW]      = useState(1.5);

  // Keep hinge thickness <= paper thickness
  useEffect(() => { if (hingeH > panelH) setHingeH(panelH); }, [panelH]);
  const [designBaseH, setDesignBaseH] = useState(0.4);
  const [designEmb,   setDesignEmb]   = useState(0.4);
  const [msg,         setMsg]         = useState('');
  const [dragging,    setDragging]    = useState(false);
  const [dragDes,     setDragDes]     = useState(false);
  const fileRef   = useRef();
  const designRef = useRef();

  function loadPattern(file) {
    if (!file) return;
    setFileName(file.name);
    const r = new FileReader();
    r.onload = e => {
      const text = e.target.result;
      const parsed = file.name.endsWith('.svg')
        ? parseSVGPattern(text)
        : (parseFOLD(text) || parseSVGPattern(text));
      if (parsed) { setPattern(parsed); setMsg(''); }
      else setMsg('Could not parse file — check format');
    };
    r.readAsText(file);
  }

  function loadDesign(file) {
    if (!file) return;
    if (!file.name.endsWith('.svg')) { setMsg('Design must be an SVG file'); return; }
    setDesignName(file.name);
    const r = new FileReader();
    r.onload = e => { setDesignSVG(e.target.result); setMsg(''); };
    r.readAsText(file);
  }

  async function doExport() {
    if (!pattern) return;
    try {
      setMsg('Building model…'); await new Promise(r => setTimeout(r, 20));
      const modelStl = buildModelSTL(pattern, { paperMM, panelH, hingeH, hingeW });
      const files = [{ name: 'foldform_model.stl', data: modelStl }];

      if (designSVG) {
        setMsg('Rasterizing design…'); await new Promise(r => setTimeout(r, 20));
        const [frontStl, backStl] = await Promise.all([
          buildDesignSTL(designSVG, { paperMM, designBaseH, designEmbossH: designEmb, mirror: false }),
          buildDesignSTL(designSVG, { paperMM, designBaseH, designEmbossH: designEmb, mirror: true }),
        ]);
        files.push({ name: 'foldform_design_front.stl', data: frontStl });
        files.push({ name: 'foldform_design_back.stl',  data: backStl  });
      }

      const zip  = makeZip(files);
      const a    = document.createElement('a');
      a.href     = URL.createObjectURL(new Blob([zip], { type: 'application/zip' }));
      const base = fileName
        ? fileName.replace(/\.[^.]+$/, '').replace(/[^\w\-]/g, '_').replace(/_+/g, '_').replace(/^_|_$/g, '')
        : 'foldform';
      const ts   = new Date().toISOString().slice(0,16).replace('T','_').replace(':','');
      a.download = `${base}_${ts}.zip`;
      a.click();
      setMsg('✓ Downloaded!'); setTimeout(() => setMsg(''), 2500);
    } catch (err) {
      setMsg(`Error: ${err.message}`);
    }
  }

  const mc = pattern?.edges.filter(e => e.type==='M').length ?? 0;
  const vc = pattern?.edges.filter(e => e.type==='V').length ?? 0;
  const fc = pattern?.edges.filter(e => ['F','U'].includes(e.type)).length ?? 0;

  const css = `
    @import url('https://fonts.googleapis.com/css2?family=DM+Mono:wght@400;500&family=Syne:wght@400;600;700;800&display=swap');
    *{box-sizing:border-box;margin:0;padding:0}
    :root{--bg:#080810;--s:#0f0f1a;--s2:#161625;--bd:#1c1c2e;--t:#ddddf0;--mu:#55556a;--ac:#54d4a0;--acd:rgba(84,212,160,.1);--rr:10px}
    html,body{font-family:'Syne',sans-serif;background:var(--bg);color:var(--t);font-size:14px;height:100%;overflow:hidden}
    .shell{display:grid;grid-template-columns:1fr 360px;height:100vh;overflow:hidden}
    .L{padding:28px 24px;border-right:1px solid var(--bd);overflow-y:auto;display:flex;flex-direction:column;gap:18px;height:100vh}
    .R{padding:20px;display:flex;flex-direction:column;gap:14px;height:100vh;overflow-y:auto}
    .logo-mark{font-size:1.5rem;font-weight:800;letter-spacing:-.03em}.logo-mark em{color:var(--ac);font-style:normal}
    .sub{font-family:'DM Mono',monospace;font-size:.65rem;color:var(--mu);margin-top:3px}
    .sec{display:flex;flex-direction:column;gap:9px}
    .lbl{font-size:.62rem;font-weight:700;text-transform:uppercase;letter-spacing:.12em;color:var(--mu)}
    .rng{display:flex;align-items:center;gap:10px}
    .rng label{font-size:.76rem;color:var(--mu);min-width:110px}
    .rng input[type=range]{flex:1;accent-color:var(--ac);cursor:pointer}
    .rv{font-family:'DM Mono',monospace;font-size:.74rem;color:var(--ac);min-width:48px;text-align:right}
    .num-in{width:54px;background:transparent;border:none;border-bottom:1px solid var(--bd);color:var(--ac);font-family:'DM Mono',monospace;font-size:.74rem;text-align:right;padding:1px 2px;outline:none;-moz-appearance:textfield}
    .num-in::-webkit-inner-spin-button,.num-in::-webkit-outer-spin-button{-webkit-appearance:none}
    .num-in:focus{border-bottom-color:var(--ac)}
    .drop{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:8px;padding:24px 16px;border:1.5px dashed var(--bd);border-radius:12px;cursor:pointer;transition:.15s;text-align:center}
    .drop:hover,.drop.over{border-color:var(--ac);background:var(--acd)}
    .drop-icon{font-size:1.8rem;line-height:1}
    .drop-label{font-size:.82rem;color:var(--mu)}
    .drop-sub{font-family:'DM Mono',monospace;font-size:.62rem;color:var(--mu);opacity:.6}
    .file-name{font-family:'DM Mono',monospace;font-size:.72rem;color:var(--ac);padding:7px 10px;background:var(--s);border:1px solid var(--bd);border-radius:8px;word-break:break-all}
    .rm-btn{background:none;border:1px solid var(--bd);border-radius:7px;padding:4px 10px;color:var(--mu);font-family:inherit;font-size:.7rem;cursor:pointer;transition:.15s;align-self:flex-start}
    .rm-btn:hover{border-color:var(--ac);color:var(--t)}
    .stats{display:grid;grid-template-columns:repeat(3,1fr);gap:6px}
    .sbox{background:var(--s);border:1px solid var(--bd);border-radius:8px;padding:8px 10px;text-align:center}
    .sv{font-family:'DM Mono',monospace;font-size:.95rem;font-weight:600}
    .sl{font-size:.58rem;color:var(--mu);margin-top:2px}
    .eb{padding:11px 18px;background:var(--ac);color:#000;border:none;border-radius:9px;font-family:inherit;font-size:.88rem;font-weight:800;cursor:pointer;transition:.15s;width:100%}
    .eb:hover{background:#78e4b8;transform:translateY(-1px)}
    .eb:disabled{opacity:.4;cursor:default;transform:none}
    .stlmsg{font-family:'DM Mono',monospace;font-size:.75rem;color:var(--ac);text-align:center;min-height:18px}
    .notice{font-size:.7rem;color:var(--mu);line-height:1.5;padding:8px 10px;background:var(--s);border-left:2px solid var(--ac);border-radius:0 6px 6px 0}
    .legend{display:flex;flex-wrap:wrap;gap:8px}
    .leg{display:flex;align-items:center;gap:5px;font-size:.68rem;color:var(--mu)}
    .leg-line{width:20px;height:2px;border-radius:1px;flex-shrink:0}
    .demo-btn{background:none;border:1px solid var(--bd);border-radius:8px;padding:7px 12px;color:var(--mu);font-family:inherit;font-size:.72rem;cursor:pointer;transition:.15s;text-align:left}
    .demo-btn:hover{border-color:var(--ac)}
    ::-webkit-scrollbar{width:6px}::-webkit-scrollbar-track{background:transparent}::-webkit-scrollbar-thumb{background:var(--bd);border-radius:99px}
    *{scrollbar-width:thin;scrollbar-color:var(--bd) transparent}
    @media(max-width:760px){html,body{overflow:auto;height:auto}.shell{grid-template-columns:1fr;height:auto}.L,.R{height:auto}.R{order:-1}}
  `;

  return (
    <>
      <style>{css}</style>
      <div className="shell">
        <div className="L">
          <div>
            <div className="logo-mark">Fold<em>Form</em></div>
            <div className="sub">// living-hinge origami model generator</div>
          </div>

          {/* Crease pattern */}
          <div className="sec">
            <div className="lbl">Crease Pattern</div>
            <div
              className={`drop${dragging ? ' over' : ''}`}
              onClick={() => fileRef.current.click()}
              onDragOver={e => { e.preventDefault(); setDragging(true); }}
              onDragLeave={() => setDragging(false)}
              onDrop={e => { e.preventDefault(); setDragging(false); loadPattern(e.dataTransfer.files[0]); }}
            >
              <div className="drop-icon">&#x2B21;</div>
              <div className="drop-label">{fileName ? 'Replace file' : 'Drop or click to upload'}</div>
              <div className="drop-sub">.fold · .svg crease pattern</div>
            </div>
            {fileName && <div className="file-name">{fileName}</div>}
            <input ref={fileRef} type="file" accept=".fold,.svg" style={{display:'none'}}
              onChange={e => loadPattern(e.target.files[0])} />
            <button className="demo-btn"
              onClick={() => { setPattern(LILY_DEMO); setFileName('lily-demo'); setMsg(''); }}>
              &#x2B21; Load lily demo pattern
            </button>
          </div>

          {/* Dimensions */}
          <div className="sec">
            <div className="lbl">Dimensions</div>
            <div className="rng"><label>Paper size</label>
              <input type="range" min={30} max={300} step={5} value={paperMM} onChange={e => setPaperMM(+e.target.value)} />
              <input type="number" className="num-in" min={1} step={1} value={paperMM} onChange={e => setPaperMM(+e.target.value || 1)} /></div>
            <div className="rng"><label>Paper thickness</label>
              <input type="range" min={0.1} max={2} step={0.05} value={panelH} onChange={e => setPanelH(+e.target.value)} />
              <input type="number" className="num-in" min={0.05} step={0.05} value={panelH} onChange={e => setPanelH(+e.target.value || 0.1)} /></div>
            <div className="rng"><label>Hinge thickness</label>
              <input type="range" min={0.1} max={panelH} step={0.05} value={hingeH} onChange={e => setHingeH(+e.target.value)} />
              <input type="number" className="num-in" min={0.05} max={panelH} step={0.05} value={hingeH} onChange={e => setHingeH(Math.min(+e.target.value || 0.05, panelH))} /></div>
            <div className="rng"><label>Hinge width</label>
              <input type="range" min={0.3} max={6} step={0.1} value={hingeW} onChange={e => setHingeW(+e.target.value)} />
              <input type="number" className="num-in" min={0.1} step={0.1} value={hingeW} onChange={e => setHingeW(+e.target.value || 0.1)} /></div>
            <div className="notice">
              Print flat in PETG or flexible PLA. Hinge zones flex along every fold line; panels stay rigid.
            </div>
          </div>

          {/* Design layer */}
          <div className="sec">
            <div className="lbl">Design Layer <span style={{fontWeight:400,textTransform:'none',letterSpacing:0,fontSize:'.6rem'}}>(optional · multi-color)</span></div>
            <div
              className={`drop${dragDes ? ' over' : ''}`}
              onClick={() => designRef.current.click()}
              onDragOver={e => { e.preventDefault(); setDragDes(true); }}
              onDragLeave={() => setDragDes(false)}
              onDrop={e => { e.preventDefault(); setDragDes(false); loadDesign(e.dataTransfer.files[0]); }}
            >
              <div className="drop-icon">&#9670;</div>
              <div className="drop-label">{designName ? 'Replace design SVG' : 'Drop SVG artwork here'}</div>
              <div className="drop-sub">.svg — filled shapes become raised emboss</div>
            </div>
            {designName && <div className="file-name">{designName}</div>}
            {designSVG && (
              <button className="rm-btn" onClick={() => { setDesignSVG(null); setDesignName(''); }}>
                x Remove design
              </button>
            )}
            <input ref={designRef} type="file" accept=".svg" style={{display:'none'}}
              onChange={e => loadDesign(e.target.files[0])} />
            {designSVG && <>
              <div className="rng"><label>Base height</label>
                <input type="range" min={0.1} max={2} step={0.05} value={designBaseH} onChange={e => setDesignBaseH(+e.target.value)} />
                <input type="number" className="num-in" min={0.05} step={0.05} value={designBaseH} onChange={e => setDesignBaseH(+e.target.value || 0.05)} /></div>
              <div className="rng"><label>Emboss height</label>
                <input type="range" min={0.1} max={2} step={0.05} value={designEmb} onChange={e => setDesignEmb(+e.target.value)} />
                <input type="number" className="num-in" min={0.05} step={0.05} value={designEmb} onChange={e => setDesignEmb(+e.target.value || 0.05)} /></div>
            </>}
            <div className="notice">
              {designSVG
                ? 'Exports design_front.stl + design_back.stl (mirrored). Print in a second color; attach to each face of the folded model.'
                : 'Upload an SVG with filled artwork to generate design overlay STLs for multi-color printing.'}
            </div>
          </div>
        </div>

        <div className="R">
          <PatternPreview pattern={pattern} />

          <div className="legend">
            {[['M','Mountain','#ff5555',false],['V','Valley','#5599ff',true],['F','Flat','#888',false],['B','Boundary','#444',false]].map(([k,label,color,dash]) => (
              <div key={k} className="leg">
                <div className="leg-line" style={{background:color,backgroundImage:dash?`repeating-linear-gradient(90deg,${color} 0,${color} 4px,transparent 4px,transparent 7px)`:undefined}}/>
                {label}
              </div>
            ))}
          </div>

          {pattern && (
            <div className="stats">
              <div className="sbox"><div className="sv" style={{color:'#ff5555'}}>{mc}</div><div className="sl">Mountain</div></div>
              <div className="sbox"><div className="sv" style={{color:'#5599ff'}}>{vc}</div><div className="sl">Valley</div></div>
              <div className="sbox"><div className="sv" style={{color:'var(--ac)'}}>{fc}</div><div className="sl">Flat/Other</div></div>
            </div>
          )}

          <div className="sec" style={{marginTop:'auto'}}>
            <button className="eb" onClick={doExport} disabled={!pattern}>
              Export {designSVG ? '3 STLs' : 'Model STL'} (.zip)
            </button>
            <div className="stlmsg">{msg}</div>
            <div className="notice">
              {designSVG
                ? 'ZIP: foldform_model.stl + design_front.stl + design_back.stl (mirrored for back face).'
                : 'ZIP contains foldform_model.stl — print flat, then fold along the hinge lines.'}
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
