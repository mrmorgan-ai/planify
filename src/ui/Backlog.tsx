import { useEffect, useRef, useState, type ReactNode } from 'react'
import { STATES } from '../core/constants'
import { shiftStudyDays, studyDaysBetween } from '../core/dates'
import {
  hasSlipped,
  isOverdue,
  matchesFilter,
  slipDays,
  TASK_FILTERS,
  type TaskFilter,
} from '../core/selectors'
import { Link as RouterLink } from 'react-router-dom'
import { newId, type Edit } from '../core/edits'
import type { AppState, Blackout, CivilDate, Task, Resource, State, Story } from '../core/types'
import { linksOf, storyEntries, storyState, taskLabel, type TaskLabel } from '../core/stories'
import { DatePicker } from './DatePicker'
import { hostOf, TaskDetail } from './TaskDetail'
import { GeneratePanel } from './Generate'
import { EditTaskForm, NewTaskForm } from './TaskEditing'
import { DeleteStory, MoveTasksHere, StoryForm } from './StoryEditing'
import { scrollToRow, useArrival } from './useArrival'
import { PhaseSidebar, type PhaseSelection } from './PhaseSidebar'
import type { Store } from './useAppState'

const STATE_LABEL: Record<State, string> = {
  pending: 'Pending',
  in_progress: 'In progress',
  done: 'Done',
}

