import { useId, useState, type ReactNode } from 'react'
import { WORK_TYPES } from '../core/constants'
import type { Edit } from '../core/edits'
import type { AppState, Feature, Phase, PhaseNumber, Resource, Story, WorkType } from '../core/types'
import { Field, ResourcesEditor, TaskPicker } from './TaskForm'

type Draft = {
  name: string
  /** Empty for none: the type is an optional label. */
  type: WorkType | ''
  phase: PhaseNumber
  /** Empty for none. */
  featureId: string
  link: string
  resources: Resource[]
  price: string
  notes: string
  doneWhen: string
}

/** A story's fields as the form sends them. */
export type StoryFormFields = {
  name: string
  type: WorkType | null
  phase: PhaseNumber
  featureId: string | null
  link: string | null
  resources: Resource[]
  price: string
  notes: string
  doneWhen: string
}

/**
 * A story's own fields: what it is called, which phase it sits in, where it
 * lives as a whole, and what finishing it means. Its tasks are chosen from each
 * task's form ("Story"), because a task is a step of one story and that is where
 * the choice is made. A new phase moves every one of its tasks with it.
 */
export function StoryForm({
  story,
  phases,
  features,
  phase,
  busy,
  error,
  onSubmit,
  onCancel,
  danger,
}: {
  /** The story being edited, or null for a new one. */
  story: Story | null
  phases: readonly Phase[]
  features: readonly Feature[]
  /** Where a new story starts. */
  phase: PhaseNumber
  busy: boolean
  error: string | null
  onSubmit: (fields: StoryFormFields) => void
  onCancel: () => void
  danger?: ReactNode
}) {
  const [draft, setDraft] = useState<Draft>({
    name: story?.name ?? '',
    type: story?.type ?? '',
    phase: story?.phase ?? phase,
    featureId: story?.featureId ?? '',
    link: story?.link ?? '',
    resources: story?.resources ?? [],
    price: story?.price ?? '',
    notes: story?.notes ?? '',
    doneWhen: story?.doneWhen ?? '',
  })
  const id = useId()
  const link = draft.link.trim()
  const resources = draft.resources
    .map((resource) => ({ label: resource.label.trim(), url: resource.url.trim() }))
    .filter((resource) => resource.label !== '' || resource.url !== '')
  const problems = [
    ...(draft.name.trim() === '' ? ['It needs a name.'] : []),
    ...(link !== '' && !link.startsWith('https://') ? ['The link must start with https://.'] : []),
    ...(resources.some((resource) => resource.label === '' || !resource.url.startsWith('https://'))
      ? ['Each extra link needs a label and an https:// address.']
      : []),
  ]

  return (
    <form
      className="task-form"
      onSubmit={(event) => {
        event.preventDefault()
        if (problems.length > 0) return
        onSubmit({
          name: draft.name.trim(),
          type: draft.type === '' ? null : draft.type,
          phase: draft.phase,
          featureId: draft.featureId === '' ? null : draft.featureId,
          link: link === '' ? null : link,
          resources,
          price: draft.price.trim(),
          notes: draft.notes.trim(),
          doneWhen: draft.doneWhen.trim(),
        })
      }}
    >
      <Field label="Name" htmlFor={`${id}-name`}>
        <input
          id={`${id}-name`}
          value={draft.name}
          disabled={busy}
          onChange={(event) => setDraft({ ...draft, name: event.target.value })}
        />
      </Field>
      <Field label="Type" htmlFor={`${id}-type`}>
        <select
          id={`${id}-type`}
          value={draft.type}
          disabled={busy}
          onChange={(event) => setDraft({ ...draft, type: event.target.value as WorkType | '' })}
        >
          <option value="">No type</option>
          {WORK_TYPES.map((type) => (
            <option key={type}>{type}</option>
          ))}
        </select>
      </Field>
      <Field label="Phase" htmlFor={`${id}-phase`}>
        <select
          id={`${id}-phase`}
          value={draft.phase}
          disabled={busy}
          onChange={(event) =>
            setDraft({ ...draft, phase: Number(event.target.value) as PhaseNumber })
          }
        >
          {phases.map((each) => (
            <option key={each.number} value={each.number}>
              Phase {each.number} · {each.name}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Feature" htmlFor={`${id}-feature`}>
        <select
          id={`${id}-feature`}
          value={draft.featureId}
          disabled={busy}
          onChange={(event) => setDraft({ ...draft, featureId: event.target.value })}
        >
          <option value="">None — it stands on its own</option>
          {[...features]
            .sort((a, b) => a.name.localeCompare(b.name))
            .map((feature) => (
              <option key={feature.id} value={feature.id}>
                {feature.name}
              </option>
            ))}
        </select>
      </Field>
      <Field label="Link" htmlFor={`${id}-link`}>
        <input
          id={`${id}-link`}
          type="url"
          value={draft.link}
          placeholder="https://…"
          disabled={busy}
          onChange={(event) => setDraft({ ...draft, link: event.target.value })}
        />
      </Field>
      <Field label="More links">
        <ResourcesEditor
          resources={draft.resources}
          disabled={busy}
          onChange={(next) => setDraft({ ...draft, resources: next })}
        />
      </Field>
      <Field label="What it is" htmlFor={`${id}-notes`}>
        <textarea
          id={`${id}-notes`}
          value={draft.notes}
          rows={3}
          disabled={busy}
          onChange={(event) => setDraft({ ...draft, notes: event.target.value })}
        />
      </Field>
      <Field label="Done when" htmlFor={`${id}-done-when`}>
        <textarea
          id={`${id}-done-when`}
          value={draft.doneWhen}
          rows={2}
          placeholder="What finishing it produces, stated so it can be checked"
          disabled={busy}
          onChange={(event) => setDraft({ ...draft, doneWhen: event.target.value })}
        />
      </Field>
      <Field label="Price" htmlFor={`${id}-price`}>
        <input
          id={`${id}-price`}
          value={draft.price}
          placeholder="Free"
          disabled={busy}
          onChange={(event) => setDraft({ ...draft, price: event.target.value })}
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
          {busy ? 'Saving…' : story ? 'Save' : 'Create story'}
        </button>
        {danger}
      </div>
    </form>
  )
}

/**
 * Deleting a story is offered only once it has no tasks: every task needs a
 * story, so its tasks move to another story, or go, first.
 */
export function DeleteStory({
  story,
  tasks,
  busy,
  onDelete,
}: {
  story: Story
  tasks: number
  busy: boolean
  onDelete: (edit: Edit) => void
}) {
  const [asking, setAsking] = useState(false)
  if (tasks > 0) {
    return (
      <span className="faint push-end">
        Move or delete its {tasks === 1 ? 'task' : `${tasks} tasks`} to delete it.
      </span>
    )
  }
  if (!asking) {
    return (
      <button
        type="button"
        className="button danger push-end"
        disabled={busy}
        onClick={() => setAsking(true)}
      >
        Delete story…
      </button>
    )
  }
  return (
    <div className="delete-confirm" role="group" aria-label={`Delete ${story.name}`}>
      <p>
        Delete <strong>{story.name}</strong>? It has no tasks.
      </p>
      <div className="form-actions">
        <button type="button" className="button" disabled={busy} onClick={() => setAsking(false)}>
          Keep it
        </button>
        <button
          type="button"
          className="button danger"
          disabled={busy}
          onClick={() => onDelete({ op: 'deleteStory', id: story.id })}
        >
          {busy ? 'Deleting…' : 'Delete story'}
        </button>
      </div>
    </div>
  )
}

/**
 * The edit that makes a task a step of `story`. A task with no links of its own
 * shows its story's, so one moving out of a story that carried them takes them
 * along: the links an older plan's lone item had live on the story it became.
 */
function moveEdit(state: AppState, id: string, story: Story): Edit {
  const task = state.tasks.find((each) => each.id === id)
  const from = state.stories.find((each) => each.id === task?.storyId)
  const bare = task !== undefined && task.link === null && task.resources.length === 0
  const carried = from !== undefined && (from.link !== null || from.resources.length > 0)
  const same =
    from !== undefined &&
    from.link === story.link &&
    JSON.stringify(from.resources) === JSON.stringify(story.resources)
  return {
    op: 'updateTask',
    id,
    fields:
      bare && carried && !same
        ? { storyId: story.id, link: from.link, resources: from.resources }
        : { storyId: story.id },
  }
}

/**
 * Brings tasks of other stories in the same phase into this one: the way the
 * many one-task stories an older plan was converted into are gathered under
 * the deliverable they belong to. A story left with no tasks is kept, empty, to
 * be filled again or deleted from its own form.
 */
export function MoveTasksHere({
  state,
  story,
  busy,
  onMove,
  onCancel,
}: {
  state: AppState
  story: Story
  busy: boolean
  onMove: (edits: Edit[]) => void
  onCancel: () => void
}) {
  const [chosen, setChosen] = useState<string[]>([])
  const storyName = new Map(state.stories.map((each) => [each.id, each.name]))
  const left = (storyId: string) =>
    state.tasks.filter((task) => task.storyId === storyId && !chosen.includes(task.id)).length
  const emptied = [
    ...new Set(
      state.tasks.filter((task) => chosen.includes(task.id)).map((task) => task.storyId),
    ),
  ].filter((storyId) => left(storyId) === 0)

  return (
    <div className="move-tasks" role="group" aria-label={`Move tasks into ${story.name}`}>
      <Field label="Move here">
        <TaskPicker
          state={{
            ...state,
            roadmap: {
              ...state.roadmap,
              phases: state.roadmap.phases.filter((phase) => phase.number === story.phase),
            },
          }}
          values={chosen}
          offered={(task) => task.storyId !== story.id}
          placeholder="Add a task from another story in this phase…"
          label={`Add a task to move into ${story.name}`}
          disabled={busy}
          onChange={setChosen}
        />
      </Field>
      {emptied.length > 0 && (
        <p className="faint">
          {emptied.map((id) => storyName.get(id) ?? id).join(', ')}{' '}
          {emptied.length === 1 ? 'is' : 'are'} left with no tasks, and kept empty.
        </p>
      )}
      <div className="form-actions">
        <button type="button" className="button" disabled={busy} onClick={onCancel}>
          Cancel
        </button>
        <button
          type="button"
          className="button primary"
          disabled={busy || chosen.length === 0}
          onClick={() => onMove(chosen.map((id) => moveEdit(state, id, story)))}
        >
          {busy
            ? 'Moving…'
            : `Move ${chosen.length === 0 ? '' : chosen.length + ' '}${chosen.length === 1 ? 'task' : 'tasks'} here`}
        </button>
      </div>
    </div>
  )
}
