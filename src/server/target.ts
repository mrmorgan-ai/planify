import { previewOf, type ImportPreview } from '../core/importing'
import type { AppState, Item, RoadmapContent } from '../core/types'
import { loadDraftState, mutateDraft } from './drafts'
import { StaleRevisionError, loadAppState, mutateContent, type WriteOptions } from './repository'
import type { Space } from './space'

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

export function loadTarget(space: Space, target: Target): Promise<AppState> {
  return target === 'draft' ? loadDraftState(space) : loadAppState(space)
}

/** `mutateContent` on the target. The draft keeps no version, so reason and summary go unused there. */
export function mutateTarget(
  space: Space,
  target: Target,
  expectedRevision: number | null,
  transform: (state: AppState) => RoadmapContent,
  options: WriteOptions = {},
): Promise<AppState> {
  return target === 'draft'
    ? mutateDraft(space, expectedRevision, transform, options)
    : mutateContent(space, expectedRevision, transform, options)
}

/** `mutate` on the target: a write that only moves items. */
export function mutateItemsIn(
  space: Space,
  target: Target,
  expectedRevision: number | null,
  transform: (state: AppState) => Item[],
  options: WriteOptions = {},
): Promise<AppState> {
  return mutateTarget(
    space,
    target,
    expectedRevision,
    (state) => ({ roadmap: state.roadmap, workItems: state.workItems, items: transform(state) }),
    options,
  )
}

/**
 * What a write would do to the target, without writing it: the dry run of an
 * edit or a move. Refused from an old revision, as the write itself would be.
 */
export async function previewIn(
  space: Space,
  target: Target,
  expectedRevision: number,
  transform: (state: AppState) => RoadmapContent,
): Promise<ImportPreview> {
  const state = await loadTarget(space, target)
  if (expectedRevision !== state.revision) throw new StaleRevisionError(state)
  return previewOf(state, transform(state))
}
