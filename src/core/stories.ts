import { estimatedHours } from './hours'
import type { Resource, RoadmapContent, State, Story, Task } from './types'

// Stories read everything off their tasks. Nothing here is stored, so a story
// can never report a state or an hours figure its own tasks disagree with.

/** Plan order: phase first, then the curated order inside it. */
function byPlanOrder(a: Task, b: Task): number {
  return a.phase - b.phase || a.sortOrder - b.sortOrder
}

/**
 * The tasks with each one's phase read off its story, which is the only place a
 * phase is kept. A task whose phase changes — its story moved, or it moved to a
 * story elsewhere — goes to the end of its new phase, in the order it had; the
 * rest keep their places. A task whose story does not exist keeps its phase: the
 * validator names the missing story.
 *
 * Called wherever a roadmap is read or changed, so every task in memory carries
 * its story's phase and the engine, the validator and the views can go on
 * reading `task.phase`.
 */
export function withStoryPhases({ stories, tasks }: Pick<RoadmapContent, 'stories' | 'tasks'>): Task[] {
  const phaseOf = new Map(stories.map((story) => [story.id, story.phase]))
  const last = new Map<number, number>()
  for (const task of tasks) {
    if (phaseOf.get(task.storyId) === task.phase || !phaseOf.has(task.storyId)) {
      last.set(task.phase, Math.max(last.get(task.phase) ?? 0, task.sortOrder))
    }
  }
  const moving = tasks
    .filter((task) => phaseOf.has(task.storyId) && phaseOf.get(task.storyId) !== task.phase)
    .sort(byPlanOrder)
  if (moving.length === 0) return [...tasks]

  const placed = new Map<string, Pick<Task, 'phase' | 'sortOrder'>>()
  for (const task of moving) {
    const phase = phaseOf.get(task.storyId)!
    const sortOrder = (last.get(phase) ?? 0) + 1
    last.set(phase, sortOrder)
    placed.set(task.id, { phase, sortOrder })
  }
  return tasks.map((task) => {
    const place = placed.get(task.id)
    return place ? { ...task, ...place } : task
  })
}

/** `withStoryPhases` for a whole roadmap: the same content, every task in its story's phase. */
export function placedInStories<T extends Pick<RoadmapContent, 'stories' | 'tasks'>>(content: T): T {
  return { ...content, tasks: withStoryPhases(content) }
}

export function tasksOf(storyId: string, tasks: readonly Task[]): Task[] {
  return tasks.filter((task) => task.storyId === storyId).sort(byPlanOrder)
}

export type TaskLabel = { story: Story; index: number; total: number }

/** "Task 3 of 9 of X", or null when the task's story is missing. */
export function taskLabel(
  task: Task,
  stories: readonly Story[],
  tasks: readonly Task[],
): TaskLabel | null {
  const story = stories.find((candidate) => candidate.id === task.storyId)
  if (!story) return null
  const steps = tasksOf(story.id, tasks)
  return { story, index: steps.findIndex((step) => step.id === task.id) + 1, total: steps.length }
}

/** Done when every task is, in progress as soon as any task has moved, pending otherwise. */
export function storyState(tasks: readonly Task[]): State {
  if (tasks.length > 0 && tasks.every((task) => task.state === 'done')) return 'done'
  return tasks.some((task) => task.state !== 'pending') ? 'in_progress' : 'pending'
}

export type StoryHours = {
  total: number
  done: number
  /** Tasks with no estimate, which the two totals above leave out. */
  unestimated: number
}

export function storyHours(tasks: readonly Task[]): StoryHours {
  let total = 0
  let done = 0
  let unestimated = 0
  for (const task of tasks) {
    const hours = estimatedHours(task)
    if (hours === null) {
      unestimated += 1
      continue
    }
    total += hours
    if (task.state === 'done') done += hours
  }
  return { total, done, unestimated }
}

/** One entry in the stories view: a story with its tasks, in plan order. */
export type StoryEntry = { story: Story; tasks: Task[] }

/**
 * Every story with its tasks, in the order the plan first reaches each. A story
 * with no tasks yet comes after those that have some, by phase, so nothing
 * disappears from the list for being empty.
 */
export function storyEntries(tasks: readonly Task[], stories: readonly Story[]): StoryEntry[] {
  const known = new Map(stories.map((story) => [story.id, story]))
  const entries = new Map<string, StoryEntry>()

  for (const task of tasks.slice().sort(byPlanOrder)) {
    const story = known.get(task.storyId)
    if (!story) continue
    const entry = entries.get(story.id)
    if (entry) entry.tasks.push(task)
    else entries.set(story.id, { story, tasks: [task] })
  }
  const empty = stories
    .filter((story) => !entries.has(story.id))
    .sort((a, b) => a.phase - b.phase || a.name.localeCompare(b.name))
    .map((story) => ({ story, tasks: [] }))

  return [...entries.values(), ...empty]
}

/**
 * The links to show for a task: its own when it has any, otherwise its story's.
 * The tasks of a course usually share one link, and repeating it on every task
 * is how a link ends up fixed in one place and stale in the others.
 */
export function linksOf(
  task: Task,
  stories: readonly Story[],
): { link: string | null; resources: Resource[] } {
  if (task.link !== null || task.resources.length > 0) {
    return { link: task.link, resources: task.resources }
  }
  const story = stories.find((candidate) => candidate.id === task.storyId)
  return { link: story?.link ?? null, resources: story?.resources ?? [] }
}
