import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import type { AppState } from '../core/types'
import { validate, type Issue } from '../core/validate'

/**
 * What the plan breaks, on every screen. Checked in the browser against the copy
 * it already holds — the validator is the same code the server runs — so it
 * costs no request and follows every change the moment it lands. Renders
 * nothing while the plan breaks no rule.
 */
export function PlanIssues({ state }: { state: AppState }) {
  const issues = useMemo(() => validate(state), [state])
  const [open, setOpen] = useState(false)
  const panelId = useId()
  const root = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }
    const onPointer = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('keydown', onKey)
    document.addEventListener('pointerdown', onPointer)
    return () => {
      document.removeEventListener('keydown', onKey)
      document.removeEventListener('pointerdown', onPointer)
    }
  }, [open])

  if (issues.length === 0) return null

  const errors = issues.filter((issue) => issue.severity === 'error')
  const warnings = issues.filter((issue) => issue.severity === 'warning')

  return (
    <div className="plan-issues" ref={root}>
      <button
        type="button"
        className={`plan-issues-toggle ${errors.length > 0 ? 'has-errors' : ''}`}
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((current) => !current)}
      >
        {summary(errors.length, warnings.length)}
      </button>

      {open && (
        <div className="plan-issues-panel" id={panelId} role="region" aria-label="Plan issues">
          <IssueList title="Errors" issues={errors} onFollow={() => setOpen(false)} />
          <IssueList title="Warnings" issues={warnings} onFollow={() => setOpen(false)} />
        </div>
      )}
    </div>
  )
}

function IssueList({
  title,
  issues,
  onFollow,
}: {
  title: string
  issues: Issue[]
  onFollow: () => void
}) {
  if (issues.length === 0) return null
  return (
    <section>
      <h3>{title}</h3>
      <ul>
        {issues.map((issue, index) => (
          <li key={`${issue.rule}-${index}`} className={issue.severity}>
            <span className="plan-issues-rule">{issue.rule}</span>
            {issue.itemId ? (
              <Link to={`/backlog?item=${encodeURIComponent(issue.itemId)}`} onClick={onFollow}>
                {issue.message}
              </Link>
            ) : (
              <span>{issue.message}</span>
            )}
          </li>
        ))}
      </ul>
    </section>
  )
}

function summary(errors: number, warnings: number): string {
  const parts = []
  if (errors > 0) parts.push(`${errors} ${errors === 1 ? 'error' : 'errors'}`)
  if (warnings > 0) parts.push(`${warnings} ${warnings === 1 ? 'warning' : 'warnings'}`)
  return parts.join(' · ')
}
