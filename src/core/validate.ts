import { addDays, isBlackoutDay, isCivilDate, startOfWeek, studyDaysBetween } from './dates'
import { estimatedHours, hoursByWeek, weekOf } from './hours'
import type { CivilDate, Task, PhaseNumber, RoadmapContent } from './types'
import { tasksOf } from './stories'

/**
 * An error is data the app cannot run on, and a write carrying one is refused. A
 * warning is one of the plan's own conventions — a week over capacity, a task
 * longer than a week — shown but never blocking, because an edit in progress has
 * to be able to pass through a state that breaks one. A note is a convention many
 * plans follow but a sound plan may not — an optional task outside its phase's
 * milestone, a story with one task — so it is told, never counted as a problem.
 */
export type Severity = 'error' | 'warning' | 'info'

/** Every rule and how hard it is. The one place a rule's severity is decided. */
export const RULES = {
  'task-id': 'error',
  'duplicate-id': 'error',
  'story-id': 'error',
  'feature-id': 'error',
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
  'unknown-story': 'error',
  'unknown-feature': 'error',
  'unmapped-skill': 'error',
  'unknown-dimension': 'error',

  'too-long': 'warning',
  'phase-order': 'warning',
  'late-dependency': 'warning',
  'phase-gate': 'warning',
  'project-chain': 'warning',
  'overlapping-tasks': 'warning',
  'done-when': 'warning',
  'no-estimate': 'warning',
  'over-capacity': 'warning',
  'unused-skill': 'warning',
  'empty-axis': 'warning',

  'milestone-coverage': 'info',
  'single-task': 'info',
} as const satisfies Record<string, Severity>

export type Rule = keyof typeof RULES

export type Issue = {
  severity: Severity
  rule: Rule
  message: string
  /** The task to open to fix it, when one task is the thing to change. */
  taskId: string | null
}

type Report = (rule: Rule, message: string, taskId?: string) => void

const KEBAB = /^[a-z0-9]+(-[a-z0-9]+)*$/
/** Every task must be finishable inside one week, so a slip shows in days. */
const MAX_STUDY_DAYS = 7
/** Slack for the pro-rating's floating point when a week is filled exactly. */
const CAPACITY_TOLERANCE = 0.01

/** Every rule the roadmap follows, checked against the whole roadmap at once. */
export function validate(content: RoadmapContent): Issue[] {
  const issues: Issue[] = []
  const report: Report = (rule, message, taskId) => {
    issues.push({ severity: RULES[rule], rule, message, taskId: taskId ?? null })
  }

  const idsUnique = checkIds(content, report)
  checkPhases(content, report)
  checkSettings(content, report)
  const dated = checkDates(content, report)
  checkGraph(content, report, idsUnique)
  checkStories(content, report)
  checkHours(content, report, dated)
  checkSkills(content, report)

  return issues
}

/**
 * The errors a change brings in: those `after` has and `before` did not. A
 * roadmap already carrying an error must stay editable — refusing every write
 * until someone fixes it would lock the app — so only a new error refuses one.
 * `before` is only checked when `after` has errors, which a sound change never
 * does. A caller that has already validated `after` passes its issues along.
 */
export function introducedErrors(
  before: RoadmapContent,
  after: RoadmapContent,
  issues: readonly Issue[] = validate(after),
): Issue[] {
  const errors = issues.filter((issue) => issue.severity === 'error')
  if (errors.length === 0) return []
  const key = (issue: Issue) => `${issue.rule}\n${issue.message}`
  const existing = new Set(
    validate(before)
      .filter((issue) => issue.severity === 'error')
      .map(key),
  )
  return errors.filter((issue) => !existing.has(key(issue)))
}

function checkIds({ tasks, stories, features }: RoadmapContent, report: Report): boolean {
  const taskIds = new Set<string>()
  let unique = true
  for (const task of tasks) {
    if (!KEBAB.test(task.id)) report('task-id', `${task.id} is not kebab-case`, task.id)
    if (taskIds.has(task.id)) {
      report('duplicate-id', `${task.id} is used by more than one task`, task.id)
      unique = false
    }
    taskIds.add(task.id)
  }

  const storyIds = new Set<string>()
  for (const story of stories) {
    if (!KEBAB.test(story.id)) report('story-id', `${story.id} is not kebab-case`)
    if (storyIds.has(story.id)) {
      report('story-id', `${story.id} is used by more than one story`)
    }
    if (taskIds.has(story.id)) {
      report('story-id', `${story.id} is both a task and a story`)
    }
    storyIds.add(story.id)
  }

  const featureIds = new Set<string>()
  for (const feature of features) {
    if (!KEBAB.test(feature.id)) report('feature-id', `${feature.id} is not kebab-case`)
    if (featureIds.has(feature.id)) {
      report('feature-id', `${feature.id} is used by more than one feature`)
    }
    if (taskIds.has(feature.id) || storyIds.has(feature.id)) {
      report('feature-id', `${feature.id} is both a feature and a task or story`)
    }
    featureIds.add(feature.id)
  }
  return unique
}

