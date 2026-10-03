import { WORK_TYPES, PHASE_NUMBERS, STATES } from '../core/constants'
import type {
  Blackout,
  Dimension,
  Feature,
  Task,
  WorkType,
  Phase,
  PhaseNumber,
  Resource,
  State,
  Story,
} from '../core/types'

// Mapping between D1 rows and the domain. Pure on purpose: this is where a
// column rename or a bad cast would otherwise slip through untested.

export type TaskRow = {
  id: string
  name: string
  story_id: string
  skills: string
  depends_on: string
  baseline_start: string
  baseline_end: string
  projected_start: string
  projected_end: string
  link: string | null
  resources: string
  duration: string
  notes: string
  done_when: string
  state: string
  completed_at: string | null
  hours_done: number
  sort_order: number
}

export type StoryRow = {
  id: string
  name: string
  type: string | null
  phase: number
  feature_id: string | null
  link: string | null
  resources: string
  price: string
  notes: string
  done_when: string
}

export type FeatureRow = {
  id: string
  name: string
  type: string | null
  link: string | null
  notes: string
}

export type PhaseRow = { number: number; name: string; closing_milestone_id: string | null }
export type BlackoutRow = { from_date: string; to_date: string; reason: string }
export type DimensionRow = { name: string }
export type SkillRow = { name: string; dimension: string }
export type MetaRow = { key: string; value: string }

/**
 * A task row as the domain sees it. The phase is not a column — it is the
 * story's — so the caller passes it in.
 */
export function toTask(row: TaskRow, phase: PhaseNumber): Task {
  if (!STATES.includes(row.state as State)) {
    throw new Error(`${row.id} has an unknown state in the database: ${row.state}`)
  }

  return {
    id: row.id,
    name: row.name,
    phase,
    storyId: row.story_id,
    skills: parseStringArray(row.skills, `${row.id}.skills`),
    dependsOn: parseStringArray(row.depends_on, `${row.id}.depends_on`),
    baselineStartDate: row.baseline_start,
    baselineEndDate: row.baseline_end,
    projectedStartDate: row.projected_start,
    projectedEndDate: row.projected_end,
    link: row.link === null || row.link === '' ? null : row.link,
    resources: parseResources(row.resources, `${row.id}.resources`),
    duration: row.duration,
    notes: row.notes,
    doneWhen: row.done_when ?? '',
    state: row.state as State,
    completedAt: row.completed_at,
    hoursDone: row.hours_done ?? 0,
    sortOrder: row.sort_order,
  }
}

export function toStory(row: StoryRow): Story {
  const type = typeOf(row.type, `Story ${row.id}`)
  if (!PHASE_NUMBERS.includes(row.phase as PhaseNumber)) {
    throw new Error(`Story ${row.id} has an out-of-range phase in the database: ${row.phase}`)
  }
  return {
    id: row.id,
    name: row.name,
    type,
    phase: row.phase as PhaseNumber,
    featureId: row.feature_id === '' ? null : row.feature_id,
    link: row.link === null || row.link === '' ? null : row.link,
    resources: parseResources(row.resources, `${row.id}.resources`),
    price: row.price,
    notes: row.notes,
    doneWhen: row.done_when ?? '',
  }
}

export function toFeature(row: FeatureRow): Feature {
  return {
    id: row.id,
    name: row.name,
    type: typeOf(row.type, `Feature ${row.id}`),
    link: row.link === null || row.link === '' ? null : row.link,
    notes: row.notes,
  }
}

export function toPhase(row: PhaseRow): Phase {
  if (!PHASE_NUMBERS.includes(row.number as PhaseNumber)) {
    throw new Error(`Phase ${row.number} is out of range`)
  }
  return {
    number: row.number as PhaseNumber,
    name: row.name,
    closingMilestoneId: row.closing_milestone_id,
  }
}

export function toBlackout(row: BlackoutRow): Blackout {
  return { from: row.from_date, to: row.to_date, reason: row.reason }
}

export function toSkillDimension(rows: readonly SkillRow[]): Record<string, Dimension> {
  const map: Record<string, Dimension> = {}
  for (const row of rows) map[row.name] = row.dimension
  return map
}

export function toMeta(rows: readonly MetaRow[]): Record<string, string> {
  const map: Record<string, string> = {}
  for (const row of rows) map[row.key] = row.value
  return map
}

/** The inverse of `toTask`: a task as the columns it is stored in. */
export function fromTask(task: Task): TaskRow {
  return {
    id: task.id,
    name: task.name,
    story_id: task.storyId,
    skills: JSON.stringify(task.skills),
    depends_on: JSON.stringify(task.dependsOn),
    baseline_start: task.baselineStartDate,
    baseline_end: task.baselineEndDate,
    projected_start: task.projectedStartDate,
    projected_end: task.projectedEndDate,
    link: task.link,
    resources: JSON.stringify(task.resources),
    duration: task.duration,
    notes: task.notes,
    done_when: task.doneWhen,
    state: task.state,
    completed_at: task.completedAt,
    hours_done: task.hoursDone,
    sort_order: task.sortOrder,
  }
}

/** The inverse of `toStory`. */
export function fromStory(story: Story): StoryRow {
  return {
    id: story.id,
    name: story.name,
    type: story.type,
    phase: story.phase,
    feature_id: story.featureId,
    link: story.link,
    resources: JSON.stringify(story.resources),
    price: story.price,
    notes: story.notes,
    done_when: story.doneWhen,
  }
}

/** The inverse of `toFeature`. */
export function fromFeature(feature: Feature): FeatureRow {
  return {
    id: feature.id,
    name: feature.name,
    type: feature.type,
    link: feature.link,
    notes: feature.notes,
  }
}

/** A stored type: one of the list, or none. */
function typeOf(value: string | null, what: string): WorkType | null {
  if (value === null || value === '') return null
  if (!WORK_TYPES.includes(value as WorkType)) {
    throw new Error(`${what} has an unknown type in the database: ${value}`)
  }
  return value as WorkType
}

function parseResources(raw: string, at: string): Resource[] {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw === '' ? '[]' : raw)
  } catch {
    throw new Error(`${at} is not valid JSON: ${raw}`)
  }
  if (!Array.isArray(parsed)) throw new Error(`${at} must be a JSON array`)
  return parsed.map((entry) => {
    const resource = entry as { label?: unknown; url?: unknown }
    if (typeof resource.label !== 'string' || typeof resource.url !== 'string') {
      throw new Error(`${at} entries must each have a string label and url`)
    }
    return { label: resource.label, url: resource.url }
  })
}

function parseStringArray(raw: string, at: string): string[] {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    throw new Error(`${at} is not valid JSON: ${raw}`)
  }
  if (!Array.isArray(parsed) || parsed.some((entry) => typeof entry !== 'string')) {
    throw new Error(`${at} must be a JSON array of strings`)
  }
  return parsed as string[]
}
