import { WORK_TYPES, PHASE_NUMBERS } from './constants'
import { isCivilDate } from './dates'
import type {
  Blackout,
  CivilDate,
  Dimension,
  Feature,
  IsoDateTime,
  Task,
  WorkType,
  Phase,
  PhaseNumber,
  Resource,
  RoadmapContent,
  WeeklyHours,
  Story,
} from './types'
import { isFormatV1, upgradeV1 } from './upgrade'

/** The roadmap file's format: features, stories and tasks. An older file is upgraded on read. */
export const SEED_FORMAT = 2

/**
 * The seed carries content only. `state`, `completedAt`, `hoursDone` and the
 * projected dates are runtime state, so the file you hand-edit cannot overwrite
 * your progress. The phase is its story's, so a task does not carry one.
 */
export type SeedTask = Omit<
  Task,
  'state' | 'completedAt' | 'hoursDone' | 'projectedStartDate' | 'projectedEndDate' | 'phase'
>

/**
 * Everything a roadmap is made of. Lives outside this repository: the app is
 * open, the roadmap is not.
 */
export type SeedFile = {
  format: typeof SEED_FORMAT
  timeZone: string
  /** The anchor the plan starts on. Optional in the file; derived when absent. */
  startDate?: CivilDate
  /** Study hours per week. Optional; without it the board shows no capacity. */
  weeklyHours?: WeeklyHours
  phases: Phase[]
  blackouts: Blackout[]
  dimensions: Dimension[]
  skills: Record<string, Dimension>
  /** Goals wider than a phase. Optional; a story names its own with `featureId`. */
  features: Feature[]
  stories: Story[]
  tasks: SeedTask[]
}

/**
 * Checks a parsed seed's shape and types, field by field, and throws naming the
 * first field that is wrong. Whether the content makes a sound plan is a
 * separate question, answered by `validate`.
 *
 * A file in the first format — items and work items — is upgraded first, so an
 * old export, a version kept in the history and a draft started before the
 * change all read as what they always meant.
 */
export function parseSeed(raw: unknown): SeedFile {
  if (typeof raw !== 'object' || raw === null) throw new Error('The seed is not an object')
  const file = isFormatV1(raw) ? upgradeV1(raw) : (raw as Record<string, unknown>)
  if (file.format !== undefined && file.format !== SEED_FORMAT) {
    throw new Error(`format must be ${SEED_FORMAT}, got ${String(file.format)}`)
  }

  const dimensions = requireStringArray(file.dimensions, 'dimensions')
  const skills = requireStringRecord(file.skills, 'skills')
  for (const [skill, dimension] of Object.entries(skills)) {
    if (!dimensions.includes(dimension)) {
      throw new Error(`skills["${skill}"] points at unknown dimension "${dimension}"`)
    }
  }

  // A roadmap may hold no tasks and no pauses yet: a new one starts that way, and
  // its drafts and its history go through this same parser.
  const tasks = requireArray(file.tasks, 'tasks', true).map((entry, index) =>
    parseSeedTask(entry, `tasks[${index}]`),
  )

  return {
    format: SEED_FORMAT,
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
    features: (file.features === undefined ? [] : requireArray(file.features, 'features', true)).map(
      (entry, index) => parseFeature(entry, `features[${index}]`),
    ),
    stories: (file.stories === undefined ? [] : requireArray(file.stories, 'stories', true)).map(
      (entry, index) => parseStory(entry, `stories[${index}]`),
    ),
    tasks,
  }
}

/**
 * Fills in the runtime fields the seed deliberately omits, and each task's
 * phase from its story. A task whose story is missing gets the first phase; the
 * validator names the missing story.
 */
