import { addDays, isBlackoutDay, isCivilDate, startOfWeek, studyDaysBetween } from './dates'
import { estimatedHours, hoursInWeek, weekOf } from './hours'
import { topologicalOrder } from './schedule'
import type { CivilDate, Item, PhaseNumber, RoadmapContent } from './types'
import { partsOf } from './workItems'

/**
 * An error is data the app cannot run on, and a write carrying one is refused. A
 * warning is one of the plan's own conventions — a week over capacity, an item
 * longer than a week — shown but never blocking, because an edit in progress has
 * to be able to pass through a state that breaks one.
 */
export type Severity = 'error' | 'warning'

/** Every rule and how hard it is. The one place a rule's severity is decided. */
export const RULES = {
  'item-id': 'error',
  'duplicate-id': 'error',
  'work-item-id': 'error',
  'phase-numbering': 'error',
  'unknown-phase': 'error',
  'closing-milestone': 'error',
  'sort-order': 'error',
  'time-zone': 'error',
  link: 'error',
  dates: 'error',
  'blackout-edge': 'error',
  'before-start': 'error',
  dependency: 'error',
  cycle: 'error',
  'unknown-work-item': 'error',
  'unmapped-skill': 'error',
  'unknown-dimension': 'error',

  'too-long': 'warning',
  'phase-order': 'warning',
  'late-dependency': 'warning',
  'phase-gate': 'warning',
  'milestone-coverage': 'warning',
  'project-chain': 'warning',
  'single-part': 'warning',
  'overlapping-parts': 'warning',
  'done-when': 'warning',
  'no-estimate': 'warning',
  'over-capacity': 'warning',
  'unused-skill': 'warning',
  'empty-axis': 'warning',
} as const satisfies Record<string, Severity>

export type Rule = keyof typeof RULES

export type Issue = { severity: Severity; rule: Rule; message: string }

type Report = (rule: Rule, message: string) => void

const KEBAB = /^[a-z0-9]+(-[a-z0-9]+)*$/
/** Every item must be finishable inside one week, so a slip shows in days. */
const MAX_STUDY_DAYS = 7
/** Slack for the pro-rating's floating point when a week is filled exactly. */
const CAPACITY_TOLERANCE = 0.01

/** Every rule the roadmap follows, checked against the whole roadmap at once. */
export function validate(content: RoadmapContent): Issue[] {
  const issues: Issue[] = []
  const report: Report = (rule, message) => {
    issues.push({ severity: RULES[rule], rule, message })
  }

  const idsUnique = checkIds(content, report)
  checkPhases(content, report)
  checkSettings(content, report)
  const dated = checkDates(content, report)
  checkGraph(content, report, idsUnique)
  checkWorkItems(content, report)
  checkHours(content, report, dated)
  checkSkills(content, report)

  return issues
}

/**
 * The errors a change brings in: those `after` has and `before` did not. A
 * roadmap already carrying an error must stay editable — refusing every write
 * until someone fixes it would lock the app — so only a new error refuses one.
 * `before` is only checked when `after` has errors, which a sound change never
 * does.
 */
export function introducedErrors(before: RoadmapContent, after: RoadmapContent): Issue[] {
  const errors = validate(after).filter((issue) => issue.severity === 'error')
  if (errors.length === 0) return []
  const key = (issue: Issue) => `${issue.rule}\n${issue.message}`
  const existing = new Set(
    validate(before)
      .filter((issue) => issue.severity === 'error')
      .map(key),
  )
  return errors.filter((issue) => !existing.has(key(issue)))
}

function checkIds({ items, workItems }: RoadmapContent, report: Report): boolean {
  const itemIds = new Set<string>()
  let unique = true
  for (const item of items) {
    if (!KEBAB.test(item.id)) report('item-id', `${item.id} is not kebab-case`)
    if (itemIds.has(item.id)) {
      report('duplicate-id', `${item.id} is used by more than one item`)
      unique = false
    }
    itemIds.add(item.id)
  }

  const workItemIds = new Set<string>()
  for (const workItem of workItems) {
    if (!KEBAB.test(workItem.id)) report('work-item-id', `${workItem.id} is not kebab-case`)
    if (workItemIds.has(workItem.id)) {
      report('work-item-id', `${workItem.id} is used by more than one work item`)
    }
    if (itemIds.has(workItem.id)) {
      report('work-item-id', `${workItem.id} is both an item and a work item`)
    }
    workItemIds.add(workItem.id)
  }
  return unique
}

