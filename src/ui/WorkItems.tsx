import { useEffect, useRef, useState, type Ref } from 'react'
import { Link as RouterLink, useSearchParams } from 'react-router-dom'
import { estimatedHours } from '../core/hours'
import type { AppState, ItemType, State } from '../core/types'
import { unitHours, unitPhases, unitState, unitsOf, type Unit } from '../core/workItems'

const STATE_LABEL: Record<State, string> = {
  pending: 'Pending',
  in_progress: 'In progress',
  done: 'Done',
}

type StateFilter = 'all' | State
const FILTERS: readonly StateFilter[] = ['all', 'pending', 'in_progress', 'done'] as const
const FILTER_LABEL: Record<StateFilter, string> = { all: 'All', ...STATE_LABEL }

/** Deliverables first, then what is studied, then the weekly routine. */
const SECTIONS: ReadonlyArray<{ type: ItemType; label: string }> = [
  { type: 'Project', label: 'Projects' },
  { type: 'Certification', label: 'Certifications' },
  { type: 'Course', label: 'Courses' },
  { type: 'Book', label: 'Books' },
  { type: 'Documentation', label: 'Documentation' },
  { type: 'Paper', label: 'Papers' },
  { type: 'Case study', label: 'Case studies' },
  { type: 'Exam prep', label: 'Exam prep' },
  { type: 'Practice', label: 'Practice' },
]

/**
 * The roadmap as units of work rather than as a calendar: a course with its
 * weeks, a book with the chapters read across phases, a project with its tasks.
 * No dates on purpose — the question here is "how far through this am I", and
 * the backlog and the Gantt already answer "when".
 *
 * Read-only. State is changed where it always is, on the backlog or the board,
 * and every part links back to its row there.
 */
