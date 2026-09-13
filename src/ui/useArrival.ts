import { useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'

/** How long the arrival highlight lasts. Must match the animation in the stylesheet. */
const HIGHLIGHT_MS = 2400
const NOTICE_MS = 6000

/**
 * A view reached through a link that names one of its rows: `?item=` on the
 * backlog, `?unit=` on the work items.
 *
 * The parameter is read once and dropped, so a reload does not replay the jump.
 * A name that matches nothing is reported rather than swallowed — a link that
 * silently lands on the top of the page is indistinguishable from one that
 * worked. A name that does match is handed to `open`, which puts the row on
 * screen, and is returned as `arrived` for as long as the highlight runs.
 */
export function useArrival(
  name: string,
  exists: (id: string) => boolean,
  open: (id: string) => void,
): { arrived: string | null; missing: string | null } {
  const [params, setParams] = useSearchParams()
  const [arrived, setArrived] = useState<string | null>(null)
  const [missing, setMissing] = useState<string | null>(null)

  // The callbacks are recreated on every render; reading them through a ref
  // keeps the jump tied to the parameter changing, not to a re-render.
  const latest = useRef({ exists, open })
  latest.current = { exists, open }

  const requested = params.get(name)
  useEffect(() => {
    if (!requested) return
    if (latest.current.exists(requested)) {
      latest.current.open(requested)
      setArrived(requested)
      setMissing(null)
    } else {
      setMissing(requested)
    }
    setParams({}, { replace: true })
  }, [requested, setParams])

  useEffect(() => {
    if (!arrived) return
    const timer = setTimeout(() => setArrived(null), HIGHLIGHT_MS)
    return () => clearTimeout(timer)
  }, [arrived])

  useEffect(() => {
    if (!missing) return
    const timer = setTimeout(() => setMissing(null), NOTICE_MS)
    return () => clearTimeout(timer)
  }, [missing])

  return { arrived, missing }
}

/** Brings a row to the middle of its scroller, without animating for anyone who asked for less motion. */
export function scrollToRow(row: HTMLElement | null): void {
  if (!row) return
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
  row.scrollIntoView({ block: 'center', behavior: reduced ? 'auto' : 'smooth' })
}
