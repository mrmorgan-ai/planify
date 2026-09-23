import type { AppState, Item, RoadmapContent } from '../core/types'
import { loadDraftState, mutateDraft } from './drafts'
import { loadAppState, mutateContent, type WriteOptions } from './repository'

/**
 * Where a change to the plan lands: the live roadmap, or the draft. The writes
 * that shape the plan — edits, dates, generators — take either; progress, imports
 * and the history act on the live roadmap only.
 */
export type Target = 'live' | 'draft'

/** The target a request names: `draft: true` in its body, or the live roadmap. */
export function targetOf(body: unknown): Target {
  return (body as { draft?: unknown } | null)?.draft === true ? 'draft' : 'live'
}

export function loadTarget(db: D1Database, target: Target): Promise<AppState> {
  return target === 'draft' ? loadDraftState(db) : loadAppState(db)
}

/** `mutateContent` on the target. The draft keeps no version, so reason and summary go unused there. */
export function mutateTarget(
  db: D1Database,
  target: Target,
  expectedRevision: number | null,
  transform: (state: AppState) => RoadmapContent,
  options: WriteOptions = {},
): Promise<AppState> {
  return target === 'draft'
    ? mutateDraft(db, expectedRevision, transform, options)
    : mutateContent(db, expectedRevision, transform, options)
}

/** `mutate` on the target: a write that only moves items. */
export function mutateItemsIn(
  db: D1Database,
  target: Target,
  expectedRevision: number | null,
  transform: (state: AppState) => Item[],
  options: WriteOptions = {},
): Promise<AppState> {
  return mutateTarget(
    db,
    target,
    expectedRevision,
    (state) => ({ roadmap: state.roadmap, workItems: state.workItems, items: transform(state) }),
    options,
  )
}
