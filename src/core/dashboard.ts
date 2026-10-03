import { addDays, blackoutAt, startOfWeek, toCivilDate, toEpochDay } from './dates'
import { isOverdue } from './selectors'
import type { Blackout, CivilDate, Dimension, Task, Phase, Roadmap } from './types'

// The numbers behind the dashboard. Pure functions over the task list, so every
// block is a computation the tests can pin, not something the view improvises.

/**
 * Consecutive weeks with at least one task completed, counting back from the
 * current week. Only completing counts — starting something does not.
 *
 * The week in progress never breaks the streak: with nothing done yet this
 * week, counting starts at the previous one. Breaking it on Monday morning
 * would punish a week that has not had its chance.
 */
export function currentStreakWeeks(
  tasks: readonly Task[],
  today: CivilDate,
  timeZone: string,
): number {
  const weeks = new Set(
    tasks
      .filter((task) => task.state === 'done' && task.completedAt !== null)
      .map((task) => startOfWeek(toCivilDate(task.completedAt as string, timeZone))),
  )

  const thisWeek = startOfWeek(today)
  let cursor = weeks.has(thisWeek) ? thisWeek : addDays(thisWeek, -7)
  let streak = 0
  while (weeks.has(cursor)) {
    streak += 1
    cursor = addDays(cursor, -7)
  }
  return streak
}

/** Past due and not done, soonest first — the block is a to-do list, not a count. */
export function overdueTasks(tasks: readonly Task[], today: CivilDate): Task[] {
  return tasks
    .filter((task) => isOverdue(task, today))
    .sort((a, b) => a.projectedEndDate.localeCompare(b.projectedEndDate))
}

export type MilestoneStatus = {
  task: Task
  /** Days from today to the projected end. Negative means it is already past. */
  daysAway: number
  /** Projected end minus baseline end. Positive is behind plan. */
  paceDays: number
}

/**
 * The nearest closing milestone still open. Read off `closingMilestoneId` and
 * never off `type`: one phase closes on a project task rather than on a
 * certification, so filtering by type would silently skip it.
 */
export function nextMilestone(
  tasks: readonly Task[],
  phases: readonly Phase[],
  today: CivilDate,
): MilestoneStatus | null {
  const ids = new Set(phases.map((phase) => phase.closingMilestoneId).filter(Boolean))
  const next = tasks
    .filter((task) => ids.has(task.id) && task.state !== 'done')
    .sort((a, b) => a.projectedEndDate.localeCompare(b.projectedEndDate))[0]

  if (!next) return null
  return {
    task: next,
    daysAway: toEpochDay(next.projectedEndDate) - toEpochDay(today),
    paceDays: toEpochDay(next.projectedEndDate) - toEpochDay(next.baselineEndDate),
  }
}

/** Where today sits: inside a non-study period, inside a phase, or past the end. */
export type Context =
  | { kind: 'blackout'; blackout: Blackout }
  | { kind: 'phase'; phase: Phase }
  | { kind: 'outside' }

export function activeContext(
  today: CivilDate,
  roadmap: Roadmap,
  tasks: readonly Task[],
): Context {
  const blackout = blackoutAt(today, roadmap.blackouts)
  if (blackout) return { kind: 'blackout', blackout }

  const phase = roadmap.phases.find((candidate) => {
    const range = phaseRange(tasks, candidate)
    return range !== null && range.start <= today && today <= range.end
  })
  return phase ? { kind: 'phase', phase } : { kind: 'outside' }
}

/** A phase spans its tasks: earliest projected start to latest projected end. */
export function phaseRange(
  tasks: readonly Task[],
  phase: Phase,
): { start: CivilDate; end: CivilDate } | null {
  const inPhase = tasks.filter((task) => task.phase === phase.number)
  if (inPhase.length === 0) return null
  return {
    start: inPhase.reduce((a, b) => (a < b.projectedStartDate ? a : b.projectedStartDate), inPhase[0]!.projectedStartDate),
    end: inPhase.reduce((a, b) => (a > b.projectedEndDate ? a : b.projectedEndDate), inPhase[0]!.projectedEndDate),
  }
}

/** What is in progress right now, soonest due first. The board's middle column. */
export function inProgress(tasks: readonly Task[]): Task[] {
  return tasks
    .filter((task) => task.state === 'in_progress')
    .sort((a, b) => a.projectedEndDate.localeCompare(b.projectedEndDate))
}

/**
 * Pending tasks with the nearest projected start. Shown when nothing is in
 * progress, as a suggestion of what to pick up — never as a restriction.
 */
export function suggestedNext(tasks: readonly Task[], limit = 3): Task[] {
  return tasks
    .filter((task) => task.state === 'pending')
    .sort((a, b) => a.projectedStartDate.localeCompare(b.projectedStartDate))
    .slice(0, limit)
}

/** Skills of every done task. Completing the task is the whole signal — no levels. */
export function coveredSkills(tasks: readonly Task[]): string[] {
  return unique(tasks.filter((task) => task.state === 'done').flatMap((task) => task.skills))
}

/** Skills still only reachable through unfinished tasks. */
export function pendingSkills(tasks: readonly Task[]): string[] {
  const covered = new Set(coveredSkills(tasks))
  return unique(
    tasks.filter((task) => task.state !== 'done').flatMap((task) => task.skills),
  ).filter((skill) => !covered.has(skill))
}

export type DimensionCoverage = {
  dimension: Dimension
  covered: number
  total: number
  /** Covered over total, 0 to 1. A dimension with no skills reads as 0. */
  ratio: number
}

export type DimensionSkills = DimensionCoverage & {
  /** Every skill on that axis, covered ones first, each alphabetical. */
  skills: { name: string; covered: boolean }[]
}

/**
 * The skill map arranged the way it is actually read: by dimension, not as one
 * heap of seventy-four names. Each axis carries its own count and its own
 * skills, so a group answers "how far along this axis am I" on its own.
 */
export function skillsByDimension(tasks: readonly Task[], roadmap: Roadmap): DimensionSkills[] {
  const covered = new Set(coveredSkills(tasks))
  const groups = new Map<Dimension, { name: string; covered: boolean }[]>(
    roadmap.dimensions.map((dimension) => [dimension, []]),
  )

  for (const [skill, dimension] of Object.entries(roadmap.skillDimension)) {
    groups.get(dimension)?.push({ name: skill, covered: covered.has(skill) })
  }

  return roadmap.dimensions.map((dimension) => {
    const skills = (groups.get(dimension) ?? []).sort(
      (a, b) => Number(b.covered) - Number(a.covered) || a.name.localeCompare(b.name),
    )
    const done = skills.filter((skill) => skill.covered).length
    return {
      dimension,
      covered: done,
      total: skills.length,
      ratio: skills.length === 0 ? 0 : done / skills.length,
      skills,
    }
  })
}

/**
 * The radar, as numbers. The same counts as the groups above with the names
 * dropped — one computation, so the chart and the list can never disagree.
 */
export function dimensionCoverage(tasks: readonly Task[], roadmap: Roadmap): DimensionCoverage[] {
  return skillsByDimension(tasks, roadmap).map(({ dimension, covered, total, ratio }) => ({
    dimension,
    covered,
    total,
    ratio,
  }))
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values)].sort((a, b) => a.localeCompare(b))
}
