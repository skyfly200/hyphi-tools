import { useEffect, useRef } from 'react'

// Vue island: this React component owns a host div, and a dynamic import
// mounts the Vue app inside it. The Vue app handles all rendering for /polyforge.
export default function PolyForge() {
  const hostRef = useRef(null)

  useEffect(() => {
    let cleanup = () => {}
    let cancelled = false
    import('./polyforge/mount.js').then(({ mountPolyForge }) => {
      if (cancelled || !hostRef.current) return
      cleanup = mountPolyForge(hostRef.current)
    })
    return () => { cancelled = true; cleanup() }
  }, [])

  return <div ref={hostRef} style={{ position: 'fixed', inset: 0 }} />
}
