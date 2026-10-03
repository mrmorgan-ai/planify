import { useState } from 'react'
import { addDays, firstStudyDayFrom, maxDate } from '../core/dates'
import { dependentsOf, hasProgress, newId, type Edit } from '../core/edits'
import type { AppState, CivilDate, Task, PhaseNumber } from '../core/types'
import { DatePicker } from './DatePicker'
import { Field, TaskForm, blankDraft, draftOf, editsFor, fieldsOf } from './TaskForm'

const STATE_WORD = { pending: 'pending', in_progress: 'in progress', done: 'done' } as const

/**
 * A new task, in the phase being looked at: it starts as a step of the story
 * there that ends last, and on the first study day after that phase's last task
 * ends, which is where a new task most often goes, lasting a day until told
 * otherwise. Choosing a story in another phase puts it in that phase. The id is
 * picked here from the name, so the row can be opened once it exists; the
 * server refuses it if it was taken in the meantime.
 */
export function NewTaskForm({
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
  const [start, setStart] = useState(() => nextFreeDay(state, phase))
  const [end, setEnd] = useState(start)
  const { roadmap } = state

  return (
    <div className="new-task">
      <h3>New task</h3>
      <TaskForm
        state={state}
        self={null}
        initial={blankDraft(latestStory(state, phase))}
        busy={busy}
        error={error}
        submitLabel="Create task"
        extra={
          <>
            <Field label="Planned">
              <div className="form-dates">
                <DatePicker
                  value={start}
                  min={roadmap.startDate || undefined}
                  disabled={busy}
                  label="Planned start of the new task"
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
                  label="Planned end of the new task"
                  onChange={setEnd}
                />
              </div>
            </Field>
          </>
        }
        onCancel={onCancel}
        onSubmit={(draft) => {
          const fields = fieldsOf(draft)
          const id = newId(fields.name, state)
          const story = state.stories.find((each) => each.id === fields.storyId)
          onCreate(
            [
              {
                op: 'createTask',
                task: {
                  ...fields,
                  id,
                  baselineStartDate: start,
                  baselineEndDate: end,
                  dependsOn: draft.dependsOn,
                },
              },
            ],
            id,
            story?.phase ?? phase,
          )
        }}
      />
    </div>
  )
}

/**
 * Deleting says what it does before it does it: who waited on the task and what
 * they will wait on instead, and the progress that goes with it. A phase's
 * closing milestone is not offered at all — the phase has to close on something
 * else first.
 */
export function DeleteTask({
  state,
  task,
  busy,
  onDelete,
}: {
  state: AppState
  task: Task
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
        Delete task…
      </button>
    )
  }

  const names = new Map(state.tasks.map((each) => [each.id, each.name]))
  const dependents = dependentsOf(state.tasks, task.id)
  const closes = state.roadmap.phases.find((phase) => phase.closingMilestoneId === task.id)
  const progress = hasProgress(task)
  const through = task.dependsOn.map((id) => names.get(id) ?? id)

  return (
    <div className="delete-confirm" role="group" aria-label={`Delete ${task.name}`}>
      {closes ? (
        <p>
          {task.name} closes phase {closes.number}, so it cannot be deleted until another task
          closes that phase.
        </p>
      ) : (
        <>
          <p>
            Delete <strong>{task.name}</strong>?
          </p>
          <ul>
            {dependents.length > 0 && (
              <li>
                {dependents.length === 1 ? '1 task waits' : `${dependents.length} tasks wait`} on
                it: {dependents.map((each) => each.name).join(', ')}.{' '}
                {through.length > 0
                  ? `${dependents.length === 1 ? 'It' : 'They'} will wait on ${through.join(', ')} instead.`
                  : `${dependents.length === 1 ? 'It' : 'They'} will no longer wait on anything through it.`}
              </li>
            )}
            {progress && (
              <li>
                It is {STATE_WORD[task.state]}
                {task.hoursDone > 0 ? ` with ${task.hoursDone}h logged` : ''}; that progress is
                deleted with it.
              </li>
            )}
            {dependents.length === 0 && !progress && (
              <li>Nothing waits on it, and it has no progress.</li>
            )}
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
                op: 'deleteTask',
                id: task.id,
                rewire: dependents.length > 0,
                discardProgress: progress,
              })
            }
          >
            {busy ? 'Deleting…' : 'Delete task'}
          </button>
        )}
      </div>
    </div>
  )
}