const FILTER_LABEL: Record<TaskFilter, string> = {
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
 * The phase is read as its stories, each a row with its tasks under it: a story
 * opens to show its own details and edit them, and unfolds to list its tasks.
 * Each story's folding is remembered in this browser; one with a task under way
 * starts unfolded. The filters pick tasks, and a story shows while any of its
 * tasks match.
 *
 * Dates are editable on each task's row. What you edit is the baseline — the
 * plan — and the server recomputes every projection from it, so anything that
 * depends on the task you moved follows. Dependencies are shown as information,
 * never as a lock: nothing here stops you starting anything.
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
  const [filter, setFilter] = useState<TaskFilter>('all')
  const [phase, setPhase] = useState<PhaseSelection>(state.roadmap.phases[0]?.number ?? null)
  const [unfolded, setUnfolded] = useUnfolded(state)
  const [panel, setPanel] = useState<StoryPanel | null>(null)
  const [expanded, setExpanded] = useState<string | null>(null)
  const [editing, setEditing] = useState<string | null>(null)
  const [editingTask, setEditingTask] = useState<string | null>(null)
  /** The new-task form, and the story it was asked for from, when it was. */
  const [creating, setCreating] = useState<{ storyId?: string } | null>(null)
  const [creatingStory, setCreatingStory] = useState(false)
  const [generating, setGenerating] = useState(false)
  /**
   * Which form's last save was refused — a task's or story's id, `new` or
   * `new-story` — so the store's error shows in that form and not in every
   * open one.
   */
  const [refused, setRefused] = useState<string | null>(null)

  const unfold = (storyId: string) => setUnfolded((current) => new Set(current).add(storyId))
  const save = async (key: string, edits: Edit[]) => {
    const saved = await edit(edits, key)
    setRefused(saved ? null : key)
    return saved
  }

  /**
   * `?task=` is how the Gantt and the board hand a row over: its phase is
   * shown, the filter that might hide it cleared, its story unfolded and the
   * task expanded; the row then scrolls itself into view and is highlighted.
   */
  const taskArrival = useArrival(
    'task',
    (id) => state.tasks.some((task) => task.id === id),
    (id) => {
      const target = state.tasks.find((task) => task.id === id)
      if (!target) return
      setPhase(target.phase)
      setFilter('all')
      unfold(target.storyId)
      setExpanded(target.id)
    },
  )
  /** `?story=` opens a story's details the same way. */
  const storyArrival = useArrival(
    'story',
    (id) => state.stories.some((story) => story.id === id),
    (id) => {
      const target = state.stories.find((story) => story.id === id)
      if (!target) return
      setPhase(target.phase)
      setFilter('all')
      unfold(target.id)
      setPanel({ storyId: target.id, mode: 'detail' })
    },
  )
  const missing = taskArrival.missing ?? storyArrival.missing

  const inPhase = state.tasks.filter((task) => phase === null || task.phase === phase)
  const entries = storyEntries(state.tasks, state.stories)
    .filter(({ story }) => phase === null || story.phase === phase)
    .map((entry) => ({
      ...entry,
      shown: entry.tasks.filter((task) => matchesFilter(task, filter, state.today)),
    }))
    // An empty story only shows unfiltered: no filter can pick a task it lacks.
    .filter((entry) => entry.shown.length > 0 || (filter === 'all' && entry.tasks.length === 0))

  const names = new Map(state.tasks.map((task) => [task.id, task.name]))
  const featureName = new Map(state.features.map((feature) => [feature.id, feature.name]))
  const noStories = state.stories.length === 0
  const where = phase ?? state.roadmap.phases[0]?.number ?? 1

  return (
    <section className="backlog">
      <PhaseSidebar
        phases={state.roadmap.phases}
        tasks={state.tasks}
        selected={phase}
        onSelect={setPhase}
      />

      <div className="tasks-pane">
        {missing && (
          <p className="notice" role="status">
            The link pointed at <code>{missing}</code>, which is not in the roadmap any more.
          </p>
        )}

        <div className="filters">
          {TASK_FILTERS.map((candidate) => (
            <button
              key={candidate}
              type="button"
              className={candidate === filter ? 'chip active' : 'chip'}
              onClick={() => setFilter(candidate)}
            >
              {FILTER_LABEL[candidate]}
              <span className="count">
                {inPhase.filter((task) => matchesFilter(task, candidate, state.today)).length}
              </span>
            </button>
          ))}
          <button
            type="button"
            className={noStories ? 'button primary push-end' : 'button push-end'}
            disabled={creatingStory || creating !== null || generating}
            onClick={() => {
              setRefused(null)
              setCreatingStory(true)
            }}
          >
            + New story
          </button>
          <button
            type="button"
            className="button"
            disabled={noStories || creatingStory || creating !== null || generating}
            title={noStories ? 'A task is a step of a story: create a story first' : undefined}
            onClick={() => {
              setRefused(null)
              setCreating({})
            }}
          >
            + New task
          </button>
          <button
            type="button"
            className="button"
            disabled={creatingStory || creating !== null || generating}
            onClick={() => setGenerating(true)}
          >
            + Generate…
          </button>
        </div>

        {noStories && !creatingStory && (
          <p className="settings-text">
            Every task is a step of a story — a course, a project, an exam. Create a story first,
            or generate one with its tasks already placed.
          </p>
        )}

        {generating && (
          <GeneratePanel
            state={state}
            phase={where}
            draft={mode === 'draft'}
            error={error}
            generate={generate}
            onCancel={() => setGenerating(false)}
            onDone={(placed, into) => {
              setGenerating(false)
              setPhase(into)
              setFilter('all')
              const first = state.tasks.find((task) => task.id === placed[0]?.id)
              if (first) unfold(first.storyId)
              setExpanded(placed[0]?.id ?? null)
            }}
          />
        )}

        {creatingStory && (
          <div className="new-task">
            <h3>New story</h3>
            <StoryForm
              story={null}
              phases={state.roadmap.phases}
              features={state.features}
              phase={where}
              busy={pendingId === 'new-story'}
              error={refused === 'new-story' ? error : null}
              onCancel={() => setCreatingStory(false)}
              onSubmit={async (fields) => {
                const id = newId(fields.name, state)
                if (!(await save('new-story', [{ op: 'createStory', story: { ...fields, id } }]))) {
                  return
                }
                setCreatingStory(false)
                setPhase(fields.phase)
                setFilter('all')
                unfold(id)
                // A new story is empty: its first task is what comes next.
                setCreating({ storyId: id })
              }}
            />
          </div>
        )}

        {creating && (
          <NewTaskForm
            key={creating.storyId ?? 'any'}
            state={state}
            phase={where}
            storyId={creating.storyId}
            busy={pendingId === 'new'}
            error={refused === 'new' ? error : null}
            onCancel={() => setCreating(null)}
            onCreate={async (edits, id, into) => {
              if (!(await save('new', edits))) return
              setCreating(null)
              setPhase(into)
              setFilter('all')
              const created = edits.find((each) => each.op === 'createTask')
              if (created?.op === 'createTask') unfold(created.task.storyId)
              setExpanded(id)
            }}
          />
        )}

        {entries.length === 0 ? (
          <p className="empty">
            {noStories ? 'No stories yet.' : 'Nothing matches this filter in this phase.'}
          </p>
        ) : (
          <table className="tasks">
            <thead>
              <tr>
                <th className="col-state">State</th>
                <th className="col-type">Type</th>
                <th className="col-name">Story · task</th>
                <th className="col-date">Start</th>
                <th className="col-date">End</th>
                <th className="col-edit" />
                <th className="col-resources">Resources</th>
              </tr>
            </thead>
            {entries.map(({ story, tasks, shown }) => {
              const open = unfolded.has(story.id)
              const storyPanel = panel?.storyId === story.id ? panel.mode : null
              return (
                <tbody key={story.id} className="story-group">
                  <StoryRow
                    story={story}
                    tasks={tasks}
                    today={state.today}
                    open={open}
                    panelOpen={storyPanel !== null}
                    arrived={storyArrival.arrived === story.id}
                    busy={pendingId === story.id}
                    showPhase={phase === null}
                    onToggle={() =>
                      setUnfolded((current) => {
                        const next = new Set(current)
                        if (next.has(story.id)) next.delete(story.id)
                        else next.add(story.id)
                        return next
                      })
                    }
                    onPanel={() => {
                      setRefused(null)
                      setPanel(storyPanel ? null : { storyId: story.id, mode: 'detail' })
                    }}
                    onAddTask={() => {
                      setRefused(null)
                      setCreating({ storyId: story.id })
                    }}
                  />

                  {storyPanel && (
                    <tr className="detail story-detail">
                      <td colSpan={2} />
                      <td colSpan={5}>
                        {storyPanel === 'edit' ? (
                          <StoryForm
                            key={story.id}
                            story={story}
                            phases={state.roadmap.phases}
                            features={state.features}
                            phase={story.phase}
                            busy={pendingId === story.id}
                            error={refused === story.id ? error : null}
                            onCancel={() => setPanel({ storyId: story.id, mode: 'detail' })}
                            onSubmit={async (fields) => {
                              const edits: Edit[] = [{ op: 'updateStory', id: story.id, fields }]
                              if (!(await save(story.id, edits))) return
                              setPanel({ storyId: story.id, mode: 'detail' })
                              if (phase !== null && fields.phase !== phase) setPhase(fields.phase)
                            }}
                            danger={
                              <DeleteStory
                                story={story}
                                tasks={tasks.length}
                                busy={pendingId === story.id}
                                onDelete={async (deletion) => {
                                  if (await save(story.id, [deletion])) setPanel(null)
                                }}
                              />
                            }
                          />
                        ) : storyPanel === 'move' ? (
                          <MoveTasksHere
                            state={state}
                            story={story}
                            busy={pendingId === story.id}
                            onCancel={() => setPanel({ storyId: story.id, mode: 'detail' })}
                            onMove={async (edits) => {
                              if (!(await save(story.id, edits))) return
                              unfold(story.id)
                              setPanel({ storyId: story.id, mode: 'detail' })
                            }}
                          />
                        ) : (
                          <StoryDetail
                            story={story}
                            feature={story.featureId ? featureName.get(story.featureId) : undefined}
                            busy={pendingId === story.id}
                            onEdit={() => {
                              setRefused(null)
                              setPanel({ storyId: story.id, mode: 'edit' })
                            }}
                            onMove={() => setPanel({ storyId: story.id, mode: 'move' })}
                            onAddTask={() => {
                              setRefused(null)
                              setCreating({ storyId: story.id })
                            }}
                          />
                        )}
                        {refused === story.id && storyPanel !== 'edit' && error && (
                          <p className="form-error" role="alert">
                            {error}
                          </p>
                        )}
                      </td>
                    </tr>
                  )}

                  {open &&
                    shown.map((task) => (
                      <Row
                        key={task.id}
                        task={task}
                        today={state.today}
                        floor={state.roadmap.startDate}
                        blackouts={state.roadmap.blackouts}
                        busy={pendingId === task.id}
                        open={expanded === task.id}
                        arrived={taskArrival.arrived === task.id}
                        editing={editing === task.id}
                        names={names}
                        part={taskLabel(task, state.stories, state.tasks)}
                        links={linksOf(task, state.stories)}
                        form={
                          editingTask === task.id ? (
                            <EditTaskForm
                              key={task.id}
                              state={state}
                              task={task}
                              busy={pendingId === task.id}
                              error={refused === task.id ? error : null}
                              onCancel={() => setEditingTask(null)}
                              onSave={async (edits, into) => {
                                const saved = edits.length === 0 || (await save(task.id, edits))
                                if (!saved) return
                                setEditingTask(null)
                                if (phase !== null && into !== phase) setPhase(into)
                              }}
                              onDelete={async (deletion) => {
                                if (!(await save(task.id, [deletion]))) return
                                setEditingTask(null)
                                setExpanded(null)
                              }}
                            />
                          ) : null
                        }
                        onEditTask={() => {
                          setRefused(null)
                          setEditingTask(task.id)
                        }}
                        onToggle={() => {
                          if (expanded === task.id && editingTask === task.id) setEditingTask(null)
                          setExpanded(expanded === task.id ? null : task.id)
                        }}
                        onEdit={() => setEditing(editing === task.id ? null : task.id)}
                        onChange={(next) => void changeState(task.id, next)}
                        onSaveDates={async (start, end) => {
                          if (await changeDates(task.id, start, end)) setEditing(null)
                        }}
                      />
                    ))}
                </tbody>
              )
            })}
          </table>
        )}
      </div>
    </section>
  )
}

