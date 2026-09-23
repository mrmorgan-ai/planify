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
import type { CivilDate, IsoDateTime, Item, ScheduleOptions, State } from './types'

/**
 * Dependency order, with ties broken by phase, then curated order, then id, so
 * the output is stable — a test comparing two runs compares the same order.
 */
export function topologicalOrder(items: readonly Item[]): Item[] {
  const byId = new Map(items.map((item) => [item.id, item]))

  for (const item of items) {
    for (const dependency of item.dependsOn) {
      if (!byId.has(dependency)) {
        throw new Error(`${item.id} depends on ${dependency}, which does not exist`)
      }
    }
  }

  const pending = new Map<string, number>(
    items.map((item) => [item.id, new Set(item.dependsOn).size]),
  )
  const dependents = new Map<string, string[]>(items.map((item) => [item.id, []]))
  for (const item of items) {
    for (const dependency of new Set(item.dependsOn)) {
      dependents.get(dependency)?.push(item.id)
    }
  }

  const ready = items
    .filter((item) => pending.get(item.id) === 0)
    .sort((a, b) => compareRank(rank(a), rank(b)))

  const ordered: Item[] = []
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

  if (ordered.length !== items.length) {
    const stuck = items
      .filter((item) => !ordered.includes(item))
      .map((item) => item.id)
      .join(', ')
    throw new Error(`The dependency graph has a cycle involving: ${stuck}`)
  }

  return ordered
}

/**
 * Recomputes `projectedStartDate`/`projectedEndDate` for every item from the
 * baselines, the dependency graph and whatever is already done.
 *
 * Deliberately a full recompute rather than propagation from the changed node:
 * with a roadmap this size it costs nothing, it is idempotent so projections
 * cannot drift, and it handles un-completing an item — which propagation does
 * not.
 */
export function recomputeProjections(items: readonly Item[], options: ScheduleOptions): Item[] {
  const { blackouts, timeZone } = options
  const projected = new Map<string, { start: CivilDate; end: CivilDate }>()

  for (const item of topologicalOrder(items)) {
    const duration = studyDaysBetween(item.baselineStartDate, item.baselineEndDate, blackouts)
    if (duration < 1) {
      throw new Error(
        `${item.id} has a baseline span with no study days: ${item.baselineStartDate}..${item.baselineEndDate}`,
      )
    }

    const latestDependencyEnd = item.dependsOn.reduce<CivilDate | null>((latest, id) => {
      const resolved = projected.get(id)
      if (!resolved) throw new Error(`${item.id} was projected before its dependency ${id}`)
      return latest === null || resolved.end > latest ? resolved.end : latest
    }, null)

    // The baseline is a floor: finishing early never pulls the rest forward.
    const earliest =
      latestDependencyEnd === null
        ? item.baselineStartDate
        : maxDate(item.baselineStartDate, studyDayAfter(latestDependencyEnd, blackouts))

    let start = firstStudyDayFrom(earliest, blackouts)
    let end: CivilDate

    if (item.state === 'done' && item.completedAt) {
      // A completed item freezes on its real date, whatever its dependencies do.
      end = toCivilDate(item.completedAt, timeZone)
      start = minDate(start, end)
    } else {
      end = addStudyDays(start, duration, blackouts)
    }

    projected.set(item.id, { start, end })
  }

  return items.map((item) => {
    const resolved = projected.get(item.id)
    if (!resolved) throw new Error(`${item.id} was not projected`)
    return {
      ...item,
      projectedStartDate: resolved.start,
      projectedEndDate: resolved.end,
    }
  })
}

/**
 * `recomputeProjections` for a plan that may be broken. The engine cannot place
 * a missing dependency, a cycle or a span with no study day, and says so by
 * throwing; the items then keep the projections they came with, and the
 * validator is what names the problem — as an error, which refuses the write.
 */
export function projectWherePossible(items: readonly Item[], options: ScheduleOptions): Item[] {
  try {
    return recomputeProjections(items, options)
  } catch {
    return [...items]
  }
}

/**
 * Moves one item to a new state and reprojects everything. Keeps the invariant
 * the schema enforces: `done` carries a `completedAt`, anything else does not.
 * Re-marking an item done keeps its original date.
 *
 * Finishing an item also fills in its hours, so nobody has to declare the last
 * hour of something they just finished. Moving it back out of `done` leaves them
 * where they are: the work was really done, and the state says the rest.
 */
