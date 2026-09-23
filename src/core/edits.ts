import { projectWherePossible } from './schedule'
import { parseSeedItem, type SeedItem } from './seed'
import type { Item, RoadmapContent } from './types'
import { EditError, newItemId, takenIds } from './editing'
import {
  applyStructureEdit,
  isStructureOp,
  parseStructureEdit,
  type StructureEdit,
} from './structure'

export { EditError, newItemId, slugOf } from './editing'

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
 * another wait on it — is all or nothing. Items are edited here; what they hang
 * off — work items, phases, pauses, settings, skills — in structure.ts.
 */
export type Edit = ItemEdit | StructureEdit

export type ItemEdit =
  | { op: 'updateItem'; id: string; fields: ItemFields }
  | { op: 'setDependencies'; id: string; dependsOn: string[] }
  | { op: 'createItem'; item: NewItem }
  | {
      /**
       * Puts an item in a phase, before another item of that phase or last.
       * The same edit reorders within a phase. Both phases are renumbered, so
       * the order stays 1..n.
       */
      op: 'moveItem'
      id: string
      phase: number
      before?: string | null
    }
  | {
      op: 'deleteItem'
      id: string
      /** Connect whatever depended on it to what it depended on, instead of refusing. */
      rewire?: boolean
      /** Delete it even though it has progress, which goes with it. */
      discardProgress?: boolean
    }

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
        return {
          op: 'setDependencies',
          id: idOf(edit, at),
          dependsOn: strings(edit.dependsOn, `${at}.dependsOn`),
        }
      case 'createItem': {
        const item = edit.item
        if (typeof item !== 'object' || item === null || Array.isArray(item)) {
          throw new EditError(`${at}.item must be an object`)
        }
        return { op: 'createItem', item: item as NewItem }
      }
      case 'moveItem': {
        const phase = edit.phase
        if (typeof phase !== 'number' || !Number.isInteger(phase)) {
          throw new EditError(`${at}.phase must be a phase number`)
        }
        const before = edit.before ?? null
        if (before !== null && typeof before !== 'string') {
          throw new EditError(`${at}.before must be an item id or null`)
        }
        return { op: 'moveItem', id: idOf(edit, at), phase, before }
      }
      case 'deleteItem':
        return {
          op: 'deleteItem',
          id: idOf(edit, at),
          rewire: edit.rewire === true,
          discardProgress: edit.discardProgress === true,
        }
      default:
        if (isStructureOp(edit.op)) return parseStructureEdit(edit, at)
        throw new EditError(`${at}.op is not an edit this roadmap knows: ${String(edit.op)}`)
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
  let next = content

  edits.forEach((edit, index) => {
    const at = `edits[${index}]`
    const items = next.items
    switch (edit.op) {
      case 'updateItem': {
        const target = find(items, edit.id)
        const parsed = parse({ ...seedItemOf(target), ...edit.fields }, at)
        next = {
          ...next,
          items: items.map((item) => (item.id === target.id ? { ...item, ...pick(parsed) } : item)),
        }
        break
      }
      case 'setDependencies': {
        const target = find(items, edit.id)
        next = {
          ...next,
          items: items.map((item) =>
            item.id === target.id ? { ...item, dependsOn: [...edit.dependsOn] } : item,
          ),
        }
        break
      }
      case 'createItem':
        next = { ...next, items: [...items, created(next, edit.item, at)] }
        break
      case 'moveItem':
        next = { ...next, items: moved(next, edit) }
        break
      case 'deleteItem':
        next = { ...next, items: deleted(next, edit) }
        break
      default:
        next = applyStructureEdit(next, edit, at)
    }
  })

  const options = { blackouts: next.roadmap.blackouts, timeZone: next.roadmap.timeZone }
  return { ...next, items: projectWherePossible(next.items, options) }
}

/** Who waits on an item: what a delete has to deal with. */
export function dependentsOf(items: readonly Item[], id: string): Item[] {
  return items.filter((item) => item.dependsOn.includes(id))
}

/** Whether an item has anything to lose: a state past pending, or hours logged. */
export function hasProgress(item: Item): boolean {
  return item.state !== 'pending' || item.hoursDone > 0
}

function created(content: RoadmapContent, item: NewItem, at: string): Item {
  if (item.id !== undefined && takenIds(content).has(item.id)) {
    throw new EditError(`${at}: the id ${item.id} is already taken`)
  }
  const id = item.id ?? newItemId(String(item.name ?? ''), content)
  const last = content.items
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

function moved(content: RoadmapContent, edit: Extract<Edit, { op: 'moveItem' }>): Item[] {
  const target = find(content.items, edit.id)
  const phase = content.roadmap.phases.find((each) => each.number === edit.phase)
  if (!phase) throw new EditError(`No phase ${edit.phase}`)
  if (edit.before === target.id) return content.items

  const inOrder = (number: number) =>
    content.items
      .filter((item) => item.phase === number && item.id !== target.id)
      .sort((a, b) => a.sortOrder - b.sortOrder)
  const destination = inOrder(phase.number)
  const at =
    edit.before == null
      ? destination.length
      : destination.findIndex((item) => item.id === edit.before)
  if (at < 0) throw new EditError(`${edit.before} is not in phase ${phase.number}`)
  destination.splice(at, 0, { ...target, phase: phase.number })

  const order = new Map<string, { phase: Item['phase']; sortOrder: number }>()
  destination.forEach((item, index) =>
    order.set(item.id, { phase: phase.number, sortOrder: index + 1 }),
  )
  if (target.phase !== phase.number) {
    inOrder(target.phase).forEach((item, index) =>
      order.set(item.id, { phase: target.phase, sortOrder: index + 1 }),
    )
  }
  return content.items.map((item) => {
    const place = order.get(item.id)
    return place ? { ...item, ...place } : item
  })
}

function deleted(content: RoadmapContent, edit: Extract<Edit, { op: 'deleteItem' }>): Item[] {
  const { items } = content
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
  if (typeof edit.id !== 'string' || edit.id === '')
    throw new EditError(`${at}.id must be a string`)
  return edit.id
}

function strings(value: unknown, at: string): string[] {
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== 'string')) {
    throw new EditError(`${at} must be an array of strings`)
  }
  return value as string[]
}
