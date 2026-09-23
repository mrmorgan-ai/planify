import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Link as RouterLink } from 'react-router-dom'
import { newItemId } from '../core/edits'
import { estimatedHours } from '../core/hours'
import type { AppState, ItemType, State, WorkItem } from '../core/types'
import { unitHours, unitPhases, unitState, unitsOf, type Unit } from '../core/workItems'
import type { Edit } from '../core/edits'
import type { Store } from './useAppState'
import { scrollToRow, useArrival } from './useArrival'
import { DeleteWorkItem, WorkItemForm } from './WorkItemEditing'

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
 * State is changed where it always is, on the backlog or the board, and every
 * part links back to its row there. What is edited here is the work item
 * itself; which items are its parts is chosen in each item's own form.
 */
export function WorkItems({
  state,
  error,
  pendingId,
  edit,
}: Pick<Store, 'error' | 'pendingId' | 'edit'> & { state: AppState }) {
  const [filter, setFilter] = useState<StateFilter>('all')
  const [open, setOpen] = useState<Set<string>>(new Set())
  const [creating, setCreating] = useState(false)
  const [editing, setEditing] = useState<string | null>(null)
  /** The form whose last save was refused: a work item's id, or `new`. */
  const [refused, setRefused] = useState<string | null>(null)

  const save = async (key: string, edits: Edit[]) => {
    const saved = await edit(edits, key)
    setRefused(saved ? null : key)
    return saved
  }

  /** The form for one work item, or null when it is not being edited. */
  const editorFor = (workItem: WorkItem, parts: number): ReactNode =>
    editing === workItem.id ? (
      <WorkItemForm
        key={workItem.id}
        workItem={workItem}
        busy={pendingId === workItem.id}
        error={refused === workItem.id ? error : null}
        onCancel={() => setEditing(null)}
        onSubmit={async (fields) => {
          const edits: Edit[] = [{ op: 'updateWorkItem', id: workItem.id, fields }]
          if (await save(workItem.id, edits)) setEditing(null)
        }}
        danger={
          <DeleteWorkItem
            workItem={workItem}
            parts={parts}
            busy={pendingId === workItem.id}
            onDelete={async (deletion) => {
              if (await save(workItem.id, [deletion])) setEditing(null)
            }}
          />
        }
      />
    ) : null

  const units = unitsOf(state.items, state.workItems)
  const partless = state.workItems.filter(
    (workItem) => !state.items.some((item) => item.workItemId === workItem.id),
  )
  const visible = units.filter((unit) => filter === 'all' || unitState(unit.parts) === filter)

  /** `?unit=` is how a part hands its work item over: open it, bring it into view, highlight it. */
  const { arrived, missing } = useArrival(
    'unit',
    (id) => units.some((unit) => unit.id === id),
    (id) => {
      setFilter('all')
      setOpen((current) => new Set(current).add(id))
    },
  )

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

      {missing && (
        <p className="notice" role="status">
          The link pointed at <code>{missing}</code>, which is not in the roadmap any more.
        </p>
      )}

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
        <button
          type="button"
          className="button push-end"
          disabled={creating}
          onClick={() => {
            setRefused(null)
            setCreating(true)
          }}
        >
          + New work item
        </button>
      </div>

      {creating && (
        <div className="new-item">
          <h3>New work item</h3>
          <WorkItemForm
            workItem={null}
            busy={pendingId === 'new'}
            error={refused === 'new' ? error : null}
            onCancel={() => setCreating(false)}
            onSubmit={async (fields) => {
              const id = newItemId(fields.name, state)
              const edits: Edit[] = [{ op: 'createWorkItem', workItem: { ...fields, id } }]
              if (await save('new', edits)) setCreating(false)
            }}
          />
        </div>
      )}

      {partless.length > 0 && (
        <div className="unit-section">
          <h3 className="unit-section-title">
            No parts yet <span className="count">{partless.length}</span>
          </h3>
          <p className="settings-text">
            An item joins a work item from its own form in the backlog, under “Part of”.
          </p>
          <ul className="settings-rows partless">
            {partless.map((workItem) => (
              <li key={workItem.id}>
                {editorFor(workItem, 0) ?? (
                  <div className="partless-line">
                    <span className="name">{workItem.name}</span>
                    <span className="type-tag">{workItem.type}</span>
                    <button
                      type="button"
                      className="button push-end"
                      onClick={() => {
                        setRefused(null)
                        setEditing(workItem.id)
                      }}
                    >
                      Edit
                    </button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

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
                    arrived={arrived === unit.id}
                    editor={
                      unit.standalone
                        ? null
                        : editorFor(
                            state.workItems.find((each) => each.id === unit.id)!,
                            unit.parts.length,
                          )
                    }
                    onEdit={() => {
                      setRefused(null)
                      setEditing(unit.id)
                    }}
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
  arrived,
  editor,
  onEdit,
  onToggle,
}: {
  unit: Unit
  open: boolean
  arrived: boolean
  /** The work item's form, while it is being edited. */
  editor: ReactNode
  onEdit: () => void
  onToggle: () => void
}) {
  const row = useRef<HTMLTableRowElement>(null)
  useEffect(() => {
    if (arrived) scrollToRow(row.current)
  }, [arrived])

  const current = unitState(unit.parts)
  const hours = unitHours(unit.parts)
  const done = unit.parts.filter((part) => part.state === 'done').length
  const only = unit.parts[0]

  return (
    <>
      <tr
        ref={row}
        className={
          [current === 'done' ? 'done' : '', open ? 'open' : '', arrived ? 'arrived' : '']
            .filter(Boolean)
            .join(' ') || undefined
        }
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

      {open && !unit.standalone && (
        <tr className="detail">
          <td colSpan={5}>
            {editor ?? (
              <div className="detail-line unit-notes">
                {unit.notes && <span className="notes">{unit.notes}</span>}
                <button type="button" className="button push-end" onClick={onEdit}>
                  Edit work item
                </button>
              </div>
            )}
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
