import { useId, useState, type ReactNode } from 'react'
import { ITEM_TYPES } from '../core/constants'
import type { Edit, ItemFields } from '../core/edits'
import type { AppState, Item, ItemType, Resource, Roadmap } from '../core/types'

/** What the form holds while it is being edited: every field as its input shows it. */
export type Draft = {
  name: string
  type: ItemType
  duration: string
  notes: string
  doneWhen: string
  price: string
  /** Empty for none. */
  link: string
  resources: Resource[]
  /** Empty for none. */
  workItemId: string
  skills: string[]
  dependsOn: string[]
}

export function draftOf(item: Item): Draft {
  return {
    name: item.name,
    type: item.type,
    duration: item.duration,
    notes: item.notes,
    doneWhen: item.doneWhen,
    price: item.price,
    link: item.link ?? '',
    resources: item.resources,
    workItemId: item.workItemId ?? '',
    skills: item.skills,
    dependsOn: item.dependsOn,
  }
}

/** An empty form, for an item that does not exist yet. */
export function blankDraft(): Draft {
  return {
    name: '',
    type: 'Course',
    duration: '',
    notes: '',
    doneWhen: '',
    price: '',
    link: '',
    resources: [],
    workItemId: '',
    skills: [],
    dependsOn: [],
  }
}

/** The draft as the item's fields: empty inputs back to null, blank link rows dropped. */
export function fieldsOf(draft: Draft): Required<ItemFields> {
  return {
    name: draft.name.trim(),
    type: draft.type,
    duration: draft.duration.trim(),
    notes: draft.notes.trim(),
    doneWhen: draft.doneWhen.trim(),
    price: draft.price.trim(),
    link: draft.link.trim() === '' ? null : draft.link.trim(),
    resources: draft.resources
      .map((resource) => ({ label: resource.label.trim(), url: resource.url.trim() }))
      .filter((resource) => resource.label !== '' || resource.url !== ''),
    workItemId: draft.workItemId === '' ? null : draft.workItemId,
    skills: draft.skills,
  }
}

/**
 * The edits that turn an item into the draft: only the fields that changed, and
 * the dependencies only when they did. Nothing changed means no edits at all.
 */
export function editsFor(item: Item, draft: Draft): Edit[] {
  const fields = fieldsOf(draft)
  const changed = Object.fromEntries(
    Object.entries(fields).filter(
      ([field, value]) => JSON.stringify(item[field as keyof ItemFields]) !== JSON.stringify(value),
    ),
  ) as ItemFields
  const edits: Edit[] = []
  if (Object.keys(changed).length > 0)
    edits.push({ op: 'updateItem', id: item.id, fields: changed })
  if (JSON.stringify(item.dependsOn) !== JSON.stringify(draft.dependsOn)) {
    edits.push({ op: 'setDependencies', id: item.id, dependsOn: draft.dependsOn })
  }
  return edits
}

/**
 * What stops the draft being saved before the server is asked: the checks a
 * person can fix on the spot. Everything else — a dependency cycle, a skill on no
 * axis — is the server's to refuse, with the rule's own message.
 */
export function problemsOf(draft: Draft): string[] {
  const fields = fieldsOf(draft)
  const problems: string[] = []
  if (fields.name === '') problems.push('It needs a name.')
  if (fields.skills.length === 0) problems.push('It needs at least one skill.')
  if (fields.link !== null && !fields.link.startsWith('https://')) {
    problems.push('The link must start with https://.')
  }
  if (
    fields.resources.some(
      (resource) => resource.label === '' || !resource.url.startsWith('https://'),
    )
  ) {
    problems.push('Each extra link needs a label and an https:// address.')
  }
  return problems
}

/**
 * An item's fields as a form: what it is, what finishing it means, where it
 * lives, which skills it feeds and what it waits on. The dates are edited on the
 * row and the phase stays where it is: both move other items too.
 */
