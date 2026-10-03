import { describe, expect, it } from 'vitest'
import {
  daysLeftInWeek,
  estimatedHours,
  progressHours,
  hoursByWeek,
  hoursInWeek,
  inWeek,
  planProgress,
  sumHours,
  weekOf,
  withoutEstimate,
} from './hours'
import type { Task, WeeklyHours } from './types'

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

const CAPACITY: WeeklyHours = { normal: 15 }

describe('estimatedHours', () => {
  it('reads plain hours', () => {
    expect(estimatedHours(task('a', { duration: '~10h' }))).toBe(10)
  })

  it('reads a decimal', () => {
    expect(estimatedHours(task('a', { duration: '~1.5h' }))).toBe(1.5)
  })

  it('reads a range as its midpoint', () => {
    expect(estimatedHours(task('a', { duration: '~2.5-3h' }))).toBe(2.75)
  })

  it('converts minutes', () => {
    expect(estimatedHours(task('a', { duration: '~45 min' }))).toBe(0.75)
  })

  it('ignores what follows the hours', () => {
    expect(estimatedHours(task('a', { duration: '~25h, 7 videos' }))).toBe(25)
  })

  it('is null when the text carries no hours', () => {
    expect(estimatedHours(task('a', { duration: '7 videos' }))).toBeNull()
    expect(estimatedHours(task('a', { duration: 'complete' }))).toBeNull()
    expect(estimatedHours(task('a', { duration: '' }))).toBeNull()
  })

  it('is null and not zero, so a missing estimate is distinguishable', () => {
    const missing = task('a')

    expect(estimatedHours(missing)).not.toBe(0)
    expect(estimatedHours(missing)).toBeNull()
  })
})

describe('sumHours and withoutEstimate', () => {
  const tasks = [
    task('a', { duration: '~10h' }),
    task('b', { duration: '~30 min' }),
    task('c'),
    task('d', { duration: 'complete' }),
  ]

  it('adds what is estimated', () => {
    expect(sumHours(tasks)).toBe(10.5)
  })

  it('counts what the sum leaves out', () => {
    expect(withoutEstimate(tasks)).toBe(2)
  })

  it('is zero on an empty list', () => {
    expect(sumHours([])).toBe(0)
  })
})

describe('weekOf', () => {
  it('spans Monday to Sunday with the normal capacity', () => {
    expect(weekOf('2030-02-06', CAPACITY)).toEqual({
      from: '2030-02-04',
      to: '2030-02-10',
      hours: 15,
    })
  })

  it('uses the same capacity in the last week of a month', () => {
    expect(weekOf('2030-04-30', CAPACITY).hours).toBe(15)
  })
})

describe('inWeek', () => {
  const week = weekOf('2030-02-06', CAPACITY)

  it('includes a task that merely overlaps the week', () => {
    const spanning = task('long', {
      projectedStartDate: '2030-01-28',
      projectedEndDate: '2030-02-20',
    })

    expect(inWeek([spanning], week).map((entry) => entry.id)).toEqual(['long'])
  })

  it('excludes a task that ends before the week starts', () => {
    const before = task('before', {
      projectedStartDate: '2030-01-21',
      projectedEndDate: '2030-02-03',
    })

    expect(inWeek([before], week)).toEqual([])
  })

  it('excludes a task that starts after the week ends', () => {
    const after = task('after', {
      projectedStartDate: '2030-02-11',
      projectedEndDate: '2030-02-15',
    })

    expect(inWeek([after], week)).toEqual([])
  })
})

describe('daysLeftInWeek', () => {
  const week = weekOf('2030-02-06', CAPACITY)

  it('counts today as still available', () => {
    expect(daysLeftInWeek(week, '2030-02-10')).toBe(1)
  })

  it('is the whole week before it starts', () => {
    expect(daysLeftInWeek(week, '2030-01-30')).toBe(7)
  })

  it('is nothing once the week is over', () => {
    expect(daysLeftInWeek(week, '2030-02-11')).toBe(0)
  })

  it('counts from Monday', () => {
    expect(daysLeftInWeek(week, '2030-02-04')).toBe(7)
  })
})

