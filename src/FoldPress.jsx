import { useState, useRef } from 'react';

// ── STL helpers ────────────────────────────────────────────────────────────
const vf = (x,y,z) => `${(+x).toFixed(4)} ${(+y).toFixed(4)} ${(+z).toFixed(4)}`;
const sub3  = ([ax,ay,az],[bx,by,bz]) => [ax-bx,ay-by,az-bz];
const cross3 = ([ax,ay,az],[bx,by,bz]) => [ay*bz-az*by, az*bx-ax*bz, ax*by-ay*bx];
const norm3  = v => { const l=Math.hypot(...v)||1; return v.map(x=>x/l); };
const stlTri = (a,b,c) => {
  const n=norm3(cross3(sub3(b,a),sub3(c,a)));
  return `facet normal ${vf(...n)}\nouter loop\nvertex ${vf(...a)}\nvertex ${vf(...b)}\nvertex ${vf(...c)}\nendloop\nendfacet\n`;
};

function stlBox(x,y,z,w,d,h) {
  const [x2,y2,z2]=[x+w,y+d,z+h];
  let t='';
  t+=stlTri([x,y,z2],[x2,y,z2],[x2,y2,z2]); t+=stlTri([x,y,z2],[x2,y2,z2],[x,y2,z2]);
  t+=stlTri([x,y,z],[x2,y2,z],[x2,y,z]);     t+=stlTri([x,y,z],[x,y2,z],[x2,y2,z]);
  t+=stlTri([x,y,z],[x2,y,z],[x2,y,z2]);     t+=stlTri([x,y,z],[x2,y,z2],[x,y,z2]);
  t+=stlTri([x,y2,z],[x,y2,z2],[x2,y2,z2]);  t+=stlTri([x,y2,z],[x2,y2,z2],[x2,y2,z]);
  t+=stlTri([x,y,z],[x,y,z2],[x,y2,z2]);     t+=stlTri([x,y,z],[x,y2,z2],[x,y2,z]);
  t+=stlTri([x2,y,z],[x2,y2,z],[x2,y2,z2]);  t+=stlTri([x2,y,z],[x2,y2,z2],[x2,y,z2]);
  return t;
}

function ridgePrism(x1,y1,x2,y2,z,h,w,shrink=0) {
  const len=Math.hypot(x2-x1,y2-y1);
  if(len<1e-6) return '';
  const dx=(x2-x1)/len, dy=(y2-y1)/len;
  const nx=-dy, ny=dx;
  const ax=x1+dx*shrink, ay=y1+dy*shrink;
  const bx=x2-dx*shrink, by=y2-dy*shrink;
  if(Math.hypot(bx-ax,by-ay)<1e-6) return '';
  const LS=[ax-nx*w, ay-ny*w, z], RS=[ax+nx*w, ay+ny*w, z], PS=[ax, ay, z+h];
  const LE=[bx-nx*w, by-ny*w, z], RE=[bx+nx*w, by+ny*w, z], PE=[bx, by, z+h];
  let t='';
  t+=stlTri(LS,PS,RS); t+=stlTri(LE,RE,PE);
  t+=stlTri(LS,LE,PE); t+=stlTri(LS,PE,PS);
  t+=stlTri(RS,PS,PE); t+=stlTri(RS,PE,RE);
  return t;
}

// ── Parsers ────────────────────────────────────────────────────────────────
function parseFOLD(text) {
  try {
    const d=JSON.parse(text);
    const vc=d.vertices_coords;
    if(!vc?.length) return null;
    const ev=d.edges_vertices||[], ea=d.edges_assignment||ev.map(()=>'U');
    const xs=vc.map(v=>v[0]), ys=vc.map(v=>v[1]);
    const minX=Math.min(...xs), maxX=Math.max(...xs);
    const minY=Math.min(...ys), maxY=Math.max(...ys);
    const span=Math.max(maxX-minX,maxY-minY)||1;
    const vertices=vc.map(([x,y])=>[(x-minX)/span,(y-minY)/span]);
    const edges=ev.map((e,i)=>({v1:e[0],v2:e[1],type:(ea[i]||'U').toUpperCase()}));
    return {vertices,edges};
  } catch { return null; }
}

