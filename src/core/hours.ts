import { addDays, maxDate, minDate, startOfWeek, studyDaysBetween, toEpochDay } from './dates'
import type { Blackout, CivilDate, Task, PhaseNumber, WeeklyHours } from './types'

// Hours are read out of the `duration` text a task already carries, rather than
// stored as a number. The text is the honest record — "~25h, 7 videos" says more
// than 25 does — and an estimate that has to be kept in two places drifts.

const DURATION = /(\d+(?:[.,]\d+)?)\s*(?:[-–]\s*(\d+(?:[.,]\d+)?)\s*)?(h|hrs?|hours|min|minutes)\b/i

/**
 * The hours a task's duration text claims, or null when it claims none. A
 * range is read as its midpoint: "~2.5-3h" is 2.75.
 *
 * Returning null rather than 0 matters — a project task with no estimate is not
 * a task that takes no time, and a caller that wants to say so needs to see the
 * difference.
 */
export function estimatedHours(task: Task): number | null {
  const match = DURATION.exec(task.duration)
  if (!match) return null

  const low = Number(match[1]!.replace(',', '.'))
  const high = match[2] === undefined ? low : Number(match[2].replace(',', '.'))
  const value = (low + high) / 2
  return match[3]!.toLowerCase().startsWith('min') ? value / 60 : value
}

/**
 * The hours of a task that count as done.
 *
 * A finished task counts its whole estimate, whatever was declared along the
 * way: finished is finished. An unfinished one counts what was declared, never
 * more than the estimate. With no estimate there is nothing to be part of, so it
 * counts nothing — which is also why the board offers no field to declare on it.
 */
export function progressHours(task: Task): number {
  const estimate = estimatedHours(task)
  if (estimate === null) return 0
  if (task.state === 'done') return estimate
  return Math.min(Math.max(task.hoursDone, 0), estimate)
}

/** Declared or finished hours across a list. */
export function sumProgressHours(tasks: readonly Task[]): number {
  return tasks.reduce((total, task) => total + progressHours(task), 0)
}

/** Hours across a list, ignoring what carries no estimate. */
export function sumHours(tasks: readonly Task[]): number {
  return tasks.reduce((total, task) => total + (estimatedHours(task) ?? 0), 0)
}

/** How many in a list have no estimate at all — what the sum above leaves out. */
export function withoutEstimate(tasks: readonly Task[]): number {
  return tasks.filter((task) => estimatedHours(task) === null).length
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

/** Tasks whose projection touches the week at all, not only those starting in it. */
export function inWeek(tasks: readonly Task[], week: Week): Task[] {
  return tasks.filter(
    (task) => task.projectedStartDate <= week.to && task.projectedEndDate >= week.from,
  )
}

/**
 * The hours of a list that fall inside one week, spread across each task's own
 * study days.
 *
 * Counting a whole estimate in every week it touches is what makes a weekly
 * figure meaningless: a 25h course spanning four weeks is not 25h of work in
 * each of them. A task with no estimate contributes nothing, same as anywhere
 * else.
 */
export function hoursInWeek(
  tasks: readonly Task[],
  week: Week,
  blackouts: readonly Blackout[],
): number {
  return tasks.reduce((total, task) => {
    const share = shareOf(task, blackouts)
    if (share === null) return total

    const from = maxDate(task.projectedStartDate, week.from)
    const to = minDate(task.projectedEndDate, week.to)
    if (to < from) return total

    return total + share(from, to)
  }, 0)
}

/**
 * `hoursInWeek` for every week the tasks touch, keyed by Monday.
 *
 * Each task is read once and visits only its own weeks. Asking `hoursInWeek`
 * week by week reads every task for every week of the plan, which made the
 * capacity check most of what validating a roadmap costs.
 */
export function hoursByWeek(
  tasks: readonly Task[],
  blackouts: readonly Blackout[],
): Map<CivilDate, number> {
  const weeks = new Map<CivilDate, number>()
  for (const task of tasks) {
    const share = shareOf(task, blackouts)
    if (share === null) continue

    const start = task.projectedStartDate
    const end = task.projectedEndDate
    for (let monday = startOfWeek(start); monday <= end; monday = addDays(monday, 7)) {
      const hours = share(maxDate(start, monday), minDate(end, addDays(monday, 6)))
      weeks.set(monday, (weeks.get(monday) ?? 0) + hours)
    }
  }
  return weeks
}

/**
 * The hours of a task that fall in `[from, to]`, spread evenly over its study
 * days. Null for a task that has no hours to spread.
 */
function shareOf(
  task: Task,
  blackouts: readonly Blackout[],
): ((from: CivilDate, to: CivilDate) => number) | null {
  const hours = estimatedHours(task)
  if (hours === null) return null

  const span = studyDaysBetween(task.projectedStartDate, task.projectedEndDate, blackouts)
  if (span === 0) return null

  return (from, to) => (hours * studyDaysBetween(from, to, blackouts)) / span
}

/** Days of a week that are already behind, so "hours left" can mean something. */
export function daysLeftInWeek(week: Week, today: CivilDate): number {
  if (today < week.from) return 7
  if (today > week.to) return 0
  return toEpochDay(week.to) - toEpochDay(today) + 1
}

export type PlanProgress = {
  /** Hours done: whole tasks finished, plus the hours declared on the rest. */
  done: number
  /** Hours of the tasks the plan expected finished before today. */
  expected: number
  total: number
  /** Each phase's share of the total, in phase order — where the plan's stages start and end. */
  phases: Array<{ phase: PhaseNumber; hours: number; done: number }>
}

/**
 * Progress through the plan in hours, against where the plan says you should be.
 *
 * What is done counts finished tasks in full and, on the rest, the hours
 * declared on them: the work in hand is real work, and a bar that only moved on
 * completion left a week's effort invisible until its last day. The expectation
 * still counts whole tasks — a task is expected once its planned end is behind
 * today, the same line `isOverdue` draws, so the two never disagree.
 */
export function planProgress(
  tasks: readonly Task[],
  phases: readonly PhaseNumber[],
  today: CivilDate,
): PlanProgress {
  const byPhase = phases.map((phase) => {
    const inPhase = tasks.filter((task) => task.phase === phase)
    return {
      phase,
      hours: sumHours(inPhase),
      done: sumProgressHours(inPhase),
    }
  })
  return {
    done: sumProgressHours(tasks),
    expected: sumHours(tasks.filter((task) => task.baselineEndDate < today)),
    total: sumHours(tasks),
    phases: byPhase,
  }
}
