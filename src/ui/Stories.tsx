import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Link as RouterLink } from 'react-router-dom'
import { newId } from '../core/edits'
import { estimatedHours } from '../core/hours'
import type { AppState, WorkType, State, Story } from '../core/types'
import { storyEntries, storyHours, storyState, type StoryEntry } from '../core/stories'
import type { Edit } from '../core/edits'
import type { Store } from './useAppState'
import { scrollToRow, useArrival } from './useArrival'
import { DeleteStory, StoryForm } from './StoryEditing'

const STATE_LABEL: Record<State, string> = {
  pending: 'Pending',
  in_progress: 'In progress',
  done: 'Done',
}

type StateFilter = 'all' | State
const FILTERS: readonly StateFilter[] = ['all', 'pending', 'in_progress', 'done'] as const
const FILTER_LABEL: Record<StateFilter, string> = { all: 'All', ...STATE_LABEL }

/** Deliverables first, then what is studied, then the weekly routine, then the unlabelled. */
const SECTIONS: ReadonlyArray<{ type: WorkType | null; label: string }> = [
  { type: 'Project', label: 'Projects' },
  { type: 'Certification', label: 'Certifications' },
  { type: 'Course', label: 'Courses' },
  { type: 'Book', label: 'Books' },
  { type: 'Documentation', label: 'Documentation' },
  { type: 'Paper', label: 'Papers' },
  { type: 'Case study', label: 'Case studies' },
  { type: 'Exam prep', label: 'Exam prep' },
  { type: 'Practice', label: 'Practice' },
  { type: null, label: 'Other' },
]

/**
 * The roadmap as stories rather than as a calendar: a course with its weeks, a
 * project with its steps. No dates on purpose — the question here is "how far
 * through this am I", and the backlog and the Gantt already answer "when".
 *
 * State is changed where it always is, on the backlog or the board, and every
 * task links back to its row there. What is edited here is the story itself;
 * which story a task is a step of is chosen in the task's own form.
 */
