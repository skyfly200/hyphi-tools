import { useState, useRef, useEffect, useCallback } from "react";
import qrCodeGenerator from "qrcode-generator";

function buildQRData(type, fields) {
  switch (type) {
    case "url":      return fields.url || "https://example.com";
    case "text":     return fields.text || "Hello World";
    case "wifi":     return `WIFI:T:${fields.wifiSec||"WPA"};S:${fields.wifiSSID||""};P:${fields.wifiPass||""};H:${fields.wifiHidden?"true":"false"};;`;
    case "contact":  return `BEGIN:VCARD\nVERSION:3.0\nFN:${fields.vcName||""}\nTEL:${fields.vcPhone||""}\nEMAIL:${fields.vcEmail||""}\nORG:${fields.vcOrg||""}\nURL:${fields.vcUrl||""}\nEND:VCARD`;
    case "bluetooth":return `bluetooth:${fields.btAddress||"00:11:22:33:44:55"}`;
    case "intent":   return fields.intent||"intent://scan/#Intent;scheme=zxing;package=com.google.zxing.client.android;end";
    case "sms":      return `SMSTO:${fields.smsPhone||""}:${fields.smsMsg||""}`;
    case "email":    return `mailto:${fields.emailTo||""}?subject=${encodeURIComponent(fields.emailSubj||"")}&body=${encodeURIComponent(fields.emailBody||"")}`;
    case "phone":    return `tel:${fields.phone||""}`;
    case "location": return `geo:${fields.geoLat||"0"},${fields.geoLng||"0"}${fields.geoLabel?`?q=${encodeURIComponent(fields.geoLabel)}`:""}`;
    case "calendar": {
      const fmt = s => s ? s.replace(/[-:]/g,"").replace(".000","") : "";
      return `BEGIN:VEVENT\nSUMMARY:${fields.calTitle||""}\nDTSTART:${fmt(fields.calStart)}\nDTEND:${fmt(fields.calEnd)}\nLOCATION:${fields.calLoc||""}\nDESCRIPTION:${fields.calDesc||""}\nEND:VEVENT`;
    }
    case "crypto":   return `${fields.cryptoCoin||"bitcoin"}:${fields.cryptoAddr||""}${fields.cryptoAmt?`?amount=${fields.cryptoAmt}`:""}`;
    case "appstore": return fields.appUrl || "https://apps.apple.com/app/id";
    default:         return fields.url||"";
  }
}

function rrect(x, y, w, h, r) {
  r = Math.min(r, w/2, h/2);
  return `M ${x+r} ${y} h ${w-2*r} a ${r} ${r} 0 0 1 ${r} ${r} v ${h-2*r} a ${r} ${r} 0 0 1 -${r} ${r} h -${w-2*r} a ${r} ${r} 0 0 1 -${r} -${r} v -${h-2*r} a ${r} ${r} 0 0 1 ${r} -${r} Z`;
}

function finderSVG(col, row, mod, accent, bg, sharp) {
  const ox = col*mod, oy = row*mod;
  const cr  = sharp ? 0 : mod*0.55;
  const cr2 = sharp ? 0 : Math.max(0, mod*0.55 - mod);
  const cr3 = sharp ? 0 : mod*0.3;
  const gap  = `<rect x="${ox+mod}" y="${oy+mod}" width="${5*mod}" height="${5*mod}" fill="${bg}"/>`;
  const ring = `<path fill="${accent}" fill-rule="evenodd" d="${rrect(ox,oy,7*mod,7*mod,cr)} ${rrect(ox+mod,oy+mod,5*mod,5*mod,cr2)}"/>`;
  const dot  = `<path fill="${accent}" d="${rrect(ox+2*mod,oy+2*mod,3*mod,3*mod,cr3)}"/>`;
  return gap + ring + dot;
}

function dotPath(col, row, mod, style) {
  if (style === "square") return `M ${col*mod} ${row*mod} h ${mod} v ${mod} h -${mod} Z`;
  const p = mod*0.08, lx=col*mod+p, ly=row*mod+p, ds=mod-p*2, cr=ds*0.38;
  switch(style) {
    case "circle":  return `M ${lx+ds/2} ${ly} a ${ds/2} ${ds/2} 0 1 0 .001 0 Z`;
    case "diamond": { const cx=lx+ds/2,cy=ly+ds/2; return `M ${cx} ${ly} L ${lx+ds} ${cy} L ${cx} ${ly+ds} L ${lx} ${cy} Z`; }
    case "star": {
      const cx=lx+ds/2,cy=ly+ds/2,R=ds/2,ri=R*.4; let d="";
      for(let i=0;i<8;i++){const a=(i*Math.PI/4)-Math.PI/2,ra=i%2===0?R:ri;d+=(i===0?`M`:`L`)+` ${cx+ra*Math.cos(a)} ${cy+ra*Math.sin(a)}`;}
      return d+" Z";
    }
    default: return rrect(lx,ly,ds,ds,cr);
  }
}

const v = (x,y,z) => `${x.toFixed(4)} ${y.toFixed(4)} ${z.toFixed(4)}`;
const tri = (a,b,c,n) => `facet normal ${v(...n)}\nouter loop\nvertex ${v(...a)}\nvertex ${v(...b)}\nvertex ${v(...c)}\nendloop\nendfacet\n`;

function box(x,y,z,w,d,h) {
  const [x2,y2,z2]=[x+w,y+d,z+h];
  return [
    tri([x,y,z2],[x2,y,z2],[x2,y2,z2],[0,0,1]), tri([x,y,z2],[x2,y2,z2],[x,y2,z2],[0,0,1]),
    tri([x,y,z],[x2,y2,z],[x2,y,z],[0,0,-1]),   tri([x,y,z],[x,y2,z],[x2,y2,z],[0,0,-1]),
    tri([x,y,z],[x2,y,z],[x2,y,z2],[0,-1,0]),   tri([x,y,z],[x2,y,z2],[x,y,z2],[0,-1,0]),
    tri([x,y2,z],[x2,y2,z2],[x2,y2,z],[0,1,0]), tri([x,y2,z],[x,y2,z2],[x2,y2,z2],[0,1,0]),
    tri([x,y,z],[x,y,z2],[x,y2,z2],[-1,0,0]),   tri([x,y,z],[x,y2,z2],[x,y2,z],[-1,0,0]),
    tri([x2,y,z],[x2,y2,z],[x2,y2,z2],[1,0,0]), tri([x2,y,z],[x2,y2,z2],[x2,y,z2],[1,0,0]),
  ].join("");
}

function cylinder(cx,cy,z1,z2,r,seg=24) {
  let t="";
  for(let i=0;i<seg;i++){
    const a0=i/seg*Math.PI*2,a1=(i+1)/seg*Math.PI*2;
    const [x0,y0,x1,y1]=[cx+Math.cos(a0)*r,cy+Math.sin(a0)*r,cx+Math.cos(a1)*r,cy+Math.sin(a1)*r];
    const nx=Math.cos((a0+a1)/2),ny=Math.sin((a0+a1)/2);
    t+=tri([x0,y0,z1],[x1,y1,z1],[x1,y1,z2],[nx,ny,0]);
    t+=tri([x0,y0,z1],[x1,y1,z2],[x0,y0,z2],[nx,ny,0]);
    t+=tri([cx,cy,z2],[x0,y0,z2],[x1,y1,z2],[0,0,1]);
    t+=tri([cx,cy,z1],[x1,y1,z1],[x0,y0,z1],[0,0,-1]);
  }
  return t;
}

