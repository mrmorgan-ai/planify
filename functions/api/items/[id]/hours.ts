import { applyHoursDone } from '../../../../src/core/schedule'
import { missingRevision, only, refusal, revisionOf } from '../../../../src/server/http'
import { mutate, scheduleOptions, type Env } from '../../../../src/server/repository'

/**
 * Declares the hours already spent on one item. Progress only: the item's state
 * is left exactly where it was, and the whole recalculated world comes back, as
 * with every other write.
 */
export const onRequest = only<Env>('PATCH', async ({ env, params, request }) => {
  const id = Array.isArray(params.id) ? params.id[0] : params.id
  if (!id) return Response.json({ error: 'Missing item id' }, { status: 400 })

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return Response.json({ error: 'Body must be JSON' }, { status: 400 })
  }

  const hours = (body as { hours?: unknown } | null)?.hours
  if (typeof hours !== 'number' || !Number.isFinite(hours) || hours < 0) {
    return Response.json({ error: 'hours must be a number of zero or more' }, { status: 400 })
  }
  const revision = revisionOf(body)
  if (revision === null) return missingRevision()

  try {
    const state = await mutate(env.DB, revision, (current) =>
      applyHoursDone(current.items, id, hours, scheduleOptions(current.roadmap)),
    )
    return Response.json(state)
  } catch (error) {
    const refused = refusal(error)
    if (refused) return refused
    const message = error instanceof Error ? error.message : 'Unknown error'
    const status = message.startsWith('No item with id')
      ? 404
      : message.includes('no hours estimate') || message.startsWith('Hours must be')
        ? 400
        : 500
    return Response.json({ error: message }, { status })
  }
})
