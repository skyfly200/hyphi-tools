import { useEffect, useRef } from 'react'

// Vue island: this React component owns a host div, and a dynamic import
// mounts the Vue app inside it. The Vue app handles all rendering for /foldstudio.
export default function FoldStudio() {
  const hostRef = useRef(null)

  useEffect(() => {
    let cleanup = () => {}
    let cancelled = false
    import('./foldstudio/mount.js').then(({ mountFoldStudio }) => {
      if (cancelled || !hostRef.current) return
      cleanup = mountFoldStudio(hostRef.current)
    })
    return () => { cancelled = true; cleanup() }
  }, [])

  return <div ref={hostRef} style={{ position: 'fixed', inset: 0 }} />
}
