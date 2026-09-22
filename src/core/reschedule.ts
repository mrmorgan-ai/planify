import { addDays, firstStudyDayFrom, shiftStudyDays, studyDaysBetween, toEpochDay } from './dates'
import { recomputeProjections } from './schedule'
import type { CivilDate, Item, ScheduleOptions } from './types'

/**
 * How far behind the oldest unfinished item has to be before the app offers to
 * reschedule. A week: a day or two late is a normal week, a whole one is a plan
 * that no longer describes what is happening.
 */
export const LATE_THRESHOLD_DAYS = 7

export type Lateness = {
  /** Calendar days from the oldest late item's end to today. */
  days: number
  /** The end date of the oldest late item. */
  since: CivilDate
  /** Every unfinished item whose projected end is behind today, oldest first. */
  items: Item[]
}

/**
 * Where the plan stands against today, or null when nothing is late. Reads the
 * projection, the same line `isOverdue` draws, so the alert and the red dates
 * never disagree about what is late.
 */
export function lateness(items: readonly Item[], today: CivilDate): Lateness | null {
  const late = items
    .filter((item) => item.state !== 'done' && item.projectedEndDate < today)
    .sort((a, b) => (a.projectedEndDate < b.projectedEndDate ? -1 : 1))
  const oldest = late[0]
  if (!oldest) return null
  return {
    days: toEpochDay(today) - toEpochDay(oldest.projectedEndDate),
    since: oldest.projectedEndDate,
    items: late,
  }
}

/** Behind by enough to recommend rescheduling. */
export function needsReschedule(items: readonly Item[], today: CivilDate): boolean {
  const behind = lateness(items, today)
  return behind !== null && behind.days >= LATE_THRESHOLD_DAYS
}

export type Reschedule = {
  /** The first study day on or after the chosen date: where the plan restarts. */
  restart: CivilDate
  /** Study days every unfinished item moves. Zero means there is nothing to do. */
  shift: number
  /** The roadmap after the move, projections recomputed. */
  items: Item[]
  /** Ids of the items whose dates changed. */
  moved: string[]
}

/**
 * Moves every unfinished item forward so the earliest of them starts on the
 * restart date, keeping the plan's shape.
 *
 * Every item that is not done moves by the same number of study days — linked
 * or not, late or not — so the order and the gaps between items stay as they
 * were planned. Items in progress move whole and keep the hours declared on
 * them. Done items stay where they ended.
 *
 * What moves is the forecast: each unfinished item's projection becomes its new
 * plan, shifted. An item already pushed past its baseline by a predecessor that
 * finished late therefore moves from where it really is, not from where it was
 * first planned.
 *
 * The plan is never pulled earlier. A restart on or before the earliest
 * unfinished start moves nothing, and `shift` is zero.
 */
export function reschedulePlan(
  items: readonly Item[],
  restartOn: CivilDate,
  options: ScheduleOptions,
): Reschedule {
  const { blackouts } = options
  const current = recomputeProjections(items, options)
  const restart = firstStudyDayFrom(restartOn, blackouts)

  const unfinished = current.filter((item) => item.state !== 'done')
  const anchor = unfinished.reduce<CivilDate | null>(
    (earliest, item) =>
      earliest === null || item.projectedStartDate < earliest ? item.projectedStartDate : earliest,
    null,
  )

  const shift =
    anchor === null || restart <= anchor
      ? 0
      : studyDaysBetween(anchor, addDays(restart, -1), blackouts)

  if (shift === 0) return { restart, shift, items: current, moved: [] }

  const rescheduled = recomputeProjections(
    current.map((item) =>
      item.state === 'done'
        ? item
        : {
            ...item,
            baselineStartDate: shiftStudyDays(item.projectedStartDate, shift, blackouts),
            baselineEndDate: shiftStudyDays(item.projectedEndDate, shift, blackouts),
          },
    ),
    options,
  )

  const before = new Map(current.map((item) => [item.id, item]))
  const moved = rescheduled
    .filter((item) => {
      const old = before.get(item.id)
      return (
        old !== undefined &&
        (old.projectedStartDate !== item.projectedStartDate ||
          old.projectedEndDate !== item.projectedEndDate)
      )
    })
    .map((item) => item.id)

  return { restart, shift, items: rescheduled, moved }
}
