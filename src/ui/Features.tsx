import { useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { Link as RouterLink } from 'react-router-dom'
import { WORK_TYPES } from '../core/constants'
import { newId, type Edit } from '../core/edits'
import { storyHours, storyState, tasksOf } from '../core/stories'
import type { AppState, Feature, State, Story, Task, WorkType } from '../core/types'
import type { Store } from './useAppState'
import { Field } from './TaskForm'
import { scrollToRow, useArrival } from './useArrival'

const STATE_LABEL: Record<State, string> = {
  pending: 'Pending',
  in_progress: 'In progress',
  done: 'Done',
}

/**
 * The goals wider than a phase — a certification, a large project — each with
 * the stories that serve it. Nothing here is dated or ticked off: a feature's
 * phases, span and progress are read off its stories' tasks, and its stories
 * are worked in the backlog, where each links.
 *
 * What is edited here is the feature itself and which stories serve it.
 */
export function Features({
  state,
  error,
  pendingId,
  edit,
}: Pick<Store, 'error' | 'pendingId' | 'edit'> & { state: AppState }) {
  const [open, setOpen] = useState<Set<string>>(new Set())
  const [creating, setCreating] = useState(false)
  const [editing, setEditing] = useState<string | null>(null)
  const [adding, setAdding] = useState<string | null>(null)
  /** The form whose last save was refused: a feature's id, or `new`. */
  const [refused, setRefused] = useState<string | null>(null)

  const save = async (key: string, edits: Edit[]) => {
    const saved = await edit(edits, key)
    setRefused(saved ? null : key)
    return saved
  }

  /** `?feature=` is how a story hands its feature over: open it, bring it into view, highlight it. */
  const { arrived, missing } = useArrival(
    'feature',
    (id) => state.features.some((feature) => feature.id === id),
    (id) => setOpen((current) => new Set(current).add(id)),
  )

  const toggle = (id: string) =>
    setOpen((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  const features = [...state.features].sort((a, b) => a.name.localeCompare(b.name))
  const unattached = state.stories.filter((story) => story.featureId === null).length

  return (
    <section className="features">
      <h2 className="board-title">Features</h2>

      {missing && (
        <p className="notice" role="status">
          The link pointed at <code>{missing}</code>, which is not in the roadmap any more.
        </p>
      )}

      <div className="filters">
        <span className="settings-text features-summary">
          {features.length === 0
            ? 'A feature is a goal wider than a phase, served by stories in one or more phases.'
            : `${features.length} ${features.length === 1 ? 'feature' : 'features'} · ${unattached} ${unattached === 1 ? 'story serves' : 'stories serve'} none`}
        </span>
        <button
          type="button"
          className="button push-end"
          disabled={creating}
          onClick={() => {
            setRefused(null)
            setCreating(true)
          }}
        >
          + New feature
        </button>
      </div>

      {creating && (
        <div className="new-task">
          <h3>New feature</h3>
          <FeatureForm
            feature={null}
            busy={pendingId === 'new'}
            error={refused === 'new' ? error : null}
            onCancel={() => setCreating(false)}
            onSubmit={async (fields) => {
              const id = newId(fields.name, state)
              if (!(await save('new', [{ op: 'createFeature', feature: { ...fields, id } }]))) return
              setCreating(false)
              setOpen((current) => new Set(current).add(id))
              setAdding(id)
            }}
          />
        </div>
      )}

      {features.length === 0 && !creating && <p className="empty">No features yet.</p>}

      {features.length > 0 && (
        <table className="tasks units">
          <thead>
            <tr>
              <th className="col-name">Feature</th>
              <th className="col-phases">Phases</th>
              <th className="col-progress">Progress</th>
              <th className="col-hours">Hours</th>
              <th className="col-unit-state">State</th>
            </tr>
          </thead>
          <tbody>
            {features.map((feature) => {
              const stories = state.stories
                .filter((story) => story.featureId === feature.id)
                .sort((a, b) => a.phase - b.phase || a.name.localeCompare(b.name))
              return (
                <FeatureRows
                  key={feature.id}
                  state={state}
                  feature={feature}
                  stories={stories}
                  open={open.has(feature.id)}
                  arrived={arrived === feature.id}
                  busy={pendingId === feature.id}
                  onToggle={() => toggle(feature.id)}
                  editor={
                    editing === feature.id ? (
                      <FeatureForm
                        key={feature.id}
                        feature={feature}
                        busy={pendingId === feature.id}
                        error={refused === feature.id ? error : null}
                        onCancel={() => setEditing(null)}
                        onSubmit={async (fields) => {
                          const edits: Edit[] = [{ op: 'updateFeature', id: feature.id, fields }]
                          if (await save(feature.id, edits)) setEditing(null)
                        }}
                        danger={
                          <DeleteFeature
                            feature={feature}
                            stories={stories.length}
                            busy={pendingId === feature.id}
                            onDelete={async (deletion) => {
                              if (await save(feature.id, [deletion])) setEditing(null)
                            }}
                          />
                        }
                      />
                    ) : adding === feature.id ? (
                      <AddStories
                        state={state}
                        feature={feature}
                        busy={pendingId === feature.id}
                        error={refused === feature.id ? error : null}
                        onCancel={() => setAdding(null)}
                        onAdd={async (edits) => {
                          if (await save(feature.id, edits)) setAdding(null)
                        }}
                      />
                    ) : null
                  }
                  onEdit={() => {
                    setRefused(null)
                    setAdding(null)
                    setEditing(feature.id)
                  }}
                  onAdd={() => {
                    setRefused(null)
                    setEditing(null)
                    setAdding(feature.id)
                  }}
                  onRemove={(story) =>
                    void save(feature.id, [
                      { op: 'updateStory', id: story.id, fields: { featureId: null } },
                    ])
                  }
                />
              )
            })}
          </tbody>
        </table>
      )}
    </section>
  )
}

function FeatureRows({
  state,
  feature,
  stories,
  open,
  arrived,
  busy,
  editor,
  onToggle,
  onEdit,
  onAdd,
  onRemove,
}: {
  state: AppState
  feature: Feature
  stories: Story[]
  open: boolean
  arrived: boolean
  busy: boolean
  /** The feature's form, or the stories to add, while one is open. */
  editor: ReactNode
  onToggle: () => void
  onEdit: () => void
  onAdd: () => void
  onRemove: (story: Story) => void
}) {
  const row = useRef<HTMLTableRowElement>(null)
  useEffect(() => {
    if (arrived) scrollToRow(row.current)
  }, [arrived])

  const tasksOfStory = (story: Story) => tasksOf(story.id, state.tasks)
  const tasks: Task[] = stories.flatMap(tasksOfStory)
  const current = storyState(tasks)
  const hours = storyHours(tasks)
  const done = tasks.filter((task) => task.state === 'done').length
  const phases = [...new Set(stories.map((story) => story.phase))]

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
              aria-label={`Stories of ${feature.name}`}
              onClick={onToggle}
            >
              {open ? '▾' : '▸'}
            </button>
            {feature.type && <span className="type-tag">{feature.type}</span>}
            <span className="name">{feature.name}</span>
            <span className="count">
              {stories.length} {stories.length === 1 ? 'story' : 'stories'}
            </span>
          </div>
        </td>
        <td className="col-phases">{phases.length === 0 ? '—' : phaseRange(phases)}</td>
        <td className="col-progress">
          {tasks.length === 0 ? (
            <span className="faint">—</span>
          ) : (
            <>
              <span className="progress-count">
                {done} of {tasks.length} tasks
              </span>
              <div className="meter">
                <div
                  className="meter-fill"
                  style={{ width: `${Math.round((done / tasks.length) * 100)}%` }}
                />
              </div>
            </>
          )}
        </td>
        <td className="col-hours">
          {hours.done > 0 ? `${trim(hours.done)} of ${trim(hours.total)}h` : `${trim(hours.total)}h`}
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
                {feature.notes && <span className="notes">{feature.notes}</span>}
                <span className="push-end feature-actions">
                  <button type="button" className="button" disabled={busy} onClick={onAdd}>
                    + Add stories…
                  </button>
                  <button type="button" className="button" disabled={busy} onClick={onEdit}>
                    Edit feature
                  </button>
                </span>
              </div>
            )}
          </td>
        </tr>
      )}

      {open &&
        stories.map((story) => {
          const steps = tasksOfStory(story)
          const finished = steps.filter((task) => task.state === 'done').length
          return (
            <tr key={story.id} className={storyState(steps) === 'done' ? 'part done' : 'part'}>
              <td className="col-name">
                <div className="name-line part-line">
                  <span className="name">{story.name}</span>
                  {story.type && story.type !== feature.type && (
                    <span className="type-tag">{story.type}</span>
                  )}
                  <RouterLink
                    className="icon-button unit-jump"
                    to={`/backlog?story=${encodeURIComponent(story.id)}`}
                    title={`Open ${story.name} in the backlog`}
                    aria-label={`Open ${story.name} in the backlog`}
                  >
                    ↗
                  </RouterLink>
                  <button
                    type="button"
                    className="chip-remove"
                    disabled={busy}
                    aria-label={`Take ${story.name} out of ${feature.name}`}
                    title="Take it out of this feature"
                    onClick={() => onRemove(story)}
                  >
                    ×
                  </button>
                </div>
              </td>
              <td className="col-phases">{story.phase}</td>
              <td className="col-progress">
                {steps.length === 0 ? (
                  <span className="faint">no tasks</span>
                ) : (
                  <span className="progress-count">
                    {finished} of {steps.length}
                  </span>
                )}
              </td>
              <td className="col-hours">{trim(storyHours(steps).total)}h</td>
              <td className="col-unit-state">
                <span className={`state-tag ${storyState(steps)}`}>
                  {STATE_LABEL[storyState(steps)]}
                </span>
              </td>
            </tr>
          )
        })}
    </>
  )
}

