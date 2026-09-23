import type { RoadmapContent } from './types'

// What every kind of edit shares: how it fails, and how a new id is picked.

/** An edit that cannot be applied as asked. Nothing is written. */
export class EditError extends Error {}

/** Every id in use. Items and work items share one namespace. */
export function takenIds({ items, workItems }: Pick<RoadmapContent, 'items' | 'workItems'>): Set<string> {
  return new Set([...items.map((item) => item.id), ...workItems.map((workItem) => workItem.id)])
}

/** A kebab-case id from a name: "Build part 2 — the API" → "build-part-2-the-api". */
export function slugOf(name: string): string {
  const slug = name
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
    .replace(/-+$/, '')
  return slug === '' ? 'item' : slug
}

/**
 * The id a new item with this name gets: its name in kebab-case, numbered when
 * an item or a work item already has it. The client asks for it explicitly, so
 * it knows which row to open once the item exists.
 */
export function newItemId(name: string, content: Pick<RoadmapContent, 'items' | 'workItems'>): string {
  const base = slugOf(name)
  const taken = takenIds(content)
  if (!taken.has(base)) return base
  for (let n = 2; ; n++) {
    const candidate = `${base}-${n}`
    if (!taken.has(candidate)) return candidate
  }
}
