import { describe, expect, it } from 'vitest'
import {
  applyBaselineDates,
  applyHoursDone,
  applyStateChange,
  recomputeProjections,
  topologicalOrder,
} from './schedule'
import type { Blackout, Task, ScheduleOptions } from './types'

// A synthetic calendar and timezone: the real ones are roadmap content and live
// in the database.
const BREAK: Blackout[] = [{ from: '2030-01-15', to: '2030-01-28', reason: 'Break' }]
const OPTIONS: ScheduleOptions = { blackouts: BREAK, timeZone: 'America/New_York' }

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
    sortOrder: 0,
    ...overrides,
  }
}

/** Four one-week tasks in a straight chain, on consecutive weeks. */
function chain(): Task[] {
  return [
    task('a', { baselineStartDate: '2030-02-04', baselineEndDate: '2030-02-10', sortOrder: 1 }),
    task('b', {
      baselineStartDate: '2030-02-11',
      baselineEndDate: '2030-02-17',
      dependsOn: ['a'],
      sortOrder: 2,
    }),
    task('c', {
      baselineStartDate: '2030-02-18',
      baselineEndDate: '2030-02-24',
      dependsOn: ['b'],
      sortOrder: 3,
    }),
    task('d', {
      baselineStartDate: '2030-02-25',
      baselineEndDate: '2030-03-03',
      dependsOn: ['c'],
      sortOrder: 4,
    }),
  ]
}

function find(tasks: Task[], id: string): Task {
  const found = tasks.find((candidate) => candidate.id === id)
  if (!found) throw new Error(`No fixture task ${id}`)
  return found
}

describe('untouched plan', () => {
  it('projects every task onto its own baseline', () => {
    for (const projected of recomputeProjections(chain(), OPTIONS)) {
      expect(projected.projectedStartDate).toBe(projected.baselineStartDate)
      expect(projected.projectedEndDate).toBe(projected.baselineEndDate)
    }
  })

  it('is idempotent', () => {
    const once = recomputeProjections(chain(), OPTIONS)
    expect(recomputeProjections(once, OPTIONS)).toEqual(once)
  })
})

describe('a chain of four tasks', () => {
  const result = applyStateChange(chain(), 'a', 'done', '2030-02-17T18:00:00-05:00', OPTIONS)

  it('freezes the completed task on its real date', () => {
    expect(find(result, 'a').projectedEndDate).toBe('2030-02-17')
  })

  it('starts the next task the day after, never the same day', () => {
    expect(find(result, 'b').projectedStartDate).toBe('2030-02-18')
  })

  it('drags the whole chain by the same week', () => {
    expect(find(result, 'b').projectedEndDate).toBe('2030-02-24')
    expect(find(result, 'c').projectedStartDate).toBe('2030-02-25')
    expect(find(result, 'd').projectedEndDate).toBe('2030-03-10')
  })

  it('preserves each planned duration instead of stretching it', () => {
    for (const projected of result) {
      if (projected.state === 'done') continue
      const days =
        (new Date(projected.projectedEndDate).getTime() -
          new Date(projected.projectedStartDate).getTime()) /
        86_400_000
      expect(days).toBe(6)
    }
  })
})

describe('a closing milestone with five predecessors', () => {
  const tasks = [
    ...['p1', 'p2', 'p3', 'p4', 'p5'].map((id, index) =>
      task(id, {
        baselineStartDate: '2030-02-04',
        baselineEndDate: '2030-02-10',
        sortOrder: index + 1,
      }),
    ),
    task('milestone', {
      baselineStartDate: '2030-02-11',
      baselineEndDate: '2030-02-17',
      dependsOn: ['p1', 'p2', 'p3', 'p4', 'p5'],
      sortOrder: 6,
    }),
  ]

  it('waits for the latest predecessor, not the first', () => {
    const result = applyStateChange(tasks, 'p3', 'done', '2030-02-19T12:00:00-05:00', OPTIONS)
    expect(find(result, 'milestone').projectedStartDate).toBe('2030-02-20')
    expect(find(result, 'milestone').projectedEndDate).toBe('2030-02-26')
  })

  it('does not move when a predecessor lands on time', () => {
    const result = applyStateChange(tasks, 'p3', 'done', '2030-02-10T12:00:00-05:00', OPTIONS)
    expect(find(result, 'milestone').projectedStartDate).toBe('2030-02-11')
  })
})

