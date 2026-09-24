import { applyEdits } from '../core/edits'
import { generate, type GenerateRequest, type Placed } from '../core/generate'
import { previewOf, type ImportPreview } from '../core/importing'
import type { AppState } from '../core/types'
import { StaleRevisionError } from './repository'
import type { Space } from './space'
import { loadTarget, mutateTarget, type Target } from './target'

/** What a generator would add, placed, and what that does to the roadmap. */
export type GeneratePreview = ImportPreview & { placed: Placed[] }

/**
 * Runs the generator the apply runs, against the same revision, so the items
 * previewed are the items written. The backlog's order making room for them is
 * left out of the changes: every item after them moves down a place, and
 * listing each would bury what the generator actually adds.
 */
export async function previewGenerate(
  space: Space,
  revision: number,
  request: GenerateRequest,
  target: Target = 'live',
): Promise<GeneratePreview> {
  const state = await loadTarget(space, target)
  if (revision !== state.revision) throw new StaleRevisionError(state)
  const { edits, placed } = generate(state, state.today, request)
  const preview = previewOf(state, applyEdits(state, edits))
  const { changes } = preview
  return {
    ...preview,
    changes: {
      ...changes,
      items: {
        ...changes.items,
        changed: changes.items.changed.flatMap(({ id, fields }) => {
          const made = fields.filter((field) => field !== 'sortOrder')
          return made.length > 0 ? [{ id, fields: made }] : []
        }),
      },
    },
    placed,
  }
}

/** Adds what the generator makes in one write, kept in the history as its own change. */
export async function applyGenerate(
  space: Space,
  revision: number,
  request: GenerateRequest,
  target: Target = 'live',
): Promise<AppState> {
  let summary = ''
  return mutateTarget(
    space,
    target,
    revision,
    (state) => {
      const generated = generate(state, state.today, request)
      summary = generated.summary
      return applyEdits(state, generated.edits)
    },
    { reason: 'generate', summary: () => summary },
  )
}