function checkPhases({ roadmap, items }: RoadmapContent, report: Report): void {
  const numbers = roadmap.phases.map((phase) => phase.number).sort((a, b) => a - b)
  if (numbers.some((number, index) => number !== index + 1)) {
    report(
      'phase-numbering',
      `Phases must be numbered 1 to n without gaps, got ${numbers.join(', ')}`,
    )
  }

  const defined = new Set<number>(numbers)
  for (const item of items) {
    if (!defined.has(item.phase)) {
      report('unknown-phase', `${item.id} is in phase ${item.phase}, which is not defined`)
    }
  }

  const byId = new Map(items.map((item) => [item.id, item]))
  for (const phase of roadmap.phases) {
    const milestoneId = phase.closingMilestoneId
    if (milestoneId === null) continue
    const milestone = byId.get(milestoneId)
    if (!milestone) {
      report(
        'closing-milestone',
        `Phase ${phase.number} closes on ${milestoneId}, which does not exist`,
      )
    } else if (milestone.phase !== phase.number) {
      report(
        'closing-milestone',
        `Phase ${phase.number} closes on ${milestoneId}, which is in phase ${milestone.phase}`,
      )
    }
  }

  for (const phase of roadmap.phases) {
    const seen = new Map<number, string>()
    for (const item of items.filter((candidate) => candidate.phase === phase.number)) {
      const other = seen.get(item.sortOrder)
      if (other !== undefined) {
        report(
          'sort-order',
          `${other} and ${item.id} share position ${item.sortOrder} in phase ${phase.number}`,
        )
      }
      seen.set(item.sortOrder, item.id)
    }
  }

  // Phase windows are read off the items rather than declared, so they can
  // never disagree with the dates they describe.
  const window = (phase: PhaseNumber) => span(items.filter((item) => item.phase === phase))
  for (const phase of roadmap.phases) {
    const next = roadmap.phases.find((other) => other.number === phase.number + 1)
    if (!next) continue
    const current = window(phase.number)
    const following = window(next.number)
    if (current && following && current.end >= following.start) {
      report(
        'phase-order',
        `Phase ${phase.number} ends on ${current.end} but phase ${next.number} starts on ${following.start}`,
      )
    }
  }
}

function checkSettings({ roadmap, items, workItems }: RoadmapContent, report: Report): void {
  try {
    new Intl.DateTimeFormat('en-CA', { timeZone: roadmap.timeZone })
  } catch {
    report('time-zone', `${roadmap.timeZone} is not a timezone the runtime knows`)
  }

  for (const entry of [...items, ...workItems]) {
    if (entry.link !== null && !entry.link.startsWith('https://')) {
      report('link', `${entry.id} links to ${entry.link}; links must be https or empty`)
    }
  }
}

/** Returns the items whose dates are sound enough to count hours on. */
function checkDates({ roadmap, items }: RoadmapContent, report: Report): Item[] {
  const { blackouts, startDate } = roadmap
  const dated: Item[] = []

  for (const item of items) {
    const start = item.baselineStartDate
    const end = item.baselineEndDate
    if (!isCivilDate(start) || !isCivilDate(end)) {
      report('dates', `${item.id} has planned dates not in YYYY-MM-DD: ${start}..${end}`)
      continue
    }

    const studyDays = end < start ? 0 : studyDaysBetween(start, end, blackouts)
    if (studyDays < 1) {
      report('dates', `${item.id} has no study day between ${start} and ${end}`)
      continue
    }
    dated.push(item)

    if (isBlackoutDay(start, blackouts)) {
      report('blackout-edge', `${item.id} starts inside a pause, on ${start}`)
    }
    if (isBlackoutDay(end, blackouts)) {
      report('blackout-edge', `${item.id} ends inside a pause, on ${end}`)
    }
    if (startDate !== '' && start < startDate) {
      report('before-start', `${item.id} starts on ${start}, before the plan does (${startDate})`)
    }
    if (studyDays > MAX_STUDY_DAYS) {
      report(
        'too-long',
        `${item.id} spans ${studyDays} study days; split it into parts of ${MAX_STUDY_DAYS} or fewer`,
      )
    }
  }
  return dated
}