/** Which story's own panel is open, and what it shows. */
type StoryPanel = { storyId: string; mode: 'detail' | 'edit' | 'move' }

/** Where each browser keeps which stories are unfolded. */
const UNFOLDED_KEY = 'planify.backlog.unfolded'

/**
 * The stories shown with their tasks, remembered in this browser. With nothing
 * remembered, the stories with a task under way start unfolded: that is where
 * the work is.
 */
function useUnfolded(state: AppState) {
  const [unfolded, setUnfolded] = useState<Set<string>>(() => {
    try {
      const stored = localStorage.getItem(UNFOLDED_KEY)
      if (stored !== null) return new Set(JSON.parse(stored) as string[])
    } catch {
      // A private window may refuse; fall through to the default.
    }
    return new Set(
      state.tasks.filter((task) => task.state === 'in_progress').map((task) => task.storyId),
    )
  })
  useEffect(() => {
    try {
      localStorage.setItem(UNFOLDED_KEY, JSON.stringify([...unfolded]))
    } catch {
      // Not remembered, then: the folding still works for this visit.
    }
  }, [unfolded])
  return [unfolded, setUnfolded] as const
}

/**
 * A story's line: what it is, how far through its tasks, and when — the span
 * from its first task's start to its last task's end, as projected. The ▸
 * unfolds its tasks; the name opens the story's own details.
 */
