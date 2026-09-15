import { useState } from 'react'
import { phaseProgress } from '../core/selectors'
import type { Item, Phase, PhaseNumber } from '../core/types'

/** `null` is the entry that ignores phases — the one place a view spans the whole roadmap. */
export type PhaseSelection = PhaseNumber | null

const STORAGE_KEY = 'planify.phases.open'
const NARROW = '(max-width: 1024px)'

/**
 * Open on a wide screen, closed on a narrow one, and after that whatever the
 * reader last chose. On a phone the list is six rows of furniture between the
 * header and the items, so it starts out of the way.
 */
function initiallyOpen(): boolean {
  const stored = localStorage.getItem(STORAGE_KEY)
  if (stored !== null) return stored === 'true'
  return !window.matchMedia(NARROW).matches
}

/**
 * The backlog's phase picker, which folds away: the list is navigation, and
 * navigation that cannot be closed eats the screen it is meant to serve. Closed,
 * it keeps naming the phase in view, so folding it never costs the answer to
 * "where am I?".
 */
export function PhaseSidebar({
  phases,
  items,
  selected,
  onSelect,
}: {
  phases: readonly Phase[]
  items: readonly Item[]
  selected: PhaseSelection
  onSelect: (phase: PhaseSelection) => void
}) {
  const [open, setOpen] = useState(initiallyOpen)
  const done = items.filter((item) => item.state === 'done').length

  const current = phases.find((phase) => phase.number === selected)
  const summary = current ? `Phase ${current.number} · ${current.name}` : 'All phases'

  function setAndStore(next: boolean) {
    localStorage.setItem(STORAGE_KEY, String(next))
    setOpen(next)
  }

  /** On a narrow screen the list covers what it filters, so choosing closes it. */
  function choose(phase: PhaseSelection) {
    onSelect(phase)
    if (window.matchMedia(NARROW).matches) setAndStore(false)
  }

  return (
    <aside className={open ? 'phases' : 'phases closed'}>
      <button
        type="button"
        className="phases-toggle"
        aria-expanded={open}
        onClick={() => setAndStore(!open)}
      >
        <span className="disclosure" aria-hidden="true">
          {open ? '▾' : '▸'}
        </span>
        <span className="phase-name">{open ? 'Phases' : summary}</span>
      </button>

      {open && (
        <div className="phase-list">
          {phases.map((phase) => {
            const progress = phaseProgress(items, phase)
            return (
              <button
                key={phase.number}
                type="button"
                className={selected === phase.number ? 'phase-link active' : 'phase-link'}
                aria-pressed={selected === phase.number}
                onClick={() => choose(phase.number)}
              >
                <span className="phase-index">{phase.number}</span>
                <span className="phase-name">{phase.name}</span>
                <span className="phase-progress">
                  {progress.done}/{progress.total}
                </span>
              </button>
            )
          })}

          <button
            type="button"
            className={selected === null ? 'phase-link active' : 'phase-link'}
            aria-pressed={selected === null}
            onClick={() => choose(null)}
          >
            <span className="phase-index">·</span>
            <span className="phase-name">All phases</span>
            <span className="phase-progress">
              {done}/{items.length}
            </span>
          </button>
        </div>
      )}
    </aside>
  )
}
