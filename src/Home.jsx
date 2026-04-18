import { Link } from 'react-router-dom'

const TOOLS = [
  {
    href: '/qr',
    internal: true,
    name: 'QRForge',
    tagline: 'Custom QR code generator',
    desc: 'Design styled QR codes with custom colors, dot shapes, logos, and export to PNG, SVG, or 3D-printable STL.',
    icon: '▦',
  },
  {
    href: 'https://l.hyphi.art',
    internal: false,
    name: 'Link Shortener',
    tagline: 'Short URLs',
    desc: 'Shorten and share links under the hyphi.art domain.',
    icon: '↗',
  },
]

const css = `
  @import url('https://fonts.googleapis.com/css2?family=DM+Mono:wght@300;400;500&family=Bebas+Neue&family=DM+Sans:wght@300;400;500&display=swap');
  *{box-sizing:border-box;margin:0;padding:0}
  :root{--bg:#0a0a0f;--s:#111118;--bd:#2a2a3a;--t:#e8e8f0;--sub:#7a7a9a;--ac:#ff6b35;--ac2:#7b5cfa;--acd:rgba(123,92,250,.12)}
  html,body{font-family:'DM Sans',sans-serif;background:var(--bg);color:var(--t);min-height:100vh}
  .page{min-height:100vh;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:48px 24px;gap:48px}
  .hero{text-align:center;display:flex;flex-direction:column;align-items:center;gap:12px}
  .wordmark{font-family:'Bebas Neue',sans-serif;font-size:3.6rem;letter-spacing:.04em;background:linear-gradient(135deg,#ff6b35,#7b5cfa);-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text}
  .hero-sub{font-family:'DM Mono',monospace;font-size:.78rem;color:var(--sub)}
  .grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:16px;width:100%;max-width:720px}
  .card{display:flex;flex-direction:column;gap:12px;padding:28px;background:var(--s);border:1px solid var(--bd);border-radius:12px;text-decoration:none;color:inherit;transition:.18s;cursor:pointer}
  .card:hover{border-color:var(--ac2);background:var(--acd);transform:translateY(-2px)}
  .card-icon{font-size:2rem;line-height:1;color:var(--ac)}
  .card-name{font-size:1.1rem;font-weight:500;letter-spacing:.01em}
  .card-tag{font-family:'DM Mono',monospace;font-size:.65rem;color:var(--sub);margin-top:2px}
  .card-desc{font-size:.84rem;color:var(--sub);line-height:1.6}
  .footer{font-family:'DM Mono',monospace;font-size:.65rem;color:var(--sub);text-decoration:none}
  .footer:hover{color:var(--t)}
`

export default function Home() {
  return (
    <>
      <style>{css}</style>
      <div className="page">
        <div className="hero">
          <div className="wordmark">Hyphi Tools</div>
          <div className="hero-sub">// a growing collection of useful stuff</div>
        </div>

        <div className="grid">
          {TOOLS.map(t => t.internal
            ? <Link key={t.name} className="card" to={t.href}>
                <div className="card-icon">{t.icon}</div>
                <div>
                  <div className="card-name">{t.name}</div>
                  <div className="card-tag">// {t.tagline}</div>
                </div>
                <div className="card-desc">{t.desc}</div>
              </Link>
            : <a key={t.name} className="card" href={t.href} target="_blank" rel="noopener noreferrer">
                <div className="card-icon">{t.icon}</div>
                <div>
                  <div className="card-name">{t.name}</div>
                  <div className="card-tag">// {t.tagline}</div>
                </div>
                <div className="card-desc">{t.desc}</div>
              </a>
          )}
        </div>

        <a href="https://hyphi.art" className="footer">hyphi.art</a>
      </div>
    </>
  )
}
