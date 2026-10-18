import { useEffect, useRef } from 'react'

// Vue island, same pattern as PolyForge: React owns the host div, a dynamic import mounts the Vue app.
export default function FacetFold() {
  const hostRef = useRef(null)
  useEffect(() => {
    let cleanup = () => {}
    let cancelled = false
    import('./facetfold/mount.js').then(({ mountFacetFold }) => {
      if (cancelled || !hostRef.current) return
      cleanup = mountFacetFold(hostRef.current)
    })
    return () => { cancelled = true; cleanup() }
  }, [])
  return <div ref={hostRef} style={{ position: 'fixed', inset: 0 }} />
}
