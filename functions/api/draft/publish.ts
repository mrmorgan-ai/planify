import { previewPublish, publishDraft } from '../../../src/server/drafts'
import { missingRevision, only, refusal, revisionOf } from '../../../src/server/http'
import type { Env } from '../../../src/server/repository'
import { spaceOf } from '../../../src/server/space'

/**
 * Makes the draft the plan: `{ draftRevision, revision }`, the draft's revision
 * as reviewed and the live one the review was made against. The live
 * roadmap's progress stays and the draft ends, in one write.
 *
 * With `dryRun: true` only `draftRevision` is needed: nothing is written, and
 * the answer says what publishing would change on the live roadmap, the rules it
 * would break, whether the live plan changed since the draft started, and the
 * live revision to publish from. A stale revision answers 409 with the draft's
 * world; a draft that would bring in an error, 422; no draft, 404.
 */
export const onRequest = only<Env>('POST', async ({ env, data, request }) => {
  const space = spaceOf(env, data)
  let body: unknown
  try {
    body = await request.json()
  } catch {
    return Response.json({ error: 'Body must be JSON' }, { status: 400 })
  }

  const draftRevision = revisionOf({
    revision: (body as { draftRevision?: unknown } | null)?.draftRevision,
  })
  if (draftRevision === null) {
    return Response.json(
      { error: 'draftRevision must be the revision of the draft that was reviewed' },
      { status: 400 },
    )
  }
  const dryRun = (body as { dryRun?: unknown }).dryRun === true
  const revision = revisionOf(body)
  if (!dryRun && revision === null) return missingRevision()

  try {
    return Response.json(
      dryRun
        ? await previewPublish(space, draftRevision)
        : await publishDraft(space, revision!, draftRevision),
    )
  } catch (error) {
    const refused = refusal(error)
    if (refused) return refused
    const message = error instanceof Error ? error.message : 'Unknown error'
    return Response.json({ error: message }, { status: 500 })
  }
})
