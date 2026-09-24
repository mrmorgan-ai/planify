import { isCivilDate } from '../../../../src/core/dates'
import { DatesError, datesMoved, moveDates } from '../../../../src/server/dates'
import { missingRevision, only, refusal, revisionOf } from '../../../../src/server/http'
import type { Env } from '../../../../src/server/repository'
import { previewIn, targetOf } from '../../../../src/server/target'

/**
 * Moves one item's baseline dates, pushing what depends on it forward by the
 * same study days — see `moveDates`. With `draft: true` the move lands in the
 * draft; with `dryRun: true` nothing is written, and the answer says what it
 * would change.
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

  const { baselineStartDate: start, baselineEndDate: end } = (body ?? {}) as {
    baselineStartDate?: unknown
    baselineEndDate?: unknown
  }

  if (typeof start !== 'string' || !isCivilDate(start)) {
    return Response.json({ error: 'baselineStartDate must be YYYY-MM-DD' }, { status: 400 })
  }
  if (typeof end !== 'string' || !isCivilDate(end)) {
    return Response.json({ error: 'baselineEndDate must be YYYY-MM-DD' }, { status: 400 })
  }
  const revision = revisionOf(body)
  if (revision === null) return missingRevision()

  try {
    if ((body as { dryRun?: unknown }).dryRun === true) {
      const moved = datesMoved(id, start, end)
      return Response.json(
        await previewIn(env.DB, targetOf(body), revision, (state) => ({
          ...state,
          items: moved(state),
        })),
      )
    }
    return Response.json(await moveDates(env.DB, targetOf(body), revision, id, start, end))
  } catch (error) {
    const refused = refusal(error)
    if (refused) return refused
    const message = error instanceof Error ? error.message : 'Unknown error'
    const status =
      error instanceof DatesError ? 400 : message.startsWith('No item with id') ? 404 : 500
    return Response.json({ error: message }, { status })
  }
})