/** The stories that serve no feature, to pick from by phase; the chosen ones serve this one. */
function AddStories({
  state,
  feature,
  busy,
  error,
  onAdd,
  onCancel,
}: {
  state: AppState
  feature: Feature
  busy: boolean
  error: string | null
  onAdd: (edits: Edit[]) => void
  onCancel: () => void
}) {
  const [chosen, setChosen] = useState<Set<string>>(new Set())
  const free = state.stories.filter((story) => story.featureId === null)
  const flip = (id: string) =>
    setChosen((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  return (
    <div className="add-stories" role="group" aria-label={`Add stories to ${feature.name}`}>
      {free.length === 0 ? (
        <p className="settings-text">Every story already serves a feature.</p>
      ) : (
        state.roadmap.phases.map((phase) => {
          const inPhase = free
            .filter((story) => story.phase === phase.number)
            .sort((a, b) => a.name.localeCompare(b.name))
          if (inPhase.length === 0) return null
          return (
            <fieldset key={phase.number} className="add-stories-phase">
              <legend>
                Phase {phase.number} · {phase.name}
              </legend>
              {inPhase.map((story) => (
                <label key={story.id} className="add-stories-option">
                  <input
                    type="checkbox"
                    checked={chosen.has(story.id)}
                    disabled={busy}
                    onChange={() => flip(story.id)}
                  />
                  {story.name}
                  {story.type && <span className="type-tag">{story.type}</span>}
                </label>
              ))}
            </fieldset>
          )
        })
      )}
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      <div className="form-actions">
        <button type="button" className="button" disabled={busy} onClick={onCancel}>
          Cancel
        </button>
        <button
          type="button"
          className="button primary"
          disabled={busy || chosen.size === 0}
          onClick={() =>
            onAdd(
              [...chosen].map(
                (id): Edit => ({ op: 'updateStory', id, fields: { featureId: feature.id } }),
              ),
            )
          }
        >
          {busy
            ? 'Adding…'
            : `Add ${chosen.size === 0 ? '' : chosen.size + ' '}${chosen.size === 1 ? 'story' : 'stories'}`}
        </button>
      </div>
    </div>
  )
}

type FeatureFields = { name: string; type: WorkType | null; link: string | null; notes: string }

/** A feature's own fields: what it is called and is, where it lives, and why it matters. */
function FeatureForm({
  feature,
  busy,
  error,
  onSubmit,
  onCancel,
  danger,
}: {
  feature: Feature | null
  busy: boolean
  error: string | null
  onSubmit: (fields: FeatureFields) => void
  onCancel: () => void
  danger?: ReactNode
}) {
  const [name, setName] = useState(feature?.name ?? '')
  const [type, setType] = useState<WorkType | ''>(feature?.type ?? '')
  const [link, setLink] = useState(feature?.link ?? '')
  const [notes, setNotes] = useState(feature?.notes ?? '')
  const id = useId()
  const trimmed = link.trim()
  const problems = [
    ...(name.trim() === '' ? ['It needs a name.'] : []),
    ...(trimmed !== '' && !trimmed.startsWith('https://') ? ['The link must start with https://.'] : []),
  ]

  return (
    <form
      className="task-form"
      onSubmit={(event) => {
        event.preventDefault()
        if (problems.length > 0) return
        onSubmit({
          name: name.trim(),
          type: type === '' ? null : type,
          link: trimmed === '' ? null : trimmed,
          notes: notes.trim(),
        })
      }}
    >
      <Field label="Name" htmlFor={`${id}-name`}>
        <input id={`${id}-name`} value={name} disabled={busy} onChange={(event) => setName(event.target.value)} />
      </Field>
      <Field label="Type" htmlFor={`${id}-type`}>
        <select
          id={`${id}-type`}
          value={type}
          disabled={busy}
          onChange={(event) => setType(event.target.value as WorkType | '')}
        >
          <option value="">No type</option>
          {WORK_TYPES.map((each) => (
            <option key={each}>{each}</option>
          ))}
        </select>
      </Field>
      <Field label="Link" htmlFor={`${id}-link`}>
        <input
          id={`${id}-link`}
          type="url"
          value={link}
          placeholder="https://…"
          disabled={busy}
          onChange={(event) => setLink(event.target.value)}
        />
      </Field>
      <Field label="What it is" htmlFor={`${id}-notes`}>
        <textarea
          id={`${id}-notes`}
          value={notes}
          rows={3}
          disabled={busy}
          onChange={(event) => setNotes(event.target.value)}
        />
      </Field>

      {problems.length > 0 && (
        <ul className="form-problems">
          {problems.map((problem) => (
            <li key={problem}>{problem}</li>
          ))}
        </ul>
      )}
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      <div className="form-actions">
        <button type="button" className="button" disabled={busy} onClick={onCancel}>
          Cancel
        </button>
        <button type="submit" className="button primary" disabled={busy || problems.length > 0}>
          {busy ? 'Saving…' : feature ? 'Save' : 'Create feature'}
        </button>
        {danger}
      </div>
    </form>
  )
}

/** Deleting a feature keeps its stories: they stay in the plan, serving none. */
function DeleteFeature({
  feature,
  stories,
  busy,
  onDelete,
}: {
  feature: Feature
  stories: number
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
        Delete feature…
      </button>
    )
  }
  return (
    <div className="delete-confirm" role="group" aria-label={`Delete ${feature.name}`}>
      <p>
        Delete <strong>{feature.name}</strong>?{' '}
        {stories === 0
          ? 'No story serves it.'
          : `Its ${stories === 1 ? 'story stays' : `${stories} stories stay`} in the plan, serving no feature.`}
      </p>
      <div className="form-actions">
        <button type="button" className="button" disabled={busy} onClick={() => setAsking(false)}>
          Keep it
        </button>
        <button
          type="button"
          className="button danger"
          disabled={busy}
          onClick={() => onDelete({ op: 'deleteFeature', id: feature.id })}
        >
          {busy ? 'Deleting…' : 'Delete feature'}
        </button>
      </div>
    </div>
  )
}

/** "1", "1–3", "1, 3": the phases a feature's stories sit in. */
function phaseRange(phases: number[]): string {
  const sorted = [...phases].sort((a, b) => a - b)
  const contiguous = sorted.every((phase, index) => index === 0 || phase === sorted[index - 1]! + 1)
  if (sorted.length > 1 && contiguous) return `${sorted[0]}–${sorted.at(-1)}`
  return sorted.join(', ')
}

function trim(hours: number): string {
  return Number.isInteger(hours) ? String(hours) : hours.toFixed(1)
}
