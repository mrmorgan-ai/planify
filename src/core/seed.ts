import { ITEM_TYPES, PHASE_NUMBERS } from './constants'
import { isCivilDate } from './dates'
import type {
  Blackout,
  CivilDate,
  Dimension,
  IsoDateTime,
  Item,
  ItemType,
  Phase,
  PhaseNumber,
  Resource,
  RoadmapContent,
  WeeklyHours,
  WorkItem,
} from './types'

/**
 * The seed carries content only. `state`, `completedAt`, `hoursDone` and the
 * projected dates are runtime state, so the file you hand-edit cannot overwrite
 * your progress.
 */
export type SeedItem = Omit<
  Item,
  'state' | 'completedAt' | 'hoursDone' | 'projectedStartDate' | 'projectedEndDate'
>

/**
 * Everything a roadmap is made of. Lives outside this repository: the app is
 * open, the roadmap is not.
 */
export type SeedFile = {
  timeZone: string
  /** The anchor the plan starts on. Optional in the file; derived when absent. */
  startDate?: CivilDate
  /** Study hours per week. Optional; without it the board shows no capacity. */
  weeklyHours?: WeeklyHours
  phases: Phase[]
  blackouts: Blackout[]
  dimensions: Dimension[]
  skills: Record<string, Dimension>
  /** The units items are split from. Optional; an item names its own with `workItemId`. */
  workItems: WorkItem[]
  items: SeedItem[]
}

/**
 * Checks a parsed seed's shape and types, field by field, and throws naming the
 * first field that is wrong. Whether the content makes a sound plan is a
 * separate question, answered by `validate`.
 */
export function parseSeed(raw: unknown): SeedFile {
  if (typeof raw !== 'object' || raw === null) throw new Error('The seed is not an object')
  const file = raw as Record<string, unknown>

  const dimensions = requireStringArray(file.dimensions, 'dimensions')
  const skills = requireStringRecord(file.skills, 'skills')
  for (const [skill, dimension] of Object.entries(skills)) {
    if (!dimensions.includes(dimension)) {
      throw new Error(`skills["${skill}"] points at unknown dimension "${dimension}"`)
    }
  }

  // A roadmap may hold no items and no pauses yet: a new one starts that way, and
  // its drafts and its history go through this same parser.
  const items = requireArray(file.items, 'items', true).map((entry, index) =>
    parseSeedItem(entry, `items[${index}]`),
  )

  return {
    timeZone: requireString(file.timeZone, 'timeZone'),
    startDate:
      file.startDate === undefined ? undefined : requireCivilDate(file.startDate, 'startDate'),
    weeklyHours: parseWeeklyHours(file.weeklyHours),
    phases: requireArray(file.phases, 'phases').map((entry, index) => parsePhase(entry, index)),
    blackouts: requireArray(file.blackouts, 'blackouts', true).map((entry, index) =>
      parseBlackout(entry, `blackouts[${index}]`),
    ),
    dimensions,
    skills,
    workItems: (file.workItems === undefined ? [] : requireArray(file.workItems, 'workItems', true)).map(
      (entry, index) => parseWorkItem(entry, `workItems[${index}]`),
    ),
    items,
  }
}

/** Fills in the runtime fields the seed deliberately omits. */
export function asItems(seed: SeedFile): Item[] {
  return seed.items.map((item) => ({
    ...item,
    projectedStartDate: item.baselineStartDate,
    projectedEndDate: item.baselineEndDate,
    state: 'pending',
    completedAt: null,
    hoursDone: 0,
  }))
}

/**
 * A seed as the rest of the app sees a roadmap, before any progress. An absent
 * start date is the earliest planned start, which is what it means anyway, and
 * an absent capacity is zero, which reads downstream as "not declared".
 */
export function seedContent(seed: SeedFile): RoadmapContent {
  const items = asItems(seed)
  const earliest = items.reduce<CivilDate | ''>(
    (min, item) => (min === '' || item.baselineStartDate < min ? item.baselineStartDate : min),
    '',
  )
  return {
    roadmap: {
      timeZone: seed.timeZone,
      startDate: seed.startDate ?? earliest,
      weeklyHours: seed.weeklyHours ?? { normal: 0 },
      phases: seed.phases,
      blackouts: seed.blackouts,
      dimensions: seed.dimensions,
      skillDimension: seed.skills,
    },
    workItems: seed.workItems,
    items,
  }
}

/**
 * A roadmap as a seed file again: content only, in the order the file is read
 * in. The inverse of `seedContent` — progress and projections stay behind, and
 * a start date or capacity that is not set is left out rather than written
 * empty. Skills are grouped by axis, because the file is edited by hand and the
 * grouping is what makes a long skill map readable.
 */
