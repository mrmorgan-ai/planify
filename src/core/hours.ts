import { addDays, maxDate, minDate, startOfWeek, studyDaysBetween, toEpochDay } from './dates'
import type { Blackout, CivilDate, Item, PhaseNumber, WeeklyHours } from './types'

// Hours are read out of the `duration` text an item already carries, rather than
// stored as a number. The text is the honest record — "~25h, 7 videos" says more
// than 25 does — and an estimate that has to be kept in two places drifts.

const DURATION = /(\d+(?:[.,]\d+)?)\s*(?:[-–]\s*(\d+(?:[.,]\d+)?)\s*)?(h|hrs?|hours|min|minutes)\b/i

/**
 * The hours an item's duration text claims, or null when it claims none. A
 * range is read as its midpoint: "~2.5-3h" is 2.75.
 *
 * Returning null rather than 0 matters — a project task with no estimate is not
 * a task that takes no time, and a caller that wants to say so needs to see the
 * difference.
 */
export function estimatedHours(item: Item): number | null {
  const match = DURATION.exec(item.duration)
  if (!match) return null

  const low = Number(match[1]!.replace(',', '.'))
  const high = match[2] === undefined ? low : Number(match[2].replace(',', '.'))
  const value = (low + high) / 2
  return match[3]!.toLowerCase().startsWith('min') ? value / 60 : value
}

/**
 * The hours of an item that count as done.
 *
 * A finished item counts its whole estimate, whatever was declared along the
 * way: finished is finished. An unfinished one counts what was declared, never
 * more than the estimate. With no estimate there is nothing to be part of, so it
 * counts nothing — which is also why the board offers no field to declare on it.
 */
export function progressHours(item: Item): number {
  const estimate = estimatedHours(item)
  if (estimate === null) return 0
  if (item.state === 'done') return estimate
  return Math.min(Math.max(item.hoursDone, 0), estimate)
}

/** Declared or finished hours across a list. */
export function sumProgressHours(items: readonly Item[]): number {
  return items.reduce((total, item) => total + progressHours(item), 0)
}

/** Hours across a list, ignoring what carries no estimate. */
export function sumHours(items: readonly Item[]): number {
  return items.reduce((total, item) => total + (estimatedHours(item) ?? 0), 0)
}

/** How many in a list have no estimate at all — what the sum above leaves out. */
export function withoutEstimate(items: readonly Item[]): number {
  return items.filter((item) => estimatedHours(item) === null).length
}

export type Week = {
  /** Monday. */
  from: CivilDate
  /** Sunday. */
  to: CivilDate
  /** Study hours available in this week, from the roadmap's own capacity. */
  hours: number
}

/** The week a date falls in, with its capacity. Every week has the same one. */
export function weekOf(date: CivilDate, capacity: WeeklyHours): Week {
  const from = startOfWeek(date)
  return { from, to: addDays(from, 6), hours: capacity.normal }
}

/** Items whose projection touches the week at all, not only those starting in it. */
export function inWeek(items: readonly Item[], week: Week): Item[] {
  return items.filter(
    (item) => item.projectedStartDate <= week.to && item.projectedEndDate >= week.from,
  )
}

/**
 * The hours of a list that fall inside one week, spread across each item's own
 * study days.
 *
 * Counting a whole estimate in every week it touches is what makes a weekly
 * figure meaningless: a 25h course spanning four weeks is not 25h of work in
 * each of them. An item with no estimate contributes nothing, same as anywhere
 * else.
 */
export function hoursInWeek(
  items: readonly Item[],
  week: Week,
  blackouts: readonly Blackout[],
): number {
  return items.reduce((total, item) => {
    const hours = estimatedHours(item)
    if (hours === null) return total

    const span = studyDaysBetween(item.projectedStartDate, item.projectedEndDate, blackouts)
    if (span === 0) return total

    const from = maxDate(item.projectedStartDate, week.from)
    const to = minDate(item.projectedEndDate, week.to)
    if (to < from) return total

    return total + (hours * studyDaysBetween(from, to, blackouts)) / span
  }, 0)
}

/** Days of a week that are already behind, so "hours left" can mean something. */
export function daysLeftInWeek(week: Week, today: CivilDate): number {
  if (today < week.from) return 7
  if (today > week.to) return 0
  return toEpochDay(week.to) - toEpochDay(today) + 1
}

export type PlanProgress = {
  /** Hours done: whole items finished, plus the hours declared on the rest. */
  done: number
  /** Hours of the items the plan expected finished before today. */
  expected: number
  total: number
  /** Each phase's share of the total, in phase order — where the plan's stages start and end. */
  phases: Array<{ phase: PhaseNumber; hours: number; done: number }>
}

/**
 * Progress through the plan in hours, against where the plan says you should be.
 *
 * What is done counts finished items in full and, on the rest, the hours
 * declared on them: the work in hand is real work, and a bar that only moved on
 * completion left a week's effort invisible until its last day. The expectation
 * still counts whole items — an item is expected once its planned end is behind
 * today, the same line `isOverdue` draws, so the two never disagree.
 */
export function planProgress(
  items: readonly Item[],
  phases: readonly PhaseNumber[],
  today: CivilDate,
): PlanProgress {
  const byPhase = phases.map((phase) => {
    const inPhase = items.filter((item) => item.phase === phase)
    return {
      phase,
      hours: sumHours(inPhase),
      done: sumProgressHours(inPhase),
    }
  })
  return {
    done: sumProgressHours(items),
    expected: sumHours(items.filter((item) => item.baselineEndDate < today)),
    total: sumHours(items),
    phases: byPhase,
  }
}
