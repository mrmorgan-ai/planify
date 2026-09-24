import { applyBaselineDates } from '../core/schedule'
import type { AppState, CivilDate, Item } from '../core/types'
import { scheduleOptions } from './repository'
import { mutateItemsIn, type Target } from './target'

/** A move the plan refuses as asked, before anything runs. */
export class DatesError extends Error {}

/**
 * Moves one item's baseline dates. When it now ends later, everything that
 * depends on it is pushed forward by the same study days in the same write, so
 * the plan stays continuous. Nothing is ever pulled back.
 *
 * The roadmap's start date is enforced here rather than in the engine: a floor
 * inside the engine would quietly clamp bad data instead of reporting it, and
 * the validator's strongest rule — nothing done means projected equals baseline
 * — depends on the engine not adjusting what it is given.
 */
export function moveDates(
  db: D1Database,
  target: Target,
  revision: number,
  id: string,
  start: CivilDate,
  end: CivilDate,
): Promise<AppState> {
  return mutateItemsIn(db, target, revision, datesMoved(id, start, end), {
    summary: (before, after) => movedSummary(before.items, after.items, id, start, end),
  })
}

/** The move as a transform of the items, for a write or for a preview of one. */
export function datesMoved(
  id: string,
  start: CivilDate,
  end: CivilDate,
): (current: AppState) => Item[] {
  if (end < start) throw new DatesError(`End ${end} is before start ${start}`)
  return (current) => {
    const floor = current.roadmap.startDate
    if (floor !== '' && start < floor) {
      throw new DatesError(`The plan starts on ${floor}; ${start} is before it`)
    }
    return applyBaselineDates(current.items, id, start, end, scheduleOptions(current.roadmap))
  }
}

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
