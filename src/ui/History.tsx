import { useEffect, useState } from 'react'
import type { PlanVersion, VersionReason } from '../core/history'
import type { ImportPreview } from '../core/importing'
import type { AppState } from '../core/types'
import { StaleStateError, fetchVersionPlan, fetchVersions, previewRestore } from './api'
import { ChangeReview, type ReviewWords } from './ChangeReview'

const REASON: Record<VersionReason, string> = {
  edit: 'Edit',
  import: 'Import',
  reschedule: 'Reschedule',
  restore: 'Restore',
  generate: 'Generate',
  publish: 'Publish',
}

/** The newest ones cover most of what anyone goes back for. */
const SHOWN_AT_FIRST = 10

const RESTORE_WORDS: ReviewWords = {
  subject: 'This version',
  apply: 'Restore',
  applying: 'Restoring…',
  after: 'after restoring',
  fix: () => 'It cannot be restored as it is:',
}

type Review =
  | { kind: 'checking'; version: PlanVersion }
  | { kind: 'failed'; version: PlanVersion; message: string }
  | { kind: 'ready'; version: PlanVersion; preview: ImportPreview; plan: unknown }
  | { kind: 'restored' }

/**
 * The plans changes replaced, newest first. Each can be looked at against the
 * roadmap as it is now and brought back. Getting the plan as a file is the
 * roadmap file's job: restore a version, then download it there.
 *
 * Reloaded whenever the roadmap's revision moves, since any change to the plan
 * — from this page or another device — may have kept a version.
 */
export function History({
  state,
  restore,
}: {
  state: AppState
  restore: (id: number, revision: number) => Promise<boolean>
}) {
  const [versions, setVersions] = useState<PlanVersion[] | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [showAll, setShowAll] = useState(false)
  const [review, setReview] = useState<Review | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let cancelled = false
    fetchVersions()
      .then((loaded) => {
        if (cancelled) return
        setVersions(loaded)
        setLoadError(null)
      })
      .catch((cause: unknown) => {
        if (!cancelled) setLoadError(messageOf(cause))
      })
    return () => {
      cancelled = true
    }
  }, [state.revision])

  async function compare(version: PlanVersion) {
    setReview({ kind: 'checking', version })
    try {
      const comparing = async () => {
        try {
          return await previewRestore(version.id, state.revision)
        } catch (cause: unknown) {
          // Another device changed the roadmap: compare with it as it is now.
          if (!(cause instanceof StaleStateError)) throw cause
          return previewRestore(version.id, cause.state.revision)
        }
      }
      // The plan too, for the names of items it brings back that the roadmap no longer has.
      const [preview, plan] = await Promise.all([comparing(), fetchVersionPlan(version.id)])
      setReview({ kind: 'ready', version, preview, plan })
    } catch (cause: unknown) {
      setReview({ kind: 'failed', version, message: messageOf(cause) })
    }
  }

  async function apply(version: PlanVersion, preview: ImportPreview) {
    setBusy(true)
    const done = await restore(version.id, preview.revision)
    setBusy(false)
    // A refusal is reported in the footer; comparing again shows why here.
    if (done) setReview({ kind: 'restored' })
    else await compare(version)
  }

  const when = timeFormat(state.roadmap.timeZone)
  const shown = versions === null ? [] : showAll ? versions : versions.slice(0, SHOWN_AT_FIRST)

  return (
    <section className="block settings-section">
      <h2>History</h2>
      <p className="settings-text">
        Every change to the plan keeps the plan it replaced, for the last 50 changes. Edits a few
        minutes apart count as one. Progress — ticks and hours logged — is not a change of plan:
        it keeps nothing, and restoring a version never undoes it.
      </p>

      {loadError && (
        <p className="notice bad-notice" role="alert">
          The history could not be loaded: {loadError}
        </p>
      )}
      {versions === null && !loadError && <p className="muted">Loading…</p>}
      {versions !== null && versions.length === 0 && (
        <p className="muted">Nothing yet. The next change to the plan starts it.</p>
      )}

      {review?.kind === 'restored' && (
        <p className="good" role="status">
          Restored. The roadmap is at revision {state.revision}, and the plan it replaced is at the
          top of the list.
        </p>
      )}

      {shown.length > 0 && (
        <ol className="history-list">
          {shown.map((version) => {
            const open =
              review !== null && review.kind !== 'restored' && review.version.id === version.id
            return (
              <li key={version.id} className="history-entry">
                <div className="history-line">
                  <span className="history-id">#{version.id}</span>
                  <span className="history-when">{when(version.createdAt)}</span>
                  <span className="history-reason">{REASON[version.reason]}</span>
                  <span className="history-what">
                    {version.summary}
                    {version.laterChanges > 0 && (
                      <span className="muted">
                        {' '}
                        · and {version.laterChanges} more{' '}
                        {version.laterChanges === 1 ? 'change' : 'changes'}
                      </span>
                    )}
                  </span>
                </div>
                <div className="history-actions">
                  <button
                    type="button"
                    className="button"
                    disabled={busy || review?.kind === 'checking'}
                    aria-expanded={open}
                    onClick={() => (open ? setReview(null) : void compare(version))}
                  >
                    {open ? 'Close' : 'Go back to before this…'}
                  </button>
                </div>

                {open && review.kind === 'checking' && <p className="muted">Comparing…</p>}
                {open && review.kind === 'failed' && (
                  <p className="notice bad-notice" role="alert">
                    {review.message}
                  </p>
                )}
                {open && review.kind === 'ready' && (
                  <ChangeReview
                    state={state}
                    title={`Back to the plan before #${version.id}`}
                    source={review.plan}
                    note={
                      <p className="muted">
                        Compared with the roadmap as it is now. Progress on the items it keeps
                        stays, and the plan it replaces is kept here in turn.
                      </p>
                    }
                    preview={review.preview}
                    busy={busy}
                    words={RESTORE_WORDS}
                    onCancel={() => setReview(null)}
                    onApply={() => void apply(version, review.preview)}
                  />
                )}
              </li>
            )
          })}
        </ol>
      )}

      {versions !== null && versions.length > SHOWN_AT_FIRST && (
        <button type="button" className="button" onClick={() => setShowAll(!showAll)}>
          {showAll ? 'Show fewer' : `Show all ${versions.length}`}
        </button>
      )}
    </section>
  )
}

/** "23 Sep, 13:05", in the roadmap's timezone: the one every date in the app is in. */
function timeFormat(timeZone: string): (instant: string) => string {
  let format: Intl.DateTimeFormat
  try {
    format = new Intl.DateTimeFormat(undefined, {
      timeZone,
      day: 'numeric',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
    })
  } catch {
    return (instant) => instant
  }
  return (instant) => format.format(new Date(instant))
}

function messageOf(cause: unknown): string {
  return cause instanceof Error ? cause.message : 'Unknown error'
}