export function toSeedFile(content: RoadmapContent): SeedFile {
  const { roadmap } = content
  const axis = (skill: string) => roadmap.dimensions.indexOf(roadmap.skillDimension[skill] ?? '')
  const skills = Object.keys(roadmap.skillDimension).sort(
    (a, b) => axis(a) - axis(b) || a.localeCompare(b),
  )

  return {
    timeZone: roadmap.timeZone,
    ...(roadmap.startDate === '' ? {} : { startDate: roadmap.startDate }),
    ...(roadmap.weeklyHours.normal > 0 ? { weeklyHours: roadmap.weeklyHours } : {}),
    phases: roadmap.phases,
    blackouts: roadmap.blackouts,
    dimensions: roadmap.dimensions,
    skills: Object.fromEntries(skills.map((skill) => [skill, roadmap.skillDimension[skill]!])),
    workItems: content.workItems,
    items: content.items.map((item) => ({
      id: item.id,
      name: item.name,
      type: item.type,
      phase: item.phase,
      workItemId: item.workItemId,
      skills: item.skills,
      baselineStartDate: item.baselineStartDate,
      baselineEndDate: item.baselineEndDate,
      dependsOn: item.dependsOn,
      price: item.price,
      link: item.link,
      resources: item.resources,
      duration: item.duration,
      notes: item.notes,
      doneWhen: item.doneWhen,
      sortOrder: item.sortOrder,
    })),
  }
}

/**
 * The name a roadmap file downloads as: `roadmap-2026-09-23-1332.json`, stamped
 * with when it was taken in the roadmap's timezone, like every date in the app,
 * so a folder of them sorts by date. A version of the plan adds its number in
 * the history: `roadmap-2026-09-23-1332-v5.json`.
 */
export function roadmapFileName(at: IsoDateTime, timeZone: string, version?: number): string {
  const part = partsIn(new Date(at), timeZone)
  const stamp = `${part('year')}-${part('month')}-${part('day')}-${part('hour')}${part('minute')}`
  return `roadmap-${stamp}${version === undefined ? '' : `-v${version}`}.json`
}

/** The calendar and clock fields of an instant in a timezone, UTC for one the runtime lacks. */
function partsIn(instant: Date, timeZone: string): (type: Intl.DateTimeFormatPartTypes) => string {
  const options: Intl.DateTimeFormatOptions = {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }
  let format: Intl.DateTimeFormat
  try {
    format = new Intl.DateTimeFormat('en-CA', { ...options, timeZone })
  } catch {
    format = new Intl.DateTimeFormat('en-CA', { ...options, timeZone: 'UTC' })
  }
  const parts = format.formatToParts(instant)
  return (type) => parts.find((part) => part.type === type)?.value ?? ''
}

function parsePhase(entry: unknown, index: number): Phase {
  const value = requireObject(entry, `phases[${index}]`)
  const number = value.number
  if (typeof number !== 'number' || !PHASE_NUMBERS.includes(number as PhaseNumber)) {
    throw new Error(`phases[${index}].number must be 1-6`)
  }
  const milestone = value.closingMilestoneId
  if (milestone !== null && typeof milestone !== 'string') {
    throw new Error(`phases[${index}].closingMilestoneId must be a string or null`)
  }
  return {
    number: number as PhaseNumber,
    name: requireString(value.name, `phases[${index}].name`),
    closingMilestoneId: milestone ?? null,
  }
}

/** One work item's shape and types. `at` names it in the error, as for items. */
export function parseWorkItem(entry: unknown, at: string): WorkItem {
  const value = requireObject(entry, at)
  const id = requireString(value.id, `${at}.id`)
  const where = `${at} (${id})`

  const type = requireString(value.type, `${where}.type`)
  if (!ITEM_TYPES.includes(type as ItemType)) throw new Error(`${where}.type is not valid: ${type}`)

  const link = value.link ?? null
  if (link !== null && typeof link !== 'string') {
    throw new Error(`${where}.link must be a string or null`)
  }
  if (link === '') throw new Error(`${where}.link is an empty string — use null`)

  return {
    id,
    name: requireString(value.name, `${where}.name`),
    type: type as ItemType,
    link,
    resources: parseResources(value.resources, `${where}.resources`),
    notes: requireString(value.notes ?? '', `${where}.notes`, true),
  }
}

/** One pause's shape and types. `at` names it in the error. */
export function parseBlackout(entry: unknown, at: string): Blackout {
  const value = requireObject(entry, at)
  const from = requireCivilDate(value.from, `${at}.from`)
  const to = requireCivilDate(value.to, `${at}.to`)
  if (to < from) throw new Error(`${at} ends on ${to}, before it starts on ${from}`)
  return { from, to, reason: requireString(value.reason, `${at}.reason`) }
}

/**
 * One item's shape and types, as the seed file requires them. Exported so an
 * item edited in the app is held to exactly the rules a file is. `at` names it
 * in the error: `items[3]` in a file, the edit it came from in the app.
 */