function parseSVG(text) {
  try {
    const doc=new DOMParser().parseFromString(text,'image/svg+xml');
    if(doc.querySelector('parsererror')) return null;
    const svg=doc.querySelector('svg');
    const vb=svg?.getAttribute('viewBox')?.split(/[\s,]+/).map(Number);
    const W=vb?.[2]||parseFloat(svg?.getAttribute('width')||'1');
    const H=vb?.[3]||parseFloat(svg?.getAttribute('height')||'1');
    const span=Math.max(W,H)||1;
    const vertices=[],edges=[],vMap=new Map();
    const addV=(x,y)=>{
      const k=`${x.toFixed(2)},${y.toFixed(2)}`;
      if(!vMap.has(k)){vMap.set(k,vertices.length);vertices.push([x/span,(H-y)/span]);}
      return vMap.get(k);
    };
    const getType=el=>{
      const s=(el.getAttribute('stroke')||'').toLowerCase();
      const cls=(el.getAttribute('class')||'').toLowerCase();
      if(s.includes('red')||s.startsWith('#f')||/mountain|mtn/.test(cls)) return 'M';
      if(s.includes('blue')||/valley|vly/.test(cls)) return 'V';
      if(/boundary|border/.test(cls)) return 'B';
      return 'F';
    };
    for(const el of doc.querySelectorAll('line')){
      const [x1,y1,x2,y2]=['x1','y1','x2','y2'].map(a=>parseFloat(el.getAttribute(a)||0));
      edges.push({v1:addV(x1,y1),v2:addV(x2,y2),type:getType(el)});
    }
    for(const el of doc.querySelectorAll('path')){
      const m=(el.getAttribute('d')||'').match(/M[\s,]*([\d.e+-]+)[\s,]+([\d.e+-]+)[\s,]*L[\s,]*([\d.e+-]+)[\s,]+([\d.e+-]+)/i);
      if(m) edges.push({v1:addV(+m[1],+m[2]),v2:addV(+m[3],+m[4]),type:getType(el)});
    }
    return vertices.length?{vertices,edges}:null;
  } catch { return null; }
}

// ── Plate generator (heightfield + adaptive triangulation) ─────────────────
// Each vertex in an N×N grid is assigned a height by accumulating a tent
// profile (peak at the fold line, linear falloff to zero at ±ridgeW) from
// every fold edge. Ridges raise the surface; grooves lower it. The grid is
// triangulated with an adaptive diagonal per quad so that fold lines running
// along either diagonal never produce the saw-tooth spikes caused by a fixed
// split direction.
//
// Top plate:  M → ridge, V → groove, F/U → ridge on both
// Bottom plate: V → ridge, M → groove, F/U → ridge on both
// Clearance gaps only where an M edge and V edge share a vertex.

