import { useEffect, useRef, useState } from 'react'
import type { AppState } from '../core/types'
import { StaleStateError, previewPublish, type PublishPreview } from './api'
import { ChangeReview, type ReviewWords } from './ChangeReview'
import type { Store } from './useAppState'

const PUBLISH_WORDS: ReviewWords = {
  subject: 'The draft',
  apply: 'Publish',
  applying: 'Publishing…',
  after: 'after publishing',
  fix: (count) => `Fix ${count === 1 ? 'it' : 'them'} in the draft, then publish:`,
}

type Review =
  | { kind: 'checking' }
  | { kind: 'failed'; message: string }
  | { kind: 'ready'; preview: PublishPreview }

type Drafts = Pick<Store, 'mode' | 'openDraft' | 'leaveDraft' | 'discard' | 'publish'>

/** Starts a draft, or opens the one in progress. Shown in the header of the live roadmap. */
export function DraftButton({ state, mode, openDraft }: { state: AppState } & Drafts) {
  const [busy, setBusy] = useState(false)
  if (mode === 'draft') return <span className="draft-badge">Draft</span>
  return (
    <button
      type="button"
      className="button draft-toggle"
      disabled={busy}
      title="Stage changes to the plan apart from the live roadmap, then publish them at once"
      onClick={async () => {
        setBusy(true)
        await openDraft()
        setBusy(false)
      }}
    >
      {state.draft ? 'Open draft' : 'Start a draft'}
    </button>
  )
}

/**
 * The line under the header that says which world is on screen. In a draft,
 * every change to the plan lands in the draft, and every view — the backlog, the
 * Gantt, the warnings — shows the draft's plan with the live roadmap's progress.
 * Nothing reaches the live roadmap until the draft is published, after the same
 * review an import shows.
 */
export function DraftBar({
  state,
  mode,
  openDraft,
  leaveDraft,
  discard,
  publish,
}: { state: AppState } & Drafts) {
  const dialog = useRef<HTMLDialogElement>(null)
  const [review, setReview] = useState<Review | null>(null)
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)
  const [published, setPublished] = useState(false)

  useEffect(() => {
    const element = dialog.current
    if (!element) return
    if (review && !element.open) element.showModal()
    if (!review && element.open) element.close()
  }, [review])

  async function check(draftRevision: number) {
    setReview({ kind: 'checking' })
    try {
      let preview: PublishPreview
      try {
        preview = await previewPublish(draftRevision)
      } catch (cause: unknown) {
        // The draft changed on another device: review it as it is now.
        if (!(cause instanceof StaleStateError)) throw cause
        preview = await previewPublish(cause.state.revision)
      }
      setReview({ kind: 'ready', preview })
    } catch (cause: unknown) {
      setReview({
        kind: 'failed',
        message: cause instanceof Error ? cause.message : 'Unknown error',
      })
    }
  }

  async function apply(preview: PublishPreview) {
    setBusy(true)
    const done = await publish(preview.revision, state.revision)
    setBusy(false)
    if (done) {
      setReview(null)
      setPublished(true)
    } else {
      // Refused: the footer says why, and the review, made again, shows what now stands.
      await check(state.revision)
    }
  }

  if (mode === 'live') {
    if (published) {
      return (
        <div className="draft-bar" role="status">
          <span>Published. The plan it replaced is in Settings → History.</span>
          <button type="button" className="draft-bar-action" onClick={() => setPublished(false)}>
            OK
          </button>
        </div>
      )
    }
    if (!state.draft) return null
    return (
      <div className="draft-bar" role="status">
        <span>
          A draft of the plan is in progress, last changed {when(state.draft.updatedAt, state)}.
        </span>
        <button type="button" className="draft-bar-action" onClick={() => void openDraft()}>
          Open it
        </button>
      </div>
    )
  }

  return (
    <>
      <div className="draft-bar drafting" role="status">
        <span>
          <strong>Draft.</strong> Changes to the plan land here, not on the live roadmap, until it
          is published. Progress is still recorded on the live roadmap.
        </span>
        {confirming ? (
          <span className="draft-bar-actions">
            <span>Discard the draft and every change in it?</span>
            <button
              type="button"
              className="draft-bar-action danger"
              disabled={busy}
              onClick={async () => {
                setBusy(true)
                await discard()
                setBusy(false)
                setConfirming(false)
              }}
            >
              Discard
            </button>
            <button
              type="button"
              className="draft-bar-action"
              disabled={busy}
              onClick={() => setConfirming(false)}
            >
              Keep it
            </button>
          </span>
        ) : (
          <span className="draft-bar-actions">
            <button
              type="button"
              className="draft-bar-action primary"
              onClick={() => void check(state.revision)}
            >
              Review and publish…
            </button>
            <button type="button" className="draft-bar-action" onClick={() => void leaveDraft()}>
              Back to live
            </button>
            <button type="button" className="draft-bar-action" onClick={() => setConfirming(true)}>
              Discard…
            </button>
          </span>
        )}
      </div>

      <dialog
        ref={dialog}
        className="reschedule publish-review"
        aria-label="Publish the draft"
        onClose={() => setReview(null)}
      >
        {review?.kind === 'checking' && <p className="muted">Comparing with the live roadmap…</p>}
        {review?.kind === 'failed' && (
          <>
            <p className="notice bad-notice" role="alert">
              {review.message}
            </p>
            <div className="form-actions">
              <button type="button" className="button" onClick={() => setReview(null)}>
                Close
              </button>
            </div>
          </>
        )}
        {review?.kind === 'ready' && (
          <ChangeReview
            state={state}
            title="Publish the draft"
            source={null}
            note={
              <>
                <p className="muted">
                  Compared with the live roadmap as it is now. Progress on the items the draft keeps
                  stays, and the plan it replaces is kept in the history.
                </p>
                {review.preview.liveChanged && (
                  <p className="notice" role="alert">
                    The live plan changed after this draft started. Publishing replaces those
                    changes with the draft’s; they are listed below.
                  </p>
                )}
              </>
            }
            preview={review.preview}
            busy={busy}
            words={PUBLISH_WORDS}
            onCancel={() => setReview(null)}
            onApply={() => void apply(review.preview)}
          />
        )}
      </dialog>
    </>
  )
}

/** "Sep 23, 14:05" in the roadmap's timezone. */
function when(instant: string, state: AppState): string {
  try {
    return new Date(instant).toLocaleString('en', {
      timeZone: state.roadmap.timeZone,
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    })
  } catch {
    return instant
  }
}