function checkGraph(
  { roadmap, items, workItems }: RoadmapContent,
  report: Report,
  idsUnique: boolean,
): void {
  const byId = new Map(items.map((item) => [item.id, item]))

  for (const item of items) {
    const seen = new Set<string>()
    for (const dependency of item.dependsOn) {
      if (dependency === item.id) report('dependency', `${item.id} depends on itself`)
      else if (!byId.has(dependency)) {
        report('dependency', `${item.id} depends on ${dependency}, which does not exist`)
      }
      if (seen.has(dependency)) report('dependency', `${item.id} lists ${dependency} twice`)
      seen.add(dependency)
    }
  }

  // Only the edges that point somewhere real: a missing item is its own error,
  // and letting it through would read as a cycle as well.
  const known = items.map((item) => ({
    ...item,
    dependsOn: item.dependsOn.filter((id) => id !== item.id && byId.has(id)),
  }))
  if (idsUnique) {
    try {
      topologicalOrder(known)
    } catch (error) {
      report('cycle', error instanceof Error ? error.message : 'The dependencies form a cycle')
    }
  }

  // The engine starts an item the study day after its latest dependency ends.
  // A dependency ending on or after the planned start therefore shifts the item
  // the moment the plan is loaded: the plan is born already late.
  for (const item of known) {
    for (const dependencyId of item.dependsOn) {
      const dependency = byId.get(dependencyId)
      if (dependency && dependency.baselineEndDate >= item.baselineStartDate) {
        report(
          'late-dependency',
          `${item.id} is planned to start on ${item.baselineStartDate}, ` +
            `but ${dependencyId} ends on ${dependency.baselineEndDate}`,
        )
      }
    }
  }

  const reachedFrom = transitiveDependencies(known)

  for (const phase of roadmap.phases) {
    const previous = roadmap.phases.find((other) => other.number === phase.number - 1)
    if (!previous) continue
    const gate = previous.closingMilestoneId
    if (gate === null) {
      report(
        'phase-gate',
        `Phase ${previous.number} has no closing milestone, so phase ${phase.number} is not gated`,
      )
      continue
    }
    for (const item of items.filter((candidate) => candidate.phase === phase.number)) {
      if (!reachedFrom(item.id).has(gate)) {
        report(
          'phase-gate',
          `${item.id} does not wait on ${gate}, which closes phase ${previous.number}`,
        )
      }
    }
  }

  for (const phase of roadmap.phases) {
    const milestoneId = phase.closingMilestoneId
    if (milestoneId === null || byId.get(milestoneId)?.phase !== phase.number) continue
    const reached = reachedFrom(milestoneId)
    for (const other of items.filter((candidate) => candidate.phase === phase.number)) {
      if (other.id !== milestoneId && !reached.has(other.id)) {
        report('milestone-coverage', `${milestoneId} does not wait on ${other.id}`)
      }
    }
  }

  for (const workItem of workItems.filter((candidate) => candidate.type === 'Project')) {
    const parts = partsOf(workItem.id, items)
    parts.forEach((part, index) => {
      const previous = parts[index - 1]
      if (previous && !part.dependsOn.includes(previous.id)) {
        report('project-chain', `${part.id} does not depend on ${previous.id}, the task before it`)
      }
    })
  }
}

/** Everything an item waits on, directly or not. Safe on a graph with cycles. */
function transitiveDependencies(items: readonly Item[]): (id: string) => Set<string> {
  const byId = new Map(items.map((item) => [item.id, item]))
  const cache = new Map<string, Set<string>>()
  return (id) => {
    const cached = cache.get(id)
    if (cached) return cached
    const seen = new Set<string>()
    const queue = [...(byId.get(id)?.dependsOn ?? [])]
    while (queue.length > 0) {
      const next = queue.pop()
      if (next === undefined || seen.has(next)) continue
      seen.add(next)
      queue.push(...(byId.get(next)?.dependsOn ?? []))
    }
    cache.set(id, seen)
    return seen
  }
}