function checkPhases({ roadmap, stories, tasks }: RoadmapContent, report: Report): void {
  const numbers = roadmap.phases.map((phase) => phase.number).sort((a, b) => a - b)
  if (numbers.some((number, index) => number !== index + 1)) {
    report(
      'phase-numbering',
      `Phases must be numbered 1 to n without gaps, got ${numbers.join(', ')}`,
    )
  }

  // A task's phase is its story's, so the story is where an undefined one is named.
  const defined = new Set<number>(numbers)
  for (const story of stories) {
    if (!defined.has(story.phase)) {
      report('unknown-phase', `${story.id} is in phase ${story.phase}, which is not defined`)
    }
  }

  const byId = new Map(tasks.map((task) => [task.id, task]))
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
        milestone.id,
      )
    }
  }

  for (const phase of roadmap.phases) {
    const seen = new Map<number, string>()
    for (const task of tasks.filter((candidate) => candidate.phase === phase.number)) {
      const other = seen.get(task.sortOrder)
      if (other !== undefined) {
        report(
          'sort-order',
          `${other} and ${task.id} share position ${task.sortOrder} in phase ${phase.number}`,
          task.id,
        )
      }
      seen.set(task.sortOrder, task.id)
    }
  }

  // Phase windows are read off the tasks rather than declared, so they can
  // never disagree with the dates they describe.
  const window = (phase: PhaseNumber) => span(tasks.filter((task) => task.phase === phase))
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

function checkSettings(
  { roadmap, tasks, stories, features }: RoadmapContent,
  report: Report,
): void {
  try {
    new Intl.DateTimeFormat('en-CA', { timeZone: roadmap.timeZone })
  } catch {
    report('time-zone', `${roadmap.timeZone} is not a timezone the runtime knows`)
  }

  const badLink = (link: string | null) => link !== null && !link.startsWith('https://')
  for (const task of tasks) {
    if (badLink(task.link)) {
      report('link', `${task.id} links to ${task.link}; links must be https or empty`, task.id)
    }
  }
  for (const each of [...stories, ...features]) {
    if (badLink(each.link)) {
      report('link', `${each.id} links to ${each.link}; links must be https or empty`)
    }
  }
}

/** Returns the tasks whose dates are sound enough to count hours on. */
function checkDates({ roadmap, tasks }: RoadmapContent, report: Report): Task[] {
  const { blackouts, startDate } = roadmap
  const dated: Task[] = []

  for (const task of tasks) {
    const start = task.baselineStartDate
    const end = task.baselineEndDate
    if (!isCivilDate(start) || !isCivilDate(end)) {
      report('dates', `${task.id} has planned dates not in YYYY-MM-DD: ${start}..${end}`, task.id)
      continue
    }

    const studyDays = end < start ? 0 : studyDaysBetween(start, end, blackouts)
    if (studyDays < 1) {
      report('dates', `${task.id} has no study day between ${start} and ${end}`, task.id)
      continue
    }
    dated.push(task)

    if (isBlackoutDay(start, blackouts)) {
      report('blackout-edge', `${task.id} starts inside a pause, on ${start}`, task.id)
    }
    if (isBlackoutDay(end, blackouts)) {
      report('blackout-edge', `${task.id} ends inside a pause, on ${end}`, task.id)
    }
    if (startDate !== '' && start < startDate) {
      report(
        'before-start',
        `${task.id} starts on ${start}, before the plan does (${startDate})`,
        task.id,
      )
    }
    if (studyDays > MAX_STUDY_DAYS) {
      report(
        'too-long',
        `${task.id} spans ${studyDays} study days; split it into parts of ${MAX_STUDY_DAYS} or fewer`,
        task.id,
      )
    }
  }
  return dated
}

