import {
  addDays,
  addStudyDays,
  firstStudyDayFrom,
  maxDate,
  minDate,
  shiftStudyDays,
  studyDayAfter,
  studyDaysBetween,
  toCivilDate,
} from './dates'
import { estimatedHours } from './hours'
import type { CivilDate, IsoDateTime, Task, ScheduleOptions, State } from './types'

/**
 * Dependency order, with ties broken by phase, then curated order, then id, so
 * the output is stable — a test comparing two runs compares the same order.
 */
export function topologicalOrder(tasks: readonly Task[]): Task[] {
  const byId = new Map(tasks.map((task) => [task.id, task]))

  for (const task of tasks) {
    for (const dependency of task.dependsOn) {
      if (!byId.has(dependency)) {
        throw new Error(`${task.id} depends on ${dependency}, which does not exist`)
      }
    }
  }

  const pending = new Map<string, number>(
    tasks.map((task) => [task.id, new Set(task.dependsOn).size]),
  )
  const dependents = new Map<string, string[]>(tasks.map((task) => [task.id, []]))
  for (const task of tasks) {
    for (const dependency of new Set(task.dependsOn)) {
      dependents.get(dependency)?.push(task.id)
    }
  }

  const ready = tasks
    .filter((task) => pending.get(task.id) === 0)
    .sort((a, b) => compareRank(rank(a), rank(b)))

  const ordered: Task[] = []
  while (ready.length > 0) {
    const next = ready.shift()
    if (!next) break
    ordered.push(next)

    for (const dependentId of dependents.get(next.id) ?? []) {
      const remaining = (pending.get(dependentId) ?? 0) - 1
      pending.set(dependentId, remaining)
      if (remaining === 0) {
        const dependent = byId.get(dependentId)
        if (dependent) insertByRank(ready, dependent)
      }
    }
  }

  if (ordered.length !== tasks.length) {
    const stuck = tasks
      .filter((task) => !ordered.includes(task))
      .map((task) => task.id)
      .join(', ')
    throw new Error(`The dependency graph has a cycle involving: ${stuck}`)
  }

  return ordered
}

/**
 * Recomputes `projectedStartDate`/`projectedEndDate` for every task from the
 * baselines, the dependency graph and whatever is already done.
 *
 * Deliberately a full recompute rather than propagation from the changed node:
 * with a roadmap this size it costs nothing, it is idempotent so projections
 * cannot drift, and it handles un-completing a task — which propagation does
 * not.
 */
export function recomputeProjections(tasks: readonly Task[], options: ScheduleOptions): Task[] {
  const { blackouts, timeZone } = options
  const projected = new Map<string, { start: CivilDate; end: CivilDate }>()

  for (const task of topologicalOrder(tasks)) {
    const duration = studyDaysBetween(task.baselineStartDate, task.baselineEndDate, blackouts)
    if (duration < 1) {
      throw new Error(
        `${task.id} has a baseline span with no study days: ${task.baselineStartDate}..${task.baselineEndDate}`,
      )
    }

    const latestDependencyEnd = task.dependsOn.reduce<CivilDate | null>((latest, id) => {
      const resolved = projected.get(id)
      if (!resolved) throw new Error(`${task.id} was projected before its dependency ${id}`)
      return latest === null || resolved.end > latest ? resolved.end : latest
    }, null)

    // The baseline is a floor: finishing early never pulls the rest forward.
    const earliest =
      latestDependencyEnd === null
        ? task.baselineStartDate
        : maxDate(task.baselineStartDate, studyDayAfter(latestDependencyEnd, blackouts))

    let start = firstStudyDayFrom(earliest, blackouts)
    let end: CivilDate

    if (task.state === 'done' && task.completedAt) {
      // A completed task freezes on its real date, whatever its dependencies do.
      end = toCivilDate(task.completedAt, timeZone)
      start = minDate(start, end)
    } else {
      end = addStudyDays(start, duration, blackouts)
    }

    projected.set(task.id, { start, end })
  }

  return tasks.map((task) => {
    const resolved = projected.get(task.id)
    if (!resolved) throw new Error(`${task.id} was not projected`)
    return {
      ...task,
      projectedStartDate: resolved.start,
      projectedEndDate: resolved.end,
    }
  })
}

/**
 * `recomputeProjections` for a plan that may be broken. The engine cannot place
 * a missing dependency, a cycle or a span with no study day, and says so by
 * throwing; the tasks then keep the projections they came with, and the
 * validator is what names the problem — as an error, which refuses the write.
 */