export function asTasks(seed: Pick<SeedFile, 'stories' | 'tasks'>): Task[] {
  const phaseOf = new Map(seed.stories.map((story) => [story.id, story.phase]))
  return seed.tasks.map((task) => ({
    ...task,
    phase: phaseOf.get(task.storyId) ?? PHASE_NUMBERS[0]!,
    projectedStartDate: task.baselineStartDate,
    projectedEndDate: task.baselineEndDate,
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
  const tasks = asTasks(seed)
  const earliest = tasks.reduce<CivilDate | ''>(
    (min, task) => (min === '' || task.baselineStartDate < min ? task.baselineStartDate : min),
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
    features: seed.features,
    stories: seed.stories,
    tasks,
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
    format: SEED_FORMAT,
    timeZone: roadmap.timeZone,
    ...(roadmap.startDate === '' ? {} : { startDate: roadmap.startDate }),
    ...(roadmap.weeklyHours.normal > 0 ? { weeklyHours: roadmap.weeklyHours } : {}),
    phases: roadmap.phases,
    blackouts: roadmap.blackouts,
    dimensions: roadmap.dimensions,
    skills: Object.fromEntries(skills.map((skill) => [skill, roadmap.skillDimension[skill]!])),
    features: content.features,
    stories: content.stories,
    tasks: content.tasks.map((task) => ({
      id: task.id,
      name: task.name,
      storyId: task.storyId,
      skills: task.skills,
      baselineStartDate: task.baselineStartDate,
      baselineEndDate: task.baselineEndDate,
      dependsOn: task.dependsOn,
      link: task.link,
      resources: task.resources,
      duration: task.duration,
      notes: task.notes,
      doneWhen: task.doneWhen,
      sortOrder: task.sortOrder,
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

/** One story's shape and types. `at` names it in the error, as for tasks. */
export function parseStory(entry: unknown, at: string): Story {
  const value = requireObject(entry, at)
  const id = requireString(value.id, `${at}.id`)
  const where = `${at} (${id})`

  const phase = value.phase
  if (typeof phase !== 'number' || !PHASE_NUMBERS.includes(phase as PhaseNumber)) {
    throw new Error(`${where}.phase must be 1-6`)
  }

  const featureId = value.featureId ?? null
  if (featureId !== null && typeof featureId !== 'string') {
    throw new Error(`${where}.featureId must be a string or null`)
  }

  return {
    id,
    name: requireString(value.name, `${where}.name`),
    type: optionalType(value.type, where),
    phase: phase as PhaseNumber,
    featureId,
    link: optionalLink(value.link, where),
    resources: parseResources(value.resources, `${where}.resources`),
    price: requireString(value.price ?? '', `${where}.price`, true),
    notes: requireString(value.notes ?? '', `${where}.notes`, true),
    doneWhen: requireString(value.doneWhen ?? '', `${where}.doneWhen`, true),
  }
}

/** One feature's shape and types. `at` names it in the error. */
export function parseFeature(entry: unknown, at: string): Feature {
  const value = requireObject(entry, at)
  const id = requireString(value.id, `${at}.id`)
  const where = `${at} (${id})`
  return {
    id,
    name: requireString(value.name, `${where}.name`),
    type: optionalType(value.type, where),
    link: optionalLink(value.link, where),
    notes: requireString(value.notes ?? '', `${where}.notes`, true),
  }
}

/** One of the listed types, or null. Absent reads as null: the label is optional. */
function optionalType(value: unknown, where: string): WorkType | null {
  const type = value ?? null
  if (type === null) return null
  if (typeof type !== 'string' || !WORK_TYPES.includes(type as WorkType)) {
    throw new Error(`${where}.type is not valid: ${String(type)}`)
  }
  return type as WorkType
}

/** A link or null. An empty string is refused, so "no link" has one spelling. */
function optionalLink(value: unknown, where: string): string | null {
  const link = value ?? null
  if (link !== null && typeof link !== 'string') {
    throw new Error(`${where}.link must be a string or null`)
  }
  if (link === '') throw new Error(`${where}.link is an empty string — use null`)
  return link
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
 * One task's shape and types, as the seed file requires them. Exported so an
 * task edited in the app is held to exactly the rules a file is. `at` names it
 * in the error: `tasks[3]` in a file, the edit it came from in the app.
 */
export function parseSeedTask(entry: unknown, at: string): SeedTask {
  const value = requireObject(entry, at)
  const id = requireString(value.id, `${at}.id`)
  const where = `${at} (${id})`

  const sortOrder = value.sortOrder
  if (typeof sortOrder !== 'number' || !Number.isInteger(sortOrder)) {
    throw new Error(`${where}.sortOrder must be an integer`)
  }

  return {
    id,
    name: requireString(value.name, `${where}.name`),
    storyId: requireString(value.storyId, `${where}.storyId`),
    skills: requireStringArray(value.skills, `${where}.skills`),
    baselineStartDate: requireCivilDate(value.baselineStartDate, `${where}.baselineStartDate`),
    baselineEndDate: requireCivilDate(value.baselineEndDate, `${where}.baselineEndDate`),
    dependsOn: requireStringArray(value.dependsOn, `${where}.dependsOn`, true),
    link: optionalLink(value.link, where),
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
