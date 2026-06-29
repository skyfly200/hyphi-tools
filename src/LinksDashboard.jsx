import { useEffect, useState } from 'react'

// Admin dashboard for the l.hyphi.art link shortener. Fetches stats
// from /api/links/stats with a bearer token kept in sessionStorage —
// closes when the tab closes; not in localStorage on purpose.

const css = `
  @import url('https://fonts.googleapis.com/css2?family=DM+Mono:wght@300;400;500&family=Bebas+Neue&family=DM+Sans:wght@300;400;500&display=swap');
  *{box-sizing:border-box;margin:0;padding:0}
  :root{--bg:#0a0a0f;--s:#111118;--bd:#2a2a3a;--t:#e8e8f0;--sub:#7a7a9a;--ac:#ff6b35;--ac2:#7b5cfa;--acd:rgba(123,92,250,.12)}
  html,body{font-family:'DM Sans',sans-serif;background:var(--bg);color:var(--t);min-height:100vh}
  .page{min-height:100vh;padding:32px 20px;display:flex;flex-direction:column;align-items:center;gap:20px}
  .header{max-width:960px;width:100%;display:flex;align-items:baseline;gap:12px;flex-wrap:wrap}
  .brand{font-family:'Bebas Neue',sans-serif;font-size:1.6rem;letter-spacing:.04em;background:linear-gradient(135deg,#ff6b35,#7b5cfa);-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text;text-decoration:none}
  .title{font-weight:500;font-size:1rem}
  .meta{margin-left:auto;font-family:'DM Mono',monospace;font-size:.72rem;color:var(--sub)}
  .controls{display:flex;gap:6px;align-items:center}
  input,select,button{background:var(--bg);color:var(--t);border:1px solid var(--bd);border-radius:6px;padding:7px 10px;font:500 .8rem 'DM Sans',sans-serif}
  button{cursor:pointer}
  button:hover,input:focus,select:focus{border-color:var(--ac2);outline:none}
  button.primary{background:var(--ac2);border-color:var(--ac2);color:#fff}
  .panel{max-width:960px;width:100%;background:var(--s);border:1px solid var(--bd);border-radius:10px;padding:16px}
  table{width:100%;border-collapse:collapse;font-size:.85rem}
  th,td{padding:10px 8px;text-align:left;border-bottom:1px solid var(--bd);vertical-align:middle}
  th{font-weight:500;color:var(--sub);font-size:.7rem;text-transform:uppercase;letter-spacing:.05em}
  tr:last-child td{border-bottom:none}
  td.num{font-family:'DM Mono',monospace;text-align:right}
  td.slug{font-family:'DM Mono',monospace;color:var(--ac)}
  td.dest a{color:var(--sub);text-decoration:none;font-size:.78rem}
  td.dest a:hover{color:var(--t)}
  .spark{display:inline-flex;align-items:flex-end;gap:2px;height:28px}
  .spark span{display:block;width:4px;background:var(--ac2);opacity:.75;border-radius:1px;min-height:1px}
  .spark span.zero{background:var(--bd);opacity:.4}
  .err{color:#ff6b6b;font-family:'DM Mono',monospace;font-size:.78rem;padding-top:8px}
  .empty{color:var(--sub);padding:24px;text-align:center;font-size:.9rem}
  .login{max-width:360px;width:100%;text-align:center;padding:36px 28px}
  .login input{width:100%;margin:14px 0;padding:10px 12px}
  .footer-link{font-family:'DM Mono',monospace;font-size:.7rem;color:var(--sub);text-decoration:none}
  .footer-link:hover{color:var(--t)}
`