export function Stories({
  state,
  error,
  pendingId,
  edit,
}: Pick<Store, 'error' | 'pendingId' | 'edit'> & { state: AppState }) {
  const [filter, setFilter] = useState<StateFilter>('all')
  const [open, setOpen] = useState<Set<string>>(new Set())
  const [creating, setCreating] = useState(false)
  const [editing, setEditing] = useState<string | null>(null)
  /** The form whose last save was refused: a story's id, or `new`. */
  const [refused, setRefused] = useState<string | null>(null)
  const { phases } = state.roadmap

  const save = async (key: string, edits: Edit[]) => {
    const saved = await edit(edits, key)
    setRefused(saved ? null : key)
    return saved
  }

  /** The form for one story, or null when it is not being edited. */
  const editorFor = (story: Story, tasks: number): ReactNode =>
    editing === story.id ? (
      <StoryForm
        key={story.id}
        story={story}
        phases={phases}
        phase={story.phase}
        busy={pendingId === story.id}
        error={refused === story.id ? error : null}
        onCancel={() => setEditing(null)}
        onSubmit={async (fields) => {
          const edits: Edit[] = [{ op: 'updateStory', id: story.id, fields }]
          if (await save(story.id, edits)) setEditing(null)
        }}
        danger={
          <DeleteStory
            story={story}
            tasks={tasks}
            busy={pendingId === story.id}
            onDelete={async (deletion) => {
              if (await save(story.id, [deletion])) setEditing(null)
            }}
          />
        }
      />
    ) : null

  const entries = storyEntries(state.tasks, state.stories)
  const started = entries.filter((entry) => entry.tasks.length > 0)
  const empty = entries.filter((entry) => entry.tasks.length === 0)
  const matches = (entry: StoryEntry, candidate: StateFilter) =>
    candidate === 'all' || storyState(entry.tasks) === candidate
  const visible = started.filter((entry) => matches(entry, filter))

  /** `?story=` is how a task hands its story over: open it, bring it into view, highlight it. */
  const { arrived, missing } = useArrival(
    'story',
    (id) => entries.some((entry) => entry.story.id === id),
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
    <section className="stories">
      <h2 className="board-title">Stories</h2>

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
              {started.filter((entry) => matches(entry, candidate)).length}
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
          + New story
        </button>
      </div>

      {creating && (
        <div className="new-task">
          <h3>New story</h3>
          <StoryForm
            story={null}
            phases={phases}
            phase={phases[0]?.number ?? 1}
            busy={pendingId === 'new'}
            error={refused === 'new' ? error : null}
            onCancel={() => setCreating(false)}
            onSubmit={async (fields) => {
              const id = newId(fields.name, state)
              const edits: Edit[] = [{ op: 'createStory', story: { ...fields, id } }]
              if (await save('new', edits)) setCreating(false)
            }}
          />
        </div>
      )}

      {empty.length > 0 && (
        <div className="unit-section">
          <h3 className="unit-section-title">
            No tasks yet <span className="count">{empty.length}</span>
          </h3>
          <p className="settings-text">
            A task joins a story from its own form in the backlog, under “Story”.
          </p>
          <ul className="settings-rows partless">
            {empty.map(({ story }) => (
              <li key={story.id}>
                {editorFor(story, 0) ?? (
                  <div className="partless-line">
                    <span className="name">{story.name}</span>
                    {story.type && <span className="type-tag">{story.type}</span>}
                    <span className="faint">Phase {story.phase}</span>
                    <button
                      type="button"
                      className="button push-end"
                      onClick={() => {
                        setRefused(null)
                        setEditing(story.id)
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
        const inSection = visible.filter((entry) => entry.story.type === type)
        if (inSection.length === 0) return null
        return (
          <div key={type} className="unit-section">
            <h3 className="unit-section-title">
              {label} <span className="count">{inSection.length}</span>
            </h3>
            <table className="tasks units">
              <thead>
                <tr>
                  <th className="col-name">Story</th>
                  <th className="col-phases">Phase</th>
                  <th className="col-progress">Progress</th>
                  <th className="col-hours">Hours</th>
                  <th className="col-unit-state">State</th>
                </tr>
              </thead>
              <tbody>
                {inSection.map((entry) => (
                  <StoryRows
                    key={entry.story.id}
                    entry={entry}
                    open={open.has(entry.story.id)}
                    arrived={arrived === entry.story.id}
                    editor={editorFor(entry.story, entry.tasks.length)}
                    onEdit={() => {
                      setRefused(null)
                      setEditing(entry.story.id)
                    }}
                    onToggle={() => toggle(entry.story.id)}
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

function StoryRows({
  entry,
  open,
  arrived,
  editor,
  onEdit,
  onToggle,
}: {
  entry: StoryEntry
  open: boolean
  arrived: boolean
  /** The story's form, while it is being edited. */
  editor: ReactNode
  onEdit: () => void
  onToggle: () => void
}) {
  const row = useRef<HTMLTableRowElement>(null)
  useEffect(() => {
    if (arrived) scrollToRow(row.current)
  }, [arrived])

  const { story, tasks } = entry
  const current = storyState(tasks)
  const hours = storyHours(tasks)
  const done = tasks.filter((task) => task.state === 'done').length

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
            <button
              type="button"
              className="disclosure"
              aria-expanded={open}
              aria-label={`Tasks of ${story.name}`}
              onClick={onToggle}
            >
              {open ? '▾' : '▸'}
            </button>
            <span className="name">{story.name}</span>
            <span className="count">
              {tasks.length} {tasks.length === 1 ? 'task' : 'tasks'}
            </span>
          </div>
        </td>
        <td className="col-phases">{story.phase}</td>
        <td className="col-progress">
          <span className="progress-count">
            {done} of {tasks.length}
          </span>
          <div className="meter">
            <div
              className="meter-fill"
              style={{ width: `${Math.round((done / tasks.length) * 100)}%` }}
            />
          </div>
        </td>
        <td className="col-hours">
          {hours.done > 0 ? `${trim(hours.done)} of ${trim(hours.total)}h` : `${trim(hours.total)}h`}
          {hours.unestimated > 0 && <div className="faint">{hours.unestimated} without estimate</div>}
        </td>
        <td className="col-unit-state">
          <span className={`state-tag ${current}`}>{STATE_LABEL[current]}</span>
        </td>
      </tr>

      {open && (
        <tr className="detail">
          <td colSpan={5}>
            {editor ?? (
              <div className="detail-line unit-notes">
                {story.notes && <span className="notes">{story.notes}</span>}
                <button type="button" className="button push-end" onClick={onEdit}>
                  Edit story
                </button>
              </div>
            )}
          </td>
        </tr>
      )}

      {open &&
        tasks.map((task, index) => {
          const taskHours = estimatedHours(task)
          return (
            <tr key={task.id} className={task.state === 'done' ? 'part done' : 'part'}>
              <td className="col-name">
                <div className="name-line part-line">
                  <span className="part-index">{index + 1}</span>
                  <span className="name">{task.name}</span>
                  <BacklogLink id={task.id} name={task.name} />
                </div>
              </td>
              <td className="col-phases">{task.phase}</td>
              <td className="col-progress" />
              <td className="col-hours">{taskHours === null ? '—' : `${trim(taskHours)}h`}</td>
              <td className="col-unit-state">
                <span className={`state-tag ${task.state}`}>{STATE_LABEL[task.state]}</span>
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
      to={`/backlog?task=${encodeURIComponent(id)}`}
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