export function projectWherePossible(tasks: readonly Task[], options: ScheduleOptions): Task[] {
  try {
    return recomputeProjections(tasks, options)
  } catch {
    return [...tasks]
  }
}

/**
 * Moves one task to a new state and reprojects everything. Keeps the invariant
 * the schema enforces: `done` carries a `completedAt`, anything else does not.
 * Re-marking a task done keeps its original date.
 *
 * Finishing a task also fills in its hours, so nobody has to declare the last
 * hour of something they just finished. Moving it back out of `done` leaves them
 * where they are: the work was really done, and the state says the rest.
 */
export function applyStateChange(
  tasks: readonly Task[],
  id: string,
  next: State,
  now: IsoDateTime,
  options: ScheduleOptions,
): Task[] {
  if (!tasks.some((task) => task.id === id)) throw new Error(`No task with id ${id}`)

  const updated = tasks.map((task) => {
    if (task.id !== id) return task
    const estimate = estimatedHours(task)
    return {
      ...task,
      state: next,
      completedAt: next === 'done' ? (task.completedAt ?? now) : null,
      hoursDone: next === 'done' && estimate !== null ? estimate : task.hoursDone,
    }
  })

  return recomputeProjections(updated, options)
}

/**
 * Declares how many hours of a task are already spent.
 *
 * Progress is information, not a decision: declaring hours never moves the task
 * to another state, the same way a dependency never blocks one. It is clamped to
 * the estimate, because "6 of 4 hours" is a typo rather than an achievement, and
 * refused outright when there is no estimate to be part of — an exam has hours
 * you sit, not hours you accumulate.
 *
 * Dates do not depend on hours, but the projections are recomputed anyway: one
 * write path, one guarantee about what comes back.
 */
export function applyHoursDone(
  tasks: readonly Task[],
  id: string,
  hours: number,
  options: ScheduleOptions,
): Task[] {
  const target = tasks.find((task) => task.id === id)
  if (!target) throw new Error(`No task with id ${id}`)

  const estimate = estimatedHours(target)
  if (estimate === null) throw new Error(`${id} has no hours estimate to declare against`)
  if (!Number.isFinite(hours) || hours < 0) throw new Error(`Hours must be zero or more`)

  const declared = Math.min(hours, estimate)
  const updated = tasks.map((task) => (task.id === id ? { ...task, hoursDone: declared } : task))

  return recomputeProjections(updated, options)
}

/**
 * Moves one task's baseline, pushes what follows it, and recomputes every
 * projection.
 *
 * When the task now ends N study days later than it did, everything that depends
 * on it — directly or down the chain — moves N study days later too, as a block:
 * the gaps the plan left between them are kept. Their baselines move, not only
 * their projections, because a push is a change of plan; moving the task back
 * later does not pull them with it.
 *
 * Pushing only goes forward. A task moved earlier or shortened leaves what
 * follows it where it was. Done tasks are not pushed and the push does not pass
 * through them: they ended when they ended.
 *
 * A task that depends on nothing keeps its own dates, because nothing about its
 * plan changed — unless it is the next part of the same story and the move
 * now overlaps it, in which case it is set apart (see `separateParts`).
 */
export function applyBaselineDates(
  tasks: readonly Task[],
  id: string,
  start: CivilDate,
  end: CivilDate,
  options: ScheduleOptions,
): Task[] {
  if (!tasks.some((task) => task.id === id)) throw new Error(`No task with id ${id}`)
  if (end < start) throw new Error(`End ${end} is before start ${start}`)

  const before = recomputeProjections(tasks, options)
  const moved = recomputeProjections(
    tasks.map((task) =>
      task.id === id ? { ...task, baselineStartDate: start, baselineEndDate: end } : task,
    ),
    options,
  )

  const push = pushedBy(before, moved, id, options)
  const followers = push === 0 ? new Set<string>() : followersOf(moved, id)
  const pushed = moved.map((task) =>
    followers.has(task.id) ? shiftBaseline(task, push, options) : task,
  )
  return recomputeProjections(separateParts(tasks, pushed, options), options)
}

