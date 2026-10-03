import { projectWherePossible } from './schedule'
import { parseSeedTask, type SeedTask } from './seed'
import { placedInStories } from './stories'
import type { Task, RoadmapContent } from './types'
import { EditError, newId, takenIds } from './editing'
import {
  applyStructureEdit,
  isStructureOp,
  parseStructureEdit,
  type StructureEdit,
} from './structure'

export { EditError, newId, slugOf } from './editing'

/**
 * The fields of a task that can be edited in place. The id never changes —
 * progress is keyed to it — and the dates and the order each have their own
 * path, because moving either moves other tasks too. The phase is the story's:
 * moving a task to a story in another phase moves it there, last.
 */
export const EDITABLE_FIELDS = [
  'name',
  'storyId',
  'skills',
  'link',
  'resources',
  'duration',
  'notes',
  'doneWhen',
] as const

export type EditableField = (typeof EDITABLE_FIELDS)[number]
export type TaskFields = Partial<Pick<SeedTask, EditableField>>

/**
 * A new task: what it is, which story it is a step of, and when. The id and the
 * order are the server's to pick; the phase is the story's.
 */
export type NewTask = TaskFields &
  Pick<SeedTask, 'name' | 'storyId' | 'baselineStartDate' | 'baselineEndDate' | 'skills'> & {
    /** Asked for, rather than derived from the name. Refused if it is taken. */
    id?: string
    dependsOn?: string[]
  }

/**
 * One change to the roadmap's content. Edits travel as a list and land as one
 * batch, so a change that takes several steps — create a task, then make
 * another wait on it — is all or nothing. Tasks are edited here; what they hang
 * off — stories, phases, pauses, settings, skills — in structure.ts.
 */
export type Edit = TaskEdit | StructureEdit