describe('completing out of order', () => {
  it('freezes a task completed before its own window, and never moves it again', () => {
    const early = applyStateChange(chain(), 'c', 'done', '2030-02-05T12:00:00-05:00', OPTIONS)
    expect(find(early, 'c').projectedEndDate).toBe('2030-02-05')
    // The bar cannot end before it starts — the schema's CHECK relies on this.
    expect(find(early, 'c').projectedStartDate).toBe('2030-02-05')

    const thenLate = applyStateChange(early, 'a', 'done', '2030-02-17T18:00:00-05:00', OPTIONS)
    expect(find(thenLate, 'c').projectedEndDate).toBe('2030-02-05')
    expect(find(thenLate, 'b').projectedEndDate).toBe('2030-02-24')
  })

  it('passes propagation through a completed task using its real date', () => {
    const tasks = chain().map((candidate) =>
      candidate.id === 'c'
        ? { ...candidate, state: 'done' as const, completedAt: '2030-03-10T12:00:00-05:00' }
        : candidate,
    )
    const result = recomputeProjections(tasks, OPTIONS)
    expect(find(result, 'c').projectedEndDate).toBe('2030-03-10')
    expect(find(result, 'd').projectedStartDate).toBe('2030-03-11')
  })
})

describe('finishing early', () => {
  it('does not pull the rest of the plan forward', () => {
    const result = applyStateChange(chain(), 'a', 'done', '2030-02-06T12:00:00-05:00', OPTIONS)
    expect(find(result, 'b').projectedStartDate).toBe('2030-02-11')
    expect(find(result, 'd').projectedEndDate).toBe('2030-03-03')
  })
})

describe('blackout periods', () => {
  const tasks = [
    task('x', { baselineStartDate: '2030-01-01', baselineEndDate: '2030-01-07', sortOrder: 1 }),
    task('y', {
      baselineStartDate: '2030-01-08',
      baselineEndDate: '2030-01-14',
      dependsOn: ['x'],
      sortOrder: 2,
    }),
    task('z', {
      baselineStartDate: '2030-01-29',
      baselineEndDate: '2030-02-04',
      dependsOn: ['y'],
      sortOrder: 3,
    }),
  ]

  it('pushes a start that lands inside a blackout to the first day after it', () => {
    const result = applyStateChange(tasks, 'x', 'done', '2030-01-14T12:00:00-05:00', OPTIONS)
    expect(find(result, 'y').projectedStartDate).toBe('2030-01-29')
    expect(find(result, 'y').projectedEndDate).toBe('2030-02-04')
  })

  it('lets a span straddle a blackout without spending duration inside it', () => {
    const result = applyStateChange(tasks, 'x', 'done', '2030-01-11T12:00:00-05:00', OPTIONS)
    expect(find(result, 'y').projectedStartDate).toBe('2030-01-12')
    // 3 study days before the break, the remaining 4 after it.
    expect(find(result, 'y').projectedEndDate).toBe('2030-02-01')
    expect(find(result, 'z').projectedStartDate).toBe('2030-02-02')
  })
})

describe('un-completing a task', () => {
  it('releases the chain and clears the completion date', () => {
    const done = applyStateChange(chain(), 'a', 'done', '2030-02-17T18:00:00-05:00', OPTIONS)
    expect(find(done, 'b').projectedStartDate).toBe('2030-02-18')

    const undone = applyStateChange(done, 'a', 'pending', '2030-02-18T10:00:00-05:00', OPTIONS)
    expect(find(undone, 'a').completedAt).toBeNull()
    expect(find(undone, 'a').projectedEndDate).toBe('2030-02-10')
    expect(find(undone, 'b').projectedStartDate).toBe('2030-02-11')
  })

  it('keeps the original date when a task is marked done twice', () => {
    const first = applyStateChange(chain(), 'a', 'done', '2030-02-17T18:00:00-05:00', OPTIONS)
    const again = applyStateChange(first, 'a', 'done', '2030-02-25T09:00:00-05:00', OPTIONS)
    expect(find(again, 'a').completedAt).toBe('2030-02-17T18:00:00-05:00')
  })
})

describe('graph validation', () => {
  it('refuses a cycle instead of looping forever', () => {
    const tasks = [task('a', { dependsOn: ['b'] }), task('b', { dependsOn: ['a'] })]
    expect(() => recomputeProjections(tasks, OPTIONS)).toThrow(/cycle/i)
  })

  it('refuses a dependency that does not exist', () => {
    expect(() => topologicalOrder([task('a', { dependsOn: ['ghost'] })])).toThrow(/ghost/)
  })

  it('orders dependencies before dependents', () => {
    const ordered = topologicalOrder(chain().slice().reverse()).map((candidate) => candidate.id)
    expect(ordered).toEqual(['a', 'b', 'c', 'd'])
  })
})

