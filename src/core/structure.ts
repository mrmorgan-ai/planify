import { PHASE_NUMBERS } from './constants'
import { addStudyDays, isCivilDate, shiftStudyDays, studyDaysBetween } from './dates'
import { EditError, newId, takenIds } from './editing'
import { parseBlackout, parseFeature, parseStory } from './seed'
import { placedInStories } from './stories'
import type {
  Blackout,
  CivilDate,
  Feature,
  PhaseNumber,
  RoadmapContent,
  Story,
  Task,
} from './types'

// Edits to what the tasks hang off: stories, features, phases, pauses, the
// plan's settings and the skill map. Each returns the whole roadmap it produces;
// the caller recomputes projections and the validator judges the result.

export const STORY_FIELDS = [
  'name',
  'type',
  'phase',
  'featureId',
  'link',
  'resources',
  'price',
  'notes',
  'doneWhen',
] as const
export type StoryFields = Partial<Pick<Story, (typeof STORY_FIELDS)[number]>>
export type NewStory = StoryFields & Pick<Story, 'name' | 'phase'> & { id?: string }

export const FEATURE_FIELDS = ['name', 'type', 'link', 'notes'] as const
export type FeatureFields = Partial<Pick<Feature, (typeof FEATURE_FIELDS)[number]>>
export type NewFeature = FeatureFields & Pick<Feature, 'name'> & { id?: string }

export type SettingsFields = {
  timeZone?: string
  /** Empty for none. */
  startDate?: CivilDate | ''
  /** Study hours per week; zero for undeclared. */
  weeklyHours?: number
}

export type StructureEdit =
  | { op: 'createStory'; story: NewStory }
  /** A new phase moves every one of its tasks with it, to the end of that phase. */
  | { op: 'updateStory'; id: string; fields: StoryFields }
  /** Only once it has no tasks: every task needs a story. */
  | { op: 'deleteStory'; id: string }
  | { op: 'createFeature'; feature: NewFeature }
  | { op: 'updateFeature'; id: string; fields: FeatureFields }
  /** Its stories stay, serving no feature. */
  | { op: 'deleteFeature'; id: string }
  | { op: 'addPhase'; name: string }
  | {
      op: 'updatePhase'
      number: number
      fields: { name?: string; closingMilestoneId?: string | null }
    }
  /** Only the last phase, and only once it is empty. */
  | { op: 'removePhase'; number: number }
  | {
      op: 'setBlackouts'
      blackouts: Blackout[]
      /**
       * Keep every unfinished task on the same study day of the plan, so a new
       * pause pushes what comes after it and a removed one pulls it back.
       */
      keepStudyDays?: boolean
    }
  | { op: 'updateSettings'; fields: SettingsFields }
  | {
      op: 'setSkillMap'
      dimensions: string[]
      skills: Record<string, string>
      /** Skills given a new name: every task using the old one follows. */
      renamed?: Record<string, string>
    }

