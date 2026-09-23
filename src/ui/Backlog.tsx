import { useEffect, useRef, useState, type ReactNode } from 'react'
import { STATES } from '../core/constants'
import { shiftStudyDays, studyDaysBetween } from '../core/dates'
import {
  hasSlipped,
  isOverdue,
  matchesFilter,
  slipDays,
  ITEM_FILTERS,
  type ItemFilter,
} from '../core/selectors'
import type { AppState, Blackout, CivilDate, Item, Resource, State } from '../core/types'
import { linksOf, partLabel, type PartLabel } from '../core/workItems'
import { DatePicker } from './DatePicker'
import { hostOf, ItemDetail } from './ItemDetail'
import { GeneratePanel } from './Generate'
import { EditItemForm, NewItemForm } from './ItemEditing'
import { scrollToRow, useArrival } from './useArrival'
import { PhaseSidebar, type PhaseSelection } from './PhaseSidebar'
import type { Store } from './useAppState'

const STATE_LABEL: Record<State, string> = {
  pending: 'Pending',
  in_progress: 'In progress',
  done: 'Done',
}

const FILTER_LABEL: Record<ItemFilter, string> = {
  all: 'All',
  pending: 'Pending',
  in_progress: 'In progress',
  overdue: 'Overdue',
  done: 'Done',
}

/**
 * The detail view, and the surface the rest hangs off: the Gantt only reflects
 * what is set here or on the board. One phase at a time, because a hundred rows in a
 * single scroll is a list you stop reading.
 *
 * Dates are editable here. What you edit is the baseline — the plan — and the
 * server recomputes every projection from it, so anything that depends on the
 * item you moved follows. Dependencies are shown as information, never as a
 * lock: nothing here stops you starting anything.
 *
 * The rest of an item is edited in its expanded row, and saved as one write.
 * New items are created here too, in the phase being looked at: one at a time,
 * or a whole course, certification, project or run of practice at once.
 */