describe('applyBaselineDates', () => {
  // Dates deliberately before the fixture's break (2030-01-15 to 01-28), so
  // these cases measure the handoff and nothing else. The break has its own
  // case at the end.
  const chain = [
    task('first', { baselineStartDate: '2030-01-07', baselineEndDate: '2030-01-08', sortOrder: 1 }),
    task('second', {
      baselineStartDate: '2030-01-09',
      baselineEndDate: '2030-01-11',
      dependsOn: ['first'],
      sortOrder: 2,
    }),
  ]

  it('writes the new baseline on the task it names', () => {
    const after = applyBaselineDates(chain, 'first', '2030-01-07', '2030-01-10', OPTIONS)

    const first = after.find((entry) => entry.id === 'first')!
    expect([first.baselineStartDate, first.baselineEndDate]).toEqual(['2030-01-07', '2030-01-10'])
  })

  it('pushes what depends on it to the next study day', () => {
    const after = applyBaselineDates(chain, 'first', '2030-01-07', '2030-01-10', OPTIONS)

    const second = after.find((entry) => entry.id === 'second')!
    expect(second.projectedStartDate).toBe('2030-01-11')
    // A push is a change of plan: the dependent's baseline moves with it.
    expect([second.baselineStartDate, second.baselineEndDate]).toEqual([
      '2030-01-11',
      '2030-01-13',
    ])
  })

  it('moves the whole chain by the same amount, keeping the gaps between tasks', () => {
    const gapped = [
      ...chain,
      task('third', {
        baselineStartDate: '2030-01-13',
        baselineEndDate: '2030-01-14',
        dependsOn: ['second'],
        sortOrder: 3,
      }),
    ]

    const after = applyBaselineDates(gapped, 'first', '2030-01-07', '2030-01-10', OPTIONS)

    const third = after.find((entry) => entry.id === 'third')!
    // Two study days later; the one-day gap after `second` is still there, and
    // the break (01-15 to 01-28) is stepped over instead of counted.
    expect([third.baselineStartDate, third.baselineEndDate]).toEqual(['2030-01-29', '2030-01-30'])
    expect(third.projectedStartDate).toBe('2030-01-29')
  })

  it('pushes a dependent that has slack by the full amount', () => {
    const slack = [
      chain[0]!,
      task('later', {
        baselineStartDate: '2030-01-12',
        baselineEndDate: '2030-01-13',
        dependsOn: ['first'],
        sortOrder: 2,
      }),
    ]

    const after = applyBaselineDates(slack, 'first', '2030-01-07', '2030-01-09', OPTIONS)

    expect(after.find((entry) => entry.id === 'later')!.projectedStartDate).toBe('2030-01-13')
  })

  it('slides the task itself as a block when its start and end move together', () => {
    const after = applyBaselineDates(chain, 'first', '2030-01-09', '2030-01-10', OPTIONS)

    const [first, second] = after
    expect([first!.projectedStartDate, first!.projectedEndDate]).toEqual([
      '2030-01-09',
      '2030-01-10',
    ])
    expect(second!.projectedStartDate).toBe('2030-01-11')
  })

  it('pushes each follower once, however many paths reach it', () => {
    const diamond = [
      ...chain,
      task('side', {
        baselineStartDate: '2030-01-09',
        baselineEndDate: '2030-01-11',
        dependsOn: ['first'],
        sortOrder: 3,
      }),
      task('join', {
        baselineStartDate: '2030-01-12',
        baselineEndDate: '2030-01-12',
        dependsOn: ['second', 'side'],
        sortOrder: 4,
      }),
    ]

    const after = applyBaselineDates(diamond, 'first', '2030-01-07', '2030-01-09', OPTIONS)

    expect(after.find((entry) => entry.id === 'join')!.baselineStartDate).toBe('2030-01-13')
  })

  it('moves a dependent with two predecessors when either one pushes it', () => {
    const two = [
      ...chain,
      task('other', { baselineStartDate: '2030-01-07', baselineEndDate: '2030-01-08', sortOrder: 3 }),
      task('both', {
        baselineStartDate: '2030-01-12',
        baselineEndDate: '2030-01-12',
        dependsOn: ['second', 'other'],
        sortOrder: 4,
      }),
    ]

    const after = applyBaselineDates(two, 'first', '2030-01-07', '2030-01-09', OPTIONS)

    expect(after.find((entry) => entry.id === 'other')!.projectedStartDate).toBe('2030-01-07')
    expect(after.find((entry) => entry.id === 'both')!.projectedStartDate).toBe('2030-01-13')
  })

  it('does not push a task that is already done, nor pass through it', () => {
    const finished = [
      ...chain.map((entry) =>
        entry.id === 'second'
          ? { ...entry, state: 'done' as const, completedAt: '2030-01-11T12:00:00-05:00' }
          : entry,
      ),
      task('after', {
        baselineStartDate: '2030-01-12',
        baselineEndDate: '2030-01-12',
        dependsOn: ['second'],
        sortOrder: 3,
      }),
    ]

    const after = applyBaselineDates(finished, 'first', '2030-01-07', '2030-01-10', OPTIONS)

    expect(after.find((entry) => entry.id === 'second')!.baselineStartDate).toBe('2030-01-09')
    expect(after.find((entry) => entry.id === 'after')!.baselineStartDate).toBe('2030-01-12')
  })

  it('leaves a task that depends on nothing where it was', () => {
    const loose = [
      ...chain,
      task('loose', {
        baselineStartDate: '2030-01-09',
        baselineEndDate: '2030-01-10',
        sortOrder: 3,
      }),
    ]

    const after = applyBaselineDates(loose, 'first', '2030-01-07', '2030-01-10', OPTIONS)

    const untouched = after.find((entry) => entry.id === 'loose')!
    expect(untouched.projectedStartDate).toBe('2030-01-09')
  })

  it('never pulls a dependent back when the task shrinks again', () => {
    const stretched = applyBaselineDates(chain, 'first', '2030-01-07', '2030-01-10', OPTIONS)
    const shrunk = applyBaselineDates(stretched, 'first', '2030-01-07', '2030-01-08', OPTIONS)

    expect(shrunk.find((entry) => entry.id === 'second')!.projectedStartDate).toBe('2030-01-11')
  })

  it('leaves the dependents where they are when the task moves earlier', () => {
    const late = [
      task('first', { baselineStartDate: '2030-01-08', baselineEndDate: '2030-01-09', sortOrder: 1 }),
      task('second', {
        baselineStartDate: '2030-01-10',
        baselineEndDate: '2030-01-11',
        dependsOn: ['first'],
        sortOrder: 2,
      }),
    ]

    const after = applyBaselineDates(late, 'first', '2030-01-06', '2030-01-07', OPTIONS)

    expect(after.find((entry) => entry.id === 'second')!.projectedStartDate).toBe('2030-01-10')
  })

  it('hands off across a non-study period instead of into it', () => {
    const after = applyBaselineDates(chain, 'first', '2030-01-07', '2030-01-14', OPTIONS)

    expect(after.find((entry) => entry.id === 'second')!.projectedStartDate).toBe('2030-01-29')
  })

  it('refuses an end before the start', () => {
    expect(() => applyBaselineDates(chain, 'first', '2030-01-11', '2030-01-07', OPTIONS)).toThrow(
      /before start/,
    )
  })

  it('refuses an id that is not in the roadmap', () => {
    expect(() => applyBaselineDates(chain, 'ghost', '2030-01-07', '2030-01-11', OPTIONS)).toThrow(
      /No task with id/,
    )
  })
})


