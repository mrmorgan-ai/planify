import type { RoadmapContent } from './types'

// What every kind of edit shares: how it fails, and how a new id is picked.

/** An edit that cannot be applied as asked. Nothing is written. */
export class EditError extends Error {}

/** Every id in use. Tasks, stories and features share one namespace. */
export function takenIds({ tasks, stories, features }: IdSpace): Set<string> {
  return new Set([...tasks, ...stories, ...features].map((each) => each.id))
}

/** What ids are picked against. */
export type IdSpace = Pick<RoadmapContent, 'tasks' | 'stories' | 'features'>

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
  return slug === '' ? 'task' : slug
}

/**
 * The id a new task, story or feature with this name gets: its name in
 * kebab-case, numbered when anything already has it. The client asks for it
 * explicitly, so it knows which row to open once it exists.
 */
export function newId(name: string, content: IdSpace): string {
  return unusedId(name, takenIds(content))
}

/** `newId` against a set of ids in use, for a change that picks several at once. */
export function unusedId(name: string, taken: ReadonlySet<string>): string {
  const base = slugOf(name)
  if (!taken.has(base)) return base
  for (let n = 2; ; n++) {
    const candidate = `${base}-${n}`
    if (!taken.has(candidate)) return candidate
  }
}
