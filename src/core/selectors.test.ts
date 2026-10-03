import { describe, expect, it } from 'vitest'
import {
  groupByPhase,
  groupByState,
  hasSlipped,
  isOverdue,
  matchesFilter,
  phaseProgress,
  slipDays,
  unfinishedDependencies,
} from './selectors'
import type { Task, Phase } from './types'

function task(id: string, overrides: Partial<Task> = {}): Task {
  return {
    id,
    name: id,
    phase: 1,
    skills: [],
    // A story of its own, as a task on its own was before every task had one.
    storyId: `${id}-story`,
    baselineStartDate: '2030-02-04',
    baselineEndDate: '2030-02-10',
    projectedStartDate: '2030-02-04',
    projectedEndDate: '2030-02-10',
    dependsOn: [],
    link: null,
    resources: [],
    duration: '',
    notes: '',
    doneWhen: '',
    state: 'pending',
    completedAt: null,
    hoursDone: 0,
    sortOrder: 1,
    ...overrides,
  }
}

const phases: Phase[] = [
  { number: 1, name: 'First', closingMilestoneId: null },
  { number: 2, name: 'Second', closingMilestoneId: null },
]

describe('isOverdue', () => {
  it('is not overdue on the day it is due', () => {
    expect(isOverdue(task('a'), '2030-02-10')).toBe(false)
  })

  it('is overdue the day after', () => {
    expect(isOverdue(task('a'), '2030-02-11')).toBe(true)
  })

  it('is never overdue once done, however late it was', () => {
    const done = task('a', { state: 'done', completedAt: '2030-03-01T12:00:00Z' })
    expect(isOverdue(done, '2030-06-01')).toBe(false)
  })

  it('counts a task in progress past its date', () => {
    expect(isOverdue(task('a', { state: 'in_progress' }), '2030-02-11')).toBe(true)
  })
})

describe('slip', () => {
  it('reports no slip when the projection sits on the plan', () => {
    expect(hasSlipped(task('a'))).toBe(false)
    expect(slipDays(task('a'))).toBe(0)
  })

  it('counts days behind as positive', () => {
    const late = task('a', { projectedStartDate: '2030-02-11', projectedEndDate: '2030-02-17' })
    expect(hasSlipped(late)).toBe(true)
    expect(slipDays(late)).toBe(7)
  })

  it('counts days ahead as negative', () => {
    const early = task('a', { projectedEndDate: '2030-02-05' })
    expect(slipDays(early)).toBe(-5)
  })
})

describe('matchesFilter', () => {
  const today = '2030-02-11'

  it('lets everything through on all', () => {
    expect(matchesFilter(task('a'), 'all', today)).toBe(true)
  })

  it('matches on the state field for the three state filters', () => {
    expect(matchesFilter(task('a', { state: 'in_progress' }), 'in_progress', today)).toBe(true)
    expect(matchesFilter(task('a', { state: 'in_progress' }), 'pending', today)).toBe(false)
    expect(
      matchesFilter(task('a', { state: 'done', completedAt: '2030-02-01T00:00:00Z' }), 'done', today),
    ).toBe(true)
  })

  it('treats overdue as a computed filter, not a state', () => {
    expect(matchesFilter(task('a'), 'overdue', today)).toBe(true)
    expect(matchesFilter(task('a'), 'overdue', '2030-02-01')).toBe(false)
  })
})

describe('groupByPhase', () => {
  it('orders phases by number and tasks by their curated order', () => {
    const tasks = [
      task('second', { phase: 1, sortOrder: 2 }),
      task('first', { phase: 1, sortOrder: 1 }),
      task('later', { phase: 2, sortOrder: 1 }),
    ]
    const groups = groupByPhase(tasks, phases)
    expect(groups.map((group) => group.phase.number)).toEqual([1, 2])
    expect(groups[0]?.tasks.map((entry) => entry.id)).toEqual(['first', 'second'])
  })

  it('drops a phase with nothing left in it', () => {
    const groups = groupByPhase([task('only', { phase: 2 })], phases)
    expect(groups).toHaveLength(1)
    expect(groups[0]?.phase.number).toBe(2)
  })
})

describe('phaseProgress', () => {
  it('counts done over total for one phase only', () => {
    const tasks = [
      task('a', { phase: 1, state: 'done', completedAt: '2030-02-01T00:00:00Z' }),
      task('b', { phase: 1 }),
      task('c', { phase: 2, state: 'done', completedAt: '2030-02-01T00:00:00Z' }),
    ]
    expect(phaseProgress(tasks, phases[0] as Phase)).toEqual({ done: 1, total: 2 })
  })
})

describe('groupByState', () => {
  it('puts every task in the column of its state', () => {
    const tasks = [
      task('a'),
      task('b', { state: 'in_progress' }),
      task('c', { state: 'done', completedAt: '2030-02-10T10:00:00Z' }),
      task('d', { state: 'in_progress' }),
    ]

    const columns = groupByState(tasks)

    expect(columns.pending.map((entry) => entry.id)).toEqual(['a'])
    expect(columns.in_progress.map((entry) => entry.id)).toEqual(['b', 'd'])
    expect(columns.done.map((entry) => entry.id)).toEqual(['c'])
  })

  it('orders each column by phase and then by the curated order', () => {
    const tasks = [
      task('late-in-one', { phase: 1, sortOrder: 9 }),
      task('first-in-two', { phase: 2, sortOrder: 1 }),
      task('first-in-one', { phase: 1, sortOrder: 1 }),
    ]

    expect(groupByState(tasks).pending.map((entry) => entry.id)).toEqual([
      'first-in-one',
      'late-in-one',
      'first-in-two',
    ])
  })

  it('returns the three columns even when everything is in one', () => {
    const columns = groupByState([task('a'), task('b')])

    expect(columns.in_progress).toEqual([])
    expect(columns.done).toEqual([])
  })
})

describe('unfinishedDependencies', () => {
  const done = task('done-one', { state: 'done', completedAt: '2030-02-10T10:00:00Z' })
  const open = task('open-one')

  it('lists only the dependencies that are not done', () => {
    const target = task('target', { dependsOn: ['done-one', 'open-one'] })

    expect(unfinishedDependencies(target, [done, open, target]).map((entry) => entry.id)).toEqual([
      'open-one',
    ])
  })

  it('is empty when every dependency is done', () => {
    const target = task('target', { dependsOn: ['done-one'] })

    expect(unfinishedDependencies(target, [done, target])).toEqual([])
  })

  it('ignores an id that is not in the roadmap instead of throwing', () => {
    const target = task('target', { dependsOn: ['ghost'] })

    expect(unfinishedDependencies(target, [target])).toEqual([])
  })
})
