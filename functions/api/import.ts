import { parseSeed, type SeedFile } from '../../src/core/seed'
import { missingRevision, only, refusal, revisionOf } from '../../src/server/http'
import { applyImport, previewImport } from '../../src/server/importing'
import type { Env } from '../../src/server/repository'

/**
 * Replaces the roadmap's content with a seed file's: `{ revision, roadmap }`,
 * where `roadmap` is the file and `revision` the one it was exported from.
 * Progress on the items the file keeps stays.
 *
 * With `dryRun: true` nothing is written, and the answer says what would
 * change — items added, removed with their progress, and edited — and which
 * rules the result breaks. Without it, the answer is the new world, like every
 * other write. A file that is not a roadmap answers 400; one from an older
 * revision, 409; one that would bring in an error, 422.
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

  const { roadmap, dryRun } = body as { roadmap?: unknown; dryRun?: unknown }
  let seed: SeedFile
  try {
    seed = parseSeed(roadmap)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error'
    return Response.json({ error: `Not a roadmap file: ${message}` }, { status: 400 })
  }

  try {
    return Response.json(
      dryRun === true
        ? await previewImport(env.DB, revision, seed)
        : await applyImport(env.DB, revision, seed),
    )
  } catch (error) {
    const refused = refusal(error)
    if (refused) return refused
    const message = error instanceof Error ? error.message : 'Unknown error'
    return Response.json({ error: message }, { status: 500 })
  }
})
