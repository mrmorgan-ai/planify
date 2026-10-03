import { useId, useState, type ReactNode } from 'react'
import type { Edit, TaskFields } from '../core/edits'
import type { AppState, Task, Resource, Roadmap } from '../core/types'

/** What the form holds while it is being edited: every field as its input shows it. */
export type Draft = {
  name: string
  duration: string
  notes: string
  doneWhen: string
  /** Empty for none. */
  link: string
  resources: Resource[]
  /** Empty until one is chosen: every task needs a story. */
  storyId: string
  skills: string[]
  dependsOn: string[]
}

export function draftOf(task: Task): Draft {
  return {
    name: task.name,
    duration: task.duration,
    notes: task.notes,
    doneWhen: task.doneWhen,
    link: task.link ?? '',
    resources: task.resources,
    storyId: task.storyId,
    skills: task.skills,
    dependsOn: task.dependsOn,
  }
}

/** An empty form, for a task that does not exist yet, in the story it starts in. */
export function blankDraft(storyId = ''): Draft {
  return {
    name: '',
    duration: '',
    notes: '',
    doneWhen: '',
    link: '',
    resources: [],
    storyId,
    skills: [],
    dependsOn: [],
  }
}

/** The draft as the task's fields: empty inputs back to null, blank link rows dropped. */
export function fieldsOf(draft: Draft): Required<TaskFields> {
  return {
    name: draft.name.trim(),
    duration: draft.duration.trim(),
    notes: draft.notes.trim(),
    doneWhen: draft.doneWhen.trim(),
    link: draft.link.trim() === '' ? null : draft.link.trim(),
    resources: draft.resources
      .map((resource) => ({ label: resource.label.trim(), url: resource.url.trim() }))
      .filter((resource) => resource.label !== '' || resource.url !== ''),
    storyId: draft.storyId,
    skills: draft.skills,
  }
}

/**
 * The edits that turn a task into the draft: only the fields that changed, and
 * the dependencies only when they did. Nothing changed means no edits at all.
 */
export function editsFor(task: Task, draft: Draft): Edit[] {
  const fields = fieldsOf(draft)
  const changed = Object.fromEntries(
    Object.entries(fields).filter(
      ([field, value]) => JSON.stringify(task[field as keyof TaskFields]) !== JSON.stringify(value),
    ),
  ) as TaskFields
  const edits: Edit[] = []
  if (Object.keys(changed).length > 0)
    edits.push({ op: 'updateTask', id: task.id, fields: changed })
  if (JSON.stringify(task.dependsOn) !== JSON.stringify(draft.dependsOn)) {
    edits.push({ op: 'setDependencies', id: task.id, dependsOn: draft.dependsOn })
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
  if (fields.storyId === '') problems.push('It needs a story.')
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
 * A task's fields as a form: what it is, what finishing it means, which story
 * it is a step of, which skills it feeds and what it waits on. The dates are
 * edited on the row, because they move other tasks too; the phase is the
 * story's, so a task changes phase by changing story.
 */
export function TaskForm({
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
  /** The task being edited, so it is left out of its own dependency list. */
  self: string | null
  initial: Draft
  busy: boolean
  /** The server's answer to the last attempt, when it refused it. */
  error: string | null
  submitLabel: string
  /** Fields that only one use of the form has, placed after the name. */
  extra?: ReactNode
  /** What goes at the far end of the buttons: deleting, for a task that exists. */
  danger?: ReactNode
  onSubmit: (draft: Draft) => void
  onCancel: () => void
}) {
  const [draft, setDraft] = useState(initial)
  const id = useId()
  const set = <K extends keyof Draft>(key: K, value: Draft[K]) =>
    setDraft((current) => ({ ...current, [key]: value }))

  const problems = problemsOf(draft)
  const names = new Map(state.tasks.map((task) => [task.id, task.name]))
  const { roadmap } = state

  return (
    <form
      className="task-form"
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

      <Field label="Story" htmlFor={`${id}-story`}>
        <select
          id={`${id}-story`}
          value={draft.storyId}
          disabled={busy}
          onChange={(event) => set('storyId', event.target.value)}
        >
          {draft.storyId === '' && <option value="">Choose the story it is a step of…</option>}
          {roadmap.phases.map((phase) => (
            <optgroup key={phase.number} label={`Phase ${phase.number} · ${phase.name}`}>
              {state.stories
                .filter((story) => story.phase === phase.number)
                .sort((a, b) => a.name.localeCompare(b.name))
                .map((story) => (
                  <option key={story.id} value={story.id}>
                    {story.name}
                  </option>
                ))}
            </optgroup>
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
                {state.tasks
                  .filter(
                    (task) =>
                      task.phase === phase.number &&
                      task.id !== self &&
                      !draft.dependsOn.includes(task.id),
                  )
                  .sort((a, b) => a.sortOrder - b.sortOrder)
                  .map((task) => (
                    <option key={task.id} value={task.id}>
                      {task.name}
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