export function WorkItems({ state }: { state: AppState }) {
  const [filter, setFilter] = useState<StateFilter>('all')
  const [open, setOpen] = useState<Set<string>>(new Set())
  const [params, setParams] = useSearchParams()
  const target = useRef<HTMLTableRowElement | null>(null)
  const [scrollTo, setScrollTo] = useState<string | null>(null)

  const units = unitsOf(state.items, state.workItems)
  const visible = units.filter((unit) => filter === 'all' || unitState(unit.parts) === filter)

  /** `?unit=` is how a backlog row hands its work item over: open it and bring it into view. */
  const requested = params.get('unit')
  useEffect(() => {
    if (!requested) return
    setFilter('all')
    setOpen((current) => new Set(current).add(requested))
    setScrollTo(requested)
    setParams({}, { replace: true })
  }, [requested, setParams])

  useEffect(() => {
    if (scrollTo && target.current) {
      target.current.scrollIntoView({ block: 'center' })
      setScrollTo(null)
    }
  }, [scrollTo])

  function toggle(id: string) {
    setOpen((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  return (
    <section className="work-items">
      <h2 className="board-title">Work items</h2>

      <div className="filters">
        {FILTERS.map((candidate) => (
          <button
            key={candidate}
            type="button"
            className={candidate === filter ? 'chip active' : 'chip'}
            onClick={() => setFilter(candidate)}
          >
            {FILTER_LABEL[candidate]}
            <span className="count">
              {
                units.filter(
                  (unit) => candidate === 'all' || unitState(unit.parts) === candidate,
                ).length
              }
            </span>
          </button>
        ))}
      </div>

      {visible.length === 0 && <p className="empty">Nothing matches this filter.</p>}

      {SECTIONS.map(({ type, label }) => {
        const inSection = visible.filter((unit) => unit.type === type)
        if (inSection.length === 0) return null
        return (
          <div key={type} className="unit-section">
            <h3 className="unit-section-title">
              {label} <span className="count">{inSection.length}</span>
            </h3>
            <table className="items units">
              <thead>
                <tr>
                  <th className="col-name">Work item</th>
                  <th className="col-phases">Phases</th>
                  <th className="col-progress">Progress</th>
                  <th className="col-hours">Hours</th>
                  <th className="col-unit-state">State</th>
                </tr>
              </thead>
              <tbody>
                {inSection.map((unit) => (
                  <UnitRows
                    key={unit.id}
                    unit={unit}
                    open={open.has(unit.id)}
                    rowRef={scrollTo === unit.id ? target : undefined}
                    onToggle={() => toggle(unit.id)}
                  />
                ))}
              </tbody>
            </table>
          </div>
        )
      })}
    </section>
  )
}

function UnitRows({
  unit,
  open,
  rowRef,
  onToggle,
}: {
  unit: Unit
  open: boolean
  rowRef: Ref<HTMLTableRowElement> | undefined
  onToggle: () => void
}) {
  const current = unitState(unit.parts)
  const hours = unitHours(unit.parts)
  const done = unit.parts.filter((part) => part.state === 'done').length
  const only = unit.parts[0]

  return (
    <>
      <tr
        ref={rowRef}
        className={[current === 'done' ? 'done' : '', open ? 'open' : ''].join(' ').trim() || undefined}
      >
        <td className="col-name">
          <div className="name-line">
            {unit.standalone ? (
              <span className="disclosure-spacer" />
            ) : (
              <button
                type="button"
                className="disclosure"
                aria-expanded={open}
                aria-label={`Parts of ${unit.name}`}
                onClick={onToggle}
              >
                {open ? '▾' : '▸'}
              </button>
            )}
            <span className="name">{unit.name}</span>
            {unit.standalone && only ? (
              <BacklogLink id={only.id} name={only.name} />
            ) : (
              <span className="count">{unit.parts.length} parts</span>
            )}
          </div>
        </td>
        <td className="col-phases">{unitPhases(unit.parts).join(' · ')}</td>
        <td className="col-progress">
          {unit.standalone ? (
            <span className="faint">—</span>
          ) : (
            <>
              <span className="progress-count">
                {done} of {unit.parts.length}
              </span>
              <div className="meter">
                <div
                  className="meter-fill"
                  style={{ width: `${Math.round((done / unit.parts.length) * 100)}%` }}
                />
              </div>
            </>
          )}
        </td>
        <td className="col-hours">
          {hours.done > 0 ? `${trim(hours.done)} of ${trim(hours.total)}h` : `${trim(hours.total)}h`}
          {hours.unestimated > 0 && <div className="faint">{hours.unestimated} without estimate</div>}
        </td>
        <td className="col-unit-state">
          <span className={`state-tag ${current}`}>{STATE_LABEL[current]}</span>
        </td>
      </tr>

      {open && unit.notes && (
        <tr className="detail">
          <td colSpan={5}>
            <div className="detail-line unit-notes">
              <span className="notes">{unit.notes}</span>
            </div>
          </td>
        </tr>
      )}

      {open &&
        unit.parts.map((part, index) => {
          const partHours = estimatedHours(part)
          return (
            <tr key={part.id} className={part.state === 'done' ? 'part done' : 'part'}>
              <td className="col-name">
                <div className="name-line part-line">
                  <span className="part-index">{index + 1}</span>
                  <span className="name">{part.name}</span>
                  {part.type !== unit.type && <span className="type-tag">{part.type}</span>}
                  <BacklogLink id={part.id} name={part.name} />
                </div>
              </td>
              <td className="col-phases">{part.phase}</td>
              <td className="col-progress" />
              <td className="col-hours">{partHours === null ? '—' : `${trim(partHours)}h`}</td>
              <td className="col-unit-state">
                <span className={`state-tag ${part.state}`}>{STATE_LABEL[part.state]}</span>
              </td>
            </tr>
          )
        })}
    </>
  )
}

function BacklogLink({ id, name }: { id: string; name: string }) {
  return (
    <RouterLink
      className="icon-button unit-jump"
      to={`/backlog?item=${encodeURIComponent(id)}`}
      title={`Open ${name} in the backlog`}
      aria-label={`Open ${name} in the backlog`}
    >
      ↗
    </RouterLink>
  )
}

function trim(hours: number): string {
  return Number.isInteger(hours) ? String(hours) : hours.toFixed(1)
}
