import { useId, useState, type ReactNode } from 'react'
import { ITEM_TYPES } from '../core/constants'
import type { Edit } from '../core/edits'
import type { ItemType, WorkItem } from '../core/types'
import { Field } from './ItemForm'

type Draft = { name: string; type: ItemType; link: string; notes: string }

/**
 * A work item's own fields: what the unit is called, where it lives as a
 * whole, and what it is. Its parts are chosen from each item's form ("Part of"),
 * because an item belongs to one unit and that is where the choice is made.
 */
export function WorkItemForm({
  workItem,
  busy,
  error,
  onSubmit,
  onCancel,
  danger,
}: {
  /** The work item being edited, or null for a new one. */
  workItem: WorkItem | null
  busy: boolean
  error: string | null
  onSubmit: (fields: { name: string; type: ItemType; link: string | null; notes: string }) => void
  onCancel: () => void
  danger?: ReactNode
}) {
  const [draft, setDraft] = useState<Draft>({
    name: workItem?.name ?? '',
    type: workItem?.type ?? 'Course',
    link: workItem?.link ?? '',
    notes: workItem?.notes ?? '',
  })
  const id = useId()
  const link = draft.link.trim()
  const problems = [
    ...(draft.name.trim() === '' ? ['It needs a name.'] : []),
    ...(link !== '' && !link.startsWith('https://') ? ['The link must start with https://.'] : []),
  ]

  return (
    <form
      className="item-form"
      onSubmit={(event) => {
        event.preventDefault()
        if (problems.length > 0) return
        onSubmit({
          name: draft.name.trim(),
          type: draft.type,
          link: link === '' ? null : link,
          notes: draft.notes.trim(),
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
          onChange={(event) => setDraft({ ...draft, type: event.target.value as ItemType })}
        >
          {ITEM_TYPES.map((type) => (
            <option key={type}>{type}</option>
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
          {busy ? 'Saving…' : workItem ? 'Save' : 'Create work item'}
        </button>
        {danger}
      </div>
    </form>
  )
}

/** Deleting a work item keeps its parts: they stay in the plan, each on its own. */
export function DeleteWorkItem({
  workItem,
  parts,
  busy,
  onDelete,
}: {
  workItem: WorkItem
  parts: number
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
        Delete work item…
      </button>
    )
  }
  return (
    <div className="delete-confirm" role="group" aria-label={`Delete ${workItem.name}`}>
      <p>
        Delete <strong>{workItem.name}</strong>?
      </p>
      <ul>
        <li>
          {parts === 0
            ? 'It has no parts.'
            : `Its ${parts === 1 ? 'part stays' : `${parts} parts stay`} in the plan, on ${parts === 1 ? 'its' : 'their'} own, with all ${parts === 1 ? 'its' : 'their'} progress.`}
        </li>
      </ul>
      <div className="form-actions">
        <button type="button" className="button" disabled={busy} onClick={() => setAsking(false)}>
          Keep it
        </button>
        <button
          type="button"
          className="button danger"
          disabled={busy}
          onClick={() => onDelete({ op: 'deleteWorkItem', id: workItem.id })}
        >
          {busy ? 'Deleting…' : 'Delete work item'}
        </button>
      </div>
    </div>
  )
}
