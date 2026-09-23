import { parseGenerateRequest, type GenerateRequest } from '../../src/core/generate'
import { missingRevision, only, refusal, revisionOf } from '../../src/server/http'
import { applyGenerate, previewGenerate } from '../../src/server/generating'
import type { Env } from '../../src/server/repository'
import { targetOf } from '../../src/server/target'

/**
 * Adds a course, a certification, a project or practice blocks, placed in the
 * hours the plan leaves free: `{ revision, generator }`.
 *
 * With `dryRun: true` nothing is written, and the answer is the items with the
 * dates they would get, what they change and which rules the result breaks.
 * Without it, the answer is the new world, like every other write. With
 * `draft: true` both work on the draft instead. A request
 * that is not a generator, or that finds no room, answers 400; one from an
 * older revision, 409; one that would bring in an error, 422.
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

  const { generator, dryRun } = body as { generator?: unknown; dryRun?: unknown }
  try {
    const parsed: GenerateRequest = parseGenerateRequest(generator)
    return Response.json(
      dryRun === true
        ? await previewGenerate(env.DB, revision, parsed, targetOf(body))
        : await applyGenerate(env.DB, revision, parsed, targetOf(body)),
    )
  } catch (error) {
    const refused = refusal(error)
    if (refused) return refused
    const message = error instanceof Error ? error.message : 'Unknown error'
    return Response.json({ error: message }, { status: 500 })
  }
})