export function ItemForm({
  state,
  self,
  initial,
  busy,
  error,
  submitLabel,
  extra,
  danger,
  onSubmit,
  onCancel,
}: {
  state: AppState
  /** The item being edited, so it is left out of its own dependency list. */
  self: string | null
  initial: Draft
  busy: boolean
  /** The server's answer to the last attempt, when it refused it. */
  error: string | null
  submitLabel: string
  /** Fields that only one use of the form has, placed after the name. */
  extra?: ReactNode
  /** What goes at the far end of the buttons: deleting, for an item that exists. */
  danger?: ReactNode
  onSubmit: (draft: Draft) => void
  onCancel: () => void
}) {
  const [draft, setDraft] = useState(initial)
  const id = useId()
  const set = <K extends keyof Draft>(key: K, value: Draft[K]) =>
    setDraft((current) => ({ ...current, [key]: value }))

  const problems = problemsOf(draft)
  const names = new Map(state.items.map((item) => [item.id, item.name]))
  const { roadmap } = state

  return (
    <form
      className="item-form"
      onSubmit={(event) => {
        event.preventDefault()
        if (problems.length === 0) onSubmit(draft)
      }}
    >
      <Field label="Name" htmlFor={`${id}-name`}>
        <input
          id={`${id}-name`}
          value={draft.name}
          disabled={busy}
          onChange={(event) => set('name', event.target.value)}
        />
      </Field>

      {extra}

      <Field label="Type" htmlFor={`${id}-type`}>
        <select
          id={`${id}-type`}
          value={draft.type}
          disabled={busy}
          onChange={(event) => set('type', event.target.value as ItemType)}
        >
          {ITEM_TYPES.map((type) => (
            <option key={type}>{type}</option>
          ))}
        </select>
      </Field>

      <Field label="Duration" htmlFor={`${id}-duration`}>
        <input
          id={`${id}-duration`}
          value={draft.duration}
          placeholder="~6h, 3 chapters"
          disabled={busy}
          onChange={(event) => set('duration', event.target.value)}
        />
      </Field>

      <Field label="What it is" htmlFor={`${id}-notes`}>
        <textarea
          id={`${id}-notes`}
          value={draft.notes}
          rows={3}
          disabled={busy}
          onChange={(event) => set('notes', event.target.value)}
        />
      </Field>

      <Field label="Done when" htmlFor={`${id}-done-when`}>
        <textarea
          id={`${id}-done-when`}
          value={draft.doneWhen}
          rows={2}
          placeholder="What finishing it produces, stated so it can be checked"
          disabled={busy}
          onChange={(event) => set('doneWhen', event.target.value)}
        />
      </Field>

      <Field label="Link" htmlFor={`${id}-link`}>
        <input
          id={`${id}-link`}
          type="url"
          value={draft.link}
          placeholder="https://…"
          disabled={busy}
          onChange={(event) => set('link', event.target.value)}
        />
      </Field>

      <Field label="More links">
        <div className="form-list">
          {draft.resources.map((resource, index) => (
            <div key={index} className="form-pair">
              <input
                aria-label={`Label of link ${index + 1}`}
                value={resource.label}
                placeholder="Label"
                disabled={busy}
                onChange={(event) =>
                  set(
                    'resources',
                    draft.resources.map((each, at) =>
                      at === index ? { ...each, label: event.target.value } : each,
                    ),
                  )
                }
              />
              <input
                aria-label={`Address of link ${index + 1}`}
                type="url"
                value={resource.url}
                placeholder="https://…"
                disabled={busy}
                onChange={(event) =>
                  set(
                    'resources',
                    draft.resources.map((each, at) =>
                      at === index ? { ...each, url: event.target.value } : each,
                    ),
                  )
                }
              />
              <RemoveButton
                label={`Remove link ${index + 1}`}
                disabled={busy}
                onClick={() =>
                  set(
                    'resources',
                    draft.resources.filter((_, at) => at !== index),
                  )
                }
              />
            </div>
          ))}
          <button
            type="button"
            className="link-button"
            disabled={busy}
            onClick={() => set('resources', [...draft.resources, { label: '', url: '' }])}
          >
            + Add a link
          </button>
        </div>
      </Field>

      <Field label="Part of" htmlFor={`${id}-work-item`}>
        <select
          id={`${id}-work-item`}
          value={draft.workItemId}
          disabled={busy}
          onChange={(event) => set('workItemId', event.target.value)}
        >
          <option value="">Nothing — it stands on its own</option>
          {[...state.workItems]
            .sort((a, b) => a.name.localeCompare(b.name))
            .map((workItem) => (
              <option key={workItem.id} value={workItem.id}>
                {workItem.name}
              </option>
            ))}
        </select>
      </Field>

      <Field label="Skills">
        <SkillPicker
          roadmap={roadmap}
          skills={draft.skills}
          disabled={busy}
          onChange={(skills) => set('skills', skills)}
        />
      </Field>

      <Field label="Price" htmlFor={`${id}-price`}>
        <input
          id={`${id}-price`}
          value={draft.price}
          placeholder="Free"
          disabled={busy}
          onChange={(event) => set('price', event.target.value)}
        />
      </Field>

      <Field label="Depends on">
        <div className="form-list">
          <Chips
            values={draft.dependsOn}
            labelOf={(dependency) => names.get(dependency) ?? dependency}
            disabled={busy}
            onRemove={(dependency) =>
              set(
                'dependsOn',
                draft.dependsOn.filter((each) => each !== dependency),
              )
            }
          />
          <select
            aria-label="Add a dependency"
            value=""
            disabled={busy}
            onChange={(event) => set('dependsOn', [...draft.dependsOn, event.target.value])}
          >
            <option value="">Add something it waits on…</option>
            {roadmap.phases.map((phase) => (
              <optgroup key={phase.number} label={`Phase ${phase.number} · ${phase.name}`}>
                {state.items
                  .filter(
                    (item) =>
                      item.phase === phase.number &&
                      item.id !== self &&
                      !draft.dependsOn.includes(item.id),
                  )
                  .sort((a, b) => a.sortOrder - b.sortOrder)
                  .map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.name}
                    </option>
                  ))}
              </optgroup>
            ))}
          </select>
        </div>
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
          {busy ? 'Saving…' : submitLabel}
        </button>
        {danger}
      </div>
    </form>
  )
}

