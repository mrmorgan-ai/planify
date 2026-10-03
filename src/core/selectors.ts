import { toEpochDay } from './dates'
import type { CivilDate, Task, Phase, State } from './types'

// Derived reads over the task list. Pure and platform-neutral, so the backlog,
// the board and the dashboard all answer the same question the same way — and
// `today` is always an argument, never a clock read.

export type TaskFilter = 'all' | 'pending' | 'in_progress' | 'overdue' | 'done'

export const TASK_FILTERS: readonly TaskFilter[] = [
  'all',
  'pending',
  'in_progress',
  'overdue',
  'done',
] as const

/** Past its projected end and still not done. Today itself is not late yet. */
export function isOverdue(task: Task, today: CivilDate): boolean {
  return task.state !== 'done' && task.projectedEndDate < today
}

/** The projection has moved off the original plan. */
export function hasSlipped(task: Task): boolean {
  return (
    task.projectedStartDate !== task.baselineStartDate ||
    task.projectedEndDate !== task.baselineEndDate
  )
}

/** Days between the projected and the planned end. Positive is behind. */
export function slipDays(task: Task): number {
  return toEpochDay(task.projectedEndDate) - toEpochDay(task.baselineEndDate)
}

export function matchesFilter(task: Task, filter: TaskFilter, today: CivilDate): boolean {
  switch (filter) {
    case 'all':
      return true
    case 'overdue':
      return isOverdue(task, today)
    default:
      return task.state === filter
  }
}

export type PhaseGroup = {
  phase: Phase
  tasks: Task[]
}

/**
 * Tasks grouped by phase, in the curated dependency order rather than
 * alphabetically. Phases with nothing left after filtering are dropped.
 */
export function groupByPhase(tasks: readonly Task[], phases: readonly Phase[]): PhaseGroup[] {
  return phases
    .slice()
    .sort((a, b) => a.number - b.number)
    .map((phase) => ({
      phase,
      tasks: tasks
        .filter((task) => task.phase === phase.number)
        .sort((a, b) => a.sortOrder - b.sortOrder),
    }))
    .filter((group) => group.tasks.length > 0)
}

/** Done over total, per phase — the dashboard shows this as text, not a chart. */
export function phaseProgress(
  tasks: readonly Task[],
  phase: Phase,
): { done: number; total: number } {
  const inPhase = tasks.filter((task) => task.phase === phase.number)
  return {
    done: inPhase.filter((task) => task.state === 'done').length,
    total: inPhase.length,
  }
}

/** The three board columns, in the order they are shown. */
export const BOARD_COLUMNS: readonly State[] = ['pending', 'in_progress', 'done'] as const

/**
 * Tasks split by state, each column in the curated order. The board never
 * persists a position inside a column, so phase and sortOrder decide it.
 */
export function groupByState(tasks: readonly Task[]): Record<State, Task[]> {
  const columns: Record<State, Task[]> = { pending: [], in_progress: [], done: [] }
  for (const task of tasks) columns[task.state].push(task)
  for (const state of BOARD_COLUMNS) {
    columns[state].sort((a, b) => a.phase - b.phase || a.sortOrder - b.sortOrder)
  }
  return columns
}

/**
 * The dependencies of a task that are not done yet. Shown on a card as a note
 * and never as a lock (spec section 6): the board informs, it never blocks.
 * Only the unfinished ones, because a satisfied dependency is not information.
 */
export function unfinishedDependencies(task: Task, tasks: readonly Task[]): Task[] {
  const byId = new Map(tasks.map((candidate) => [candidate.id, candidate]))
  return task.dependsOn
    .map((id) => byId.get(id))
    .filter((dependency): dependency is Task => dependency !== undefined)
    .filter((dependency) => dependency.state !== 'done')
}
