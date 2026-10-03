import { useId, useState, type ReactNode } from 'react'
import { WORK_TYPES } from '../core/constants'
import type { Edit } from '../core/edits'
import type { Phase, PhaseNumber, Story, WorkType } from '../core/types'
import { Field } from './TaskForm'

type Draft = {
  name: string
  /** Empty for none: the type is an optional label. */
  type: WorkType | ''
  phase: PhaseNumber
  link: string
  price: string
  notes: string
  doneWhen: string
}

/** A story's fields as the form sends them. */
export type StoryFormFields = {
  name: string
  type: WorkType | null
  phase: PhaseNumber
  link: string | null
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
    link: story?.link ?? '',
    price: story?.price ?? '',
    notes: story?.notes ?? '',
    doneWhen: story?.doneWhen ?? '',
  })
  const id = useId()
  const link = draft.link.trim()
  const problems = [
    ...(draft.name.trim() === '' ? ['It needs a name.'] : []),
    ...(link !== '' && !link.startsWith('https://') ? ['The link must start with https://.'] : []),
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
          link: link === '' ? null : link,
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