export function Backlog({
  state,
  error,
  pendingId,
  changeState,
  changeDates,
  edit,
  generate,
  mode,
}: Store & { state: AppState }) {
  const [filter, setFilter] = useState<ItemFilter>('all')
  const [phase, setPhase] = useState<PhaseSelection>(state.roadmap.phases[0]?.number ?? null)
  const [expanded, setExpanded] = useState<string | null>(null)
  const [editing, setEditing] = useState<string | null>(null)
  const [editingItem, setEditingItem] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const [generating, setGenerating] = useState(false)
  /**
   * Which form's last save was refused — an item's id, or `new` — so the
   * store's error shows in that form and not in every open one.
   */
  const [refused, setRefused] = useState<string | null>(null)

  /**
   * `?item=` is how the Gantt and the work items hand a row over. Opening it
   * means switching to its phase, clearing the filter that might hide it and
   * expanding it; the row then scrolls itself into view and is highlighted.
   */
  const { arrived, missing } = useArrival(
    'item',
    (id) => state.items.some((item) => item.id === id),
    (id) => {
      const target = state.items.find((item) => item.id === id)
      if (!target) return
      setPhase(target.phase)
      setFilter('all')
      setExpanded(target.id)
    },
  )

  const inPhase = state.items.filter((item) => phase === null || item.phase === phase)
  const visible = inPhase
    .filter((item) => matchesFilter(item, filter, state.today))
    .sort((a, b) => a.phase - b.phase || a.sortOrder - b.sortOrder)

  const names = new Map(state.items.map((item) => [item.id, item.name]))

  return (
    <section className="backlog">
      <PhaseSidebar
        phases={state.roadmap.phases}
        items={state.items}
        selected={phase}
        onSelect={setPhase}
      />

      <div className="items-pane">
        {missing && (
          <p className="notice" role="status">
            The link pointed at <code>{missing}</code>, which is not in the roadmap any more.
          </p>
        )}

        <div className="filters">
          {ITEM_FILTERS.map((candidate) => (
            <button
              key={candidate}
              type="button"
              className={candidate === filter ? 'chip active' : 'chip'}
              onClick={() => setFilter(candidate)}
            >
              {FILTER_LABEL[candidate]}
              <span className="count">
                {inPhase.filter((item) => matchesFilter(item, candidate, state.today)).length}
              </span>
            </button>
          ))}
          <button
            type="button"
            className="button push-end"
            disabled={creating || generating}
            onClick={() => {
              setRefused(null)
              setCreating(true)
            }}
          >
            + New item
          </button>
          <button
            type="button"
            className="button"
            disabled={creating || generating}
            onClick={() => setGenerating(true)}
          >
            + Generate…
          </button>
        </div>

        {generating && (
          <GeneratePanel
            state={state}
            phase={phase ?? state.roadmap.phases[0]?.number ?? 1}
            draft={mode === 'draft'}
            error={error}
            generate={generate}
            onCancel={() => setGenerating(false)}
            onDone={(placed, into) => {
              setGenerating(false)
              setPhase(into)
              setFilter('all')
              setExpanded(placed[0]?.id ?? null)
            }}
          />
        )}

        {creating && (
          <NewItemForm
            state={state}
            phase={phase ?? state.roadmap.phases[0]?.number ?? 1}
            busy={pendingId === 'new'}
            error={refused === 'new' ? error : null}
            onCancel={() => setCreating(false)}
            onCreate={async (edits, id, into) => {
              const saved = await edit(edits, 'new')
              setRefused(saved ? null : 'new')
              if (!saved) return
              setCreating(false)
              setPhase(into)
              setFilter('all')
              setExpanded(id)
            }}
          />
        )}

        {visible.length === 0 ? (
          <p className="empty">Nothing matches this filter in this phase.</p>
        ) : (
          <table className="items">
            <thead>
              <tr>
                <th className="col-state">State</th>
                <th className="col-type">Type</th>
                <th className="col-name">Item</th>
                <th className="col-date">Start</th>
                <th className="col-date">End</th>
                <th className="col-edit" />
                <th className="col-resources">Resources</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((item) => (
                <Row
                  key={item.id}
                  item={item}
                  today={state.today}
                  floor={state.roadmap.startDate}
                  blackouts={state.roadmap.blackouts}
                  busy={pendingId === item.id}
                  open={expanded === item.id}
                  arrived={arrived === item.id}
                  editing={editing === item.id}
                  names={names}
                  part={partLabel(item, state.workItems, state.items)}
                  links={linksOf(item, state.workItems)}
                  showPhase={phase === null}
                  form={
                    editingItem === item.id ? (
                      <EditItemForm
                        key={item.id}
                        state={state}
                        item={item}
                        busy={pendingId === item.id}
                        error={refused === item.id ? error : null}
                        onCancel={() => setEditingItem(null)}
                        onSave={async (edits, into) => {
                          const saved = edits.length === 0 || (await edit(edits, item.id))
                          setRefused(saved ? null : item.id)
                          if (!saved) return
                          setEditingItem(null)
                          if (phase !== null && into !== phase) setPhase(into)
                        }}
                        onDelete={async (deletion) => {
                          const deleted = await edit([deletion], item.id)
                          setRefused(deleted ? null : item.id)
                          if (!deleted) return
                          setEditingItem(null)
                          setExpanded(null)
                        }}
                      />
                    ) : null
                  }
                  onEditItem={() => {
                    setRefused(null)
                    setEditingItem(item.id)
                  }}
                  onToggle={() => {
                    if (expanded === item.id && editingItem === item.id) setEditingItem(null)
                    setExpanded(expanded === item.id ? null : item.id)
                  }}
                  onEdit={() => setEditing(editing === item.id ? null : item.id)}
                  onChange={(next) => void changeState(item.id, next)}
                  onSaveDates={async (start, end) => {
                    if (await changeDates(item.id, start, end)) setEditing(null)
                  }}
                />
              ))}
            </tbody>
          </table>
        )}
      </div>
    </section>
  )
}