function StoryRow({
  story,
  tasks,
  today,
  open,
  panelOpen,
  arrived,
  busy,
  showPhase,
  onToggle,
  onPanel,
  onAddTask,
}: {
  story: Story
  tasks: Task[]
  today: string
  open: boolean
  panelOpen: boolean
  arrived: boolean
  busy: boolean
  showPhase: boolean
  onToggle: () => void
  onPanel: () => void
  onAddTask: () => void
}) {
  const row = useRef<HTMLTableRowElement>(null)
  useEffect(() => {
    if (arrived) scrollToRow(row.current)
  }, [arrived])

  const current = storyState(tasks)
  const done = tasks.filter((task) => task.state === 'done').length
  const start = tasks.reduce<string | null>(
    (min, task) => (min === null || task.projectedStartDate < min ? task.projectedStartDate : min),
    null,
  )
  const end = tasks.reduce<string | null>(
    (max, task) => (max === null || task.projectedEndDate > max ? task.projectedEndDate : max),
    null,
  )
  const late = tasks.some((task) => isOverdue(task, today))
  const links = { link: story.link, resources: story.resources }

  return (
    <tr
      ref={row}
      className={
        ['story-row', current === 'done' ? 'done' : '', panelOpen ? 'open' : '', arrived ? 'arrived' : '']
          .filter(Boolean)
          .join(' ')
      }
    >
      <td className="col-state">
        <span className={`state-tag ${current}`}>{STATE_LABEL[current]}</span>
      </td>
      <td className="col-type">{story.type && <span className="type-tag">{story.type}</span>}</td>
      <td className="col-name">
        <div className="name-line">
          <button
            type="button"
            className="disclosure"
            aria-expanded={open}
            aria-label={`Tasks of ${story.name}`}
            disabled={tasks.length === 0}
            onClick={onToggle}
          >
            {open ? '▾' : '▸'}
          </button>
          <button
            type="button"
            className="story-name"
            aria-expanded={panelOpen}
            title={`Details of ${story.name}`}
            onClick={onPanel}
          >
            {story.name}
          </button>
          <span className="count story-count">
            {tasks.length === 0
              ? 'no tasks yet'
              : `${tasks.length} ${tasks.length === 1 ? 'task' : 'tasks'} · ${done} of ${tasks.length}`}
          </span>
          {showPhase && <span className="phase-tag">phase {story.phase}</span>}
        </div>
      </td>
      <td className="col-date">{start ?? <span className="faint">—</span>}</td>
      <td className={late ? 'col-date late' : 'col-date'}>{end && <div>{end}</div>}</td>
      <td className="col-edit">
        <button
          type="button"
          className="icon-button"
          disabled={busy}
          aria-label={`Add a task to ${story.name}`}
          title="Add a task to this story"
          onClick={onAddTask}
        >
          +
        </button>
      </td>
      <td className="col-resources">
        <Links links={links} />
      </td>
    </tr>
  )
}