describe('applyHoursDone', () => {
  const tasks = [
    task('a', { duration: '~4h' }),
    task('exam', { duration: '', baselineStartDate: '2030-02-11', baselineEndDate: '2030-02-12' }),
  ]

  it('declares the hours spent', () => {
    expect(find(applyHoursDone(tasks, 'a', 2.5, OPTIONS), 'a').hoursDone).toBe(2.5)
  })

  it('leaves the state alone: progress is information, not a decision', () => {
    expect(find(applyHoursDone(tasks, 'a', 4, OPTIONS), 'a').state).toBe('pending')
  })

  it('clamps to the estimate', () => {
    expect(find(applyHoursDone(tasks, 'a', 99, OPTIONS), 'a').hoursDone).toBe(4)
  })

  it('refuses a task with no estimate', () => {
    expect(() => applyHoursDone(tasks, 'exam', 2, OPTIONS)).toThrow(/no hours estimate/)
  })

  it('refuses negative hours and an unknown id', () => {
    expect(() => applyHoursDone(tasks, 'a', -1, OPTIONS)).toThrow(/zero or more/)
    expect(() => applyHoursDone(tasks, 'nope', 1, OPTIONS)).toThrow(/No task with id/)
  })
})

describe('applyStateChange and hours', () => {
  const tasks = [task('a', { duration: '~4h' }), task('exam', { duration: '' })]

  it('fills in the hours of a task marked done', () => {
    const result = applyStateChange(tasks, 'a', 'done', '2030-02-17T18:00:00-05:00', OPTIONS)
    expect(find(result, 'a').hoursDone).toBe(4)
  })

  it('keeps declared hours when a task leaves done', () => {
    const done = applyStateChange(tasks, 'a', 'done', '2030-02-17T18:00:00-05:00', OPTIONS)
    const reopened = applyStateChange(done, 'a', 'in_progress', '2030-02-18T18:00:00-05:00', OPTIONS)
    expect(find(reopened, 'a').hoursDone).toBe(4)
  })

  it('leaves a task without an estimate at zero', () => {
    const result = applyStateChange(tasks, 'exam', 'done', '2030-02-17T18:00:00-05:00', OPTIONS)
    expect(find(result, 'exam').hoursDone).toBe(0)
  })
})