function buildPlate(pattern, {paperMM:S, baseH, ridgeH, ridgeW, clearance, isTop}) {
  const N    = 300;
  const step = S / N;
  const H    = new Float32Array((N+1)*(N+1)).fill(baseH);

  // Find M/V junction vertices so clearance is only applied there
  const mvVerts = new Set();
  if (clearance > 0) {
    const vt = new Map();
    for (const e of pattern.edges) {
      if (e.type !== 'M' && e.type !== 'V') continue;
      for (const vi of [e.v1, e.v2]) {
        if (!vt.has(vi)) vt.set(vi, new Set());
        vt.get(vi).add(e.type);
      }
    }
    for (const [vi, types] of vt)
      if (types.has('M') && types.has('V')) mvVerts.add(vi);
  }

  for (const e of pattern.edges) {
    if (e.type === 'B') continue;
    const isRidge = e.type === 'M' ? isTop : e.type === 'V' ? !isTop : true;

    const [x1,y1] = [pattern.vertices[e.v1][0]*S, pattern.vertices[e.v1][1]*S];
    const [x2,y2] = [pattern.vertices[e.v2][0]*S, pattern.vertices[e.v2][1]*S];
    const len = Math.hypot(x2-x1, y2-y1);
    if (len < 1e-6) continue;
    const dx=(x2-x1)/len, dy=(y2-y1)/len;

    const shrink1 = mvVerts.has(e.v1) ? clearance : 0;
    const shrink2 = mvVerts.has(e.v2) ? clearance : 0;
    const ax=x1+dx*shrink1, ay=y1+dy*shrink1;
    const bx=x2-dx*shrink2, by=y2-dy*shrink2;
    const elen = Math.hypot(bx-ax, by-ay);
    if (elen < 1e-6) continue;
    const ex=(bx-ax)/elen, ey=(by-ay)/elen;

    const pad = ridgeW + step;
    const c0=Math.max(0, Math.floor((Math.min(ax,bx)-pad)/step));
    const c1=Math.min(N, Math.ceil( (Math.max(ax,bx)+pad)/step));
    const r0=Math.max(0, Math.floor((Math.min(ay,by)-pad)/step));
    const r1=Math.min(N, Math.ceil( (Math.max(ay,by)+pad)/step));

    for (let row=r0; row<=r1; row++) {
      for (let col=c0; col<=c1; col++) {
        const px=col*step, py=row*step;
        const t    = Math.max(0, Math.min(elen, (px-ax)*ex+(py-ay)*ey));
        const dist = Math.hypot(px-ax-t*ex, py-ay-t*ey);
        if (dist >= ridgeW) continue;
        const frac = 1 - dist/ridgeW; // tent: peak at fold, zero at ±ridgeW
        const idx  = row*(N+1)+col;
        if (isRidge) H[idx] = Math.max(H[idx], baseH + ridgeH*frac);
        else         H[idx] = Math.min(H[idx], baseH - ridgeH*frac);
      }
    }
  }

  // Pre-allocate STL buffer — triangle count is exact for a heightfield mesh
  const nTris = N*N*2 + N*4*2 + 2;
  const buf   = new ArrayBuffer(80 + 4 + nTris*50);
  const dv    = new DataView(buf);
  dv.setUint32(80, nTris, true);
  let p = 84;

  const wv = (x,y,z) => { dv.setFloat32(p,x,true);p+=4; dv.setFloat32(p,y,true);p+=4; dv.setFloat32(p,z,true);p+=4; };
  const wn = (ax,ay,az,bx,by,bz,cx,cy,cz) => {
    const ux=bx-ax,uy=by-ay,uz=bz-az, vx=cx-ax,vy=cy-ay,vz=cz-az;
    const nx=uy*vz-uz*vy, ny=uz*vx-ux*vz, nz=ux*vy-uy*vx;
    const l=Math.hypot(nx,ny,nz)||1;
    dv.setFloat32(p,nx/l,true);p+=4; dv.setFloat32(p,ny/l,true);p+=4; dv.setFloat32(p,nz/l,true);p+=4;
  };
  const tri = (ax,ay,az,bx,by,bz,cx,cy,cz) => {
    wn(ax,ay,az,bx,by,bz,cx,cy,cz);
    wv(ax,ay,az); wv(bx,by,bz); wv(cx,cy,cz);
    dv.setUint16(p,0,true); p+=2;
  };

  // Top surface — adaptive diagonal prevents anti-diagonal fold spikes
  for (let r=0; r<N; r++) for (let c=0; c<N; c++) {
    const h00=H[r*(N+1)+c], h10=H[r*(N+1)+c+1], h01=H[(r+1)*(N+1)+c], h11=H[(r+1)*(N+1)+c+1];
    const x0=c*step, x1=(c+1)*step, y0=r*step, y1=(r+1)*step;
    if (Math.abs(h00-h11) <= Math.abs(h10-h01)) {
      tri(x0,y0,h00, x1,y0,h10, x1,y1,h11);
      tri(x0,y0,h00, x1,y1,h11, x0,y1,h01);
    } else {
      tri(x0,y0,h00, x1,y0,h10, x0,y1,h01);
      tri(x1,y0,h10, x1,y1,h11, x0,y1,h01);
    }
  }
  // Bottom (z=0)
  tri(0,0,0, S,S,0, S,0,0);
  tri(0,0,0, 0,S,0, S,S,0);
  // Front (y=0)
  for (let c=0; c<N; c++) {
    const x0=c*step, x1=(c+1)*step, h0=H[c], h1=H[c+1];
    tri(x0,0,0, x1,0,0, x1,0,h1); tri(x0,0,0, x1,0,h1, x0,0,h0);
  }
  // Back (y=S)
  for (let c=0; c<N; c++) {
    const x0=c*step, x1=(c+1)*step, h0=H[N*(N+1)+c], h1=H[N*(N+1)+c+1];
    tri(x0,S,0, x0,S,h0, x1,S,h1); tri(x0,S,0, x1,S,h1, x1,S,0);
  }
  // Left (x=0)
  for (let r=0; r<N; r++) {
    const y0=r*step, y1=(r+1)*step, h0=H[r*(N+1)], h1=H[(r+1)*(N+1)];
    tri(0,y0,0, 0,y1,h1, 0,y1,0); tri(0,y0,0, 0,y0,h0, 0,y1,h1);
  }
  // Right (x=S)
  for (let r=0; r<N; r++) {
    const y0=r*step, y1=(r+1)*step, h0=H[r*(N+1)+N], h1=H[(r+1)*(N+1)+N];
    tri(S,y0,0, S,y1,0, S,y1,h1); tri(S,y0,0, S,y1,h1, S,y0,h0);
  }

  return new Uint8Array(buf);
}