/**
 * The parts of a story that a move made overlap, set apart again.
 *
 * The parts of a book or a practice block are rarely chained by dependencies,
 * so a push along dependencies leaves the part after a moved one where it was —
 * now inside it. That next part moves to the study day after the moved one
 * ends, taking what depends on it along by the same amount, and so on down the
 * story. Only as far as needed: a part with room before it stays, so a
 * slipped first chapter does not drag chapters planned months later.
 *
 * Only overlaps behind a part this change moved are resolved; one the plan
 * already had is left for the validator to report.
 */
function separateParts(
  original: readonly Task[],
  planned: Task[],
  options: ScheduleOptions,
): Task[] {
  const was = new Map(original.map((task) => [task.id, task]))
  const hasMoved = (task: Task) => {
    const old = was.get(task.id)
    return (
      old !== undefined &&
      (old.baselineStartDate !== task.baselineStartDate ||
        old.baselineEndDate !== task.baselineEndDate)
    )
  }

  let tasks = planned
  // Each round moves at least one part later, and there are finitely many.
  for (let round = 0; round < tasks.length; round++) {
    const overlap = firstOverlap(tasks, hasMoved, options)
    if (!overlap) break
    const moving = followersOf(tasks, overlap.part.id).add(overlap.part.id)
    tasks = tasks.map((task) =>
      moving.has(task.id) ? shiftBaseline(task, overlap.by, options) : task,
    )
  }
  return tasks
}

/** The first unfinished part that starts before the moved part ahead of it ends. */
function firstOverlap(
  tasks: readonly Task[],
  hasMoved: (task: Task) => boolean,
  options: ScheduleOptions,
): { part: Task; by: number } | null {
  const stories = new Set(tasks.filter(hasMoved).map((task) => task.storyId))
  for (const storyId of stories) {
    if (storyId === null) continue
    const parts = tasks
      .filter((task) => task.storyId === storyId)
      .sort((a, b) => a.phase - b.phase || a.sortOrder - b.sortOrder)
    for (let index = 1; index < parts.length; index++) {
      const previous = parts[index - 1]!
      const part = parts[index]!
      if (
        hasMoved(previous) &&
        part.state !== 'done' &&
        part.baselineStartDate <= previous.baselineEndDate
      ) {
        const by = studyDaysBetween(part.baselineStartDate, previous.baselineEndDate, options.blackouts)
        if (by > 0) return { part, by }
      }
    }
  }
  return null
}

function shiftBaseline(task: Task, days: number, options: ScheduleOptions): Task {
  return {
    ...task,
    baselineStartDate: shiftStudyDays(task.baselineStartDate, days, options.blackouts),
    baselineEndDate: shiftStudyDays(task.baselineEndDate, days, options.blackouts),
  }
}

/** Study days the task's projected end moved later by. Zero when it did not. */
function pushedBy(
  before: readonly Task[],
  after: readonly Task[],
  id: string,
  options: ScheduleOptions,
): number {
  const oldEnd = before.find((task) => task.id === id)?.projectedEndDate
  const newEnd = after.find((task) => task.id === id)?.projectedEndDate
  if (!oldEnd || !newEnd || newEnd <= oldEnd) return 0
  return studyDaysBetween(addDays(oldEnd, 1), newEnd, options.blackouts)
}

/**
 * Every unfinished task that depends on `id`, directly or through other
 * unfinished tasks. Each appears once, however many paths lead to it.
 */
function followersOf(tasks: readonly Task[], id: string): Set<string> {
  const dependents = new Map<string, Task[]>()
  for (const task of tasks) {
    for (const dependency of new Set(task.dependsOn)) {
      const list = dependents.get(dependency) ?? []
      list.push(task)
      dependents.set(dependency, list)
    }
  }

  const found = new Set<string>()
  const queue = [id]
  while (queue.length > 0) {
    const current = queue.shift()!
    for (const dependent of dependents.get(current) ?? []) {
      if (dependent.state === 'done' || found.has(dependent.id)) continue
      found.add(dependent.id)
      queue.push(dependent.id)
    }
  }
  return found
}

type Rank = readonly [number, number, string]

function rank(task: Task): Rank {
  return [task.phase, task.sortOrder, task.id]
}

function compareRank(a: Rank, b: Rank): number {
  return a[0] - b[0] || a[1] - b[1] || (a[2] < b[2] ? -1 : a[2] > b[2] ? 1 : 0)
}

function insertByRank(queue: Task[], task: Task): void {
  const target = rank(task)
  const at = queue.findIndex((queued) => compareRank(rank(queued), target) > 0)
  if (at === -1) queue.push(task)
  else queue.splice(at, 0, task)
}
