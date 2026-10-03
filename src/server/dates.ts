import { applyBaselineDates } from '../core/schedule'
import type { AppState, CivilDate, Task } from '../core/types'
import { scheduleOptions } from './repository'
import type { Space } from './space'
import { mutateTasksIn, type Target } from './target'

/** A move the plan refuses as asked, before anything runs. */
export class DatesError extends Error {}

/**
 * Moves one task's baseline dates. When it now ends later, everything that
 * depends on it is pushed forward by the same study days in the same write, so
 * the plan stays continuous. Nothing is ever pulled back.
 *
 * The roadmap's start date is enforced here rather than in the engine: a floor
 * inside the engine would quietly clamp bad data instead of reporting it, and
 * the validator's strongest rule — nothing done means projected equals baseline
 * — depends on the engine not adjusting what it is given.
 */
export function moveDates(
  space: Space,
  target: Target,
  revision: number,
  id: string,
  start: CivilDate,
  end: CivilDate,
): Promise<AppState> {
  return mutateTasksIn(space, target, revision, datesMoved(id, start, end), {
    summary: (before, after) => movedSummary(before.tasks, after.tasks, id, start, end),
  })
}

/** The move as a transform of the tasks, for a write or for a preview of one. */
export function datesMoved(
  id: string,
  start: CivilDate,
  end: CivilDate,
): (current: AppState) => Task[] {
  if (end < start) throw new DatesError(`End ${end} is before start ${start}`)
  return (current) => {
    const floor = current.roadmap.startDate
    if (floor !== '' && start < floor) {
      throw new DatesError(`The plan starts on ${floor}; ${start} is before it`)
    }
    return applyBaselineDates(current.tasks, id, start, end, scheduleOptions(current.roadmap))
  }
}

/** "Moved Build part 2 to 2030-02-04 – 2030-02-06, pushing 3 tasks after it". */
function movedSummary(
  before: readonly Task[],
  after: readonly Task[],
  id: string,
  start: string,
  end: string,
): string {
  const was = new Map(before.map((task) => [task.id, task]))
  const pushed = after.filter((task) => {
    const old = was.get(task.id)
    return (
      task.id !== id &&
      old !== undefined &&
      (old.baselineStartDate !== task.baselineStartDate ||
        old.baselineEndDate !== task.baselineEndDate)
    )
  }).length
  const name = was.get(id)?.name ?? id
  return `Moved ${name} to ${start} – ${end}${pushed > 0 ? `, pushing ${pushed} tasks after it` : ''}`
}