export function parseSeedItem(entry: unknown, at: string): SeedItem {
  const value = requireObject(entry, at)
  const id = requireString(value.id, `${at}.id`)
  const where = `${at} (${id})`

  const type = requireString(value.type, `${where}.type`)
  if (!ITEM_TYPES.includes(type as ItemType)) throw new Error(`${where}.type is not valid: ${type}`)

  const phase = value.phase
  if (typeof phase !== 'number' || !PHASE_NUMBERS.includes(phase as PhaseNumber)) {
    throw new Error(`${where}.phase must be 1-6`)
  }

  const sortOrder = value.sortOrder
  if (typeof sortOrder !== 'number' || !Number.isInteger(sortOrder)) {
    throw new Error(`${where}.sortOrder must be an integer`)
  }

  const link = value.link
  if (link !== null && typeof link !== 'string') {
    throw new Error(`${where}.link must be a string or null`)
  }
  if (link === '') throw new Error(`${where}.link is an empty string — use null`)

  const workItemId = value.workItemId ?? null
  if (workItemId !== null && typeof workItemId !== 'string') {
    throw new Error(`${where}.workItemId must be a string or null`)
  }

  return {
    id,
    name: requireString(value.name, `${where}.name`),
    type: type as ItemType,
    phase: phase as PhaseNumber,
    workItemId,
    skills: requireStringArray(value.skills, `${where}.skills`),
    baselineStartDate: requireCivilDate(value.baselineStartDate, `${where}.baselineStartDate`),
    baselineEndDate: requireCivilDate(value.baselineEndDate, `${where}.baselineEndDate`),
    dependsOn: requireStringArray(value.dependsOn, `${where}.dependsOn`, true),
    price: requireString(value.price, `${where}.price`, true),
    link: link ?? null,
    resources: parseResources(value.resources, `${where}.resources`),
    duration: requireString(value.duration ?? '', `${where}.duration`, true),
    notes: requireString(value.notes, `${where}.notes`, true),
    doneWhen: requireString(value.doneWhen ?? '', `${where}.doneWhen`, true),
    sortOrder,
  }
}

/**
 * Absent reads as no declared capacity, which the board renders as unknown. A
 * `lastWeekOfMonth` left in an older seed is ignored: every week has the same
 * capacity now.
 */
function parseWeeklyHours(value: unknown): WeeklyHours | undefined {
  if (value === undefined) return undefined
  const hours = requireObject(value, 'weeklyHours')
  return { normal: requirePositive(hours.normal, 'weeklyHours.normal') }
}

function requirePositive(value: unknown, at: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    throw new Error(`${at} must be a number above zero`)
  }
  return value
}

/** Extra links, each a label and a URL. Absent reads as none, not as an error. */
function parseResources(value: unknown, at: string): Resource[] {
  if (value === undefined) return []
  if (!Array.isArray(value)) throw new Error(`${at} must be an array`)
  return value.map((entry, index) => {
    const resource = requireObject(entry, `${at}[${index}]`)
    const url = requireString(resource.url, `${at}[${index}].url`)
    if (!/^https?:\/\//.test(url)) throw new Error(`${at}[${index}].url must be http(s)`)
    return { label: requireString(resource.label, `${at}[${index}].label`), url }
  })
}

function requireObject(value: unknown, at: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`${at} must be an object`)
  }
  return value as Record<string, unknown>
}

function requireArray(value: unknown, at: string, allowEmpty = false): unknown[] {
  if (!Array.isArray(value)) throw new Error(`${at} must be an array`)
  if (!allowEmpty && value.length === 0) throw new Error(`${at} must not be empty`)
  return value
}

function requireString(value: unknown, at: string, allowEmpty = false): string {
  if (typeof value !== 'string') throw new Error(`${at} must be a string`)
  if (!allowEmpty && value.length === 0) throw new Error(`${at} must not be empty`)
  return value
}

function requireCivilDate(value: unknown, at: string): CivilDate {
  const date = requireString(value, at)
  if (!isCivilDate(date)) throw new Error(`${at} must be YYYY-MM-DD, got ${date}`)
  return date
}

function requireStringArray(value: unknown, at: string, allowEmpty = false): string[] {
  if (!Array.isArray(value)) throw new Error(`${at} must be an array`)
  if (!allowEmpty && value.length === 0) throw new Error(`${at} must not be empty`)
  return value.map((entry, index) => requireString(entry, `${at}[${index}]`))
}

function requireStringRecord(value: unknown, at: string): Record<string, string> {
  const object = requireObject(value, at)
  const record: Record<string, string> = {}
  for (const [key, entry] of Object.entries(object)) {
    record[key] = requireString(entry, `${at}["${key}"]`)
  }
  return record
}