export default function LinksDashboard() {
  const [token, setToken]    = useState(() => sessionStorage.getItem('hyphi.adminToken') || '')
  const [pending, setPending] = useState('')
  const [data, setData]      = useState(null)
  const [err, setErr]        = useState('')
  const [days, setDays]      = useState(14)
  const [loading, setLoading] = useState(false)

  async function load(t = token, d = days) {
    if (!t) return
    setLoading(true)
    setErr('')
    try {
      const res = await fetch(`/api/links/stats?days=${d}`, {
        headers: { authorization: `Bearer ${t}` },
      })
      if (res.status === 401) {
        sessionStorage.removeItem('hyphi.adminToken')
        setToken('')
        setErr('Unauthorized — token rejected.')
        return
      }
      if (!res.ok) { setErr(`${res.status} ${res.statusText}`); return }
      setData(await res.json())
    } catch (e) {
      setErr(`Network error: ${e.message}`)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (token) load(token, days)
    // intentionally only on mount; days-change handler triggers reloads
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function onSubmitToken(e) {
    e.preventDefault()
    if (!pending.trim()) return
    sessionStorage.setItem('hyphi.adminToken', pending.trim())
    setToken(pending.trim())
    load(pending.trim(), days)
  }

  function onChangeDays(e) {
    const d = Number(e.target.value)
    setDays(d)
    load(token, d)
  }

  function logout() {
    sessionStorage.removeItem('hyphi.adminToken')
    setToken('')
    setData(null)
  }

  // Login gate
  if (!token) {
    return (
      <>
        <style>{css}</style>
        <div className="page">
          <form className="panel login" onSubmit={onSubmitToken}>
            <div className="brand">Hyphi Links</div>
            <p style={{ color: 'var(--sub)', fontSize: '.85rem', marginTop: 8 }}>
              Enter the admin token to view stats.
            </p>
            <input
              type="password"
              autoFocus
              placeholder="ADMIN_TOKEN"
              value={pending}
              onChange={e => setPending(e.target.value)}
            />
            <button type="submit" className="primary">Sign in</button>
            {err && <div className="err">{err}</div>}
          </form>
          <a href="/" className="footer-link">← back to tools</a>
        </div>
      </>
    )
  }

  const slugs = data ? Object.keys(data.links).sort((a, b) => (data.totals[b] || 0) - (data.totals[a] || 0)) : []

  return (
    <>
      <style>{css}</style>
      <div className="page">
        <div className="header">
          <a href="/" className="brand">Hyphi Tools</a>
          <span className="title">/ Links</span>
          <div className="meta">{data ? `updated ${new Date(data.generatedAt).toLocaleTimeString()}` : ''}</div>
          <div className="controls">
            <select value={days} onChange={onChangeDays}>
              <option value="7">7 days</option>
              <option value="14">14 days</option>
              <option value="30">30 days</option>
              <option value="60">60 days</option>
            </select>
            <button onClick={() => load(token, days)} disabled={loading}>
              {loading ? '…' : 'Refresh'}
            </button>
            <button onClick={logout}>Logout</button>
          </div>
        </div>

        <div className="panel">
          {err && <div className="err">{err}</div>}
          {!data && !err && <div className="empty">Loading…</div>}
          {data && slugs.length === 0 && <div className="empty">No links configured yet — edit links.json.</div>}
          {data && slugs.length > 0 && (
            <table>
              <thead>
                <tr>
                  <th>Slug</th>
                  <th>Destination</th>
                  <th style={{ textAlign: 'right' }}>All time</th>
                  <th style={{ textAlign: 'right' }}>Window</th>
                  <th>Trend</th>
                </tr>
              </thead>
              <tbody>
                {slugs.map(slug => {
                  const dest = data.links[slug]
                  const dly = data.daily[slug] || {}
                  const windowTotal = Object.values(dly).reduce((a, b) => a + b, 0)
                  const max = Math.max(1, ...Object.values(dly))
                  return (
                    <tr key={slug}>
                      <td className="slug">/{slug}</td>
                      <td className="dest"><a href={dest} target="_blank" rel="noopener noreferrer">{dest}</a></td>
                      <td className="num">{data.totals[slug] || 0}</td>
                      <td className="num">{windowTotal}</td>
                      <td>
                        <div className="spark">
                          {data.dateList.map(d => {
                            const v = dly[d] || 0
                            const h = Math.max(1, Math.round((v / max) * 26))
                            return (
                              <span key={d}
                                    className={v ? '' : 'zero'}
                                    style={{ height: `${h}px` }}
                                    title={`${d}: ${v}`} />
                            )
                          })}
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}
        </div>

        <a href="/" className="footer-link">← back to tools</a>
      </div>
    </>
  )
}
