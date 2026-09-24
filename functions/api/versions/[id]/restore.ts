import { versionId } from '../../../../src/server/history'
import { missingRevision, only, refusal, revisionOf } from '../../../../src/server/http'
import { UnknownVersionError, applyRestore, previewRestore } from '../../../../src/server/importing'
import type { Env } from '../../../../src/server/repository'
import { spaceOf } from '../../../../src/server/space'

/**
 * Brings a version of the plan back: `{ revision }`. Progress on the items it
 * keeps stays, and the plan it replaces goes into the history, so a restore can
 * be undone like any other change.
 *
 * With `dryRun: true` nothing is written, and the answer says what restoring
 * would change, as an import's preview does. A version the history does not
 * have answers 404; a write from an older revision, 409; one that would bring
 * in an error, 422.
 */
export const onRequest = only<Env>('POST', async ({ env, data, params, request }) => {
  const space = spaceOf(env, data)
  const id = versionId(params.id)
  if (id === null) return Response.json({ error: 'No such version' }, { status: 404 })

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return Response.json({ error: 'Body must be JSON' }, { status: 400 })
  }
  const revision = revisionOf(body)
  if (revision === null) return missingRevision()
  const { dryRun } = body as { dryRun?: unknown }

  try {
    return Response.json(
      dryRun === true
        ? await previewRestore(space, revision, id)
        : await applyRestore(space, revision, id),
    )
  } catch (error) {
    if (error instanceof UnknownVersionError) {
      return Response.json({ error: error.message }, { status: 404 })
    }
    const refused = refusal(error)
    if (refused) return refused
    const message = error instanceof Error ? error.message : 'Unknown error'
    return Response.json({ error: message }, { status: 500 })
  }
})
