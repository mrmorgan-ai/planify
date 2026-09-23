import { ITEM_TYPES, PHASE_NUMBERS, STATES } from '../core/constants'
import type {
  Blackout,
  Dimension,
  Item,
  ItemType,
  Phase,
  PhaseNumber,
  Resource,
  State,
  WorkItem,
} from '../core/types'

// Mapping between D1 rows and the domain. Pure on purpose: this is where a
// column rename or a bad cast would otherwise slip through untested.

export type ItemRow = {
  id: string
  name: string
  type: string
  phase: number
  work_item_id: string | null
  skills: string
  depends_on: string
  baseline_start: string
  baseline_end: string
  projected_start: string
  projected_end: string
  price: string
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

export type WorkItemRow = {
  id: string
  name: string
  type: string
  link: string | null
  resources: string
  notes: string
}

export type PhaseRow = { number: number; name: string; closing_milestone_id: string | null }
export type BlackoutRow = { from_date: string; to_date: string; reason: string }
export type DimensionRow = { name: string }
export type SkillRow = { name: string; dimension: string }
export type MetaRow = { key: string; value: string }

export function toItem(row: ItemRow): Item {
  if (!ITEM_TYPES.includes(row.type as ItemType)) {
    throw new Error(`${row.id} has an unknown type in the database: ${row.type}`)
  }
  if (!STATES.includes(row.state as State)) {
    throw new Error(`${row.id} has an unknown state in the database: ${row.state}`)
  }
  if (!PHASE_NUMBERS.includes(row.phase as PhaseNumber)) {
    throw new Error(`${row.id} has an out-of-range phase in the database: ${row.phase}`)
  }

  return {
    id: row.id,
    name: row.name,
    type: row.type as ItemType,
    phase: row.phase as PhaseNumber,
    workItemId: row.work_item_id === '' ? null : row.work_item_id,
    skills: parseStringArray(row.skills, `${row.id}.skills`),
    dependsOn: parseStringArray(row.depends_on, `${row.id}.depends_on`),
    baselineStartDate: row.baseline_start,
    baselineEndDate: row.baseline_end,
    projectedStartDate: row.projected_start,
    projectedEndDate: row.projected_end,
    price: row.price,
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

export function toWorkItem(row: WorkItemRow): WorkItem {
  if (!ITEM_TYPES.includes(row.type as ItemType)) {
    throw new Error(`Work item ${row.id} has an unknown type in the database: ${row.type}`)
  }
  return {
    id: row.id,
    name: row.name,
    type: row.type as ItemType,
    link: row.link === null || row.link === '' ? null : row.link,
    resources: parseResources(row.resources, `${row.id}.resources`),
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

/** The inverse of `toItem`: an item as the columns it is stored in. */
export function fromItem(item: Item): ItemRow {
  return {
    id: item.id,
    name: item.name,
    type: item.type,
    phase: item.phase,
    work_item_id: item.workItemId,
    skills: JSON.stringify(item.skills),
    depends_on: JSON.stringify(item.dependsOn),
    baseline_start: item.baselineStartDate,
    baseline_end: item.baselineEndDate,
    projected_start: item.projectedStartDate,
    projected_end: item.projectedEndDate,
    price: item.price,
    link: item.link,
    resources: JSON.stringify(item.resources),
    duration: item.duration,
    notes: item.notes,
    done_when: item.doneWhen,
    state: item.state,
    completed_at: item.completedAt,
    hours_done: item.hoursDone,
    sort_order: item.sortOrder,
  }
}

/** The inverse of `toWorkItem`. */
export function fromWorkItem(workItem: WorkItem): WorkItemRow {
  return {
    id: workItem.id,
    name: workItem.name,
    type: workItem.type,
    link: workItem.link,
    resources: JSON.stringify(workItem.resources),
    notes: workItem.notes,
  }
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