function generatePlates(pattern, opts) {
  return {
    top: buildPlate(pattern, {...opts, isTop:true}),
    bot: buildPlate(pattern, {...opts, isTop:false}),
  };
}

// ── ZIP builder ────────────────────────────────────────────────────────────
function makeZip(files) {
  const enc=new TextEncoder();
  const toU8=d=>typeof d==='string'?enc.encode(d):d;
  const crcT=new Uint32Array(256);
  for(let i=0;i<256;i++){let c=i;for(let j=0;j<8;j++)c=(c&1)?0xEDB88320^(c>>>1):c>>>1;crcT[i]=c;}
  const crc32=b=>{let c=0xFFFFFFFF;for(let i=0;i<b.length;i++)c=crcT[(c^b[i])&0xFF]^(c>>>8);return(c^0xFFFFFFFF)>>>0;};
  const w16=(v,b,o)=>{b[o]=v&0xFF;b[o+1]=(v>>8)&0xFF;};
  const w32=(v,b,o)=>{b[o]=v&0xFF;b[o+1]=(v>>8)&0xFF;b[o+2]=(v>>16)&0xFF;b[o+3]=(v>>24)&0xFF;};
  const entries=files.map(({name,data})=>{const nU8=enc.encode(name),dU8=toU8(data);return{nU8,dU8,crc:crc32(dU8)};});
  const cdOff=entries.reduce((s,e)=>s+30+e.nU8.length+e.dU8.length,0);
  const cdSz=entries.reduce((s,e)=>s+46+e.nU8.length,0);
  const buf=new Uint8Array(cdOff+cdSz+22);let pos=0;
  const lOff=[];
  for(const{nU8,dU8,crc}of entries){
    lOff.push(pos);const sz=dU8.length;
    buf.set([0x50,0x4B,0x03,0x04],pos);pos+=4;
    w16(20,buf,pos);pos+=2;w16(0,buf,pos);pos+=2;w16(0,buf,pos);pos+=2;
    w16(0,buf,pos);pos+=2;w16(0,buf,pos);pos+=2;
    w32(crc,buf,pos);pos+=4;w32(sz,buf,pos);pos+=4;w32(sz,buf,pos);pos+=4;
    w16(nU8.length,buf,pos);pos+=2;w16(0,buf,pos);pos+=2;
    buf.set(nU8,pos);pos+=nU8.length;buf.set(dU8,pos);pos+=sz;
  }
  const cdStart=pos;
  for(let i=0;i<entries.length;i++){
    const{nU8,dU8,crc}=entries[i],sz=dU8.length;
    buf.set([0x50,0x4B,0x01,0x02],pos);pos+=4;
    w16(20,buf,pos);pos+=2;w16(20,buf,pos);pos+=2;w16(0,buf,pos);pos+=2;w16(0,buf,pos);pos+=2;
    w16(0,buf,pos);pos+=2;w16(0,buf,pos);pos+=2;
    w32(crc,buf,pos);pos+=4;w32(sz,buf,pos);pos+=4;w32(sz,buf,pos);pos+=4;
    w16(nU8.length,buf,pos);pos+=2;w16(0,buf,pos);pos+=2;w16(0,buf,pos);pos+=2;
    w16(0,buf,pos);pos+=2;w16(0,buf,pos);pos+=2;w32(0,buf,pos);pos+=4;
    w32(lOff[i],buf,pos);pos+=4;buf.set(nU8,pos);pos+=nU8.length;
  }
  buf.set([0x50,0x4B,0x05,0x06],pos);pos+=4;
  w16(0,buf,pos);pos+=2;w16(0,buf,pos);pos+=2;
  w16(entries.length,buf,pos);pos+=2;w16(entries.length,buf,pos);pos+=2;
  w32(cdSz,buf,pos);pos+=4;w32(cdStart,buf,pos);pos+=4;
  w16(0,buf,pos);
  return buf;
}

