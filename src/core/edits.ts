import { projectWherePossible } from './schedule'
import { parseSeedItem, type SeedItem } from './seed'
import type { Item, RoadmapContent } from './types'

/**
 * The fields of an item that can be edited in place. The id never changes —
 * progress is keyed to it — and the dates, the phase and the order each have
 * their own path, because moving any of them moves other items too.
 */
export const EDITABLE_FIELDS = [
  'name',
  'type',
  'workItemId',
  'skills',
  'price',
  'link',
  'resources',
  'duration',
  'notes',
  'doneWhen',
] as const

export type EditableField = (typeof EDITABLE_FIELDS)[number]
export type ItemFields = Partial<Pick<SeedItem, EditableField>>

/** A new item: what it is and when. The id and the order are the server's to pick. */
export type NewItem = ItemFields &
  Pick<SeedItem, 'name' | 'type' | 'phase' | 'baselineStartDate' | 'baselineEndDate' | 'skills'> & {
    /** Asked for, rather than derived from the name. Refused if it is taken. */
    id?: string
    dependsOn?: string[]
  }

/**
 * One change to the roadmap's content. Edits travel as a list and land as one
 * batch, so a change that takes several steps — create an item, then make
 * another wait on it — is all or nothing.
 */
export type Edit =
  | { op: 'updateItem'; id: string; fields: ItemFields }
  | { op: 'setDependencies'; id: string; dependsOn: string[] }
  | { op: 'createItem'; item: NewItem }
  | {
      op: 'deleteItem'
      id: string
      /** Connect whatever depended on it to what it depended on, instead of refusing. */
      rewire?: boolean
      /** Delete it even though it has progress, which goes with it. */
      discardProgress?: boolean
    }

/** An edit that cannot be applied as asked. Nothing is written. */
export class EditError extends Error {}

/** Checks the shape of a list of edits. The fields themselves are checked when applied. */
export function parseEdits(raw: unknown): Edit[] {
  if (!Array.isArray(raw) || raw.length === 0) {
    throw new EditError('edits must be a non-empty array')
  }
  return raw.map((entry, index) => {
    const at = `edits[${index}]`
    if (typeof entry !== 'object' || entry === null) throw new EditError(`${at} must be an object`)
    const edit = entry as Record<string, unknown>
    switch (edit.op) {
      case 'updateItem': {
        const fields = edit.fields
        if (typeof fields !== 'object' || fields === null || Array.isArray(fields)) {
          throw new EditError(`${at}.fields must be an object`)
        }
        for (const field of Object.keys(fields)) {
          if (!(EDITABLE_FIELDS as readonly string[]).includes(field)) {
            throw new EditError(`${at}.fields.${field} cannot be edited this way`)
          }
        }
        return { op: 'updateItem', id: idOf(edit, at), fields: fields as ItemFields }
      }
      case 'setDependencies':
        return { op: 'setDependencies', id: idOf(edit, at), dependsOn: strings(edit.dependsOn, `${at}.dependsOn`) }
      case 'createItem': {
        const item = edit.item
        if (typeof item !== 'object' || item === null || Array.isArray(item)) {
          throw new EditError(`${at}.item must be an object`)
        }
        return { op: 'createItem', item: item as NewItem }
      }
      case 'deleteItem':
        return {
          op: 'deleteItem',
          id: idOf(edit, at),
          rewire: edit.rewire === true,
          discardProgress: edit.discardProgress === true,
        }
      default:
        throw new EditError(`${at}.op must be updateItem, setDependencies, createItem or deleteItem`)
    }
  })
}

/**
 * Applies edits in order to a copy of the roadmap and recomputes every
 * projection once at the end. Each edited item is parsed again with the seed
 * file's own rules, so an item edited in the app obeys exactly what a file
 * would. Whether the result is a sound plan is the validator's question,
 * answered by the write that stores it.
 */
export function applyEdits(content: RoadmapContent, edits: readonly Edit[]): RoadmapContent {
  let items = [...content.items]

  edits.forEach((edit, index) => {
    const at = `edits[${index}]`
    switch (edit.op) {
      case 'updateItem': {
        const target = find(items, edit.id)
        const parsed = parse({ ...seedItemOf(target), ...edit.fields }, at)
        items = items.map((item) => (item.id === target.id ? { ...item, ...pick(parsed) } : item))
        break
      }
      case 'setDependencies': {
        const target = find(items, edit.id)
        items = items.map((item) =>
          item.id === target.id ? { ...item, dependsOn: [...edit.dependsOn] } : item,
        )
        break
      }
      case 'createItem': {
        items = [...items, created(content, items, edit.item, at)]
        break
      }
      case 'deleteItem': {
        items = deleted(content, items, edit)
        break
      }
    }
  })

  const options = { blackouts: content.roadmap.blackouts, timeZone: content.roadmap.timeZone }
  return { ...content, items: projectWherePossible(items, options) }
}

