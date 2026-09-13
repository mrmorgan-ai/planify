import { estimatedHours } from './hours'
import type { Item, ItemType, PhaseNumber, Resource, State, WorkItem } from './types'

// Work items read everything off their parts. Nothing here is stored, so a unit
// can never report a state or an hours figure its own parts disagree with.

/** One entry in the work items view: a work item with its parts, or an item on its own. */
export type Unit = {
  id: string
  name: string
  type: ItemType
  link: string | null
  resources: Resource[]
  notes: string
  /** In plan order. A standalone item is the single part of its own unit. */
  parts: Item[]
  standalone: boolean
}

/** Plan order: phase first, then the curated order inside it. */
function byPlanOrder(a: Item, b: Item): number {
  return a.phase - b.phase || a.sortOrder - b.sortOrder
}

export function partsOf(workItemId: string, items: readonly Item[]): Item[] {
  return items.filter((item) => item.workItemId === workItemId).sort(byPlanOrder)
}

export type PartLabel = { workItem: WorkItem; index: number; total: number }

/** "Part 3 of 9 of X", or null for an item that stands on its own. */
export function partLabel(
  item: Item,
  workItems: readonly WorkItem[],
  items: readonly Item[],
): PartLabel | null {
  if (item.workItemId === null) return null
  const workItem = workItems.find((candidate) => candidate.id === item.workItemId)
  if (!workItem) return null
  const parts = partsOf(workItem.id, items)
  return { workItem, index: parts.findIndex((part) => part.id === item.id) + 1, total: parts.length }
}

/** Done when every part is, in progress as soon as any part has moved, pending otherwise. */
export function unitState(parts: readonly Item[]): State {
  if (parts.length > 0 && parts.every((part) => part.state === 'done')) return 'done'
  return parts.some((part) => part.state !== 'pending') ? 'in_progress' : 'pending'
}

export type UnitHours = {
  total: number
  done: number
  /** Parts with no estimate, which the two totals above leave out. */
  unestimated: number
}

export function unitHours(parts: readonly Item[]): UnitHours {
  let total = 0
  let done = 0
  let unestimated = 0
  for (const part of parts) {
    const hours = estimatedHours(part)
    if (hours === null) {
      unestimated += 1
      continue
    }
    total += hours
    if (part.state === 'done') done += hours
  }
  return { total, done, unestimated }
}

/** The phases a unit's parts sit in, ascending and without repeats. */
export function unitPhases(parts: readonly Item[]): PhaseNumber[] {
  return [...new Set(parts.map((part) => part.phase))].sort((a, b) => a - b)
}

/**
 * Every item placed in exactly one unit, in the order the plan first reaches
 * each. Standalone items become units of one so the list is the whole roadmap:
 * nothing disappears from it for not being split.
 */
export function unitsOf(items: readonly Item[], workItems: readonly WorkItem[]): Unit[] {
  const known = new Map(workItems.map((workItem) => [workItem.id, workItem]))
  const units = new Map<string, Unit>()

  for (const item of items.slice().sort(byPlanOrder)) {
    const workItem = item.workItemId === null ? undefined : known.get(item.workItemId)
    if (!workItem) {
      units.set(`item:${item.id}`, {
        id: item.id,
        name: item.name,
        type: item.type,
        link: item.link,
        resources: item.resources,
        notes: item.notes,
        parts: [item],
        standalone: true,
      })
      continue
    }
    const unit = units.get(`work:${workItem.id}`)
    if (unit) unit.parts.push(item)
    else units.set(`work:${workItem.id}`, { ...workItem, parts: [item], standalone: false })
  }

  return [...units.values()]
}

/**
 * The links to show for an item: its own when it has any, otherwise its work
 * item's. The parts of a course usually share one link, and repeating it on
 * every part is how a link ends up fixed in one place and stale in the others.
 */
export function linksOf(
  item: Item,
  workItems: readonly WorkItem[],
): { link: string | null; resources: Resource[] } {
  if (item.link !== null || item.resources.length > 0) {
    return { link: item.link, resources: item.resources }
  }
  const workItem = workItems.find((candidate) => candidate.id === item.workItemId)
  return { link: workItem?.link ?? null, resources: workItem?.resources ?? [] }
}