// ── Demo pattern: lily / preliminary base ─────────────────────────────────
// Vertices: corners (0,1,2,3), edge midpoints (4-7), center (8)
// Diagonals = Mountain, center-lines = Valley, perimeter = Boundary
const LILY_DEMO = (()=>{
  const v = [
    [0,0],[1,0],[1,1],[0,1],   // 0-3 corners
    [0.5,0],[1,0.5],[0.5,1],[0,0.5], // 4-7 edge mids
    [0.5,0.5],                        // 8 center
  ];
  const edges = [
    // Boundary perimeter
    {v1:0,v2:4,type:'B'},{v1:4,v2:1,type:'B'},
    {v1:1,v2:5,type:'B'},{v1:5,v2:2,type:'B'},
    {v1:2,v2:6,type:'B'},{v1:6,v2:3,type:'B'},
    {v1:3,v2:7,type:'B'},{v1:7,v2:0,type:'B'},
    // Valley center-lines (horizontal + vertical)
    {v1:4,v2:8,type:'V'},{v1:8,v2:6,type:'V'},
    {v1:7,v2:8,type:'V'},{v1:8,v2:5,type:'V'},
    // Mountain diagonals
    {v1:0,v2:8,type:'M'},{v1:8,v2:2,type:'M'},
    {v1:1,v2:8,type:'M'},{v1:8,v2:3,type:'M'},
    // Additional folds for blintz base (fold corners to center — Valley)
    {v1:0,v2:4,type:'V'},{v1:0,v2:7,type:'V'},
    {v1:1,v2:4,type:'V'},{v1:1,v2:5,type:'V'},
    {v1:2,v2:5,type:'V'},{v1:2,v2:6,type:'V'},
    {v1:3,v2:6,type:'V'},{v1:3,v2:7,type:'V'},
  ];
  // De-dup (boundary already covers perimeter, remove V corner duplicates that overlap B)
  const deduped = edges.filter((e,i,arr)=>{
    const key=`${Math.min(e.v1,e.v2)}-${Math.max(e.v1,e.v2)}`;
    return arr.findIndex(x=>`${Math.min(x.v1,x.v2)}-${Math.max(x.v1,x.v2)}`===key)===i;
  });
  return {vertices:v, edges:deduped};
})();

// ── Preview ────────────────────────────────────────────────────────────────
const EDGE_COLOR = {M:'#ff5555',V:'#5599ff',B:'#444',F:'#888',U:'#666'};

function PatternPreview({pattern}) {
  if(!pattern) return (
    <div style={{display:'flex',alignItems:'center',justifyContent:'center',width:'100%',aspectRatio:'1',background:'var(--s)',border:'1px solid var(--bd)',borderRadius:12,color:'var(--mu)',fontSize:'.8rem'}}>
      upload a .fold or .svg to preview
    </div>
  );
  const S=300;
  return (
    <svg viewBox={`0 0 ${S} ${S}`} width="100%" style={{display:'block',borderRadius:12,background:'var(--s)',border:'1px solid var(--bd)'}}>
      {pattern.edges.map((e,i)=>{
        const [x1,y1]=pattern.vertices[e.v1], [x2,y2]=pattern.vertices[e.v2];
        return <line key={i}
          x1={x1*S} y1={(1-y1)*S} x2={x2*S} y2={(1-y2)*S}
          stroke={EDGE_COLOR[e.type]||'#888'}
          strokeWidth={e.type==='B'?1.5:1}
          strokeDasharray={e.type==='V'?'4,3':undefined}
        />;
      })}
    </svg>
  );
}