function Row({
  item,
  today,
  floor,
  blackouts,
  busy,
  open,
  arrived,
  editing,
  names,
  part,
  links,
  showPhase,
  form,
  onEditItem,
  onToggle,
  onEdit,
  onChange,
  onSaveDates,
}: {
  item: Item
  today: string
  floor: CivilDate | ''
  blackouts: readonly Blackout[]
  busy: boolean
  open: boolean
  /** Just reached through a link: scroll to it and highlight it. */
  arrived: boolean
  editing: boolean
  names: Map<string, string>
  /** Which work item this row is a part of, when it is one. */
  part: PartLabel | null
  /** Its own links, or its work item's when it carries none. */
  links: { link: string | null; resources: Resource[] }
  showPhase: boolean
  /** The item's edit form, while it is open in place of the detail. */
  form: ReactNode
  onEditItem: () => void
  onToggle: () => void
  onEdit: () => void
  onChange: (next: State) => void
  onSaveDates: (start: CivilDate, end: CivilDate) => void
}) {
  const late = isOverdue(item, today)
  const slipped = hasSlipped(item)
  const row = useRef<HTMLTableRowElement>(null)
  useEffect(() => {
    if (arrived) scrollToRow(row.current)
  }, [arrived])

  const rowClass = [
    late ? 'overdue' : '',
    item.state === 'done' ? 'done' : '',
    open ? 'open' : '',
    arrived ? 'arrived' : '',
  ]
    .filter(Boolean)
    .join(' ')

  return (
    <>
      <tr ref={row} className={rowClass || undefined}>
        <td className="col-state">
          <select
            className={`state-select ${item.state}`}
            value={item.state}
            disabled={busy}
            aria-label={`State of ${item.name}`}
            onChange={(event) => onChange(event.target.value as State)}
          >
            {STATES.map((candidate) => (
              <option key={candidate} value={candidate}>
                {STATE_LABEL[candidate]}
              </option>
            ))}
          </select>
        </td>

        <td className="col-type">
          <span className="type-tag">{item.type}</span>
        </td>

        <td className="col-name">
          <div className="name-line">
            <button
              type="button"
              className="disclosure"
              aria-expanded={open}
              aria-label={`Details of ${item.name}`}
              onClick={onToggle}
            >
              {open ? '▾' : '▸'}
            </button>
            {part && (
              <span className="part-count" title={`Part ${part.index} of ${part.total} · ${part.workItem.name}`}>
                {part.index}/{part.total}
              </span>
            )}
            <span className="name">{item.name}</span>
            {showPhase && <span className="phase-tag">phase {item.phase}</span>}
          </div>
        </td>

        {editing ? (
          <DateEditor
            item={item}
            floor={floor}
            blackouts={blackouts}
            busy={busy}
            onSave={onSaveDates}
            onCancel={onEdit}
          />
        ) : (
          <>
            <td className="col-date">
              <div>{item.projectedStartDate}</div>
              {slipped && <div className="planned">was {item.baselineStartDate}</div>}
            </td>

            <td className={late ? 'col-date late' : 'col-date'}>
              <div>{item.projectedEndDate}</div>
              {slipped && (
                <div className="planned">
                  was {item.baselineEndDate} ({signed(slipDays(item))}d)
                </div>
              )}
            </td>

            <td className="col-edit">
              <button
                type="button"
                className="icon-button"
                disabled={busy}
                aria-label={`Edit the dates of ${item.name}`}
                title="Edit the planned dates"
                onClick={onEdit}
              >
                ✎
              </button>
            </td>
          </>
        )}

        <td className="col-resources">
          <div className="resources">
            {links.link && (
              <a href={links.link} target="_blank" rel="noreferrer">
                {hostOf(links.link)}
              </a>
            )}
            {links.resources.map((resource) => (
              <a key={resource.url} href={resource.url} target="_blank" rel="noreferrer">
                {resource.label}
              </a>
            ))}
            {!links.link && links.resources.length === 0 && <span className="faint">—</span>}
          </div>
        </td>
      </tr>

      {open && (
        <tr className={arrived ? 'detail arrived' : 'detail'}>
          <td colSpan={2} />
          <td colSpan={5}>
            {form ?? (
              <>
                <ItemDetail item={item} part={part} links={links} names={names} />
                <div className="detail-actions">
                  <button type="button" className="button" disabled={busy} onClick={onEditItem}>
                    Edit item
                  </button>
                </div>
              </>
            )}
          </td>
        </tr>
      )}
    </>
  )
}

/**
 * Editing writes the baseline, so the inputs start from the baseline and not
 * from the projection — otherwise a slip would be silently promoted into the
 * plan the moment you saved.
 *
 * Moving the start slides the item as a block: the end follows, keeping the same
 * number of study days. Moving the end alone is how the length changes.
 */
function DateEditor({
  item,
  floor,
  blackouts,
  busy,
  onSave,
  onCancel,
}: {
  item: Item
  floor: CivilDate | ''
  blackouts: readonly Blackout[]
  busy: boolean
  onSave: (start: CivilDate, end: CivilDate) => void
  onCancel: () => void
}) {
  const [start, setStart] = useState(item.baselineStartDate)
  const [end, setEnd] = useState(item.baselineEndDate)
  const invalid = end < start

  const slide = (next: CivilDate) => {
    const length = studyDaysBetween(start, end, blackouts)
    setStart(next)
    setEnd(length > 0 ? shiftStudyDays(next, length - 1, blackouts) : next)
  }

  return (
    <>
      <td className="col-date">
        <DatePicker
          value={start}
          min={floor || undefined}
          disabled={busy}
          label={`Planned start of ${item.name}`}
          onChange={slide}
        />
      </td>

      <td className="col-date">
        <DatePicker
          value={end}
          min={start}
          disabled={busy}
          label={`Planned end of ${item.name}`}
          onChange={setEnd}
        />
        {invalid && <div className="planned bad">end is before start</div>}
      </td>

      <td className="col-edit">
        <div className="edit-actions">
          <button
            type="button"
            className="icon-button save"
            disabled={busy || invalid}
            aria-label="Save the dates"
            title="Save"
            onClick={() => onSave(start, end)}
          >
            ✓
          </button>
          <button
            type="button"
            className="icon-button"
            disabled={busy}
            aria-label="Cancel editing"
            title="Cancel"
            onClick={onCancel}
          >
            ✕
          </button>
        </div>
      </td>
    </>
  )
}

function signed(days: number): string {
  return days > 0 ? `+${days}` : String(days)
}
