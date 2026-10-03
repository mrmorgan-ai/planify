import {
  addDays,
  firstStudyDayFrom,
  shiftStudyDays,
  startOfWeek,
  studyDaysBetween,
  toEpochDay,
} from './dates'
import { recomputeProjections } from './schedule'
import type { CivilDate, Task, ScheduleOptions } from './types'

/**
 * How far behind the oldest unfinished task has to be before the app offers to
 * reschedule. A week: a day or two late is a normal week, a whole one is a plan
 * that no longer describes what is happening.
 */
export const LATE_THRESHOLD_DAYS = 7

export type Lateness = {
  /** Calendar days from the oldest late task's end to today. */
  days: number
  /** The end date of the oldest late task. */
  since: CivilDate
  /** Every unfinished task whose projected end is behind today, oldest first. */
  tasks: Task[]
}

/**
 * Where the plan stands against today, or null when nothing is late. Reads the
 * projection, the same line `isOverdue` draws, so the alert and the red dates
 * never disagree about what is late.
 */
export function lateness(tasks: readonly Task[], today: CivilDate): Lateness | null {
  const late = tasks
    .filter((task) => task.state !== 'done' && task.projectedEndDate < today)
    .sort((a, b) => (a.projectedEndDate < b.projectedEndDate ? -1 : 1))
  const oldest = late[0]
  if (!oldest) return null
  return {
    days: toEpochDay(today) - toEpochDay(oldest.projectedEndDate),
    since: oldest.projectedEndDate,
    tasks: late,
  }
}

/** Behind by enough to recommend rescheduling. */
export function needsReschedule(tasks: readonly Task[], today: CivilDate): boolean {
  const behind = lateness(tasks, today)
  return behind !== null && behind.days >= LATE_THRESHOLD_DAYS
}

export type Reschedule = {
  /**
   * Where the plan restarts: the Monday of the chosen week, or the first study
   * day after a pause that covers it.
   */
  restart: CivilDate
  /**
   * Study days every unfinished task moves: whole weeks of them. Zero means
   * there is nothing to do.
   */
  shift: number
  /** The roadmap after the move, projections recomputed. */
  tasks: Task[]
  /** Ids of the tasks whose dates changed. */
  moved: string[]
}

/**
 * Moves every unfinished task forward by whole weeks, so the plan's earliest
 * unfinished week becomes the week of the restart date, keeping its shape.
 *
 * Whole weeks, not days: the plan is laid out in Monday-to-Sunday weeks, each
 * sized to the week's capacity. Moving it by a few days would leave every
 * calendar week holding pieces of two planned weeks — over capacity where there
 * was none — and every task on a different weekday. Moved by whole weeks, each
 * task keeps its weekday and each week keeps its load. The chosen date only
 * names the week, so a restart this week puts the plan on this week's Monday,
 * even when that day has already gone by.
 *
 * Every task that is not done moves by the same number of study days — linked
 * or not, late or not — so the order and the gaps between tasks stay as they
 * were planned. Tasks in progress move whole and keep the hours declared on
 * them. Done tasks stay where they ended.
 *
 * What moves is the forecast: each unfinished task's projection becomes its new
 * plan, shifted. A task already pushed past its baseline by a predecessor that
 * finished late therefore moves from where it really is, not from where it was
 * first planned.
 *
 * The plan is never pulled earlier. A restart in or before the week of the
 * earliest unfinished start moves nothing, and `shift` is zero.
 */
export function reschedulePlan(
  tasks: readonly Task[],
  restartOn: CivilDate,
  options: ScheduleOptions,
): Reschedule {
  const { blackouts } = options
  const current = recomputeProjections(tasks, options)
  const restart = firstStudyDayFrom(startOfWeek(restartOn), blackouts)
  const restartWeek = startOfWeek(restart)

  const unfinished = current.filter((task) => task.state !== 'done')
  const anchor = unfinished.reduce<CivilDate | null>(
    (earliest, task) =>
      earliest === null || task.projectedStartDate < earliest ? task.projectedStartDate : earliest,
    null,
  )

  const anchorWeek = anchor === null ? null : startOfWeek(anchor)
  const shift =
    anchorWeek === null || restartWeek <= anchorWeek
      ? 0
      : studyDaysBetween(anchorWeek, addDays(restartWeek, -1), blackouts)

  if (shift === 0) return { restart, shift, tasks: current, moved: [] }

  const rescheduled = recomputeProjections(
    current.map((task) =>
      task.state === 'done'
        ? task
        : {
            ...task,
            baselineStartDate: shiftStudyDays(task.projectedStartDate, shift, blackouts),
            baselineEndDate: shiftStudyDays(task.projectedEndDate, shift, blackouts),
          },
    ),
    options,
  )

  const before = new Map(current.map((task) => [task.id, task]))
  const moved = rescheduled
    .filter((task) => {
      const old = before.get(task.id)
      return (
        old !== undefined &&
        (old.projectedStartDate !== task.projectedStartDate ||
          old.projectedEndDate !== task.projectedEndDate)
      )
    })
    .map((task) => task.id)

  return { restart, shift, tasks: rescheduled, moved }
}