function checkGraph(
  { roadmap, tasks, stories }: RoadmapContent,
  report: Report,
  idsUnique: boolean,
): void {
  const byId = new Map(tasks.map((task) => [task.id, task]))

  for (const task of tasks) {
    const seen = new Set<string>()
    for (const dependency of task.dependsOn) {
      if (dependency === task.id) report('dependency', `${task.id} depends on itself`, task.id)
      else if (!byId.has(dependency)) {
        report('dependency', `${task.id} depends on ${dependency}, which does not exist`, task.id)
      }
      if (seen.has(dependency)) {
        report('dependency', `${task.id} lists ${dependency} twice`, task.id)
      }
      seen.add(dependency)
    }
  }

  // Only the edges that point somewhere real: a missing task is its own error,
  // and letting it through would read as a cycle as well.
  const known = tasks.map((task) => ({
    ...task,
    dependsOn: task.dependsOn.filter((id) => id !== task.id && byId.has(id)),
  }))
  if (idsUnique) {
    const cycle = findCycle(known)
    if (cycle) {
      report('cycle', `Dependencies go round in a circle: ${cycle.join(' → ')}`, cycle[0])
    }
  }

  // The engine starts a task the study day after its latest dependency ends.
  // A dependency ending on or after the planned start therefore shifts the task
  // the moment the plan is loaded: the plan is born already late.
  for (const task of known) {
    for (const dependencyId of task.dependsOn) {
      const dependency = byId.get(dependencyId)
      if (dependency && dependency.baselineEndDate >= task.baselineStartDate) {
        report(
          'late-dependency',
          `${task.id} is planned to start on ${task.baselineStartDate}, ` +
            `but ${dependencyId} ends on ${dependency.baselineEndDate}`,
          task.id,
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
    for (const task of tasks.filter((candidate) => candidate.phase === phase.number)) {
      if (!reachedFrom(task.id).has(gate)) {
        report(
          'phase-gate',
          `${task.id} does not wait on ${gate}, which closes phase ${previous.number}`,
          task.id,
        )
      }
    }
  }

  for (const phase of roadmap.phases) {
    const milestoneId = phase.closingMilestoneId
    if (milestoneId === null || byId.get(milestoneId)?.phase !== phase.number) continue
    const reached = reachedFrom(milestoneId)
    for (const other of tasks.filter((candidate) => candidate.phase === phase.number)) {
      if (other.id !== milestoneId && !reached.has(other.id)) {
        report('milestone-coverage', `${milestoneId} does not wait on ${other.id}`, milestoneId)
      }
    }
  }

  for (const story of stories.filter((candidate) => candidate.type === 'Project')) {
    const steps = tasksOf(story.id, tasks)
    steps.forEach((part, index) => {
      const previous = steps[index - 1]
      if (previous && !part.dependsOn.includes(previous.id)) {
        report(
          'project-chain',
          `${part.id} does not depend on ${previous.id}, the task before it`,
          part.id,
        )
      }
    })
  }
}

/** Everything a task waits on, directly or not. Safe on a graph with cycles. */
function transitiveDependencies(tasks: readonly Task[]): (id: string) => Set<string> {
  const byId = new Map(tasks.map((task) => [task.id, task]))
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

/**
 * One cycle in the dependency graph, as the path that closes it — `a → b → a` —
 * or null when there is none. The path and not every task stuck behind it: the
 * engine can only say which tasks it could not order, which for one loop early
 * in the plan is everything after it.
 */
function findCycle(tasks: readonly Task[]): string[] | null {
  const byId = new Map(tasks.map((task) => [task.id, task]))
  const done = new Set<string>()
  const path: string[] = []
  const onPath = new Set<string>()

  const visit = (id: string): string[] | null => {
    if (onPath.has(id)) return [...path.slice(path.indexOf(id)), id]
    if (done.has(id)) return null
    path.push(id)
    onPath.add(id)
    for (const dependency of byId.get(id)?.dependsOn ?? []) {
      const found = visit(dependency)
      if (found) return found
    }
    path.pop()
    onPath.delete(id)
    done.add(id)
    return null
  }

  for (const task of tasks) {
    const found = visit(task.id)
    if (found) return found
  }
  return null
}

function checkStories({ tasks, stories, features }: RoadmapContent, report: Report): void {
  const storyIds = new Set(stories.map((story) => story.id))
  for (const task of tasks) {
    if (!storyIds.has(task.storyId)) {
      report(
        'unknown-story',
        `${task.id} is a task of ${task.storyId}, which does not exist`,
        task.id,
      )
    }
  }

  const featureIds = new Set(features.map((feature) => feature.id))
  for (const story of stories) {
    if (story.featureId !== null && !featureIds.has(story.featureId)) {
      report('unknown-feature', `${story.id} serves ${story.featureId}, which does not exist`)
    }
  }

  for (const story of stories) {
    const steps = tasksOf(story.id, tasks)
    if (steps.length < 2) {
      report(
        'single-task',
        `${story.id} has ${steps.length} ${steps.length === 1 ? 'task' : 'tasks'}; a story usually groups at least two`,
      )
    }
    steps.forEach((part, index) => {
      const previous = steps[index - 1]
      if (previous && part.baselineStartDate <= previous.baselineEndDate) {
        report(
          'overlapping-tasks',
          `${part.id} starts on ${part.baselineStartDate}, ` +
            `before ${previous.id} ends on ${previous.baselineEndDate}`,
          part.id,
        )
      }
    })
  }
}

function checkHours(
  { roadmap, stories, tasks }: RoadmapContent,
  report: Report,
  dated: readonly Task[],
): void {
  // Neither has a natural end the way a chapter does. Without a stated outcome,
  // done means the hours were spent, not that anything was learned. Read off the
  // story's type, when it has one: a task is what its story is.
  const typeOf = new Map(stories.map((story) => [story.id, story.type]))
  for (const task of tasks) {
    const type = typeOf.get(task.storyId)
    const needsOutcome = type === 'Practice' || type === 'Exam prep'
    if (needsOutcome && task.doneWhen.trim() === '') {
      report('done-when', `${task.id} does not say what done means`, task.id)
    }
  }

  // A task with no estimate counts as zero in every weekly total, which is how
  // a week gets planned past its capacity without anything showing it.
  for (const task of tasks) {
    if (estimatedHours(task) === null) {
      report(
        'no-estimate',
        `${task.id} has no hour estimate in its duration "${task.duration}"`,
        task.id,
      )
    }
  }

  // Capacity is a property of the plan. `hoursByWeek` spreads hours over the
  // projection, which moves with progress — finish something two days late and
  // the weeks after it fill up — so it is handed the planned dates instead.
  const planned = dated.map((task) => ({
    ...task,
    projectedStartDate: task.baselineStartDate,
    projectedEndDate: task.baselineEndDate,
  }))
  const capacity = roadmap.weeklyHours
  const plan = span(planned)
  if (capacity.normal <= 0 || plan === null) return
  const byWeek = hoursByWeek(planned, roadmap.blackouts)
  for (let monday = startOfWeek(plan.start); monday <= plan.end; monday = addDays(monday, 7)) {
    const week = weekOf(monday, capacity)
    const hours = byWeek.get(monday) ?? 0
    if (hours > week.hours + CAPACITY_TOLERANCE) {
      report(
        'over-capacity',
        `The week of ${monday} has ${hours.toFixed(1)}h planned for ${week.hours}h`,
      )
    }
  }
}

/** The first planned start and the last planned end, or null with no tasks. */
function span(tasks: readonly Task[]): { start: CivilDate; end: CivilDate } | null {
  let start: CivilDate | null = null
  let end: CivilDate | null = null
  for (const task of tasks) {
    if (start === null || task.baselineStartDate < start) start = task.baselineStartDate
    if (end === null || task.baselineEndDate > end) end = task.baselineEndDate
  }
  return start === null || end === null ? null : { start, end }
}

function checkSkills({ roadmap, tasks }: RoadmapContent, report: Report): void {
  const { dimensions, skillDimension } = roadmap

  for (const [skill, dimension] of Object.entries(skillDimension)) {
    if (!dimensions.includes(dimension)) {
      report('unknown-dimension', `"${skill}" is on axis "${dimension}", which does not exist`)
    }
  }

  for (const task of tasks) {
    for (const skill of task.skills) {
      if (skillDimension[skill] === undefined) {
        report('unmapped-skill', `${task.id} uses "${skill}", which is on no radar axis`, task.id)
      }
    }
  }

  // An unused skill sits in the radar's denominator forever, capping its axis.
  const used = new Set(tasks.flatMap((task) => task.skills))
  for (const skill of Object.keys(skillDimension)) {
    if (!used.has(skill)) report('unused-skill', `"${skill}" is on the radar but no task covers it`)
  }

  const covered = new Set(Object.values(skillDimension))
  for (const dimension of dimensions) {
    if (!covered.has(dimension)) report('empty-axis', `Axis "${dimension}" has no skills`)
  }
}
