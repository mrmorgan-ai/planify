import { describeChanges } from '../core/history'
import { importedContent, previewOf, type ImportPreview } from '../core/importing'
import { parseSeed, type SeedFile } from '../core/seed'
import type { AppState, RoadmapContent } from '../core/types'
import { nowIso } from './clock'
import { planOf } from './diff'
import { StaleRevisionError, loadAppState, mutateContent, type WriteOptions } from './repository'
import type { Space } from './space'

// A draft is the plan as the roadmap file has it, kept in one row beside the
// live roadmap, one per roadmap. Its world is the live one with the draft's plan brought in the
// way an import brings a file in: progress comes from the live roadmap, and the
// projections are computed from both. So a draft always shows today's progress,
// and a tick made while it is open is never lost by publishing it.
//
// A draft may break rules the live roadmap does not — staging a change often
// means passing through a state that breaks one — and shows them as its own
// warnings and errors. Only publishing refuses a new error.

/** A write to a draft when there is none. */
export class NoDraftError extends Error {
  constructor() {
    super('There is no draft in progress; start one first')
  }
}

type DraftRow = {
  revision: number
  started_at: string
  updated_at: string
  base_hash: string
  plan: string
}

type Loaded = { live: AppState; row: DraftRow; plan: SeedFile; state: AppState }

async function loadDraft(space: Space): Promise<Loaded | null> {
  const [live, row] = await Promise.all([
    loadAppState(space),
    space.db
      .prepare(
        'SELECT revision, started_at, updated_at, base_hash, plan FROM draft WHERE roadmap_id = ?',
      )
      .bind(space.roadmapId)
      .first<DraftRow>(),
  ])
  if (!row) return null
  const plan = parseSeed(JSON.parse(row.plan))
  return { live, row, plan, state: draftWorld(live, row, importedContent(live, plan)) }
}

function draftWorld(live: AppState, row: DraftRow, content: RoadmapContent): AppState {
  return {
    ...live,
    ...content,
    revision: row.revision,
    draft: { startedAt: row.started_at, updatedAt: row.updated_at },
  }
}

/** The draft's world: its plan with the live roadmap's progress. */
export async function loadDraftState(space: Space): Promise<AppState> {
  const draft = await loadDraft(space)
  if (!draft) throw new NoDraftError()
  return draft.state
}

/** Starts a draft from the live plan, or opens the one already in progress. */
export async function startDraft(space: Space, now: string = nowIso()): Promise<AppState> {
  const existing = await loadDraft(space)
  if (existing) return existing.state

  const plan = planOf(await loadAppState(space))
  // Two devices starting at once: the second finds the first's and opens it.
  await space.db
    .prepare(
      `INSERT INTO draft (roadmap_id, revision, started_at, updated_at, base_hash, plan)
       VALUES (?, 1, ?, ?, ?, ?) ON CONFLICT(roadmap_id) DO NOTHING`,
    )
    .bind(space.roadmapId, now, now, await fingerprint(plan), plan)
    .run()
  return loadDraftState(space)
}

/**
 * `mutateContent` for the draft: the same transforms, the same compare-and-swap
 * on the draft's own revision, and one row written. No version is kept — the
 * draft is not the plan yet — and a rule it breaks is shown, not refused.
 */
export async function mutateDraft(
  space: Space,
  expectedRevision: number | null,
  transform: (state: AppState) => RoadmapContent,
  options: Pick<WriteOptions, 'now'> = {},
): Promise<AppState> {
  const draft = await loadDraft(space)
  if (!draft) throw new NoDraftError()
  if (expectedRevision !== null && expectedRevision !== draft.row.revision) {
    throw new StaleRevisionError(draft.state)
  }

  const next = transform(draft.state)
  const now = options.now ?? nowIso()
  const written = await space.db
    .prepare(
      `UPDATE draft SET plan = ?, revision = revision + 1, updated_at = ?
       WHERE roadmap_id = ? AND revision = ? RETURNING revision`,
    )
    .bind(planOf(next), now, space.roadmapId, draft.row.revision)
    .first<{ revision: number }>()
  if (!written) {
    // Another device changed or ended the draft between the read and the write.
    const current = await loadDraft(space)
    if (!current) throw new NoDraftError()
    throw new StaleRevisionError(current.state)
  }
  return draftWorld(draft.live, { ...draft.row, revision: written.revision, updated_at: now }, next)
}

/** Drops the draft, and answers with the live world. */
export async function discardDraft(space: Space): Promise<AppState> {
  await space.db.prepare('DELETE FROM draft WHERE roadmap_id = ?').bind(space.roadmapId).run()
  return loadAppState(space)
}

/** What publishing would change on the live roadmap. */
export type PublishPreview = ImportPreview & {
  /**
   * The live plan changed after the draft started — edited on another device,
   * or rescheduled. Publishing replaces those changes with the draft's.
   */
  liveChanged: boolean
}

/**
 * Compares the draft with the live roadmap as it is now, the way an import is
 * previewed. `revision` in the answer is the live one, to publish from.
 */
export async function previewPublish(
  space: Space,
  draftRevision: number,
): Promise<PublishPreview> {
  const draft = await loadDraft(space)
  if (!draft) throw new NoDraftError()
  if (draftRevision !== draft.row.revision) throw new StaleRevisionError(draft.state)

  const { live, state } = draft
  return {
    ...previewOf(live, state),
    liveChanged: (await fingerprint(planOf(live))) !== draft.row.base_hash,
  }
}

/**
 * Makes the draft the plan in one write, and ends it in the same batch. The live
 * roadmap's progress stays, the plan it replaces is kept in the history, and a
 * draft that would bring in an error is refused like any other write.
 *
 * Both revisions must be the ones reviewed: the draft's, so what is published is
 * what was read, and the live one, so a change made there since is not replaced
 * unseen. Either being stale answers with the draft, to review again.
 */
export async function publishDraft(
  space: Space,
  revision: number,
  draftRevision: number,
  options: Pick<WriteOptions, 'now'> = {},
): Promise<AppState> {
  const draft = await loadDraft(space)
  if (!draft) throw new NoDraftError()
  if (draftRevision !== draft.row.revision) throw new StaleRevisionError(draft.state)
  const reviewAgain = (state: AppState) =>
    new StaleRevisionError(
      state,
      'The live roadmap changed since this draft was reviewed. Review it again, then publish.',
    )
  if (revision !== draft.live.revision) throw reviewAgain(draft.state)

  try {
    const published = await mutateContent(
      space,
      revision,
      (current) => importedContent(current, draft.plan),
      {
        reason: 'publish',
        summary: (before, after) => `Published a draft: ${describeChanges(before, after)}`,
        alongside: () => [
          space.db
            .prepare('DELETE FROM draft WHERE roadmap_id = ? AND revision = ?')
            .bind(space.roadmapId, draftRevision),
        ],
        now: options.now,
      },
    )
    return { ...published, draft: null }
  } catch (error) {
    // A live write landed in between: the person is still in the draft, so it is
    // the draft's world they get back.
    if (error instanceof StaleRevisionError) throw reviewAgain(draft.state)
    throw error
  }
}

/** The first 16 hex digits of a plan's SHA-256. */
async function fingerprint(plan: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(plan))
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')
    .slice(0, 16)
}
