import { applyEdits, parseEdits, type Edit } from '../../src/core/edits'
import { missingRevision, only, refusal, revisionOf } from '../../src/server/http'
import { mutateContent, type Env } from '../../src/server/repository'

/**
 * Changes the roadmap's content: `{ revision, edits }`, where each edit updates
 * an item's fields, sets its dependencies, creates an item or deletes one. The
 * list lands as one batch or not at all, and the answer is the new world.
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
    return Response.json(await mutateContent(env.DB, revision, (state) => applyEdits(state, edits)))
  } catch (error) {
    const refused = refusal(error)
    if (refused) return refused
    const message = error instanceof Error ? error.message : 'Unknown error'
    return Response.json({ error: message }, { status: 500 })
  }
})
