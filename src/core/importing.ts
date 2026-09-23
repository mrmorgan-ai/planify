import { projectWherePossible } from './schedule'
import { seedContent, toSeedFile, type SeedFile } from './seed'
import type { Item, RoadmapContent, State } from './types'
import type { Issue } from './validate'

/**
 * The roadmap a seed file turns the current one into. The file defines the
 * content, planned dates included: it names the revision it was exported from,
 * so it is the newest plan there is. Progress is the database's alone — an item
 * the file keeps keeps its state and hours, a new one starts pending, and one
 * the file no longer has goes, progress and all. Projections are then computed
 * again from the new plan.
 */
export function importedContent(current: RoadmapContent, seed: SeedFile): RoadmapContent {
  const next = seedContent(seed)
  const progress = new Map(current.items.map((item) => [item.id, item]))
  const items = next.items.map((item) => {
    const kept = progress.get(item.id)
    return kept
      ? { ...item, state: kept.state, completedAt: kept.completedAt, hoursDone: kept.hoursDone }
      : item
  })
  // A file the engine cannot place still previews: its items keep projections
  // equal to their plan, and the validator names what is wrong.
  const options = { blackouts: next.roadmap.blackouts, timeZone: next.roadmap.timeZone }
  return { ...next, items: projectWherePossible(items, options) }
}

/** An item an import removes, with what it had to show for itself. */
export type RemovedItem = {
  id: string
  name: string
  state: State
  hoursDone: number
}

/** What an import changes, for a person to read before it is applied. */
export type ImportChanges = {
  items: {
    added: string[]
    /** Progress on these goes with them. */
    removed: RemovedItem[]
    /** Each changed item with the fields of the file that differ. */
    changed: Array<{ id: string; fields: string[] }>
  }
  workItems: { added: string[]; removed: string[]; changed: string[] }
  /** The roadmap-wide sections that differ: phases, pauses, capacity, axes… */
  settings: string[]
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
 * Compares two roadmaps as the file shows them. Projections are left out: they
 * follow from the plan, and listing every date an import nudges would bury the
 * changes that were made on purpose.
 */
export function importChanges(before: RoadmapContent, after: RoadmapContent): ImportChanges {
  const was = toSeedFile(before)
  const now = toSeedFile(after)

  const items = compare(was.items, now.items)
  const workItems = compare(was.workItems, now.workItems)
  const progress = new Map(before.items.map((item) => [item.id, item]))

  const { items: _items, workItems: _workItems, ...wasSettings } = was
  const { items: _nowItems, workItems: _nowWorkItems, ...nowSettings } = now
  const sections = new Set([...Object.keys(wasSettings), ...Object.keys(nowSettings)])

  return {
    items: {
      added: items.added,
      removed: items.removed.map((id) => removed(progress.get(id)!)),
      changed: items.changed,
    },
    workItems: {
      added: workItems.added,
      removed: workItems.removed,
      changed: workItems.changed.map((change) => change.id),
    },
    settings: [...sections].filter(
      (section) =>
        JSON.stringify(wasSettings[section as keyof typeof wasSettings]) !==
        JSON.stringify(nowSettings[section as keyof typeof nowSettings]),
    ),
  }
}

function removed(item: Item): RemovedItem {
  return { id: item.id, name: item.name, state: item.state, hoursDone: item.hoursDone }
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