const OPS = [
  'createStory',
  'updateStory',
  'deleteStory',
  'createFeature',
  'updateFeature',
  'deleteFeature',
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
    case 'createStory':
      return {
        op: 'createStory',
        story: object(edit.story, `${at}.story`) as NewStory,
      }
    case 'updateStory': {
      const fields = object(edit.fields, `${at}.fields`)
      for (const field of Object.keys(fields)) {
        if (!(STORY_FIELDS as readonly string[]).includes(field)) {
          throw new EditError(`${at}.fields.${field} cannot be edited this way`)
        }
      }
      return {
        op: 'updateStory',
        id: text(edit.id, `${at}.id`),
        fields: fields as StoryFields,
      }
    }
    case 'deleteStory':
      return { op: 'deleteStory', id: text(edit.id, `${at}.id`) }
    case 'createFeature':
      return {
        op: 'createFeature',
        feature: object(edit.feature, `${at}.feature`) as NewFeature,
      }
    case 'updateFeature': {
      const fields = object(edit.fields, `${at}.fields`)
      for (const field of Object.keys(fields)) {
        if (!(FEATURE_FIELDS as readonly string[]).includes(field)) {
          throw new EditError(`${at}.fields.${field} cannot be edited this way`)
        }
      }
      return {
        op: 'updateFeature',
        id: text(edit.id, `${at}.id`),
        fields: fields as FeatureFields,
      }
    }
    case 'deleteFeature':
      return { op: 'deleteFeature', id: text(edit.id, `${at}.id`) }
    case 'addPhase':
      return { op: 'addPhase', name: text(edit.name, `${at}.name`) }
    case 'updatePhase': {
      const fields = object(edit.fields, `${at}.fields`)
      const next: { name?: string; closingMilestoneId?: string | null } = {}
      if ('name' in fields) next.name = text(fields.name, `${at}.fields.name`)
      if ('closingMilestoneId' in fields) {
        const milestone = fields.closingMilestoneId
        if (milestone !== null && typeof milestone !== 'string') {
          throw new EditError(`${at}.fields.closingMilestoneId must be a task id or null`)
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
      const dimensions = edit.dimensions.map((name, index) =>
        text(name, `${at}.dimensions[${index}]`),
      )
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
    case 'createStory': {
      const { story } = edit
      if (story.id !== undefined && takenIds(content).has(story.id)) {
        throw new EditError(`${at}: the id ${story.id} is already taken`)
      }
      const id = story.id ?? newId(String(story.name ?? ''), content)
      const created = wrap(() =>
        parseStory(
          {
            type: null,
            featureId: null,
            link: null,
            resources: [],
            price: '',
            notes: '',
            doneWhen: '',
            ...story,
            id,
          },
          at,
        ),
      )
      checkFeature(content, created.featureId)
      return { ...content, stories: [...content.stories, created] }
    }
    case 'updateStory': {
      const target = findStory(content, edit.id)
      const updated = wrap(() => parseStory({ ...target, ...edit.fields, id: target.id }, at))
      checkFeature(content, updated.featureId)
      // Placed at once, so a later edit in the same batch sees the tasks where they now are.
      return placedInStories({
        ...content,
        stories: content.stories.map((each) => (each.id === target.id ? updated : each)),
      })
    }
    case 'deleteStory': {
      const target = findStory(content, edit.id)
      const tasks = content.tasks.filter((task) => task.storyId === target.id).length
      if (tasks > 0) {
        throw new EditError(
          `${target.name} still has ${tasks} ${tasks === 1 ? 'task' : 'tasks'}; move or delete ${tasks === 1 ? 'it' : 'them'} first`,
        )
      }
      return { ...content, stories: content.stories.filter((each) => each.id !== target.id) }
    }
    case 'createFeature': {
      const { feature } = edit
      if (feature.id !== undefined && takenIds(content).has(feature.id)) {
        throw new EditError(`${at}: the id ${feature.id} is already taken`)
      }
      const id = feature.id ?? newId(String(feature.name ?? ''), content)
      const created = wrap(() =>
        parseFeature({ type: null, link: null, notes: '', ...feature, id }, at),
      )
      return { ...content, features: [...content.features, created] }
    }
    case 'updateFeature': {
      const target = findFeature(content, edit.id)
      const updated = wrap(() => parseFeature({ ...target, ...edit.fields, id: target.id }, at))
      return {
        ...content,
        features: content.features.map((each) => (each.id === target.id ? updated : each)),
      }
    }
    case 'deleteFeature': {
      const target = findFeature(content, edit.id)
      return {
        ...content,
        features: content.features.filter((each) => each.id !== target.id),
        stories: content.stories.map((story) =>
          story.featureId === target.id ? { ...story, featureId: null } : story,
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
      const inIt = content.stories.filter((story) => story.phase === phase.number).length
      if (inIt > 0) {
        throw new EditError(
          `Phase ${phase.number} still has ${inIt} ${inIt === 1 ? 'story' : 'stories'}; move or delete ${inIt === 1 ? 'it' : 'them'} first`,
        )
      }
      return {
        ...content,
        roadmap: { ...roadmap, phases: roadmap.phases.filter((each) => each !== phase) },
      }
    }
    case 'setBlackouts': {
      const tasks = edit.keepStudyDays
        ? keepStudyDays(content, roadmap.blackouts, edit.blackouts)
        : content.tasks
      return { ...content, tasks, roadmap: { ...roadmap, blackouts: edit.blackouts } }
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
        tasks: content.tasks.map((task) =>
          task.skills.some((skill) => skill in renames)
            ? { ...task, skills: [...new Set(task.skills.map(renamed))] }
            : task,
        ),
      }
    }
  }
}

/**
 * Every unfinished task moved so it sits on the same study day of the plan
 * under the new pauses as it did under the old ones, with the same number of
 * study days. Counted from the plan's start, so what comes before a change
 * stays put. Finished tasks keep their dates: they happened when they happened.
 */
export function keepStudyDays(
  content: RoadmapContent,
  before: readonly Blackout[],
  after: readonly Blackout[],
): Task[] {
  const anchor =
    content.roadmap.startDate ||
    content.tasks.reduce<CivilDate>(
      (min, task) => (min === '' || task.baselineStartDate < min ? task.baselineStartDate : min),
      '',
    )
  return content.tasks.map((task) => {
    if (task.state === 'done' || anchor === '' || task.baselineStartDate < anchor) return task
    const position = studyDaysBetween(anchor, task.baselineStartDate, before)
    const length = studyDaysBetween(task.baselineStartDate, task.baselineEndDate, before)
    if (position < 1 || length < 1) return task
    const start = shiftStudyDays(anchor, position - 1, after)
    return {
      ...task,
      baselineStartDate: start,
      baselineEndDate: addStudyDays(start, length, after),
    }
  })
}

function findStory(content: RoadmapContent, id: string): Story {
  const found = content.stories.find((each) => each.id === id)
  if (!found) throw new EditError(`No story with id ${id}`)
  return found
}

function findFeature(content: RoadmapContent, id: string): Feature {
  const found = content.features.find((each) => each.id === id)
  if (!found) throw new EditError(`No feature with id ${id}`)
  return found
}

/** A story may serve no feature, or one that exists. */
function checkFeature(content: RoadmapContent, featureId: string | null): void {
  if (featureId !== null) findFeature(content, featureId)
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
  if (typeof value !== 'string' || value.trim() === '')
    throw new EditError(`${at} must not be empty`)
  return value
}

function phaseNumber(value: unknown, at: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value))
    throw new EditError(`${at} must be a phase number`)
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