function ring(cx,cy,z,R,r,seg=32,rseg=12) {
  let t="";
  for(let i=0;i<seg;i++){
    const a0=i/seg*Math.PI*2,a1=(i+1)/seg*Math.PI*2;
    for(let j=0;j<rseg;j++){
      const b0=j/rseg*Math.PI*2,b1=(j+1)/rseg*Math.PI*2;
      const pt=(a,b)=>[(R+r*Math.cos(b))*Math.cos(a)+cx,(R+r*Math.cos(b))*Math.sin(a)+cy,r*Math.sin(b)+z];
      const [p00,p01,p10,p11]=[pt(a0,b0),pt(a0,b1),pt(a1,b0),pt(a1,b1)];
      const n=[Math.cos((a0+a1)/2)*Math.cos((b0+b1)/2),Math.sin((a0+a1)/2)*Math.cos((b0+b1)/2),Math.sin((b0+b1)/2)];
      t+=tri(p00,p10,p01,n); t+=tri(p01,p10,p11,n);
    }
  }
  return t;
}

function generateSTL(matrix, opts) {
  const {modMM=2,baseH=1.5,moduleH=1.2,margin=2,accessory="none",strapW=20,keychainR=5,standAngle=20,multiMat=true,reliefMode="inset"}=opts;
  const n=matrix.length, off=margin*modMM, boardSize=n*modMM+off*2;
  let baseTris="", modTris="";
  if (reliefMode === "raised") {
    baseTris += box(0,0,0,boardSize,boardSize,baseH);
    for(let r=0;r<n;r++) for(let c=0;c<n;c++) {
      if(!matrix[r][c]) continue;
      modTris += box(off+c*modMM, off+r*modMM, baseH, modMM, modMM, moduleH);
    }
  } else {
    baseTris += box(0,0,0,boardSize,boardSize,baseH);
    for(let r=0;r<n;r++) for(let c=0;c<n;c++) {
      if(matrix[r][c]) continue;
      modTris += box(off+c*modMM, off+r*modMM, baseH, modMM, modMM, moduleH);
    }
  }
  if(accessory==="keychain") {
    const rx=boardSize/2, ry=-(keychainR*2.2);
    baseTris += box(rx-strapW/4, -(keychainR*2.2), 0, strapW/2, keychainR*2.2, baseH);
    baseTris += ring(rx, ry, baseH*0.5, keychainR, keychainR*0.28);
  }
  if(accessory==="strap") {
    const lugH=baseH, lugDepth=4, lx=(boardSize-strapW)/2;
    baseTris += box(lx-3, -lugDepth, 0, 3, lugDepth, lugH);
    baseTris += box(lx+strapW, -lugDepth, 0, 3, lugDepth, lugH);
    baseTris += box(lx-3, -lugDepth, 0, strapW+6, 2.5, lugH);
    baseTris += box(lx-3, boardSize, 0, 3, lugDepth, lugH);
    baseTris += box(lx+strapW, boardSize, 0, 3, lugDepth, lugH);
    baseTris += box(lx-3, boardSize+lugDepth-2.5, 0, strapW+6, 2.5, lugH);
  }
  if(accessory==="stand") {
    const rad=standAngle*Math.PI/180;
    const legW=boardSize*0.55, legLen=boardSize*0.6, legThick=2.5;
    const lx=(boardSize-legW)/2;
    const hw=legLen*Math.cos(rad), hh=legLen*Math.sin(rad);
    baseTris += box(lx, boardSize, 0, legW, legThick, baseH);
    baseTris += box(lx, boardSize+legThick, 0, legW, hw, legThick);
    baseTris += box(lx, boardSize+legThick+hw-legThick, hh, legW, legThick, baseH-legThick+0.5);
  }
  if(multiMat) return `solid base\n${baseTris}endsolid base\nsolid modules\n${modTris}endsolid modules\n`;
  return `solid qrcode\n${baseTris}${modTris}endsolid qrcode\n`;
}

function TooltipBtn({ title, sub, desc, activeId, id, setActive }) {
  const isOpen = activeId === id;
  return (
    <span className="tt-wrap">
      <button className="tt-btn"
        onClick={e=>{ e.stopPropagation(); setActive(isOpen ? null : id); }}
        onMouseEnter={()=>setActive(id)}
        onMouseLeave={()=>setActive(null)}
      >?</button>
      {isOpen && (
        <span className="tt-box">
          {title && <div className="tt-title">{title}</div>}
          {sub   && <div className="tt-sub">{sub}</div>}
          {desc  && <div className="tt-desc">{desc}</div>}
        </span>
      )}
    </span>
  );
}

const PRESETS = [
  {name:"Midnight",bg:"#0d0d0d",fg:"#e8ff4f",accent:"#e8ff4f"},
  {name:"Arctic",  bg:"#f0f4ff",fg:"#1a1a2e",accent:"#4361ee"},
  {name:"Biolum",  bg:"#030d1a",fg:"#00ffe0",accent:"#00ffe0"},
  {name:"Warm",    bg:"#fffbf0",fg:"#2d1b00",accent:"#c0392b"},
  {name:"Neon",    bg:"#1a001f",fg:"#ff00cc",accent:"#ff00cc"},
  {name:"Mono",    bg:"#ffffff",fg:"#000000",accent:"#000000"},
];

const ICON_PRESETS = [
  { id:"wifi",  label:"WiFi",  svg:`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.55a11 11 0 0 1 14.08 0"/><path d="M1.42 9a16 16 0 0 1 21.16 0"/><path d="M8.53 16.11a6 6 0 0 1 6.95 0"/><circle cx="12" cy="20" r="1"/></svg>` },
  { id:"link",  label:"Link",  svg:`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>` },
  { id:"phone", label:"Phone", svg:`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07A19.5 19.5 0 0 1 4.72 12a19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 3.63 1.18h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L7.91 8.91a16 16 0 0 0 6 6l.91-.91a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 22 16.92z"/></svg>` },
  { id:"mail",  label:"Mail",  svg:`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="4" width="20" height="16" rx="2"/><path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7"/></svg>` },
  { id:"map",   label:"Map",   svg:`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z"/><circle cx="12" cy="10" r="3"/></svg>` },
  { id:"shop",  label:"Shop",  svg:`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="8" cy="21" r="1"/><circle cx="19" cy="21" r="1"/><path d="M2.05 2.05h2l2.66 12.42a2 2 0 0 0 2 1.58h9.78a2 2 0 0 0 1.95-1.57l1.65-7.43H5.12"/></svg>` },
  { id:"star",  label:"Star",  svg:`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>` },
  { id:"bt",    label:"BT",    svg:`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6.5 6.5 17.5 17.5 12 23 12 1 17.5 6.5 6.5 17.5"/></svg>` },
];

