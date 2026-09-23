import { isCivilDate } from '../../src/core/dates'
import { reschedulePlan } from '../../src/core/reschedule'
import { nowIso } from '../../src/server/clock'
import { missingRevision, only, refusal, revisionOf } from '../../src/server/http'
import { mutate, savePlanVersion, scheduleOptions, type Env } from '../../src/server/repository'

/**
 * Moves every unfinished item forward so the plan restarts on the given date,
 * keeping its shape. The plan it replaces is saved to plan_versions in the same
 * batch.
 *
 * The date may not be in the past — restarting yesterday leaves the plan late —
 * nor before the plan's own start. A date that moves nothing is refused rather
 * than answered with an unchanged world, so the client never shows "rescheduled"
 * for a no-op.
 */
export const onRequest = only<Env>('POST', async ({ env, request }) => {
  let body: unknown
  try {
    body = await request.json()
  } catch {
    return Response.json({ error: 'Body must be JSON' }, { status: 400 })
  }

  const restartDate = (body as { restartDate?: unknown } | null)?.restartDate
  if (typeof restartDate !== 'string' || !isCivilDate(restartDate)) {
    return Response.json({ error: 'restartDate must be YYYY-MM-DD' }, { status: 400 })
  }
  const revision = revisionOf(body)
  if (revision === null) return missingRevision()

  let shift = 0
  try {
    const state = await mutate(
      env.DB,
      revision,
      (current) => {
        if (restartDate < current.today) {
          throw new RefusedError(`${restartDate} is in the past; today is ${current.today}`)
        }
        const floor = current.roadmap.startDate
        if (floor !== '' && restartDate < floor) {
          throw new RefusedError(`The plan starts on ${floor}; ${restartDate} is before it`)
        }
        const result = reschedulePlan(current.items, restartDate, scheduleOptions(current.roadmap))
        if (result.shift === 0) {
          throw new RefusedError(`Nothing to move: the plan is not behind ${restartDate}`)
        }
        shift = result.shift
        return result.items
      },
      (current) => [
        savePlanVersion(env.DB, current, { createdAt: nowIso(), restartDate, shiftDays: shift }),
      ],
    )
    return Response.json(state)
  } catch (error) {
    const refused = refusal(error)
    if (refused) return refused
    const message = error instanceof Error ? error.message : 'Unknown error'
    return Response.json({ error: message }, { status: error instanceof RefusedError ? 400 : 500 })
  }
})

class RefusedError extends Error {}