// ── Component ──────────────────────────────────────────────────────────────
export default function FoldPress() {
  const [pattern,  setPattern]  = useState(null);
  const [fileName, setFileName] = useState('');
  const [paperMM,  setPaperMM]  = useState(75);
  const [baseH,    setBaseH]    = useState(2.0);
  const [ridgeH,   setRidgeH]   = useState(0.8);
  const [ridgeW,   setRidgeW]   = useState(0.6);
  const [clearance,setClearance]= useState(0.8);
  const [directed, setDirected] = useState(true);
  const [msg,      setMsg]      = useState('');
  const [dragging, setDragging] = useState(false);
  const fileRef = useRef();

  function loadFile(file) {
    if(!file) return;
    setFileName(file.name);
    const r=new FileReader();
    r.onload=e=>{
      const text=e.target.result;
      const parsed=file.name.endsWith('.svg')?parseSVG(text):(parseFOLD(text)||parseSVG(text));
      if(parsed){setPattern(parsed);setMsg('');}
      else setMsg('Could not parse file — check format');
    };
    r.readAsText(file);
  }

  async function doExport() {
    if(!pattern) return;
    setMsg('Building…'); await new Promise(r=>setTimeout(r,20));
    const {top,bot}=generatePlates(pattern,{paperMM,baseH,ridgeH,ridgeW,clearance});
    const zip=makeZip([{name:'press_top.stl',data:top},{name:'press_bottom.stl',data:bot}]);
    const a=document.createElement('a');
    a.href=URL.createObjectURL(new Blob([zip],{type:'application/zip'}));
    const base = fileName
      ? fileName.replace(/\.[^.]+$/, '').replace(/[^\w\-]/g, '_').replace(/_+/g, '_').replace(/^_|_$/g, '')
      : 'foldpress';
    const ts = new Date().toISOString().slice(0,16).replace('T','_').replace(':','');
    a.download=`${base}_${ts}.zip`;
    a.click();
    setMsg('✓ Downloaded!'); setTimeout(()=>setMsg(''),2500);
  }

  const mc=pattern?.edges.filter(e=>e.type==='M').length??0;
  const vc=pattern?.edges.filter(e=>e.type==='V').length??0;
  const fc=pattern?.edges.filter(e=>['F','U'].includes(e.type)).length??0;

  const css=`
    @import url('https://fonts.googleapis.com/css2?family=DM+Mono:wght@400;500&family=Syne:wght@400;600;700;800&display=swap');
    *{box-sizing:border-box;margin:0;padding:0}
    :root{--bg:#080810;--s:#0f0f1a;--s2:#161625;--bd:#1c1c2e;--t:#ddddf0;--mu:#55556a;--ac:#b48eff;--acd:rgba(180,142,255,.1);--rd:#ff4f6b;--rr:10px}
    html,body{font-family:'Syne',sans-serif;background:var(--bg);color:var(--t);font-size:14px;height:100%;overflow:hidden}
    .shell{display:grid;grid-template-columns:1fr 360px;height:100vh;overflow:hidden}
    .L{padding:28px 24px;border-right:1px solid var(--bd);overflow-y:auto;display:flex;flex-direction:column;gap:18px;height:100vh}
    .R{padding:20px;display:flex;flex-direction:column;gap:14px;height:100vh;overflow-y:auto}
    .logo-mark{font-size:1.5rem;font-weight:800;letter-spacing:-.03em}.logo-mark em{color:var(--ac);font-style:normal}
    .sub{font-family:'DM Mono',monospace;font-size:.65rem;color:var(--mu);margin-top:3px}
    .sec{display:flex;flex-direction:column;gap:9px}
    .lbl{font-size:.62rem;font-weight:700;text-transform:uppercase;letter-spacing:.12em;color:var(--mu)}
    .rng{display:flex;align-items:center;gap:10px}
    .rng label{font-size:.76rem;color:var(--mu);min-width:96px}
    .rng input[type=range]{flex:1;accent-color:var(--ac);cursor:pointer}
    .rv{font-family:'DM Mono',monospace;font-size:.74rem;color:var(--ac);min-width:52px;text-align:right}
    .drop{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:8px;padding:28px 16px;border:1.5px dashed var(--bd);border-radius:12px;cursor:pointer;transition:.15s;text-align:center}
    .drop:hover,.drop.over{border-color:var(--ac);background:var(--acd)}
    .drop-icon{font-size:2rem;line-height:1}
    .drop-label{font-size:.82rem;color:var(--mu)}
    .drop-sub{font-family:'DM Mono',monospace;font-size:.62rem;color:var(--mu);opacity:.6}
    .file-name{font-family:'DM Mono',monospace;font-size:.72rem;color:var(--ac);padding:7px 10px;background:var(--s);border:1px solid var(--bd);border-radius:8px;word-break:break-all}
    .toggle-row{display:flex;align-items:center;justify-content:space-between;cursor:pointer;user-select:none}
    .pill-switch{position:relative;width:36px;height:20px;flex-shrink:0}
    .pill-switch input{opacity:0;width:0;height:0;position:absolute}
    .pill-track{position:absolute;inset:0;border-radius:20px;background:var(--bd);border:1px solid var(--bd);transition:.2s}
    .pill-thumb{position:absolute;top:3px;left:3px;width:12px;height:12px;border-radius:50%;background:var(--mu);transition:.2s}
    .pill-track.on{background:var(--acd);border-color:var(--ac)}
    .pill-track.on .pill-thumb{left:19px;background:var(--ac)}
    .stats{display:grid;grid-template-columns:repeat(3,1fr);gap:6px}
    .sbox{background:var(--s);border:1px solid var(--bd);border-radius:8px;padding:8px 10px;text-align:center}
    .sv{font-family:'DM Mono',monospace;font-size:.95rem;font-weight:600}
    .sl{font-size:.58rem;color:var(--mu);margin-top:2px}
    .eb{padding:11px 18px;background:var(--ac);color:#000;border:none;border-radius:9px;font-family:inherit;font-size:.88rem;font-weight:800;cursor:pointer;transition:.15s;width:100%}
    .eb:hover{background:#c9a8ff;transform:translateY(-1px)}
    .eb:disabled{opacity:.4;cursor:default;transform:none}
    .stlmsg{font-family:'DM Mono',monospace;font-size:.75rem;color:var(--ac);text-align:center;min-height:18px}
    .notice{font-size:.7rem;color:var(--mu);line-height:1.5;padding:8px 10px;background:var(--s);border-left:2px solid var(--ac);border-radius:0 6px 6px 0}
    .legend{display:flex;flex-wrap:wrap;gap:8px}
    .leg{display:flex;align-items:center;gap:5px;font-size:.68rem;color:var(--mu)}
    .leg-line{width:20px;height:2px;border-radius:1px;flex-shrink:0}
    ::-webkit-scrollbar{width:6px}::-webkit-scrollbar-track{background:transparent}::-webkit-scrollbar-thumb{background:var(--bd);border-radius:99px}::-webkit-scrollbar-thumb:hover{background:var(--mu)}
    *{scrollbar-width:thin;scrollbar-color:var(--bd) transparent}
    @media(max-width:760px){html,body{overflow:auto;height:auto}.shell{grid-template-columns:1fr;height:auto}.L{height:auto}.R{height:auto;order:-1}}
  `;

  return (
    <>
      <style>{css}</style>
      <div className="shell">
        <div className="L">
          <div>
            <div className="logo-mark">Fold<em>Press</em></div>
            <div className="sub">// origami crease press generator</div>
          </div>

          {/* File upload */}
          <div className="sec">
            <div className="lbl">Crease Pattern</div>
            <div
              className={`drop${dragging?' over':''}`}
              onClick={()=>fileRef.current.click()}
              onDragOver={e=>{e.preventDefault();setDragging(true);}}
              onDragLeave={()=>setDragging(false)}
              onDrop={e=>{e.preventDefault();setDragging(false);loadFile(e.dataTransfer.files[0]);}}
            >
              <div className="drop-icon">⬆</div>
              <div className="drop-label">{fileName?'Replace file':'Drop or click to upload'}</div>
              <div className="drop-sub">.fold · .svg</div>
            </div>
            {fileName && <div className="file-name">{fileName}</div>}
            {msg && <div className="stlmsg">{msg}</div>}
            <input ref={fileRef} type="file" accept=".fold,.svg" style={{display:'none'}}
              onChange={e=>loadFile(e.target.files[0])}/>
            <button
              style={{background:'none',border:'1px solid var(--bd)',borderRadius:8,padding:'7px 12px',color:'var(--mu)',fontFamily:'inherit',fontSize:'.72rem',cursor:'pointer',transition:'.15s',textAlign:'left'}}
              onMouseOver={e=>e.currentTarget.style.borderColor='var(--ac)'}
              onMouseOut={e=>e.currentTarget.style.borderColor='var(--bd)'}
              onClick={()=>{setPattern(LILY_DEMO);setFileName('lily-demo (preliminary base)');setMsg('');}}
            >⬡ Load lily demo pattern</button>
          </div>

          {/* Paper size */}
          <div className="sec">
            <div className="lbl">Paper Size</div>
            <div className="rng">
              <label>Paper size</label>
              <input type="range" min={30} max={300} step={5} value={paperMM} onChange={e=>setPaperMM(+e.target.value)}/>
              <span className="rv">{paperMM} mm</span>
            </div>
          </div>

          {/* Geometry settings */}
          <div className="sec">
            <div className="lbl">Press Geometry</div>
            <div className="rng"><label>Base thickness</label><input type="range" min={0.8} max={5} step={0.1} value={baseH} onChange={e=>setBaseH(+e.target.value)}/><span className="rv">{baseH} mm</span></div>
            <div className="rng"><label>Ridge height</label><input type="range" min={0.2} max={3} step={0.1} value={ridgeH} onChange={e=>setRidgeH(+e.target.value)}/><span className="rv">{ridgeH} mm</span></div>
            <div className="rng"><label>Ridge width</label><input type="range" min={0.2} max={3} step={0.1} value={ridgeW} onChange={e=>setRidgeW(+e.target.value)}/><span className="rv">{ridgeW} mm</span></div>
            <div className="rng"><label>Clearance</label><input type="range" min={0} max={3} step={0.1} value={clearance} onChange={e=>setClearance(+e.target.value)}/><span className="rv">{clearance} mm</span></div>
          </div>

          {/* Directed mode */}
          <div className="sec">
            <label className="toggle-row" onClick={()=>setDirected(p=>!p)}>
              <span className="lbl" style={{margin:0}}>Use M/V assignments</span>
              <span className="pill-switch">
                <span className={`pill-track${directed?' on':''}`}><span className="pill-thumb"/></span>
              </span>
            </label>
            <div className="notice">
              {directed
                ? 'Top plate: mountain = ridge, valley = groove. Bottom plate: valley = ridge, mountain = groove. Plates interlock.'
                : 'All fold lines are ridges on both plates — use when the file has no M/V distinction.'}
            </div>
          </div>
        </div>

        <div className="R">
          <PatternPreview pattern={pattern}/>

          {/* Legend */}
          <div className="legend">
            {[['M','Mountain','#ff5555',false],['V','Valley','#5599ff',true],['F','Flat','#888',false],['B','Boundary','#444',false]].map(([k,label,color,dash])=>(
              <div key={k} className="leg">
                <div className="leg-line" style={{background:color,backgroundImage:dash?`repeating-linear-gradient(90deg,${color} 0,${color} 4px,transparent 4px,transparent 7px)`:undefined}}/>
                {label}
              </div>
            ))}
          </div>

          {/* Stats */}
          {pattern && (
            <div className="stats">
              <div className="sbox"><div className="sv" style={{color:'#ff5555'}}>{mc}</div><div className="sl">Mountain</div></div>
              <div className="sbox"><div className="sv" style={{color:'#5599ff'}}>{vc}</div><div className="sl">Valley</div></div>
              <div className="sbox"><div className="sv" style={{color:'var(--ac)'}}>{fc}</div><div className="sl">Flat/Other</div></div>
            </div>
          )}

          {/* Export */}
          <div className="sec" style={{marginTop:'auto'}}>
            <button className="eb" onClick={doExport} disabled={!pattern}>
              Export Press Plates (.zip)
            </button>
            <div className="stlmsg">{msg}</div>
            <div className="notice">
              Zip contains <strong>press_top.stl</strong> and <strong>press_bottom.stl</strong>.
              Print flat, ridge-side up. Flip top plate before pressing.
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
