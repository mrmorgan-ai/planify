import { useRef, useState } from 'react'
import type { Edit } from '../core/edits'
import type { ImportPreview } from '../core/importing'
import type { AppState } from '../core/types'
import { StaleStateError, previewImport } from './api'
import { ChangeReview, type ReviewWords } from './ChangeReview'
import { History } from './History'
import {
  PausesSettings,
  PhasesSettings,
  PlanSettings,
  SkillsSettings,
  type Saver,
} from './RoadmapSettings'

/** A roadmap file as read from disk, split from the revision it names. */
type ChosenFile = {
  name: string
  roadmap: unknown
  /** The revision it was exported at, or null for a file that names none. */
  revision: number | null
}

type Review =
  | { kind: 'checking'; file: ChosenFile }
  | { kind: 'unreadable'; message: string }
  | { kind: 'stale'; file: ChosenFile; current: number }
  | { kind: 'ready'; file: ChosenFile; preview: ImportPreview }
  | { kind: 'imported' }

const IMPORT_WORDS: ReviewWords = {
  subject: 'The file',
  apply: 'Import',
  applying: 'Importing…',
  after: 'after the import',
  fix: (count) => `Fix ${count === 1 ? 'it' : 'them'} in the file and choose it again:`,
}

/**
 * The roadmap's own settings — the plan, its phases, its pauses, its skills —
 * the roadmap as a file, and the versions of it the history keeps.
 *
 * Each section keeps its own draft and saves on its own. They are keyed by the
 * revision, so every draft starts again from what is stored once anything saves.
 */
export function Settings({
  state,
  error,
  pendingId,
  edit,
  importFile,
  restore,
}: {
  state: AppState
  error: string | null
  pendingId: string | null
  edit: (edits: Edit[], id?: string) => Promise<boolean>
  importFile: (roadmap: unknown, revision: number) => Promise<boolean>
  restore: (id: number, revision: number) => Promise<boolean>
}) {
  /** The section whose last save was refused, so the error shows there. */
  const [refused, setRefused] = useState<string | null>(null)
  const saver = (key: string): Saver => ({
    busy: pendingId === key,
    error: refused === key ? error : null,
    save: async (edits) => {
      const saved = await edit(edits, key)
      setRefused(saved ? null : key)
      return saved
    },
  })

  return (
    <section className="settings">
      <h2 className="board-title">Settings</h2>
      <PlanSettings key={`plan-${state.revision}`} state={state} saver={saver('settings:plan')} />
      <PhasesSettings
        key={`phases-${state.revision}`}
        state={state}
        saver={saver('settings:phases')}
      />
      <PausesSettings
        key={`pauses-${state.revision}`}
        state={state}
        saver={saver('settings:pauses')}
      />
      <SkillsSettings
        key={`skills-${state.revision}`}
        state={state}
        saver={saver('settings:skills')}
      />
      <RoadmapFile state={state} importFile={importFile} />
      <History state={state} restore={restore} />
    </section>
  )
}

/**
 * The roadmap as a file: download it, edit it anywhere, bring it back. Nothing
 * is written until the preview has been read and confirmed, and the preview is
 * computed by the server from the same merge the import runs.
 */
function RoadmapFile({
  state,
  importFile,
}: {
  state: AppState
  importFile: (roadmap: unknown, revision: number) => Promise<boolean>
}) {
  const input = useRef<HTMLInputElement>(null)
  const [review, setReview] = useState<Review | null>(null)
  const [busy, setBusy] = useState(false)

  async function compare(file: ChosenFile, revision: number) {
    setReview({ kind: 'checking', file })
    try {
      setReview({ kind: 'ready', file, preview: await previewImport(file.roadmap, revision) })
    } catch (cause: unknown) {
      if (cause instanceof StaleStateError) {
        setReview({ kind: 'stale', file, current: cause.state.revision })
      } else {
        setReview({ kind: 'unreadable', message: messageOf(cause) })
      }
    }
  }

  async function choose(chosen: File) {
    let parsed: unknown
    try {
      parsed = JSON.parse(await chosen.text())
    } catch {
      setReview({ kind: 'unreadable', message: `${chosen.name} is not JSON.` })
      return
    }
    const { revision, ...roadmap } = (parsed ?? {}) as { revision?: unknown }
    const file = {
      name: chosen.name,
      roadmap,
      revision: typeof revision === 'number' ? revision : null,
    }
    await compare(file, file.revision ?? state.revision)
  }

  async function apply(file: ChosenFile, preview: ImportPreview) {
    setBusy(true)
    const done = await importFile(file.roadmap, preview.revision)
    setBusy(false)
    // A refusal is reported in the footer; comparing again shows why here.
    if (done) setReview({ kind: 'imported' })
    else await compare(file, file.revision ?? state.revision)
  }

  return (
    <section className="block settings-section">
      <h2>Roadmap file</h2>
      <p className="settings-text">
        The whole roadmap as one JSON file: items, work items, phases, pauses, capacity and skills.
        Progress stays in the app. Edit the file anywhere and import it back — you see what changes
        before anything is saved.
      </p>

      <div className="settings-actions">
        <a className="button" href="/api/export" download="roadmap.json">
          Download roadmap.json
        </a>
        <button
          type="button"
          className="button"
          disabled={busy || review?.kind === 'checking'}
          onClick={() => input.current?.click()}
        >
          Import a file…
        </button>
        <input
          ref={input}
          type="file"
          accept="application/json,.json"
          hidden
          onChange={(event) => {
            const chosen = event.target.files?.[0]
            // Cleared, so choosing the same file again after editing it still fires.
            event.target.value = ''
            if (chosen) void choose(chosen)
          }}
        />
      </div>

      {review?.kind === 'checking' && <p className="muted">Comparing {review.file.name}…</p>}

      {review?.kind === 'unreadable' && (
        <p className="notice bad-notice" role="alert">
          {review.message}
        </p>
      )}

      {review?.kind === 'stale' && (
        <div className="import-review" role="status">
          <p className="notice">
            {review.file.revision === null
              ? `The roadmap changed while this page was open (it is now at revision ${review.current}).`
              : `${review.file.name} was exported at revision ${review.file.revision}, and the roadmap has changed since (it is now at revision ${review.current}). Importing it would undo those changes.`}
          </p>
          <div className="import-actions">
            <button type="button" className="button" onClick={() => setReview(null)}>
              Cancel
            </button>
            <button
              type="button"
              className="button"
              onClick={() => void compare(review.file, review.current)}
            >
              Compare with the current roadmap
            </button>
          </div>
        </div>
      )}

      {review?.kind === 'ready' && (
        <ChangeReview
          state={state}
          title={review.file.name}
          source={review.file.roadmap}
          note={
            review.file.revision === null && (
              <p className="muted">
                This file does not say which revision it came from, so it is compared with the
                roadmap as it is now.
              </p>
            )
          }
          preview={review.preview}
          busy={busy}
          words={IMPORT_WORDS}
          onCancel={() => setReview(null)}
          onApply={() => void apply(review.file, review.preview)}
        />
      )}

      {review?.kind === 'imported' && (
        <p className="good" role="status">
          Imported. The roadmap is at revision {state.revision}.
        </p>
      )}
    </section>
  )
}

function messageOf(cause: unknown): string {
  return cause instanceof Error ? cause.message : 'Unknown error'
}