/** A story's own details, and what can be done with it. */
function StoryDetail({
  story,
  feature,
  busy,
  onEdit,
  onMove,
  onAddTask,
}: {
  story: Story
  /** The name of the feature it serves, when it serves one. */
  feature: string | undefined
  busy: boolean
  onEdit: () => void
  onMove: () => void
  onAddTask: () => void
}) {
  return (
    <div className="task-detail">
      {story.notes && (
        <div className="detail-line">
          <span className="detail-label">What it is</span>
          <span className="notes">{story.notes}</span>
        </div>
      )}
      {story.doneWhen && (
        <div className="detail-line">
          <span className="detail-label">Done when</span>
          <span className="notes">{story.doneWhen}</span>
        </div>
      )}
      <div className="detail-line">
        <span className="detail-label">Feature</span>
        {feature ? (
          <RouterLink className="part-link" to={`/features?feature=${encodeURIComponent(story.featureId!)}`}>
            {feature}
          </RouterLink>
        ) : (
          <span className="faint">none — it stands on its own</span>
        )}
      </div>
      {story.price && (
        <div className="detail-line">
          <span className="detail-label">Price</span>
          <span className="notes">{story.price}</span>
        </div>
      )}
      <div className="detail-actions">
        <button type="button" className="button" disabled={busy} onClick={onEdit}>
          Edit story
        </button>
        <button type="button" className="button" disabled={busy} onClick={onAddTask}>
          + Task
        </button>
        <button type="button" className="button" disabled={busy} onClick={onMove}>
          Move tasks here…
        </button>
      </div>
    </div>
  )
}

/** A link or extra links, by where they go; a dash when there are none. */
function Links({ links }: { links: { link: string | null; resources: Resource[] } }) {
  return (
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
  )
}

