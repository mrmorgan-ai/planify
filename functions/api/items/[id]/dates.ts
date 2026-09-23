import { isCivilDate } from '../../../../src/core/dates'
import { applyBaselineDates } from '../../../../src/core/schedule'
import type { Item } from '../../../../src/core/types'
import { missingRevision, only, refusal, revisionOf } from '../../../../src/server/http'
import { scheduleOptions, type Env } from '../../../../src/server/repository'
import { mutateItemsIn, targetOf } from '../../../../src/server/target'

/**
 * Moves one item's baseline dates. When it now ends later, everything that
 * depends on it is pushed forward by the same study days in the same write, so
 * the plan stays continuous. Nothing is ever pulled back. With `draft: true` the
 * move lands in the draft.
 *
 * The roadmap's start date is enforced here rather than in the engine: a floor
 * inside the engine would quietly clamp bad data instead of reporting it, and
 * the validator's strongest rule — nothing done means projected equals baseline
 * — depends on the engine not adjusting what it is given.
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
  if (end < start) {
    return Response.json({ error: `End ${end} is before start ${start}` }, { status: 400 })
  }
  const revision = revisionOf(body)
  if (revision === null) return missingRevision()

  try {
    const state = await mutateItemsIn(
      env.DB,
      targetOf(body),
      revision,
      (current) => {
        const floor = current.roadmap.startDate
        if (floor !== '' && start < floor) {
          throw new Error(`The plan starts on ${floor}; ${start} is before it`)
        }
        return applyBaselineDates(current.items, id, start, end, scheduleOptions(current.roadmap))
      },
      { summary: (before, after) => movedSummary(before.items, after.items, id, start, end) },
    )
    return Response.json(state)
  } catch (error) {
    const refused = refusal(error)
    if (refused) return refused
    const message = error instanceof Error ? error.message : 'Unknown error'
    const status = message.startsWith('No item with id')
      ? 404
      : message.includes('The plan starts on')
        ? 400
        : 500
    return Response.json({ error: message }, { status })
  }
})

/** "Moved Build part 2 to 2030-02-04 – 2030-02-06, pushing 3 items after it". */
function movedSummary(
  before: readonly Item[],
  after: readonly Item[],
  id: string,
  start: string,
  end: string,
): string {
  const was = new Map(before.map((item) => [item.id, item]))
  const pushed = after.filter((item) => {
    const old = was.get(item.id)
    return (
      item.id !== id &&
      old !== undefined &&
      (old.baselineStartDate !== item.baselineStartDate ||
        old.baselineEndDate !== item.baselineEndDate)
    )
  }).length
  const name = was.get(id)?.name ?? id
  return `Moved ${name} to ${start} – ${end}${pushed > 0 ? `, pushing ${pushed} items after it` : ''}`
}
