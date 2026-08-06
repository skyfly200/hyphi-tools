import { useEffect, useRef } from 'react'

// Vue island: this React component owns a host div, and a dynamic import
// mounts the Vuetify-based Vue app inside it. The Vue app handles all
// rendering for /harness.
export default function HarnessCalculator() {
  const hostRef = useRef(null)

  useEffect(() => {
    let cleanup = () => {}
    let cancelled = false
    import('./harness/mount.js').then(({ mountHarness }) => {
      if (cancelled || !hostRef.current) return
      cleanup = mountHarness(hostRef.current)
    })
    return () => { cancelled = true; cleanup() }
  }, [])

  return <div ref={hostRef} style={{ position: 'fixed', inset: 0, overflow: 'auto' }} />
}