function Row({
  task,
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
  form,
  onEditTask,
  onToggle,
  onEdit,
  onChange,
  onSaveDates,
}: {
  task: Task
  today: string
  floor: CivilDate | ''
  blackouts: readonly Blackout[]
  busy: boolean
  open: boolean
  /** Just reached through a link: scroll to it and highlight it. */
  arrived: boolean
  editing: boolean
  names: Map<string, string>
  /** Which story this row is a part of, when it is one. */
  part: TaskLabel | null
  /** Its own links, or its story's when it carries none. */
  links: { link: string | null; resources: Resource[] }
  /** The task's edit form, while it is open in place of the detail. */
  form: ReactNode
  onEditTask: () => void
  onToggle: () => void
  onEdit: () => void
  onChange: (next: State) => void
  onSaveDates: (start: CivilDate, end: CivilDate) => void
}) {
  const late = isOverdue(task, today)
  const slipped = hasSlipped(task)
  const row = useRef<HTMLTableRowElement>(null)
  useEffect(() => {
    if (arrived) scrollToRow(row.current)
  }, [arrived])

  const rowClass = [
    'in-story',
    late ? 'overdue' : '',
    task.state === 'done' ? 'done' : '',
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
            className={`state-select ${task.state}`}
            value={task.state}
            disabled={busy}
            aria-label={`State of ${task.name}`}
            onChange={(event) => onChange(event.target.value as State)}
          >
            {STATES.map((candidate) => (
              <option key={candidate} value={candidate}>
                {STATE_LABEL[candidate]}
              </option>
            ))}
          </select>
        </td>

        <td className="col-type" />

        <td className="col-name">
          <div className="name-line">
            <button
              type="button"
              className="disclosure"
              aria-expanded={open}
              aria-label={`Details of ${task.name}`}
              onClick={onToggle}
            >
              {open ? '▾' : '▸'}
            </button>
            {part && (
              <span className="part-count" title={`Part ${part.index} of ${part.total} · ${part.story.name}`}>
                {part.index}/{part.total}
              </span>
            )}
            <span className="name">{task.name}</span>
          </div>
        </td>

        {editing ? (
          <DateEditor
            task={task}
            floor={floor}
            blackouts={blackouts}
            busy={busy}
            onSave={onSaveDates}
            onCancel={onEdit}
          />
        ) : (
          <>
            <td className="col-date">
              <div>{task.projectedStartDate}</div>
              {slipped && <div className="planned">was {task.baselineStartDate}</div>}
            </td>

            <td className={late ? 'col-date late' : 'col-date'}>
              <div>{task.projectedEndDate}</div>
              {slipped && (
                <div className="planned">
                  was {task.baselineEndDate} ({signed(slipDays(task))}d)
                </div>
              )}
            </td>

            <td className="col-edit">
              <button
                type="button"
                className="icon-button"
                disabled={busy}
                aria-label={`Edit the dates of ${task.name}`}
                title="Edit the planned dates"
                onClick={onEdit}
              >
                ✎
              </button>
            </td>
          </>
        )}

        <td className="col-resources">
          <Links links={links} />
        </td>
      </tr>

      {open && (
        <tr className={arrived ? 'detail arrived' : 'detail'}>
          <td colSpan={2} />
          <td colSpan={5}>
            {form ?? (
              <>
                <TaskDetail task={task} part={part} links={links} names={names} />
                <div className="detail-actions">
                  <button type="button" className="button" disabled={busy} onClick={onEditTask}>
                    Edit task
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
 * Moving the start slides the task as a block: the end follows, keeping the same
 * number of study days. Moving the end alone is how the length changes.
 */
function DateEditor({
  task,
  floor,
  blackouts,
  busy,
  onSave,
  onCancel,
}: {
  task: Task
  floor: CivilDate | ''
  blackouts: readonly Blackout[]
  busy: boolean
  onSave: (start: CivilDate, end: CivilDate) => void
  onCancel: () => void
}) {
  const [start, setStart] = useState(task.baselineStartDate)
  const [end, setEnd] = useState(task.baselineEndDate)
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
          label={`Planned start of ${task.name}`}
          onChange={slide}
        />
      </td>

      <td className="col-date">
        <DatePicker
          value={end}
          min={start}
          disabled={busy}
          label={`Planned end of ${task.name}`}
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