export type TaskEdit =
  | { op: 'updateTask'; id: string; fields: TaskFields }
  | { op: 'setDependencies'; id: string; dependsOn: string[] }
  | { op: 'createTask'; task: NewTask }
  | {
      /**
       * Puts a task before another task of its phase, or last. The phase is
       * renumbered, so the order stays 1..n.
       */
      op: 'moveTask'
      id: string
      before?: string | null
    }
  | {
      op: 'deleteTask'
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
      case 'updateTask': {
        const fields = edit.fields
        if (typeof fields !== 'object' || fields === null || Array.isArray(fields)) {
          throw new EditError(`${at}.fields must be an object`)
        }
        for (const field of Object.keys(fields)) {
          if (!(EDITABLE_FIELDS as readonly string[]).includes(field)) {
            throw new EditError(`${at}.fields.${field} cannot be edited this way`)
          }
        }
        return { op: 'updateTask', id: idOf(edit, at), fields: fields as TaskFields }
      }
      case 'setDependencies':
        return {
          op: 'setDependencies',
          id: idOf(edit, at),
          dependsOn: strings(edit.dependsOn, `${at}.dependsOn`),
        }
      case 'createTask': {
        const task = edit.task
        if (typeof task !== 'object' || task === null || Array.isArray(task)) {
          throw new EditError(`${at}.task must be an object`)
        }
        return { op: 'createTask', task: task as NewTask }
      }
      case 'moveTask': {
        const before = edit.before ?? null
        if (before !== null && typeof before !== 'string') {
          throw new EditError(`${at}.before must be a task id or null`)
        }
        return { op: 'moveTask', id: idOf(edit, at), before }
      }
      case 'deleteTask':
        return {
          op: 'deleteTask',
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
 * projection once at the end. Each edited task is parsed again with the seed
 * file's own rules, so a task edited in the app obeys exactly what a file
 * would. Whether the result is a sound plan is the validator's question,
 * answered by the write that stores it.
 */
export function applyEdits(content: RoadmapContent, edits: readonly Edit[]): RoadmapContent {
  let next = content

  edits.forEach((edit, index) => {
    const at = `edits[${index}]`
    const tasks = next.tasks
    switch (edit.op) {
      case 'updateTask': {
        const target = find(tasks, edit.id)
        if (edit.fields.storyId !== undefined) storyOf(next, edit.fields.storyId)
        const parsed = parse({ ...seedTaskOf(target), ...edit.fields }, at)
        next = {
          ...next,
          tasks: tasks.map((task) => (task.id === target.id ? { ...task, ...pick(parsed) } : task)),
        }
        break
      }
      case 'setDependencies': {
        const target = find(tasks, edit.id)
        next = {
          ...next,
          tasks: tasks.map((task) =>
            task.id === target.id ? { ...task, dependsOn: [...edit.dependsOn] } : task,
          ),
        }
        break
      }
      case 'createTask':
        next = { ...next, tasks: [...tasks, created(next, edit.task, at)] }
        break
      case 'moveTask':
        next = { ...next, tasks: moved(next, edit) }
        break
      case 'deleteTask':
        next = { ...next, tasks: deleted(next, edit) }
        break
      default:
        next = applyStructureEdit(next, edit, at)
    }
  })

  // A task that changed story, or whose story changed phase, takes its phase now.
  next = placedInStories(next)
  const options = { blackouts: next.roadmap.blackouts, timeZone: next.roadmap.timeZone }
  return { ...next, tasks: projectWherePossible(next.tasks, options) }
}

/** Who waits on a task: what a delete has to deal with. */
export function dependentsOf(tasks: readonly Task[], id: string): Task[] {
  return tasks.filter((task) => task.dependsOn.includes(id))
}

/** Whether a task has anything to lose: a state past pending, or hours logged. */
export function hasProgress(task: Task): boolean {
  return task.state !== 'pending' || task.hoursDone > 0
}

function created(content: RoadmapContent, task: NewTask, at: string): Task {
  if (task.id !== undefined && takenIds(content).has(task.id)) {
    throw new EditError(`${at}: the id ${task.id} is already taken`)
  }
  const id = task.id ?? newId(String(task.name ?? ''), content)
  const story = storyOf(content, String(task.storyId ?? ''))
  const last = content.tasks
    .filter((each) => each.phase === story.phase)
    .reduce((max, each) => Math.max(max, each.sortOrder), 0)

  const seed = parse(
    {
      dependsOn: [],
      link: null,
      resources: [],
      duration: '',
      notes: '',
      doneWhen: '',
      ...task,
      id,
      sortOrder: last + 1,
    },
    at,
  )
  return {
    ...seed,
    phase: story.phase,
    projectedStartDate: seed.baselineStartDate,
    projectedEndDate: seed.baselineEndDate,
    state: 'pending',
    completedAt: null,
    hoursDone: 0,
  }
}

function moved(content: RoadmapContent, edit: Extract<Edit, { op: 'moveTask' }>): Task[] {
  const target = find(content.tasks, edit.id)
  if (edit.before === target.id) return content.tasks

  const order = content.tasks
    .filter((task) => task.phase === target.phase && task.id !== target.id)
    .sort((a, b) => a.sortOrder - b.sortOrder)
  const at =
    edit.before == null ? order.length : order.findIndex((task) => task.id === edit.before)
  if (at < 0) throw new EditError(`${edit.before} is not in phase ${target.phase}`)
  order.splice(at, 0, target)

  const place = new Map(order.map((task, index) => [task.id, index + 1]))
  return content.tasks.map((task) => {
    const sortOrder = place.get(task.id)
    return sortOrder === undefined ? task : { ...task, sortOrder }
  })
}

function deleted(content: RoadmapContent, edit: Extract<Edit, { op: 'deleteTask' }>): Task[] {
  const { tasks } = content
  const target = find(tasks, edit.id)

  const closes = content.roadmap.phases.find((phase) => phase.closingMilestoneId === target.id)
  if (closes) {
    throw new EditError(
      `${target.name} closes phase ${closes.number}; choose another closing milestone first`,
    )
  }
  if (hasProgress(target) && !edit.discardProgress) {
    throw new EditError(`${target.name} has progress, which would be lost with it`)
  }

  const dependents = dependentsOf(tasks, target.id)
  if (dependents.length > 0 && !edit.rewire) {
    throw new EditError(
      `${target.name} is needed by ${dependents.map((task) => task.name).join(', ')}`,
    )
  }

  return tasks
    .filter((task) => task.id !== target.id)
    .map((task) =>
      task.dependsOn.includes(target.id)
        ? {
            ...task,
            // What it waited on through the deleted task, it now waits on directly.
            dependsOn: [
              ...new Set(
                task.dependsOn.flatMap((id) => (id === target.id ? target.dependsOn : [id])),
              ),
            ].filter((id) => id !== task.id),
          }
        : task,
    )
}

function parse(value: object, at: string): SeedTask {
  try {
    return parseSeedTask(value, at)
  } catch (error) {
    throw new EditError(error instanceof Error ? error.message : String(error))
  }
}

function seedTaskOf(task: Task): SeedTask {
  const {
    phase: _phase,
    state: _state,
    completedAt: _completedAt,
    hoursDone: _hoursDone,
    projectedStartDate: _start,
    projectedEndDate: _end,
    ...seed
  } = task
  return seed
}

function pick(seed: SeedTask): TaskFields {
  return Object.fromEntries(EDITABLE_FIELDS.map((field) => [field, seed[field]])) as TaskFields
}

function storyOf(content: RoadmapContent, id: string) {
  const found = content.stories.find((story) => story.id === id)
  if (!found) throw new EditError(`No story with id ${id}`)
  return found
}

function find(tasks: readonly Task[], id: string): Task {
  const found = tasks.find((task) => task.id === id)
  if (!found) throw new EditError(`No task with id ${id}`)
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
