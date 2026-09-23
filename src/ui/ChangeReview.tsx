import type { ReactNode } from 'react'
import { SECTION_LABEL, type ImportChanges, type ImportPreview } from '../core/importing'
import type { AppState } from '../core/types'

/** How a review speaks of what it brings in: a file, or a version of the plan. */
export type ReviewWords = {
  /** "The file", "This version". */
  subject: string
  /** The button, and the button while it works. */
  apply: string
  applying: string
  /** "after the import". */
  after: string
  /** What to do about rules it breaks. */
  fix: (count: number) => string
}

/**
 * What bringing a whole plan in would change, read before it is applied: the
 * items and settings it changes, the progress it loses, the rules it breaks and
 * the warnings it leaves. Nothing is written until the person confirms, and a
 * plan that brings in an error cannot be confirmed at all.
 */
export function ChangeReview({
  state,
  title,
  source,
  note,
  preview,
  busy,
  words,
  onCancel,
  onApply,
}: {
  state: AppState
  title: string
  /** The plan being brought in, as a roadmap file: where new items get their names. */
  source: unknown
  note?: ReactNode
  preview: ImportPreview
  busy: boolean
  words: ReviewWords
  onCancel: () => void
  onApply: () => void
}) {
  const { changes, introduced, issues } = preview
  const warnings = issues.filter((issue) => issue.severity === 'warning')
  const lost = changes.items.removed.filter(
    (item) => item.state !== 'pending' || item.hoursDone > 0,
  )
  const nothing = isEmpty(changes)
  const nameOf = namer(state, source)

  return (
    <div className="import-review">
      <h3>{title}</h3>
      {note}

      {nothing ? (
        <p className="muted">
          {words.subject} matches the roadmap. There is nothing to change.
        </p>
      ) : (
        <ul className="import-summary">
          <li>
            Items: {changes.items.added.length} added · {changes.items.removed.length} removed ·{' '}
            {changes.items.changed.length} edited
          </li>
          {(changes.workItems.added.length > 0 ||
            changes.workItems.removed.length > 0 ||
            changes.workItems.changed.length > 0) && (
            <li>
              Work items: {changes.workItems.added.length} added ·{' '}
              {changes.workItems.removed.length} removed · {changes.workItems.changed.length} edited
            </li>
          )}
          {changes.settings.length > 0 && (
            <li>
              Also changes the {changes.settings.map((key) => SECTION_LABEL[key] ?? key).join(', ')}
            </li>
          )}
        </ul>
      )}

      {lost.length > 0 && (
        <div className="notice bad-notice">
          Progress on {lost.length === 1 ? 'this item' : `these ${lost.length} items`} is lost:
          <ul>
            {lost.map((item) => (
              <li key={item.id}>
                {item.name} — {item.state === 'done' ? 'done' : 'in progress'}
                {item.hoursDone > 0 ? `, ${item.hoursDone}h logged` : ''}
              </li>
            ))}
          </ul>
        </div>
      )}

      {introduced.length > 0 && (
        <div className="notice bad-notice" role="alert">
          {words.subject} breaks {introduced.length === 1 ? 'a rule' : `${introduced.length} rules`}{' '}
          the roadmap does not. {words.fix(introduced.length)}
          <ul>
            {introduced.map((issue, index) => (
              <li key={index}>{issue.message}</li>
            ))}
          </ul>
        </div>
      )}

      {!nothing && (
        <details className="import-details">
          <summary>See every change</summary>
          <ChangeList title="Added" lines={changes.items.added.map(nameOf)} />
          <ChangeList title="Removed" lines={changes.items.removed.map((item) => item.name)} />
          <ChangeList
            title="Edited"
            lines={changes.items.changed.map(
              ({ id, fields }) => `${nameOf(id)}: ${fields.join(', ')}`,
            )}
          />
          <ChangeList title="Work items added" lines={changes.workItems.added} />
          <ChangeList title="Work items removed" lines={changes.workItems.removed} />
          <ChangeList title="Work items edited" lines={changes.workItems.changed} />
        </details>
      )}

      {warnings.length > 0 && (
        <details className="import-details">
          <summary>
            {warnings.length} {warnings.length === 1 ? 'warning' : 'warnings'} {words.after}
          </summary>
          <ChangeList title="" lines={warnings.map((issue) => issue.message)} />
        </details>
      )}

      <div className="import-actions">
        <button type="button" className="button" disabled={busy} onClick={onCancel}>
          {nothing ? 'Close' : 'Cancel'}
        </button>
        {!nothing && (
          <button
            type="button"
            className="button primary"
            disabled={busy || introduced.length > 0}
            onClick={onApply}
          >
            {busy ? words.applying : words.apply}
          </button>
        )}
      </div>
    </div>
  )
}

function ChangeList({ title, lines }: { title: string; lines: string[] }) {
  if (lines.length === 0) return null
  return (
    <>
      {title && <h4>{title}</h4>}
      <ul>
        {lines.map((line, index) => (
          <li key={index}>{line}</li>
        ))}
      </ul>
    </>
  )
}

/** An item's name from the roadmap, or from the plan coming in for one it adds. */
function namer(state: AppState, source: unknown): (id: string) => string {
  const names = new Map(state.items.map((item) => [item.id, item.name]))
  const incoming =
    (source as { items?: Array<{ id?: unknown; name?: unknown }> } | null)?.items ?? []
  for (const item of incoming) {
    if (typeof item.id === 'string' && typeof item.name === 'string') names.set(item.id, item.name)
  }
  return (id) => names.get(id) ?? id
}

function isEmpty(changes: ImportChanges): boolean {
  return (
    changes.items.added.length === 0 &&
    changes.items.removed.length === 0 &&
    changes.items.changed.length === 0 &&
    changes.workItems.added.length === 0 &&
    changes.workItems.removed.length === 0 &&
    changes.workItems.changed.length === 0 &&
    changes.settings.length === 0
  )
}