/** Who waits on an item: what a delete has to deal with. */
export function dependentsOf(items: readonly Item[], id: string): Item[] {
  return items.filter((item) => item.dependsOn.includes(id))
}

/** Whether an item has anything to lose: a state past pending, or hours logged. */
export function hasProgress(item: Item): boolean {
  return item.state !== 'pending' || item.hoursDone > 0
}

function created(content: RoadmapContent, items: Item[], item: NewItem, at: string): Item {
  const taken = new Set([...items.map((each) => each.id), ...content.workItems.map((each) => each.id)])
  if (item.id !== undefined && taken.has(item.id)) {
    throw new EditError(`${at}: the id ${item.id} is already taken`)
  }
  const id = item.id ?? uniqueId(slugOf(String(item.name ?? '')), taken)
  const last = items
    .filter((each) => each.phase === item.phase)
    .reduce((max, each) => Math.max(max, each.sortOrder), 0)

  const seed = parse(
    {
      workItemId: null,
      dependsOn: [],
      price: '',
      link: null,
      resources: [],
      duration: '',
      notes: '',
      doneWhen: '',
      ...item,
      id,
      sortOrder: last + 1,
    },
    at,
  )
  return {
    ...seed,
    projectedStartDate: seed.baselineStartDate,
    projectedEndDate: seed.baselineEndDate,
    state: 'pending',
    completedAt: null,
    hoursDone: 0,
  }
}

function deleted(
  content: RoadmapContent,
  items: Item[],
  edit: Extract<Edit, { op: 'deleteItem' }>,
): Item[] {
  const target = find(items, edit.id)

  const closes = content.roadmap.phases.find((phase) => phase.closingMilestoneId === target.id)
  if (closes) {
    throw new EditError(
      `${target.name} closes phase ${closes.number}; choose another closing milestone first`,
    )
  }
  if (hasProgress(target) && !edit.discardProgress) {
    throw new EditError(`${target.name} has progress, which would be lost with it`)
  }

  const dependents = dependentsOf(items, target.id)
  if (dependents.length > 0 && !edit.rewire) {
    throw new EditError(
      `${target.name} is needed by ${dependents.map((item) => item.name).join(', ')}`,
    )
  }

  return items
    .filter((item) => item.id !== target.id)
    .map((item) =>
      item.dependsOn.includes(target.id)
        ? {
            ...item,
            // What it waited on through the deleted item, it now waits on directly.
            dependsOn: [
              ...new Set(
                item.dependsOn.flatMap((id) => (id === target.id ? target.dependsOn : [id])),
              ),
            ].filter((id) => id !== item.id),
          }
        : item,
    )
}

function parse(value: object, at: string): SeedItem {
  try {
    return parseSeedItem(value, at)
  } catch (error) {
    throw new EditError(error instanceof Error ? error.message : String(error))
  }
}

function seedItemOf(item: Item): SeedItem {
  const {
    state: _state,
    completedAt: _completedAt,
    hoursDone: _hoursDone,
    projectedStartDate: _start,
    projectedEndDate: _end,
    ...seed
  } = item
  return seed
}

function pick(seed: SeedItem): ItemFields {
  return Object.fromEntries(EDITABLE_FIELDS.map((field) => [field, seed[field]])) as ItemFields
}

function find(items: readonly Item[], id: string): Item {
  const found = items.find((item) => item.id === id)
  if (!found) throw new EditError(`No item with id ${id}`)
  return found
}

function idOf(edit: Record<string, unknown>, at: string): string {
  if (typeof edit.id !== 'string' || edit.id === '') throw new EditError(`${at}.id must be a string`)
  return edit.id
}

function strings(value: unknown, at: string): string[] {
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== 'string')) {
    throw new EditError(`${at} must be an array of strings`)
  }
  return value as string[]
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

function uniqueId(base: string, taken: ReadonlySet<string>): string {
  if (!taken.has(base)) return base
  for (let n = 2; ; n++) {
    const candidate = `${base}-${n}`
    if (!taken.has(candidate)) return candidate
  }
}
