import { PHASE_NUMBERS } from './constants'
import { addStudyDays, isCivilDate, shiftStudyDays, studyDaysBetween } from './dates'
import { EditError, newItemId, takenIds } from './editing'
import { parseBlackout, parseWorkItem } from './seed'
import type { Blackout, CivilDate, Item, PhaseNumber, RoadmapContent, WorkItem } from './types'

// Edits to what the items hang off: work items, phases, pauses, the plan's
// settings and the skill map. Each returns the whole roadmap it produces; the
// caller recomputes projections and the validator judges the result.

export const WORK_ITEM_FIELDS = ['name', 'type', 'link', 'resources', 'notes'] as const
export type WorkItemFields = Partial<Pick<WorkItem, (typeof WORK_ITEM_FIELDS)[number]>>
export type NewWorkItem = WorkItemFields & Pick<WorkItem, 'name' | 'type'> & { id?: string }

export type SettingsFields = {
  timeZone?: string
  /** Empty for none. */
  startDate?: CivilDate | ''
  /** Study hours per week; zero for undeclared. */
  weeklyHours?: number
}

export type StructureEdit =
  | { op: 'createWorkItem'; workItem: NewWorkItem }
  | { op: 'updateWorkItem'; id: string; fields: WorkItemFields }
  /** Its parts stay, on their own. */
  | { op: 'deleteWorkItem'; id: string }
  | { op: 'addPhase'; name: string }
  | { op: 'updatePhase'; number: number; fields: { name?: string; closingMilestoneId?: string | null } }
  /** Only the last phase, and only once it is empty. */
  | { op: 'removePhase'; number: number }
  | {
      op: 'setBlackouts'
      blackouts: Blackout[]
      /**
       * Keep every unfinished item on the same study day of the plan, so a new
       * pause pushes what comes after it and a removed one pulls it back.
       */
      keepStudyDays?: boolean
    }
  | { op: 'updateSettings'; fields: SettingsFields }
  | {
      op: 'setSkillMap'
      dimensions: string[]
      skills: Record<string, string>
      /** Skills given a new name: every item using the old one follows. */
      renamed?: Record<string, string>
    }

const OPS = [
  'createWorkItem',
  'updateWorkItem',
  'deleteWorkItem',
  'addPhase',
  'updatePhase',
  'removePhase',
  'setBlackouts',
  'updateSettings',
  'setSkillMap',
] as const

export function isStructureOp(op: unknown): op is StructureEdit['op'] {
  return (OPS as readonly unknown[]).includes(op)
}