/** The skills something feeds, picked from the radar's axes. */
export function SkillPicker({
  roadmap,
  skills,
  disabled,
  onChange,
}: {
  roadmap: Roadmap
  skills: string[]
  disabled: boolean
  onChange: (skills: string[]) => void
}) {
  return (
    <div className="form-list">
      <Chips
        values={skills}
        labelOf={(skill) => skill}
        disabled={disabled}
        onRemove={(skill) => onChange(skills.filter((each) => each !== skill))}
      />
      <select
        aria-label="Add a skill"
        value=""
        disabled={disabled}
        onChange={(event) => onChange([...skills, event.target.value])}
      >
        <option value="">Add a skill…</option>
        {roadmap.dimensions.map((dimension) => (
          <optgroup key={dimension} label={dimension}>
            {Object.keys(roadmap.skillDimension)
              .filter(
                (skill) => roadmap.skillDimension[skill] === dimension && !skills.includes(skill),
              )
              .sort((a, b) => a.localeCompare(b))
              .map((skill) => (
                <option key={skill}>{skill}</option>
              ))}
          </optgroup>
        ))}
      </select>
    </div>
  )
}

export function Field({
  label,
  htmlFor,
  children,
}: {
  label: string
  htmlFor?: string
  children: ReactNode
}) {
  return (
    <div className="detail-line form-field">
      {htmlFor ? (
        <label className="detail-label" htmlFor={htmlFor}>
          {label}
        </label>
      ) : (
        <span className="detail-label">{label}</span>
      )}
      <div className="form-control">{children}</div>
    </div>
  )
}

function Chips({
  values,
  labelOf,
  disabled,
  onRemove,
}: {
  values: string[]
  labelOf: (value: string) => string
  disabled: boolean
  onRemove: (value: string) => void
}) {
  if (values.length === 0) return null
  return (
    <div className="form-chips">
      {values.map((value) => (
        <span key={value} className="form-chip">
          {labelOf(value)}
          <RemoveButton
            label={`Remove ${labelOf(value)}`}
            disabled={disabled}
            onClick={() => onRemove(value)}
          />
        </span>
      ))}
    </div>
  )
}

function RemoveButton({
  label,
  disabled,
  onClick,
}: {
  label: string
  disabled: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      className="chip-remove"
      aria-label={label}
      title="Remove"
      disabled={disabled}
      onClick={onClick}
    >
      ×
    </button>
  )
}