describe('hoursInWeek', () => {
  const week = weekOf('2030-02-06', CAPACITY)

  it('counts only the share of a multi-week task that falls in the week', () => {
    // 2030-01-28 to 2030-02-24 is 28 days, and 7 of them are this week.
    const long = task('long', {
      duration: '~28h',
      projectedStartDate: '2030-01-28',
      projectedEndDate: '2030-02-24',
    })

    expect(hoursInWeek([long], week, [])).toBeCloseTo(7)
  })

  it('counts all of a task that fits inside the week', () => {
    const inside = task('inside', {
      duration: '~6h',
      projectedStartDate: '2030-02-05',
      projectedEndDate: '2030-02-08',
    })

    expect(hoursInWeek([inside], week, [])).toBeCloseTo(6)
  })

  it('ignores a task outside the week', () => {
    const outside = task('outside', {
      duration: '~10h',
      projectedStartDate: '2030-02-11',
      projectedEndDate: '2030-02-15',
    })

    expect(hoursInWeek([outside], week, [])).toBe(0)
  })

  it('ignores a task with no estimate', () => {
    const vague = task('vague', {
      projectedStartDate: '2030-02-05',
      projectedEndDate: '2030-02-08',
    })

    expect(hoursInWeek([vague], week, [])).toBe(0)
  })

  it('skips the non-study days inside the week', () => {
    // The whole of this week is a blackout, so none of the task lands in it.
    const blackouts = [{ from: '2030-02-04', to: '2030-02-10', reason: 'Break' }]
    const spanning = task('spanning', {
      duration: '~10h',
      projectedStartDate: '2030-02-01',
      projectedEndDate: '2030-02-15',
    })

    expect(hoursInWeek([spanning], week, blackouts)).toBe(0)
  })

  it('never counts more than the task estimates', () => {
    const exact = task('exact', {
      duration: '~9h',
      projectedStartDate: '2030-02-04',
      projectedEndDate: '2030-02-10',
    })

    expect(hoursInWeek([exact], week, [])).toBeCloseTo(9)
  })
})

describe('hoursByWeek', () => {
  it('spreads a task over the weeks it touches, keyed by Monday', () => {
    // Thursday to the next Wednesday: 4 days in the first week, 3 in the second.
    const across = task('across', {
      duration: '~7h',
      projectedStartDate: '2030-02-07',
      projectedEndDate: '2030-02-13',
    })

    expect([...hoursByWeek([across], [])]).toEqual([
      ['2030-02-04', 4],
      ['2030-02-11', 3],
    ])
  })

  it('agrees with hoursInWeek for every week', () => {
    const blackouts = [{ from: '2030-02-12', to: '2030-02-18', reason: 'Break' }]
    const spanning = (id: string, duration: string, from: string, to: string) =>
      task(id, { duration, projectedStartDate: from, projectedEndDate: to })
    const tasks = [
      spanning('long', '~28h', '2030-01-28', '2030-02-24'),
      spanning('short', '~2.5-3h', '2030-02-05', '2030-02-06'),
      spanning('paused', '~10h', '2030-02-08', '2030-02-21'),
      spanning('vague', '', '2030-02-05', '2030-02-08'),
    ]
    const byWeek = hoursByWeek(tasks, blackouts)

    for (const monday of ['2030-01-28', '2030-02-04', '2030-02-11', '2030-02-18', '2030-02-25']) {
      expect(byWeek.get(monday) ?? 0).toBe(hoursInWeek(tasks, weekOf(monday, CAPACITY), blackouts))
    }
  })
})

describe('progressHours', () => {
  it('counts the hours declared on an unfinished task', () => {
    expect(progressHours(task('a', { duration: '~4h', hoursDone: 1.5 }))).toBe(1.5)
  })

  it('counts a finished task in full, whatever was declared along the way', () => {
    expect(progressHours(task('a', { duration: '~4h', hoursDone: 1, state: 'done' }))).toBe(4)
  })

  it('never counts more than the estimate', () => {
    expect(progressHours(task('a', { duration: '~4h', hoursDone: 9 }))).toBe(4)
  })

  it('counts nothing without an estimate — there is nothing to be part of', () => {
    expect(progressHours(task('a', { duration: '', hoursDone: 3 }))).toBe(0)
    expect(progressHours(task('a', { duration: '', hoursDone: 3, state: 'done' }))).toBe(0)
  })
})

describe('planProgress', () => {
  const tasks = [
    task('read', { phase: 1, duration: '~2h', baselineEndDate: '2030-02-10', state: 'done' }),
    task('build', { phase: 1, duration: '~4h', baselineEndDate: '2030-02-17' }),
    task('exam', { phase: 2, duration: '~2h', baselineEndDate: '2030-02-24' }),
    task('guess', { phase: 2, duration: '' }),
  ]

  it('counts done hours, total hours, and the hours planned to be finished before today', () => {
    const progress = planProgress(tasks, [1, 2], '2030-02-18')
    expect(progress.done).toBe(2)
    expect(progress.total).toBe(8)
    expect(progress.expected).toBe(6)
  })

  it('does not expect a task on the day it is planned to end', () => {
    expect(planProgress(tasks, [1, 2], '2030-02-17').expected).toBe(2)
  })

  it('counts hours declared on what is still in hand', () => {
    const declared = [
      tasks[0]!,
      task('build', { phase: 1, duration: '~4h', hoursDone: 3, state: 'in_progress' }),
      tasks[2]!,
      tasks[3]!,
    ]
    expect(planProgress(declared, [1, 2], '2030-02-18').done).toBe(5)
  })

  it('splits the total and the done hours by phase, in phase order', () => {
    expect(planProgress(tasks, [1, 2], '2030-02-18').phases).toEqual([
      { phase: 1, hours: 6, done: 2 },
      { phase: 2, hours: 2, done: 0 },
    ])
  })
})