/** Checks the shape of one structure edit. Its values are checked when applied. */
export function parseStructureEdit(edit: Record<string, unknown>, at: string): StructureEdit {
  switch (edit.op) {
    case 'createWorkItem':
      return { op: 'createWorkItem', workItem: object(edit.workItem, `${at}.workItem`) as NewWorkItem }
    case 'updateWorkItem': {
      const fields = object(edit.fields, `${at}.fields`)
      for (const field of Object.keys(fields)) {
        if (!(WORK_ITEM_FIELDS as readonly string[]).includes(field)) {
          throw new EditError(`${at}.fields.${field} cannot be edited this way`)
        }
      }
      return { op: 'updateWorkItem', id: text(edit.id, `${at}.id`), fields: fields as WorkItemFields }
    }
    case 'deleteWorkItem':
      return { op: 'deleteWorkItem', id: text(edit.id, `${at}.id`) }
    case 'addPhase':
      return { op: 'addPhase', name: text(edit.name, `${at}.name`) }
    case 'updatePhase': {
      const fields = object(edit.fields, `${at}.fields`)
      const next: { name?: string; closingMilestoneId?: string | null } = {}
      if ('name' in fields) next.name = text(fields.name, `${at}.fields.name`)
      if ('closingMilestoneId' in fields) {
        const milestone = fields.closingMilestoneId
        if (milestone !== null && typeof milestone !== 'string') {
          throw new EditError(`${at}.fields.closingMilestoneId must be an item id or null`)
        }
        next.closingMilestoneId = milestone
      }
      return { op: 'updatePhase', number: phaseNumber(edit.number, `${at}.number`), fields: next }
    }
    case 'removePhase':
      return { op: 'removePhase', number: phaseNumber(edit.number, `${at}.number`) }
    case 'setBlackouts': {
      if (!Array.isArray(edit.blackouts)) throw new EditError(`${at}.blackouts must be an array`)
      const blackouts = edit.blackouts
        .map((entry, index) => wrap(() => parseBlackout(entry, `${at}.blackouts[${index}]`)))
        .sort((a, b) => a.from.localeCompare(b.from))
      blackouts.forEach((blackout, index) => {
        const previous = blackouts[index - 1]
        if (previous && blackout.from <= previous.to) {
          throw new EditError(`The pauses from ${previous.from} and ${blackout.from} overlap`)
        }
      })
      return { op: 'setBlackouts', blackouts, keepStudyDays: edit.keepStudyDays === true }
    }
    case 'updateSettings': {
      const fields = object(edit.fields, `${at}.fields`)
      const next: SettingsFields = {}
      for (const field of Object.keys(fields)) {
        const value = fields[field]
        if (field === 'timeZone') next.timeZone = text(value, `${at}.fields.timeZone`)
        else if (field === 'startDate') {
          if (value !== '' && (typeof value !== 'string' || !isCivilDate(value))) {
            throw new EditError(`${at}.fields.startDate must be YYYY-MM-DD or empty`)
          }
          next.startDate = value
        } else if (field === 'weeklyHours') {
          if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
            throw new EditError(`${at}.fields.weeklyHours must be zero or more`)
          }
          next.weeklyHours = value
        } else throw new EditError(`${at}.fields.${field} cannot be edited this way`)
      }
      return { op: 'updateSettings', fields: next }
    }
    case 'setSkillMap': {
      if (!Array.isArray(edit.dimensions) || edit.dimensions.length === 0) {
        throw new EditError(`${at}.dimensions must be a non-empty array`)
      }
      const dimensions = edit.dimensions.map((name, index) => text(name, `${at}.dimensions[${index}]`))
      if (new Set(dimensions).size !== dimensions.length) {
        throw new EditError(`${at}.dimensions names the same axis twice`)
      }
      const skills = record(edit.skills, `${at}.skills`)
      for (const [skill, dimension] of Object.entries(skills)) {
        if (!dimensions.includes(dimension)) {
          throw new EditError(`${skill} is on ${dimension}, which is not an axis`)
        }
      }
      const renamed = edit.renamed === undefined ? {} : record(edit.renamed, `${at}.renamed`)
      return { op: 'setSkillMap', dimensions, skills, renamed }
    }
    default:
      throw new EditError(`${at}.op is not a structure edit`)
  }
}

export function applyStructureEdit(
  content: RoadmapContent,
  edit: StructureEdit,
  at: string,
): RoadmapContent {
  const { roadmap } = content
  switch (edit.op) {
    case 'createWorkItem': {
      const { workItem } = edit
      if (workItem.id !== undefined && takenIds(content).has(workItem.id)) {
        throw new EditError(`${at}: the id ${workItem.id} is already taken`)
      }
      const id = workItem.id ?? newItemId(String(workItem.name ?? ''), content)
      const created = wrap(() =>
        parseWorkItem({ link: null, resources: [], notes: '', ...workItem, id }, at),
      )
      return { ...content, workItems: [...content.workItems, created] }
    }
    case 'updateWorkItem': {
      const target = findWorkItem(content, edit.id)
      const updated = wrap(() => parseWorkItem({ ...target, ...edit.fields, id: target.id }, at))
      return {
        ...content,
        workItems: content.workItems.map((each) => (each.id === target.id ? updated : each)),
      }
    }
    case 'deleteWorkItem': {
      const target = findWorkItem(content, edit.id)
      return {
        ...content,
        workItems: content.workItems.filter((each) => each.id !== target.id),
        items: content.items.map((item) =>
          item.workItemId === target.id ? { ...item, workItemId: null } : item,
        ),
      }
    }
    case 'addPhase': {
      const last = Math.max(0, ...roadmap.phases.map((phase) => phase.number))
      const number = last + 1
      if (!PHASE_NUMBERS.includes(number as PhaseNumber)) {
        throw new EditError(`A roadmap has at most ${PHASE_NUMBERS.length} phases`)
      }
      const phase = { number: number as PhaseNumber, name: edit.name, closingMilestoneId: null }
      return { ...content, roadmap: { ...roadmap, phases: [...roadmap.phases, phase] } }
    }
    case 'updatePhase': {
      findPhase(content, edit.number)
      return {
        ...content,
        roadmap: {
          ...roadmap,
          phases: roadmap.phases.map((phase) =>
            phase.number === edit.number ? { ...phase, ...edit.fields } : phase,
          ),
        },
      }
    }
    case 'removePhase': {
      const phase = findPhase(content, edit.number)
      const last = Math.max(...roadmap.phases.map((each) => each.number))
      if (phase.number !== last) {
        throw new EditError(`Only the last phase can be removed; phase ${last} comes after it`)
      }
      const inIt = content.items.filter((item) => item.phase === phase.number).length
      if (inIt > 0) {
        throw new EditError(`Phase ${phase.number} still has ${inIt} items; move or delete them first`)
      }
      return {
        ...content,
        roadmap: { ...roadmap, phases: roadmap.phases.filter((each) => each !== phase) },
      }
    }
    case 'setBlackouts': {
      const items = edit.keepStudyDays
        ? keepStudyDays(content, roadmap.blackouts, edit.blackouts)
        : content.items
      return { ...content, items, roadmap: { ...roadmap, blackouts: edit.blackouts } }
    }
    case 'updateSettings': {
      const { weeklyHours, ...rest } = edit.fields
      return {
        ...content,
        roadmap: {
          ...roadmap,
          ...rest,
          ...(weeklyHours === undefined ? {} : { weeklyHours: { normal: weeklyHours } }),
        },
      }
    }
    case 'setSkillMap': {
      const renames = edit.renamed ?? {}
      const renamed = (skill: string) => renames[skill] ?? skill
      return {
        ...content,
        roadmap: { ...roadmap, dimensions: edit.dimensions, skillDimension: edit.skills },
        items: content.items.map((item) =>
          item.skills.some((skill) => skill in renames)
            ? { ...item, skills: [...new Set(item.skills.map(renamed))] }
            : item,
        ),
      }
    }
  }
}

