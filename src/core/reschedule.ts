import {
  addDays,
  firstStudyDayFrom,
  shiftStudyDays,
  startOfWeek,
  studyDaysBetween,
  toEpochDay,
} from './dates'
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
  /**
   * Where the plan restarts: the Monday of the chosen week, or the first study
   * day after a pause that covers it.
   */
  restart: CivilDate
  /**
   * Study days every unfinished item moves: whole weeks of them. Zero means
   * there is nothing to do.
   */
  shift: number
  /** The roadmap after the move, projections recomputed. */
  items: Item[]
  /** Ids of the items whose dates changed. */
  moved: string[]
}

/**
 * Moves every unfinished item forward by whole weeks, so the plan's earliest
 * unfinished week becomes the week of the restart date, keeping its shape.
 *
 * Whole weeks, not days: the plan is laid out in Monday-to-Sunday weeks, each
 * sized to the week's capacity. Moving it by a few days would leave every
 * calendar week holding pieces of two planned weeks — over capacity where there
 * was none — and every item on a different weekday. Moved by whole weeks, each
 * item keeps its weekday and each week keeps its load. The chosen date only
 * names the week, so a restart this week puts the plan on this week's Monday,
 * even when that day has already gone by.
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
 * The plan is never pulled earlier. A restart in or before the week of the
 * earliest unfinished start moves nothing, and `shift` is zero.
 */
export function reschedulePlan(
  items: readonly Item[],
  restartOn: CivilDate,
  options: ScheduleOptions,
): Reschedule {
  const { blackouts } = options
  const current = recomputeProjections(items, options)
  const restart = firstStudyDayFrom(startOfWeek(restartOn), blackouts)
  const restartWeek = startOfWeek(restart)

  const unfinished = current.filter((item) => item.state !== 'done')
  const anchor = unfinished.reduce<CivilDate | null>(
    (earliest, item) =>
      earliest === null || item.projectedStartDate < earliest ? item.projectedStartDate : earliest,
    null,
  )

  const anchorWeek = anchor === null ? null : startOfWeek(anchor)
  const shift =
    anchorWeek === null || restartWeek <= anchorWeek
      ? 0
      : studyDaysBetween(anchorWeek, addDays(restartWeek, -1), blackouts)

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
