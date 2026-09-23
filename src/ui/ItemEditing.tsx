import { useState } from 'react'
import { addDays, firstStudyDayFrom, maxDate } from '../core/dates'
import { dependentsOf, hasProgress, newItemId, type Edit } from '../core/edits'
import type { AppState, CivilDate, Item, PhaseNumber } from '../core/types'
import { DatePicker } from './DatePicker'
import { Field, ItemForm, blankDraft, fieldsOf } from './ItemForm'

const STATE_WORD = { pending: 'pending', in_progress: 'in progress', done: 'done' } as const

/**
 * A new item, in the phase being looked at. It starts on the first study day
 * after that phase's last item ends, which is where a new item most often goes,
 * and lasts a day until told otherwise. The id is picked here from the name, so
 * the row can be opened once it exists; the server refuses it if it was taken
 * in the meantime.
 */
export function NewItemForm({
  state,
  phase,
  busy,
  error,
  onCreate,
  onCancel,
}: {
  state: AppState
  phase: PhaseNumber
  busy: boolean
  error: string | null
  onCreate: (edits: Edit[], id: string, phase: PhaseNumber) => void
  onCancel: () => void
}) {
  const [inPhase, setInPhase] = useState<PhaseNumber>(phase)
  const [start, setStart] = useState(() => nextFreeDay(state, phase))
  const [end, setEnd] = useState(start)
  const { roadmap } = state

  return (
    <div className="new-item">
      <h3>New item</h3>
      <ItemForm
        state={state}
        self={null}
        initial={blankDraft()}
        busy={busy}
        error={error}
        submitLabel="Create item"
        extra={
          <>
            <Field label="Phase" htmlFor="new-item-phase">
              <select
                id="new-item-phase"
                value={inPhase}
                disabled={busy}
                onChange={(event) => {
                  const next = Number(event.target.value) as PhaseNumber
                  const day = nextFreeDay(state, next)
                  setInPhase(next)
                  setStart(day)
                  setEnd(day)
                }}
              >
                {roadmap.phases.map((each) => (
                  <option key={each.number} value={each.number}>
                    Phase {each.number} · {each.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Planned">
              <div className="form-dates">
                <DatePicker
                  value={start}
                  min={roadmap.startDate || undefined}
                  disabled={busy}
                  label="Planned start of the new item"
                  onChange={(day) => {
                    setStart(day)
                    if (end < day) setEnd(day)
                  }}
                />
                <span className="faint">to</span>
                <DatePicker
                  value={end}
                  min={start}
                  disabled={busy}
                  label="Planned end of the new item"
                  onChange={setEnd}
                />
              </div>
            </Field>
          </>
        }
        onCancel={onCancel}
        onSubmit={(draft) => {
          const fields = fieldsOf(draft)
          const id = newItemId(fields.name, state)
          onCreate(
            [
              {
                op: 'createItem',
                item: {
                  ...fields,
                  id,
                  phase: inPhase,
                  baselineStartDate: start,
                  baselineEndDate: end,
                  dependsOn: draft.dependsOn,
                },
              },
            ],
            id,
            inPhase,
          )
        }}
      />
    </div>
  )
}

/**
 * Deleting says what it does before it does it: who waited on the item and what
 * they will wait on instead, and the progress that goes with it. A phase's
 * closing milestone is not offered at all — the phase has to close on something
 * else first.
 */
export function DeleteItem({
  state,
  item,
  busy,
  onDelete,
}: {
  state: AppState
  item: Item
  busy: boolean
  onDelete: (edit: Edit) => void
}) {
  const [asking, setAsking] = useState(false)
  if (!asking) {
    return (
      <button
        type="button"
        className="button danger push-end"
        disabled={busy}
        onClick={() => setAsking(true)}
      >
        Delete item…
      </button>
    )
  }

  const names = new Map(state.items.map((each) => [each.id, each.name]))
  const dependents = dependentsOf(state.items, item.id)
  const closes = state.roadmap.phases.find((phase) => phase.closingMilestoneId === item.id)
  const progress = hasProgress(item)
  const through = item.dependsOn.map((id) => names.get(id) ?? id)

  return (
    <div className="delete-confirm" role="group" aria-label={`Delete ${item.name}`}>
      {closes ? (
        <p>
          {item.name} closes phase {closes.number}, so it cannot be deleted until another item
          closes that phase.
        </p>
      ) : (
        <>
          <p>
            Delete <strong>{item.name}</strong>?
          </p>
          <ul>
            {dependents.length > 0 && (
              <li>
                {dependents.length === 1 ? '1 item waits' : `${dependents.length} items wait`} on
                it: {dependents.map((each) => each.name).join(', ')}.{' '}
                {through.length > 0
                  ? `${dependents.length === 1 ? 'It' : 'They'} will wait on ${through.join(', ')} instead.`
                  : `${dependents.length === 1 ? 'It' : 'They'} will no longer wait on anything through it.`}
              </li>
            )}
            {progress && (
              <li>
                It is {STATE_WORD[item.state]}
                {item.hoursDone > 0 ? ` with ${item.hoursDone}h logged` : ''}; that progress is
                deleted with it.
              </li>
            )}
            {dependents.length === 0 && !progress && <li>Nothing waits on it, and it has no progress.</li>}
          </ul>
        </>
      )}
      <div className="form-actions">
        <button type="button" className="button" disabled={busy} onClick={() => setAsking(false)}>
          Keep it
        </button>
        {!closes && (
          <button
            type="button"
            className="button danger"
            disabled={busy}
            onClick={() =>
              onDelete({
                op: 'deleteItem',
                id: item.id,
                rewire: dependents.length > 0,
                discardProgress: progress,
              })
            }
          >
            {busy ? 'Deleting…' : 'Delete item'}
          </button>
        )}
      </div>
    </div>
  )
}

/** The first study day after the phase's last planned day, or where the plan starts. */
function nextFreeDay(state: AppState, phase: PhaseNumber): CivilDate {
  const { roadmap, today } = state
  const last = state.items
    .filter((item) => item.phase === phase)
    .reduce<CivilDate | null>((max, item) => (max === null || item.baselineEndDate > max ? item.baselineEndDate : max), null)
  const from = last === null ? maxDate(today, roadmap.startDate || today) : addDays(last, 1)
  return firstStudyDayFrom(from, roadmap.blackouts)
}