function checkWorkItems({ items, workItems }: RoadmapContent, report: Report): void {
  const workItemIds = new Set(workItems.map((workItem) => workItem.id))
  for (const item of items) {
    if (item.workItemId !== null && !workItemIds.has(item.workItemId)) {
      report(
        'unknown-work-item',
        `${item.id} is a part of ${item.workItemId}, which does not exist`,
      )
    }
  }

  for (const workItem of workItems) {
    const parts = partsOf(workItem.id, items)
    if (parts.length < 2) {
      report(
        'single-part',
        `${workItem.id} has ${parts.length} part(s); a work item groups at least two`,
      )
    }
    parts.forEach((part, index) => {
      const previous = parts[index - 1]
      if (previous && part.baselineStartDate <= previous.baselineEndDate) {
        report(
          'overlapping-parts',
          `${part.id} starts on ${part.baselineStartDate}, ` +
            `before ${previous.id} ends on ${previous.baselineEndDate}`,
        )
      }
    })
  }
}

function checkHours(
  { roadmap, items }: RoadmapContent,
  report: Report,
  dated: readonly Item[],
): void {
  // Neither has a natural end the way a chapter does. Without a stated outcome,
  // done means the hours were spent, not that anything was learned.
  for (const item of items) {
    const needsOutcome = item.type === 'Practice' || item.type === 'Exam prep'
    if (needsOutcome && item.doneWhen.trim() === '') {
      report('done-when', `${item.id} does not say what done means`)
    }
  }

  // An item with no estimate counts as zero in every weekly total, which is how
  // a week gets planned past its capacity without anything showing it.
  for (const item of items) {
    if (estimatedHours(item) === null) {
      report('no-estimate', `${item.id} has no hour estimate in its duration "${item.duration}"`)
    }
  }

  const capacity = roadmap.weeklyHours
  const plan = span(dated)
  if (capacity.normal <= 0 || plan === null) return
  for (let monday = startOfWeek(plan.start); monday <= plan.end; monday = addDays(monday, 7)) {
    const week = weekOf(monday, capacity)
    const planned = hoursInWeek(dated, week, roadmap.blackouts)
    if (planned > week.hours + CAPACITY_TOLERANCE) {
      report(
        'over-capacity',
        `The week of ${monday} has ${planned.toFixed(1)}h planned for ${week.hours}h`,
      )
    }
  }
}

/** The first planned start and the last planned end, or null with no items. */
function span(items: readonly Item[]): { start: CivilDate; end: CivilDate } | null {
  let start: CivilDate | null = null
  let end: CivilDate | null = null
  for (const item of items) {
    if (start === null || item.baselineStartDate < start) start = item.baselineStartDate
    if (end === null || item.baselineEndDate > end) end = item.baselineEndDate
  }
  return start === null || end === null ? null : { start, end }
}

function checkSkills({ roadmap, items }: RoadmapContent, report: Report): void {
  const { dimensions, skillDimension } = roadmap

  for (const [skill, dimension] of Object.entries(skillDimension)) {
    if (!dimensions.includes(dimension)) {
      report('unknown-dimension', `"${skill}" is on axis "${dimension}", which does not exist`)
    }
  }

  for (const item of items) {
    for (const skill of item.skills) {
      if (skillDimension[skill] === undefined) {
        report('unmapped-skill', `${item.id} uses "${skill}", which is on no radar axis`)
      }
    }
  }

  // An unused skill sits in the radar's denominator forever, capping its axis.
  const used = new Set(items.flatMap((item) => item.skills))
  for (const skill of Object.keys(skillDimension)) {
    if (!used.has(skill)) report('unused-skill', `"${skill}" is on the radar but no item covers it`)
  }

  const covered = new Set(Object.values(skillDimension))
  for (const dimension of dimensions) {
    if (!covered.has(dimension)) report('empty-axis', `Axis "${dimension}" has no skills`)
  }
}
