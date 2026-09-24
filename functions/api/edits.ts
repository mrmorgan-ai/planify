import { applyEdits, parseEdits, type Edit } from '../../src/core/edits'
import type { AppState } from '../../src/core/types'
import { missingRevision, only, refusal, revisionOf } from '../../src/server/http'
import type { Env } from '../../src/server/repository'
import { mutateTarget, previewIn, targetOf } from '../../src/server/target'

/**
 * Changes the roadmap's content: `{ revision, edits }`, where each edit updates
 * an item's fields, sets its dependencies, creates an item or deletes one. The
 * list lands as one batch or not at all, and the answer is the new world.
 * With `draft: true` they land in the draft instead, and `revision` is the
 * draft's. With `dryRun: true` nothing is written, and the answer says what they
 * would change and which rules the result would break.
 *
 * An edit that cannot be applied as asked — an unknown item, a field that is
 * not valid, a delete that would strand what depends on it — answers 400 naming
 * it. One that applies but would break a rule answers 422, like any other write.
 */
export const onRequest = only<Env>('POST', async ({ env, request }) => {
  let body: unknown
  try {
    body = await request.json()
  } catch {
    return Response.json({ error: 'Body must be JSON' }, { status: 400 })
  }

  const revision = revisionOf(body)
  if (revision === null) return missingRevision()

  try {
    const edits: Edit[] = parseEdits((body as { edits?: unknown }).edits)
    const transform = (state: AppState) => applyEdits(state, edits)
    return Response.json(
      (body as { dryRun?: unknown }).dryRun === true
        ? await previewIn(env.DB, targetOf(body), revision, transform)
        : await mutateTarget(env.DB, targetOf(body), revision, transform),
    )
  } catch (error) {
    const refused = refusal(error)
    if (refused) return refused
    const message = error instanceof Error ? error.message : 'Unknown error'
    return Response.json({ error: message }, { status: 500 })
  }
})