export function applyStateChange(
  items: readonly Item[],
  id: string,
  next: State,
  now: IsoDateTime,
  options: ScheduleOptions,
): Item[] {
  if (!items.some((item) => item.id === id)) throw new Error(`No item with id ${id}`)

  const updated = items.map((item) => {
    if (item.id !== id) return item
    const estimate = estimatedHours(item)
    return {
      ...item,
      state: next,
      completedAt: next === 'done' ? (item.completedAt ?? now) : null,
      hoursDone: next === 'done' && estimate !== null ? estimate : item.hoursDone,
    }
  })

  return recomputeProjections(updated, options)
}

/**
 * Declares how many hours of an item are already spent.
 *
 * Progress is information, not a decision: declaring hours never moves the item
 * to another state, the same way a dependency never blocks one. It is clamped to
 * the estimate, because "6 of 4 hours" is a typo rather than an achievement, and
 * refused outright when there is no estimate to be part of — an exam has hours
 * you sit, not hours you accumulate.
 *
 * Dates do not depend on hours, but the projections are recomputed anyway: one
 * write path, one guarantee about what comes back.
 */
export function applyHoursDone(
  items: readonly Item[],
  id: string,
  hours: number,
  options: ScheduleOptions,
): Item[] {
  const target = items.find((item) => item.id === id)
  if (!target) throw new Error(`No item with id ${id}`)

  const estimate = estimatedHours(target)
  if (estimate === null) throw new Error(`${id} has no hours estimate to declare against`)
  if (!Number.isFinite(hours) || hours < 0) throw new Error(`Hours must be zero or more`)

  const declared = Math.min(hours, estimate)
  const updated = items.map((item) => (item.id === id ? { ...item, hoursDone: declared } : item))

  return recomputeProjections(updated, options)
}

/**
 * Moves one item's baseline, pushes what follows it, and recomputes every
 * projection.
 *
 * When the item now ends N study days later than it did, everything that depends
 * on it — directly or down the chain — moves N study days later too, as a block:
 * the gaps the plan left between them are kept. Their baselines move, not only
 * their projections, because a push is a change of plan; moving the item back
 * later does not pull them with it.
 *
 * Pushing only goes forward. An item moved earlier or shortened leaves what
 * follows it where it was. Done items are not pushed and the push does not pass
 * through them: they ended when they ended.
 *
 * An item that depends on nothing keeps its own dates, because nothing about its
 * plan changed.
 */
export function applyBaselineDates(
  items: readonly Item[],
  id: string,
  start: CivilDate,
  end: CivilDate,
  options: ScheduleOptions,
): Item[] {
  if (!items.some((item) => item.id === id)) throw new Error(`No item with id ${id}`)
  if (end < start) throw new Error(`End ${end} is before start ${start}`)

  const before = recomputeProjections(items, options)
  const moved = recomputeProjections(
    items.map((item) =>
      item.id === id ? { ...item, baselineStartDate: start, baselineEndDate: end } : item,
    ),
    options,
  )

  const push = pushedBy(before, moved, id, options)
  if (push === 0) return moved

  const followers = followersOf(moved, id)
  return recomputeProjections(
    moved.map((item) =>
      followers.has(item.id)
        ? {
            ...item,
            baselineStartDate: shiftStudyDays(item.baselineStartDate, push, options.blackouts),
            baselineEndDate: shiftStudyDays(item.baselineEndDate, push, options.blackouts),
          }
        : item,
    ),
    options,
  )
}

/** Study days the item's projected end moved later by. Zero when it did not. */
function pushedBy(
  before: readonly Item[],
  after: readonly Item[],
  id: string,
  options: ScheduleOptions,
): number {
  const oldEnd = before.find((item) => item.id === id)?.projectedEndDate
  const newEnd = after.find((item) => item.id === id)?.projectedEndDate
  if (!oldEnd || !newEnd || newEnd <= oldEnd) return 0
  return studyDaysBetween(addDays(oldEnd, 1), newEnd, options.blackouts)
}

/**
 * Every unfinished item that depends on `id`, directly or through other
 * unfinished items. Each appears once, however many paths lead to it.
 */
function followersOf(items: readonly Item[], id: string): Set<string> {
  const dependents = new Map<string, Item[]>()
  for (const item of items) {
    for (const dependency of new Set(item.dependsOn)) {
      const list = dependents.get(dependency) ?? []
      list.push(item)
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

function rank(item: Item): Rank {
  return [item.phase, item.sortOrder, item.id]
}

function compareRank(a: Rank, b: Rank): number {
  return a[0] - b[0] || a[1] - b[1] || (a[2] < b[2] ? -1 : a[2] > b[2] ? 1 : 0)
}

function insertByRank(queue: Item[], item: Item): void {
  const target = rank(item)
  const at = queue.findIndex((queued) => compareRank(rank(queued), target) > 0)
  if (at === -1) queue.push(item)
  else queue.splice(at, 0, item)
}