function svgToDataURL(svgStr, fg) {
  const colored = svgStr.replace(/stroke="currentColor"/g, `stroke="${fg}"`).replace(/fill="currentColor"/g, `fill="${fg}"`);
  const inner = colored.replace(/<svg[^>]*>/, '').replace('</svg>', '');
  const sized = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="80" height="80">${inner}</svg>`;
  return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(sized);
}

const EC_INFO = [
  { id:"L", label:"Low",     pct:"7%",  desc:"Smallest QR code. Use when the code is clean, unobstructed, and printed at high quality." },
  { id:"M", label:"Medium",  pct:"15%", desc:"Good balance of size and resilience. Recommended for most digital and print uses." },
  { id:"Q", label:"Quartile",pct:"25%", desc:"Higher recovery. Good for QR codes on packaging or slightly worn surfaces." },
  { id:"H", label:"High",    pct:"30%", desc:"Maximum damage recovery. Required when adding a center logo or icon." },
];
const DOT_STYLES  = ["rounded","circle","diamond","star","square"];
const CTABS = [
  { id:"url",      label:"URL / Link",      group:"Web"      },
  { id:"text",     label:"Plain Text",      group:"Web"      },
  { id:"appstore", label:"App Store",       group:"Web"      },
  { id:"wifi",     label:"WiFi",            group:"Connect"  },
  { id:"bluetooth",label:"Bluetooth",       group:"Connect"  },
  { id:"phone",    label:"Phone / Call",    group:"Contact"  },
  { id:"sms",      label:"SMS / Text",      group:"Contact"  },
  { id:"email",    label:"Email",           group:"Contact"  },
  { id:"contact",  label:"vCard Contact",   group:"Contact"  },
  { id:"location", label:"Location / GPS",  group:"Place"    },
  { id:"calendar", label:"Calendar Event",  group:"Place"    },
  { id:"crypto",   label:"Crypto Payment",  group:"Other"    },
  { id:"intent",   label:"Android Intent",  group:"Other"    },
];

export default function QRForge() {
  const [mainTab,     setMainTab]     = useState("Design");
  const [ctab,        setCtab]        = useState("url");
  const [fields,      setFields]      = useState({url:"https://hyphi.art",text:"",wifiSSID:"",wifiPass:"",wifiSec:"WPA",wifiHidden:false,vcName:"",vcPhone:"",vcEmail:"",vcOrg:"",vcUrl:"",btAddress:"",intent:"",smsPhone:"",smsMsg:"",emailTo:"",emailSubj:"",emailBody:"",phone:"",geoLat:"",geoLng:"",geoLabel:"",calTitle:"",calStart:"",calEnd:"",calLoc:"",calDesc:"",cryptoCoin:"bitcoin",cryptoAddr:"",cryptoAmt:"",appUrl:""});
  const [ecLevel,     setEcLevel]     = useState("H");
  const [size,        setSize]        = useState(380);
  const [dotStyle,    setDotStyle]    = useState("square");
  const [finderSharp, setFinderSharp] = useState(true);
  const [bgColor,     setBgColor]     = useState("#000000");
  const [fgColor,     setFgColor]     = useState("#ffffff");
  const [accentColor, setAccentColor] = useState("#ffffff");
  const [margin,      setMargin]      = useState(4);
  const [logo,        setLogo]        = useState(null);
  const [logoEnabled,   setLogoEnabled]   = useState(false);
  const [selectedIcon, setSelectedIcon] = useState(null);
  const [iconColor,    setIconColor]    = useState("#ffffff");
  const [logoSize,    setLogoSize]    = useState(22);
  const [exportFmt,   setExportFmt]   = useState("png");
  const [qrMatrix,    setQrMatrix]    = useState(null);
  const [copied,      setCopied]      = useState(false);
  const [modMM,       setModMM]       = useState(2.0);
  const [baseH,       setBaseH]       = useState(1.5);
  const [moduleH,     setModuleH]     = useState(1.2);
  const [stlMargin,   setStlMargin]   = useState(2);
  const [reliefMode,  setReliefMode]  = useState("inset");
  const [multiMat,    setMultiMat]    = useState(true);
  const [accessory,   setAccessory]   = useState("none");
  const [strapWidth,  setStrapWidth]  = useState(20);
  const [keychainR,   setKeychainR]   = useState(5);
  const [standAngle,  setStandAngle]  = useState(20);
  const [stlMsg,      setStlMsg]      = useState("");
  const [previewCollapsed, setPreviewCollapsed] = useState(false);
  const [ecTooltip, setEcTooltip] = useState(null);
  const logoRef = useRef();

  useEffect(() => {
    if (selectedIcon) {
      const ic = ICON_PRESETS.find(i => i.id === selectedIcon);
      if (ic) setLogo(svgToDataURL(ic.svg, iconColor));
    }
  }, [iconColor, selectedIcon]);

  const buildMatrix = useCallback(() => {
    try {
      const qr = qrCodeGenerator(0, ecLevel);
      qr.addData(buildQRData(ctab, fields), 'Byte');
      qr.make();
      const cnt = qr.getModuleCount();
      const mtx = [];
      for (let r = 0; r < cnt; r++) {
        const row = [];
        for (let c = 0; c < cnt; c++) row.push(qr.isDark(r, c));
        mtx.push(row);
      }
      setQrMatrix(mtx);
    } catch(e) {}
  }, [ctab, fields, ecLevel]);

  useEffect(() => { buildMatrix(); }, [buildMatrix]);

  const ff = (k,v) => setFields(p=>({...p,[k]:v}));

  const buildSVG = useCallback(() => {
    if (!qrMatrix) return "";
    const n=qrMatrix.length, mod=(size-margin*2*(size/n))/n, off=margin*mod, total=size;
    const fps=[[0,0],[0,n-7],[n-7,0]];
    const inF=(r,c)=>fps.some(([fr,fc])=>r>=fr&&r<fr+7&&c>=fc&&c<fc+7);
    let dots="";
    for(let r=0;r<n;r++) for(let c=0;c<n;c++){if(!qrMatrix[r][c]||inF(r,c))continue; dots+=dotPath(c,r,mod,dotStyle)+" ";}
    let finders="";
    for(const [fr,fc] of fps) finders+=finderSVG(fc,fr,mod,accentColor,bgColor,finderSharp);
    const lw=total*logoSize/100, lx=total/2-lw/2, ly=total/2-lw/2;
    const logoMkp=logo?`<rect x="${lx-5}" y="${ly-5}" width="${lw+10}" height="${lw+10}" rx="${lw*.18}" fill="${bgColor}"/>
      <image href="${logo}" x="${lx}" y="${ly}" width="${lw}" height="${lw}" clip-path="url(#lc)" preserveAspectRatio="xMidYMid slice"/>`:"";
    const logoDef=logo?`<clipPath id="lc"><rect x="${lx}" y="${ly}" width="${lw}" height="${lw}" rx="${lw*.16}"/></clipPath>`:"";
    return `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${total}" height="${total}" viewBox="0 0 ${total} ${total}">
  <defs>${logoDef}</defs>
  <rect width="${total}" height="${total}" fill="${bgColor}" rx="14"/>
  <g transform="translate(${off},${off})"><path d="${dots}" fill="${fgColor}" fill-rule="evenodd"/>${finders}</g>
  ${logoMkp}</svg>`;
  },[qrMatrix,size,margin,dotStyle,finderSharp,fgColor,bgColor,accentColor,logo,logoSize]);

  const svgString = buildSVG();

  async function doExport() {
    if(exportFmt==="stl"){
      if(!qrMatrix)return;
      setStlMsg("Building STL…"); await new Promise(r=>setTimeout(r,20));
      const stl=generateSTL(qrMatrix,{modMM,baseH,moduleH,margin:stlMargin,accessory,strapW:strapWidth,keychainR,standAngle,multiMat,reliefMode});
      const a=document.createElement("a"); a.href=URL.createObjectURL(new Blob([stl],{type:"application/octet-stream"})); a.download="qrcode.stl"; a.click();
      setStlMsg("✓ Downloaded!"); setTimeout(()=>setStlMsg(""),2200); return;
    }
    if(!svgString)return;
    if(exportFmt==="svg"){
      const a=document.createElement("a"); a.href=URL.createObjectURL(new Blob([svgString],{type:"image/svg+xml"})); a.download="qrcode.svg"; a.click(); return;
    }
    const canvas=document.createElement("canvas"); canvas.width=canvas.height=size;
    const img=new Image(); const burl=URL.createObjectURL(new Blob([svgString],{type:"image/svg+xml"}));
    img.onload=()=>{canvas.getContext("2d").drawImage(img,0,0,size,size); URL.revokeObjectURL(burl);
      const a=document.createElement("a"); a.href=canvas.toDataURL(exportFmt==="jpg"?"image/jpeg":"image/png",.95); a.download=`qrcode.${exportFmt}`; a.click();};
    img.src=burl;
  }

  const n=qrMatrix?.length||0, boardMM=(n*modMM+stlMargin*2*modMM).toFixed(1), darkCount=qrMatrix?qrMatrix.flat().filter(Boolean).length:0;

  const css=`
    @import url('https://fonts.googleapis.com/css2?family=DM+Mono:wght@400;500&family=Syne:wght@400;600;700;800&display=swap');
    *{box-sizing:border-box;margin:0;padding:0}
    :root{--bg:#080810;--s:#0f0f1a;--s2:#161625;--bd:#1c1c2e;--t:#ddddf0;--mu:#55556a;--ac:#b48eff;--acd:rgba(180,142,255,.1);--rd:#ff4f6b;--rr:10px}
    html,body{font-family:'Syne',sans-serif;background:var(--bg);color:var(--t);font-size:14px;height:100%;overflow:hidden}
    .shell{display:grid;grid-template-columns:1fr 360px;height:100vh;overflow:hidden}
    .L{padding:28px 24px;border-right:1px solid var(--bd);overflow-y:auto;overflow-x:hidden;display:flex;flex-direction:column;gap:18px;height:100vh}
    .R{padding:20px;display:flex;flex-direction:column;gap:12px;align-items:stretch;height:100vh;overflow:hidden}
    .logo-mark{font-size:1.5rem;font-weight:800;letter-spacing:-.03em} .logo-mark em{color:var(--ac);font-style:normal}
    .mono{font-family:'DM Mono',monospace}
    .sub{font-family:'DM Mono',monospace;font-size:.65rem;color:var(--mu);margin-top:3px}
    .mtabs{display:grid;grid-template-columns:1fr 1fr;gap:3px;background:var(--s);border:1px solid var(--bd);border-radius:var(--rr);padding:3px}
    .mtab{padding:8px;border-radius:8px;border:none;background:none;color:var(--mu);font-size:.82rem;font-family:inherit;font-weight:700;cursor:pointer;transition:.15s}
    .mtab.on{background:var(--ac);color:#000}
    .sec{display:flex;flex-direction:column;gap:9px}
    .lbl{font-size:.62rem;font-weight:700;text-transform:uppercase;letter-spacing:.12em;color:var(--mu)}
    .tabs{display:flex;gap:2px;background:var(--s);border:1px solid var(--bd);border-radius:8px;padding:3px;flex-wrap:wrap}
    .tab{flex:1;min-width:fit-content;padding:5px 9px;border-radius:6px;border:none;background:none;color:var(--mu);font-size:.74rem;font-family:inherit;font-weight:600;cursor:pointer;transition:.15s;white-space:nowrap}
    .tab.on{background:var(--s2);color:var(--t);box-shadow:0 1px 3px rgba(0,0,0,.5)}
    .tab:hover:not(.on){color:var(--t)}
    input[type=text],input[type=url],input[type=password],input[type=email],input[type=tel],textarea,select{width:100%;padding:8px 11px;background:var(--s);border:1px solid var(--bd);border-radius:8px;color:var(--t);font-family:'Syne',sans-serif;font-size:.83rem;outline:none;transition:.15s}
    input:focus,select:focus,textarea:focus{border-color:var(--ac);box-shadow:0 0 0 2px var(--acd)}
    select option{background:var(--s)} textarea{resize:vertical;min-height:68px;line-height:1.5}
    .r2{display:grid;grid-template-columns:1fr 1fr;gap:8px}
    .tgl{display:flex;align-items:center;gap:7px;font-size:.8rem;cursor:pointer;color:var(--mu);user-select:none}
    .tgl input{accent-color:var(--ac);width:auto}
    .rng{display:flex;align-items:center;gap:10px}
    .rng label{font-size:.76rem;color:var(--mu);min-width:76px}
    .rng input[type=range]{flex:1;accent-color:var(--ac);cursor:pointer}
    .rv{font-family:'DM Mono',monospace;font-size:.74rem;color:var(--ac);min-width:46px;text-align:right}
    .chips{display:flex;flex-wrap:wrap;gap:5px}
    .chip{padding:5px 12px;border-radius:20px;border:1px solid var(--bd);background:var(--s);color:var(--mu);font-size:.74rem;font-family:inherit;font-weight:600;cursor:pointer;transition:.15s}
    .chip.on{border-color:var(--ac);color:var(--ac);background:var(--acd)}
    .chip:hover:not(.on){color:var(--t);border-color:#333352}
    .presets{display:flex;gap:5px;flex-wrap:wrap}
    .pset{width:28px;height:28px;border-radius:50%;border:2px solid;cursor:pointer;transition:.15s;flex-shrink:0}
    .pset:hover{transform:scale(1.18)}
    .cr{display:grid;grid-template-columns:34px 1fr;align-items:center;gap:9px}
    input[type=color]{width:32px;height:28px;border-radius:6px;border:1px solid var(--bd);cursor:pointer;padding:2px;background:var(--s)}
    .cl{font-size:.77rem;color:var(--mu)} .ch{font-family:'DM Mono',monospace;font-size:.7rem;margin-left:6px;color:var(--t)}
    .logo-drop{padding:10px;border:1.5px dashed var(--bd);border-radius:8px;background:none;color:var(--mu);font-size:.77rem;font-family:inherit;cursor:pointer;width:100%;transition:.15s;text-align:center}
    .logo-drop:hover{border-color:var(--ac);color:var(--ac)}
    .logo-row{display:flex;align-items:center;gap:9px;padding:7px 9px;background:var(--s);border:1px solid var(--bd);border-radius:8px}
    .logo-row img{width:30px;height:30px;object-fit:contain;border-radius:5px}
    .logo-row span{flex:1;font-size:.77rem;color:var(--mu)}
    .rm{padding:3px 8px;border-radius:5px;border:1px solid var(--bd);background:none;color:var(--mu);font-size:.7rem;cursor:pointer}
    .rm:hover{border-color:var(--rd);color:var(--rd)}
    .pw{background:var(--s);border:1px solid var(--bd);border-radius:14px;padding:16px;display:flex;align-items:center;justify-content:center;width:100%;aspect-ratio:1;box-sizing:border-box}
    .pw>div{width:100%;height:100%;display:flex;align-items:center;justify-content:center}
    .pw svg{width:100%;height:100%;display:block}
    .dp{font-family:'DM Mono',monospace;font-size:.62rem;color:var(--mu);word-break:break-all;padding:8px 10px;background:var(--s);border:1px solid var(--bd);border-radius:8px;max-height:50px;overflow:hidden;line-height:1.5;width:100%}
    .eg{display:flex;flex-direction:column;gap:6px;width:100%}
    .er{display:grid;grid-template-columns:1fr auto;gap:6px}
    .eb{padding:11px 18px;background:var(--ac);color:#000;border:none;border-radius:9px;font-family:inherit;font-size:.88rem;font-weight:800;cursor:pointer;transition:.15s;white-space:nowrap}
    .eb:hover{background:#c9a8ff;transform:translateY(-1px)}
    .cb{padding:9px;background:var(--s);border:1px solid var(--bd);border-radius:9px;color:var(--t);font-family:inherit;font-size:.77rem;cursor:pointer;transition:.15s;width:100%;text-align:center}
    .cb:hover{border-color:var(--ac);color:var(--ac)}
    .stats{display:grid;grid-template-columns:1fr 1fr 1fr;gap:7px}
    .sbox{background:var(--s);border:1px solid var(--bd);border-radius:8px;padding:9px 10px;text-align:center}
    .sv{font-family:'DM Mono',monospace;font-size:.95rem;font-weight:600;color:var(--ac)}
    .sl{font-size:.6rem;color:var(--mu);margin-top:2px}
    .acc-grid{display:grid;grid-template-columns:1fr 1fr;gap:6px}
    .ac{padding:10px 12px;border:1px solid var(--bd);border-radius:9px;background:var(--s);cursor:pointer;transition:.15s}
    .ac.on{border-color:var(--ac);background:var(--acd)}
    .ac:hover:not(.on){border-color:#333352}
    .ai{font-size:1.25rem;margin-bottom:3px}
    .an{font-size:.8rem;font-weight:700}
    .ad{font-size:.67rem;color:var(--mu);margin-top:2px;line-height:1.4}
    .mmrow{display:flex;align-items:flex-start;gap:10px;padding:10px 12px;background:var(--s);border:1px solid var(--bd);border-radius:8px;cursor:pointer}
    .mmrow input{flex-shrink:0;margin-top:2px;accent-color:var(--ac)}
    .mmt{font-size:.82rem;font-weight:700;color:var(--mu)} .mmt.on{color:var(--ac)}
    .mmd{font-size:.72rem;color:var(--mu);line-height:1.45;margin-top:3px}
    .badge{display:inline-block;padding:1px 7px;background:var(--ac);color:#000;border-radius:10px;font-size:.62rem;font-weight:800;margin-left:6px}
    .toggle-row{display:flex;align-items:center;justify-content:space-between;cursor:pointer;user-select:none}
    .toggle-row .lbl{margin:0}
    .pill-switch{position:relative;width:36px;height:20px;flex-shrink:0}
    .pill-switch input{opacity:0;width:0;height:0;position:absolute}
    .pill-track{position:absolute;inset:0;border-radius:20px;background:var(--bd);border:1px solid var(--bd);transition:.2s}
    .pill-thumb{position:absolute;top:3px;left:3px;width:12px;height:12px;border-radius:50%;background:var(--mu);transition:.2s}
    .pill-switch input:checked~.pill-track{background:var(--acd);border-color:var(--ac)}
    .pill-switch input:checked~.pill-track .pill-thumb{left:19px;background:var(--ac)}
    .notice{font-size:.7rem;color:var(--mu);line-height:1.5;padding:8px 10px;background:var(--s);border-left:2px solid var(--ac);border-radius:0 6px 6px 0}
    .stlmsg{font-family:'DM Mono',monospace;font-size:.75rem;color:var(--ac);text-align:center;min-height:18px}
    .icon-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:5px}
    .icon-opt{display:flex;flex-direction:column;align-items:center;gap:4px;padding:8px 4px;border:1px solid var(--bd);border-radius:8px;background:var(--s);cursor:pointer;transition:.15s;font-size:.62rem;color:var(--mu);text-align:center}
    .icon-opt.on{border-color:var(--ac);background:var(--acd);color:var(--ac)}
    .icon-opt:hover:not(.on){border-color:#333352;color:var(--t)}
    .ec-chips{display:flex;flex-wrap:wrap;gap:5px}
    .ec-chip-wrap{position:relative}
    .ec-chip{display:flex;align-items:center;gap:5px;padding:5px 12px;border-radius:20px;border:1px solid var(--bd);background:var(--s);color:var(--mu);font-size:.74rem;font-family:inherit;font-weight:600;cursor:pointer;transition:.15s}
    .ec-chip.on{border-color:var(--ac);color:var(--ac);background:var(--acd)}
    .ec-chip:hover:not(.on){color:var(--t);border-color:#333352}
    .tt-wrap{position:relative;display:inline-flex;align-items:center}
    .tt-btn{width:15px;height:15px;border-radius:50%;border:1px solid currentColor;background:none;color:var(--mu);font-size:.6rem;font-family:'DM Mono',monospace;cursor:pointer;display:inline-flex;align-items:center;justify-content:center;padding:0;flex-shrink:0;line-height:1;transition:.15s;margin-left:4px}
    .tt-btn:hover{color:var(--ac);border-color:var(--ac)}
    .tt-box{position:absolute;bottom:calc(100% + 8px);left:50%;transform:translateX(-50%);background:#1a1a2e;border:1px solid var(--ac);border-radius:8px;padding:10px 12px;width:230px;z-index:200;box-shadow:0 8px 28px rgba(0,0,0,.7);animation:ttFade .12s ease}
    .tt-box::after{content:'';position:absolute;top:100%;left:50%;transform:translateX(-50%);border:6px solid transparent;border-top-color:var(--ac)}
    .tt-title{font-size:.74rem;font-weight:700;color:var(--ac);margin-bottom:3px}
    .tt-sub{font-family:'DM Mono',monospace;font-size:.68rem;color:var(--t);margin-bottom:5px}
    .tt-desc{font-size:.71rem;color:var(--mu);line-height:1.55}
    @keyframes ttFade{from{opacity:0;transform:translateX(-50%) translateY(4px)}to{opacity:1;transform:translateX(-50%) translateY(0)}}
    .exp-mode-switch{display:grid;grid-template-columns:1fr 1fr;gap:4px}
    .exp-mode{display:flex;flex-direction:column;align-items:center;gap:5px;padding:14px 10px;border:1px solid var(--bd);border-radius:10px;background:var(--s);cursor:pointer;transition:.15s;font-family:inherit}
    .exp-mode.on{border-color:var(--ac);background:var(--acd)}
    .exp-mode:hover:not(.on){border-color:#333352}
    .exp-mode-icon{font-size:1.5rem;line-height:1}
    .exp-mode-label{font-size:.76rem;font-weight:700;color:var(--mu)}
    .exp-mode.on .exp-mode-label{color:var(--ac)}
    @media(max-width:760px){html,body{overflow:auto;height:auto}.shell{grid-template-columns:1fr;height:auto;overflow:visible}.L{height:auto}.R{height:auto;order:-1}}
  `;

  return (
    <>
      <style>{css}</style>
      <div className="shell">
        <div className="L">
          <div>
            <div className="logo-mark">QR<em>forge</em></div>
            <div className="sub">// custom qr code generator</div>
          </div>
          <div className="mtabs">
            {["Design","Export"].map(t=><button key={t} className={"mtab"+(mainTab===t?" on":"")} onClick={()=>setMainTab(t)}>{t}</button>)}
          </div>

          {mainTab==="Design" && <>
            <div className="sec">
              <div style={{display:"flex",alignItems:"center",gap:0}}>
                <span className="lbl">Content Type</span>
                <TooltipBtn id="ctype" activeId={ecTooltip} setActive={setEcTooltip} title="Content Type" sub="" desc="Selects the data format encoded in the QR. Each type formats the payload differently so phones can take the right action."/>
              </div>
              <select value={ctab} onChange={e=>setCtab(e.target.value)}>
                {["Web","Connect","Contact","Place","Other"].map(g=>(
                  <optgroup key={g} label={g}>
                    {CTABS.filter(t=>t.group===g).map(t=><option key={t.id} value={t.id}>{t.label}</option>)}
                  </optgroup>
                ))}
              </select>
            </div>
            <div className="sec">
              <div className="lbl">Data</div>
              {ctab==="url"       && <input type="url" placeholder="https://" value={fields.url} onChange={e=>ff("url",e.target.value)}/>}
              {ctab==="text"      && <textarea placeholder="Enter any text…" value={fields.text} onChange={e=>ff("text",e.target.value)}/>}
              {ctab==="appstore"  && <><input type="url" placeholder="App Store or Play Store URL" value={fields.appUrl} onChange={e=>ff("appUrl",e.target.value)}/><div className="notice">Paste the full URL from the App Store, Google Play, or F-Droid listing page.</div></>}
              {ctab==="wifi"      && <><input type="text" placeholder="Network Name (SSID)" value={fields.wifiSSID} onChange={e=>ff("wifiSSID",e.target.value)}/><input type="password" placeholder="Password" value={fields.wifiPass} onChange={e=>ff("wifiPass",e.target.value)}/><div className="r2"><select value={fields.wifiSec} onChange={e=>ff("wifiSec",e.target.value)}><option>WPA</option><option>WEP</option><option>nopass</option></select><label className="tgl"><input type="checkbox" checked={fields.wifiHidden} onChange={e=>ff("wifiHidden",e.target.checked)}/> Hidden</label></div></>}
              {ctab==="bluetooth" && <input type="text" placeholder="BT MAC address" value={fields.btAddress} onChange={e=>ff("btAddress",e.target.value)}/>}
              {ctab==="phone"     && <input type="tel" placeholder="+1 555 000 0000" value={fields.phone} onChange={e=>ff("phone",e.target.value)}/>}
              {ctab==="sms"       && <><input type="tel" placeholder="Phone number" value={fields.smsPhone} onChange={e=>ff("smsPhone",e.target.value)}/><textarea placeholder="Pre-filled message (optional)" value={fields.smsMsg} onChange={e=>ff("smsMsg",e.target.value)}/></>}
              {ctab==="email"     && <><input type="email" placeholder="To address" value={fields.emailTo} onChange={e=>ff("emailTo",e.target.value)}/><input type="text" placeholder="Subject (optional)" value={fields.emailSubj} onChange={e=>ff("emailSubj",e.target.value)}/><textarea placeholder="Body (optional)" value={fields.emailBody} onChange={e=>ff("emailBody",e.target.value)}/></>}
              {ctab==="contact"   && <><input type="text" placeholder="Full Name" value={fields.vcName} onChange={e=>ff("vcName",e.target.value)}/><div className="r2"><input type="tel" placeholder="Phone" value={fields.vcPhone} onChange={e=>ff("vcPhone",e.target.value)}/><input type="email" placeholder="Email" value={fields.vcEmail} onChange={e=>ff("vcEmail",e.target.value)}/></div><div className="r2"><input type="text" placeholder="Organization" value={fields.vcOrg} onChange={e=>ff("vcOrg",e.target.value)}/><input type="url" placeholder="Website" value={fields.vcUrl} onChange={e=>ff("vcUrl",e.target.value)}/></div></>}
              {ctab==="location"  && <><div className="r2"><input type="text" placeholder="Latitude" value={fields.geoLat} onChange={e=>ff("geoLat",e.target.value)}/><input type="text" placeholder="Longitude" value={fields.geoLng} onChange={e=>ff("geoLng",e.target.value)}/></div><input type="text" placeholder="Label (optional)" value={fields.geoLabel} onChange={e=>ff("geoLabel",e.target.value)}/></>}
              {ctab==="calendar"  && <><input type="text" placeholder="Event title" value={fields.calTitle} onChange={e=>ff("calTitle",e.target.value)}/><div className="r2"><div><div style={{fontSize:".68rem",color:"var(--mu)",marginBottom:3}}>Start</div><input type="datetime-local" value={fields.calStart} onChange={e=>ff("calStart",e.target.value)}/></div><div><div style={{fontSize:".68rem",color:"var(--mu)",marginBottom:3}}>End</div><input type="datetime-local" value={fields.calEnd} onChange={e=>ff("calEnd",e.target.value)}/></div></div><input type="text" placeholder="Location (optional)" value={fields.calLoc} onChange={e=>ff("calLoc",e.target.value)}/><textarea placeholder="Description (optional)" value={fields.calDesc} onChange={e=>ff("calDesc",e.target.value)}/></>}
              {ctab==="crypto"    && <><div className="r2"><select value={fields.cryptoCoin} onChange={e=>ff("cryptoCoin",e.target.value)}><option value="bitcoin">Bitcoin (BTC)</option><option value="ethereum">Ethereum (ETH)</option><option value="litecoin">Litecoin (LTC)</option><option value="monero">Monero (XMR)</option></select><input type="text" placeholder="Amount (optional)" value={fields.cryptoAmt} onChange={e=>ff("cryptoAmt",e.target.value)}/></div><input type="text" placeholder="Wallet address" value={fields.cryptoAddr} onChange={e=>ff("cryptoAddr",e.target.value)} style={{fontFamily:"'DM Mono',monospace",fontSize:".75rem"}}/></>}
              {ctab==="intent"    && <textarea style={{fontFamily:"'DM Mono',monospace",fontSize:".72rem"}} placeholder="intent://…" value={fields.intent} onChange={e=>ff("intent",e.target.value)}/>}
            </div>

            <div className="sec">
              <div style={{display:"flex",alignItems:"center",gap:0}}>
                <span className="lbl">Error Correction</span>
                <TooltipBtn id="ec" activeId={ecTooltip} setActive={setEcTooltip} title="Error Correction" sub="How much damage the QR can survive" desc="Higher levels let scanners recover the code even if partially obscured. Use H when adding a center logo."/>
              </div>
              <div className="ec-chips">
                {EC_INFO.map(ec=>(
                  <button key={ec.id} className={"ec-chip"+(ecLevel===ec.id?" on":"")} onClick={()=>setEcLevel(ec.id)}>
                    {ec.id}
                    <span className="mono" style={{opacity:.55,fontSize:".68rem"}}>{ec.pct}</span>
                    <span className="mono" style={{opacity:.4,fontSize:".65rem",marginLeft:1}}>{ec.label}</span>
                  </button>
                ))}
              </div>
            </div>

            <div className="sec">
              <div className="lbl">Size &amp; Margin</div>
              <div className="rng"><label>Output size</label><input type="range" min={128} max={1024} step={8} value={size} onChange={e=>setSize(+e.target.value)}/><span className="rv">{size}px</span></div>
              <div className="rng"><label>Outer border</label><input type="range" min={0} max={10} step={1} value={margin} onChange={e=>setMargin(+e.target.value)}/><span className="rv">{margin} mod</span></div>
            </div>

            <div className="sec">
              <div style={{display:"flex",alignItems:"center",gap:0}}>
                <span className="lbl">Module Shape</span>
                <TooltipBtn id="modshape" activeId={ecTooltip} setActive={setEcTooltip} title="Module Shape" sub="aka dot style" desc="Square is standard. Rounded and circle are widely supported. Diamond and star are decorative — test before printing."/>
              </div>
              <div className="chips">{DOT_STYLES.map(s=><button key={s} className={"chip"+(dotStyle===s?" on":"")} onClick={()=>setDotStyle(s)}>{s}</button>)}</div>
            </div>

            <div className="sec">
              <div className="lbl">Finder Pattern Corners</div>
              <div className="chips">
                <button className={"chip"+(!finderSharp?" on":"")} onClick={()=>setFinderSharp(false)}>Rounded</button>
                <button className={"chip"+(finderSharp?" on":"")} onClick={()=>setFinderSharp(true)}>Sharp</button>
              </div>
            </div>

            <div className="sec">
              <div style={{display:"flex",alignItems:"center",gap:0}}>
                <span className="lbl">Colors</span>
                <TooltipBtn id="colors" activeId={ecTooltip} setActive={setEcTooltip} title="Colors" sub="" desc="Ensure strong contrast — low contrast codes fail to scan."/>
              </div>
              <div className="presets">{PRESETS.map(p=><div key={p.name} title={p.name} className="pset" style={{background:p.bg,borderColor:p.fg}} onClick={()=>{setBgColor(p.bg);setFgColor(p.fg);setAccentColor(p.accent);}}/>)}</div>
              {[["Background",bgColor,setBgColor],["Foreground",fgColor,setFgColor],["Finder Accent",accentColor,setAccentColor]].map(([l,v,s])=>(
                <div key={l} className="cr"><input type="color" value={v} onChange={e=>s(e.target.value)}/><span className="cl">{l}<span className="ch">{v}</span></span></div>
              ))}
            </div>

            <div className="sec">
              <label className="toggle-row" onClick={()=>{ if(logoEnabled){setLogoEnabled(false);setLogo(null);setSelectedIcon(null);} else setLogoEnabled(true); }}>
                <span style={{display:"flex",alignItems:"center",gap:0,pointerEvents:"none"}}>
                  <span className="lbl">Center Logo / Icon</span>
                </span>
                <span className="pill-switch">
                  <input type="checkbox" checked={logoEnabled} onChange={()=>{}} style={{display:"none"}}/>
                  <span className="pill-track"><span className="pill-thumb"/></span>
                </span>
              </label>
              <input ref={logoRef} type="file" accept="image/*" style={{display:"none"}}
                onChange={e=>{const file=e.target.files[0];if(!file)return;const reader=new FileReader();reader.onload=ev=>{setLogo(ev.target.result);setSelectedIcon(null);};reader.readAsDataURL(file);e.target.value="";}}/>
              {logoEnabled && <>
                <div className="icon-grid">
                  {ICON_PRESETS.map(ic=>{
                    const isOn=selectedIcon===ic.id;
                    const url=svgToDataURL(ic.svg,isOn?iconColor:fgColor);
                    return (
                      <div key={ic.id} className={"icon-opt"+(isOn?" on":"")}
                        onClick={()=>{ if(isOn){setSelectedIcon(null);setLogo(null);}else{setSelectedIcon(ic.id);setLogo(svgToDataURL(ic.svg,iconColor));} }}>
                        <img src={url} alt={ic.label} style={{width:22,height:22,display:"block"}}/>
                        <span>{ic.label}</span>
                      </div>
                    );
                  })}
                </div>
                {logo && selectedIcon===null
                  ? <div className="logo-row"><img src={logo} alt=""/><span>Custom image</span><button className="rm" onClick={()=>{setLogo(null);setSelectedIcon(null);}}>Remove</button></div>
                  : <button className="logo-drop" onClick={()=>logoRef.current.click()}>＋ Upload custom logo</button>
                }
                {logo && <div className="cr"><input type="color" value={iconColor} onChange={e=>{setIconColor(e.target.value);if(selectedIcon){const ic=ICON_PRESETS.find(i=>i.id===selectedIcon);if(ic)setLogo(svgToDataURL(ic.svg,e.target.value));}}}/><span className="cl">Icon color<span className="ch">{iconColor}</span></span></div>}
                {logo && <div className="rng"><label>Icon size</label><input type="range" min={10} max={35} value={logoSize} onChange={e=>setLogoSize(+e.target.value)}/><span className="rv">{logoSize}%</span></div>}
                {logo && <div className="notice">Use EC level H with logos — enables 30% module recovery.</div>}
              </>}
            </div>
          </>}

          {mainTab==="Export" && <>
            <div className="sec">
              <div className="lbl">Mode</div>
              <div className="exp-mode-switch">
                <button className={"exp-mode"+(exportFmt!=="stl"?" on":"")} onClick={()=>{ if(exportFmt==="stl") setExportFmt("png"); }}>
                  <span className="exp-mode-icon">🖼</span>
                  <span className="exp-mode-label">Photo</span>
                </button>
                <button className={"exp-mode"+(exportFmt==="stl"?" on":"")} onClick={()=>setExportFmt("stl")}>
                  <span className="exp-mode-icon">⬡</span>
                  <span className="exp-mode-label">3D Model</span>
                </button>
              </div>
            </div>

            {exportFmt !== "stl" && (
              <div className="sec">
                <div className="lbl">Format</div>
                <div className="chips">
                  {[["png","PNG","lossless"],["jpg","JPG","compressed"],["svg","SVG","vector"]].map(([v,l,hint])=>(
                    <button key={v} className={"chip"+(exportFmt===v?" on":"")} onClick={()=>setExportFmt(v)}>
                      {l} <span style={{fontSize:".65rem",opacity:.45,marginLeft:3}}>{hint}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {exportFmt === "stl" && <>
              <div className="sec">
                <div className="lbl">Model Dimensions</div>
                <div className="stats">
                  <div className="sbox"><div className="sv">{boardMM}</div><div className="sl">board mm</div></div>
                  <div className="sbox"><div className="sv">{(baseH+moduleH).toFixed(1)}</div><div className="sl">total height</div></div>
                  <div className="sbox"><div className="sv">{darkCount}</div><div className="sl">modules</div></div>
                </div>
              </div>
              <div className="sec">
                <div className="lbl">Relief Mode</div>
                <div className="chips">
                  <button className={"chip"+(reliefMode==="inset"?" on":"")} onClick={()=>setReliefMode("inset")}>Inset <span style={{fontSize:".68rem",opacity:.5}}>— recessed dark</span></button>
                  <button className={"chip"+(reliefMode==="raised"?" on":"")} onClick={()=>setReliefMode("raised")}>Raised <span style={{fontSize:".68rem",opacity:.5}}>— embossed dark</span></button>
                </div>
              </div>
              <div className="sec">
                <div className="lbl">Geometry</div>
                <div className="rng"><label>Module size</label><input type="range" min={1} max={4} step={.25} value={modMM} onChange={e=>setModMM(+e.target.value)}/><span className="rv">{modMM}mm</span></div>
                <div className="rng"><label>Base height</label><input type="range" min={.5} max={4} step={.25} value={baseH} onChange={e=>setBaseH(+e.target.value)}/><span className="rv">{baseH}mm</span></div>
                <div className="rng"><label>Module height</label><input type="range" min={.4} max={3} step={.2} value={moduleH} onChange={e=>setModuleH(+e.target.value)}/><span className="rv">{moduleH}mm</span></div>
                <div className="rng"><label>Margin</label><input type="range" min={0} max={5} step={1} value={stlMargin} onChange={e=>setStlMargin(+e.target.value)}/><span className="rv">{stlMargin} mod</span></div>
              </div>
              <div className="sec">
                <div className="lbl">Multi-Material (MMU / AMS)</div>
                <div className="mmrow" onClick={()=>setMultiMat(p=>!p)}>
                  <input type="checkbox" checked={multiMat} onChange={()=>{}}/>
                  <div>
                    <div className={"mmt"+(multiMat?" on":"")}>Two-body STL {multiMat&&<span className="badge">ON</span>}</div>
                    <div className="mmd">Exports base &amp; modules as two named solids. Open in PrusaSlicer or Bambu Studio → split to parts → assign one filament per body.</div>
                  </div>
                </div>
              </div>
              <div className="sec">
                <div className="lbl">Attachment / Accessory</div>
                <div className="acc-grid">
                  {[{id:"none",icon:"✕",name:"None",desc:"Clean board only"},{id:"keychain",icon:"🔑",name:"Keychain",desc:"Torus ring at top"},{id:"strap",icon:"⌚",name:"Strap Lugs",desc:"Spring bar lugs for 20mm strap"},{id:"stand",icon:"🖥️",name:"Kickstand",desc:"Rear angled leg, prints flat"}].map(a=>(
                    <div key={a.id} className={"ac"+(accessory===a.id?" on":"")} onClick={()=>setAccessory(a.id)}>
                      <div className="ai">{a.icon}</div><div className="an">{a.name}</div><div className="ad">{a.desc}</div>
                    </div>
                  ))}
                </div>
                {accessory==="keychain" && <div className="rng"><label>Ring radius</label><input type="range" min={3} max={12} step={.5} value={keychainR} onChange={e=>setKeychainR(+e.target.value)}/><span className="rv">{keychainR}mm</span></div>}
                {accessory==="strap"    && <div className="rng"><label>Strap width</label><input type="range" min={14} max={26} step={2} value={strapWidth} onChange={e=>setStrapWidth(+e.target.value)}/><span className="rv">{strapWidth}mm</span></div>}
                {accessory==="stand"    && <div className="rng"><label>Stand angle</label><input type="range" min={10} max={50} step={5} value={standAngle} onChange={e=>setStandAngle(+e.target.value)}/><span className="rv">{standAngle}°</span></div>}
              </div>
              <div className="notice">STL units are millimeters. Recommended: 0.2mm layers, 3 perimeters, 20% gyroid infill.</div>
            </>}

            <div className="sec">
              <button className="eb" style={{width:"100%"}} onClick={doExport}>↓ Download {exportFmt==="stl"?"STL":exportFmt.toUpperCase()}</button>
              {exportFmt==="svg" && <button className="cb" onClick={()=>{navigator.clipboard.writeText(svgString).then(()=>{setCopied(true);setTimeout(()=>setCopied(false),1800)});}}>{copied?"✓ Copied!":"Copy SVG to clipboard"}</button>}
              {stlMsg && <div className="stlmsg">{stlMsg}</div>}
            </div>
          </>}
        </div>

        <div className="R">
          <div style={{display:"flex",alignItems:"center",justifyContent:"space-between"}}>
            <div className="lbl">Live Preview</div>
            <button onClick={()=>setPreviewCollapsed(p=>!p)} style={{background:"none",border:"1px solid var(--bd)",borderRadius:6,color:"var(--mu)",fontSize:".7rem",fontFamily:"inherit",padding:"3px 9px",cursor:"pointer"}}
              onMouseEnter={e=>e.target.style.color="var(--t)"} onMouseLeave={e=>e.target.style.color="var(--mu)"}>
              {previewCollapsed ? "▼ show" : "▲ hide"}
            </button>
          </div>
          {!previewCollapsed && (
            <div className="pw" style={{flexShrink:0}}>
              {svgString
                ? <div style={{width:"100%",height:"100%",display:"flex",alignItems:"center",justifyContent:"center"}}
                    dangerouslySetInnerHTML={{__html:svgString.replace(/ width="\d+" height="\d+"/,' width="100%" height="100%"')}}/>
                : <div style={{color:"var(--mu)",fontSize:".85rem"}}>Generating…</div>
              }
            </div>
          )}
          {previewCollapsed && svgString && (
            <div style={{width:"100%",maxWidth:316,background:"var(--s)",border:"1px solid var(--bd)",borderRadius:10,padding:"10px 14px",display:"flex",alignItems:"center",gap:12,cursor:"pointer"}} onClick={()=>setPreviewCollapsed(false)}>
              <div style={{width:48,height:48,flexShrink:0,borderRadius:6,overflow:"hidden"}} dangerouslySetInnerHTML={{__html:svgString.replace(/width="[^"]*" height="[^"]*"/,'width="48" height="48"')}}/>
              <span style={{fontSize:".75rem",color:"var(--mu)"}}>Preview hidden — click to expand</span>
            </div>
          )}
        </div>

      </div>
    </>
  );
}
