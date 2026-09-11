import { useEffect, useState } from 'react'

// Seconds since `key` last changed while `active`, re-rendered once a second so
// the number visibly moves during a call that produces no other output. Both the
// translate and review screens sit through calls of minutes with nothing else to
// show, and this clock is the only sign the run has not wedged.
export function useElapsed(active: boolean, key: number | string): number {
  const [since, setSince] = useState(() => Date.now())
  const [now, setNow] = useState(since)

  useEffect(() => {
    if (!active) return
    const started = Date.now()
    setSince(started)
    setNow(started)
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [active, key])

  return Math.max(0, Math.round((now - since) / 1000))
}