describe('applyBaselineDates keeps the parts of a story apart', () => {
  // A book read chapter by chapter, and a note that depends on chapter 2. The
  // chapters are not chained: parts rarely are, which is why this exists.
  const book = (overrides: Record<string, Partial<Task>> = {}) =>
    [
      task('ch1', { storyId: 'book', baselineStartDate: '2030-01-07', baselineEndDate: '2030-01-08', sortOrder: 1 }),
      task('ch2', { storyId: 'book', baselineStartDate: '2030-01-09', baselineEndDate: '2030-01-10', sortOrder: 2 }),
      task('ch3', { storyId: 'book', baselineStartDate: '2030-01-29', baselineEndDate: '2030-01-30', sortOrder: 3 }),
      task('notes', { baselineStartDate: '2030-01-11', baselineEndDate: '2030-01-12', dependsOn: ['ch2'], sortOrder: 4 }),
    ].map((entry) => ({ ...entry, ...overrides[entry.id] }))
  const dates = (tasks: Task[], id: string) => {
    const found = tasks.find((entry) => entry.id === id)!
    return [found.baselineStartDate, found.baselineEndDate]
  }

  it('moves the next part to the study day after a moved part now ends, with what depends on it', () => {
    const after = applyBaselineDates(book(), 'ch1', '2030-01-07', '2030-01-09', OPTIONS)

    expect(dates(after, 'ch2')).toEqual(['2030-01-10', '2030-01-11'])
    expect(dates(after, 'notes')).toEqual(['2030-01-12', '2030-01-13'])
    // Planned weeks later, with room: untouched.
    expect(dates(after, 'ch3')).toEqual(['2030-01-29', '2030-01-30'])
  })

  it('leaves a next part that still has room where it is', () => {
    const roomy = book({ ch2: { baselineStartDate: '2030-01-12', baselineEndDate: '2030-01-13' } })
    const after = applyBaselineDates(roomy, 'ch1', '2030-01-07', '2030-01-10', OPTIONS)

    expect(dates(after, 'ch2')).toEqual(['2030-01-12', '2030-01-13'])
  })

  it('carries on down the story when setting one part apart overlaps the next', () => {
    // Chapter 1 now runs to the break, so chapter 2 lands across it and into chapter 3.
    const after = applyBaselineDates(book(), 'ch1', '2030-01-07', '2030-01-13', OPTIONS)

    expect(dates(after, 'ch2')).toEqual(['2030-01-14', '2030-01-29'])
    expect(dates(after, 'ch3')).toEqual(['2030-01-30', '2030-01-31'])
    // Each part ends before the next begins.
    expect(dates(after, 'ch1')[1]! < dates(after, 'ch2')[0]!).toBe(true)
  })

  it('never moves a finished part', () => {
    const finished = book({ ch2: { state: 'done', completedAt: '2030-01-10T18:00:00-05:00' } })
    const after = applyBaselineDates(finished, 'ch1', '2030-01-07', '2030-01-09', OPTIONS)

    expect(dates(after, 'ch2')).toEqual(['2030-01-09', '2030-01-10'])
  })

  it('leaves an overlap the plan already had to the validator', () => {
    const overlapping = book({ ch2: { baselineStartDate: '2030-01-08', baselineEndDate: '2030-01-10' } })
    const after = applyBaselineDates(overlapping, 'ch3', '2030-01-29', '2030-01-31', OPTIONS)

    expect(dates(after, 'ch2')).toEqual(['2030-01-08', '2030-01-10'])
  })
})
