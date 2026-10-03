import { projectWherePossible } from './schedule'
import { seedContent, toSeedFile, type SeedFile } from './seed'
import type { AppState, Task, RoadmapContent, State } from './types'
import { introducedErrors, validate, type Issue } from './validate'

/**
 * The roadmap a seed file turns the current one into. The file defines the
 * content, planned dates included: it names the revision it was exported from,
 * so it is the newest plan there is. Progress is the database's alone — a task
 * the file keeps keeps its state and hours, a new one starts pending, and one
 * the file no longer has goes, progress and all. Projections are then computed
 * again from the new plan.
 */
export function importedContent(current: RoadmapContent, seed: SeedFile): RoadmapContent {
  const next = seedContent(seed)
  const progress = new Map(current.tasks.map((task) => [task.id, task]))
  const tasks = next.tasks.map((task) => {
    const kept = progress.get(task.id)
    return kept
      ? { ...task, state: kept.state, completedAt: kept.completedAt, hoursDone: kept.hoursDone }
      : task
  })
  // A file the engine cannot place still previews: its tasks keep projections
  // equal to their plan, and the validator names what is wrong.
  const options = { blackouts: next.roadmap.blackouts, timeZone: next.roadmap.timeZone }
  return { ...next, tasks: projectWherePossible(tasks, options) }
}

/** A task an import removes, with what it had to show for itself. */
export type RemovedTask = {
  id: string
  name: string
  state: State
  hoursDone: number
}

/** What an import changes, for a person to read before it is applied. */
export type ImportChanges = {
  tasks: {
    added: string[]
    /** Progress on these goes with them. */
    removed: RemovedTask[]
    /** Each changed task with the fields of the file that differ. */
    changed: Array<{ id: string; fields: string[] }>
  }
  stories: { added: string[]; removed: string[]; changed: string[] }
  features: { added: string[]; removed: string[]; changed: string[] }
  /** The roadmap-wide sections that differ: phases, pauses, capacity, axes… */
  settings: string[]
}

/** How a roadmap-wide section is named to a person: "the time zone, pauses". */
export const SECTION_LABEL: Record<string, string> = {
  timeZone: 'time zone',
  startDate: 'start date',
  weeklyHours: 'weekly capacity',
  phases: 'phases',
  blackouts: 'pauses',
  dimensions: 'radar axes',
  skills: 'skill map',
}

/** What an import would do, worked out without writing anything. */
export type ImportPreview = {
  /** The revision the preview was made against; applying from it is safe. */
  revision: number
  changes: ImportChanges
  /** Errors the import would bring in. Any at all and applying it is refused. */
  introduced: Issue[]
  /** Everything the imported roadmap breaks, warnings included. */
  issues: Issue[]
}

/**
 * What turning `before` into `after` would do, worked out without writing it:
 * the preview an import, a restore, a generator, a draft being published and an
 * agent's dry run all show before anything is applied.
 */
export function previewOf(before: AppState, after: RoadmapContent): ImportPreview {
  const issues = validate(after)
  return {
    revision: before.revision,
    changes: importChanges(before, after),
    introduced: introducedErrors(before, after, issues),
    issues,
  }
}

/**
 * Compares two roadmaps as the file shows them. Projections are left out: they
 * follow from the plan, and listing every date an import nudges would bury the
 * changes that were made on purpose.
 */
export function importChanges(before: RoadmapContent, after: RoadmapContent): ImportChanges {
  const was = toSeedFile(before)
  const now = toSeedFile(after)

  const tasks = compare(was.tasks, now.tasks)
  const stories = compare(was.stories, now.stories)
  const features = compare(was.features, now.features)
  const progress = new Map(before.tasks.map((task) => [task.id, task]))

  const { tasks: _tasks, stories: _stories, features: _features, ...wasSettings } = was
  const {
    tasks: _nowTasks,
    stories: _nowStories,
    features: _nowFeatures,
    ...nowSettings
  } = now
  const sections = new Set([...Object.keys(wasSettings), ...Object.keys(nowSettings)])

  return {
    tasks: {
      added: tasks.added,
      removed: tasks.removed.map((id) => removed(progress.get(id)!)),
      changed: tasks.changed,
    },
    stories: {
      added: stories.added,
      removed: stories.removed,
      changed: stories.changed.map((change) => change.id),
    },
    features: {
      added: features.added,
      removed: features.removed,
      changed: features.changed.map((change) => change.id),
    },
    settings: [...sections].filter(
      (section) =>
        JSON.stringify(wasSettings[section as keyof typeof wasSettings]) !==
        JSON.stringify(nowSettings[section as keyof typeof nowSettings]),
    ),
  }
}

function removed(task: Task): RemovedTask {
  return { id: task.id, name: task.name, state: task.state, hoursDone: task.hoursDone }
}

function compare<T extends { id: string }>(before: T[], after: T[]) {
  const previous = new Map(before.map((entry) => [entry.id, entry]))
  const kept = new Set(after.map((entry) => entry.id))
  const changed: Array<{ id: string; fields: string[] }> = []
  for (const entry of after) {
    const old = previous.get(entry.id)
    if (!old) continue
    const fields = Object.keys(entry).filter(
      (field) =>
        JSON.stringify(old[field as keyof T]) !== JSON.stringify(entry[field as keyof T]),
    )
    if (fields.length > 0) changed.push({ id: entry.id, fields })
  }
  return {
    added: after.filter((entry) => !previous.has(entry.id)).map((entry) => entry.id),
    removed: before.filter((entry) => !kept.has(entry.id)).map((entry) => entry.id),
    changed,
  }
}