/**
 * Every unfinished item moved so it sits on the same study day of the plan
 * under the new pauses as it did under the old ones, with the same number of
 * study days. Counted from the plan's start, so what comes before a change
 * stays put. Finished items keep their dates: they happened when they happened.
 */
export function keepStudyDays(
  content: RoadmapContent,
  before: readonly Blackout[],
  after: readonly Blackout[],
): Item[] {
  const anchor =
    content.roadmap.startDate ||
    content.items.reduce<CivilDate>(
      (min, item) => (min === '' || item.baselineStartDate < min ? item.baselineStartDate : min),
      '',
    )
  return content.items.map((item) => {
    if (item.state === 'done' || anchor === '' || item.baselineStartDate < anchor) return item
    const position = studyDaysBetween(anchor, item.baselineStartDate, before)
    const length = studyDaysBetween(item.baselineStartDate, item.baselineEndDate, before)
    if (position < 1 || length < 1) return item
    const start = shiftStudyDays(anchor, position - 1, after)
    return { ...item, baselineStartDate: start, baselineEndDate: addStudyDays(start, length, after) }
  })
}

function findWorkItem(content: RoadmapContent, id: string): WorkItem {
  const found = content.workItems.find((each) => each.id === id)
  if (!found) throw new EditError(`No work item with id ${id}`)
  return found
}

function findPhase(content: RoadmapContent, number: number) {
  const found = content.roadmap.phases.find((phase) => phase.number === number)
  if (!found) throw new EditError(`No phase ${number}`)
  return found
}

/** Runs one of the seed parsers, reporting what it finds as an edit error. */
function wrap<T>(parse: () => T): T {
  try {
    return parse()
  } catch (error) {
    throw new EditError(error instanceof Error ? error.message : String(error))
  }
}

function object(value: unknown, at: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new EditError(`${at} must be an object`)
  }
  return value as Record<string, unknown>
}

function text(value: unknown, at: string): string {
  if (typeof value !== 'string' || value.trim() === '') throw new EditError(`${at} must not be empty`)
  return value
}

function phaseNumber(value: unknown, at: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value)) throw new EditError(`${at} must be a phase number`)
  return value
}

function record(value: unknown, at: string): Record<string, string> {
  const entries = Object.entries(object(value, at))
  for (const [key, entry] of entries) {
    if (key.trim() === '' || typeof entry !== 'string' || entry.trim() === '') {
      throw new EditError(`${at} must map names to names`)
    }
  }
  return Object.fromEntries(entries) as Record<string, string>
}