/** The story of the phase whose tasks end last, or empty when the phase has none. */
function latestStory(state: AppState, phase: PhaseNumber): string {
  const inPhase = new Set(
    state.stories.filter((story) => story.phase === phase).map((story) => story.id),
  )
  const last = state.tasks
    .filter((task) => inPhase.has(task.storyId))
    .reduce<Task | null>(
      (latest, task) =>
        latest === null || task.baselineEndDate > latest.baselineEndDate ? task : latest,
      null,
    )
  return last?.storyId ?? [...inPhase][0] ?? ''
}

/** The first study day after the phase's last planned day, or where the plan starts. */
function nextFreeDay(state: AppState, phase: PhaseNumber): CivilDate {
  const { roadmap, today } = state
  const last = state.tasks
    .filter((task) => task.phase === phase)
    .reduce<CivilDate | null>(
      (max, task) => (max === null || task.baselineEndDate > max ? task.baselineEndDate : max),
      null,
    )
  const from = last === null ? maxDate(today, roadmap.startDate || today) : addDays(last, 1)
  return firstStudyDayFrom(from, roadmap.blackouts)
}

type Place = 'keep' | 'first' | `after:${string}`

/**
 * An existing task's form, plus its place in its phase's order. A move is sent
 * after the field edits, in the same write, so a renamed task that also moves
 * lands whole or not at all. A task changes phase by changing story, and then
 * goes last in its new phase, so the place applies only while it stays.
 */
export function EditTaskForm({
  state,
  task,
  busy,
  error,
  onSave,
  onDelete,
  onCancel,
}: {
  state: AppState
  task: Task
  busy: boolean
  error: string | null
  /** `phase` is where the task ends up, so the view can follow it. */
  onSave: (edits: Edit[], phase: PhaseNumber) => void
  onDelete: (edit: Edit) => void
  onCancel: () => void
}) {
  const [place, setPlace] = useState<Place>('keep')
  const others = state.tasks
    .filter((each) => each.phase === task.phase && each.id !== task.id)
    .sort((a, b) => a.sortOrder - b.sortOrder)
  const phaseOf = (storyId: string) =>
    state.stories.find((story) => story.id === storyId)?.phase ?? task.phase

  const move = (phase: PhaseNumber): Edit[] => {
    if (phase !== task.phase || place === 'keep') return []
    const at =
      place === 'first' ? 0 : others.findIndex((each) => `after:${each.id}` === place) + 1
    return [{ op: 'moveTask', id: task.id, before: others[at]?.id ?? null }]
  }

  return (
    <TaskForm
      state={state}
      self={task.id}
      initial={draftOf(task)}
      busy={busy}
      error={error}
      submitLabel="Save"
      extra={
        <Field label="Place" htmlFor={`place-${task.id}`}>
          <div className="form-place">
            <select
              id={`place-${task.id}`}
              aria-label={`Place of ${task.name} in its phase`}
              value={place}
              disabled={busy}
              onChange={(event) => setPlace(event.target.value as Place)}
            >
              <option value="keep">Where it is</option>
              <option value="first">First</option>
              {others.map((each) => (
                <option key={each.id} value={`after:${each.id}`}>
                  After {each.name}
                </option>
              ))}
            </select>
          </div>
        </Field>
      }
      danger={<DeleteTask state={state} task={task} busy={busy} onDelete={onDelete} />}
      onCancel={onCancel}
      onSubmit={(draft) => {
        const phase = phaseOf(draft.storyId)
        onSave([...editsFor(task, draft), ...move(phase)], phase)
      }}
    />
  )
}
