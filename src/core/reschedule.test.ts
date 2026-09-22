import { describe, expect, it } from 'vitest'
import { lateness, needsReschedule, reschedulePlan } from './reschedule'
import { recomputeProjections } from './schedule'
import type { Blackout, Item, ScheduleOptions } from './types'

// A synthetic calendar: the real pauses are roadmap content.
const BREAK: Blackout[] = [{ from: '2030-02-18', to: '2030-02-24', reason: 'Break' }]
const OPTIONS: ScheduleOptions = { blackouts: BREAK, timeZone: 'America/New_York' }

function item(id: string, start: string, end: string, overrides: Partial<Item> = {}): Item {
  return {
    id,
    name: id,
    type: 'Course',
    phase: 1,
    skills: [],
    workItemId: null,
    baselineStartDate: start,
    baselineEndDate: end,
    projectedStartDate: start,
    projectedEndDate: end,
    dependsOn: [],
    price: '',
    link: null,
    resources: [],
    duration: '~6h',
    notes: '',
    doneWhen: '',
    state: 'pending',
    completedAt: null,
    hoursDone: 0,
    sortOrder: 0,
    ...overrides,
  }
}

/**
 * Three weeks of plan: a finished week, a week that slipped, and one ahead.
 * `loose` depends on nothing, `in-hand` is half done.
 */
function plan(): Item[] {
  return recomputeProjections(
    [
      item('done', '2030-02-04', '2030-02-06', {
        state: 'done',
        completedAt: '2030-02-06T18:00:00-05:00',
        sortOrder: 1,
      }),
      item('in-hand', '2030-02-07', '2030-02-10', {
        state: 'in_progress',
        hoursDone: 3,
        dependsOn: ['done'],
        sortOrder: 2,
      }),
      item('loose', '2030-02-08', '2030-02-09', { sortOrder: 3 }),
      item('next', '2030-02-11', '2030-02-13', { dependsOn: ['in-hand'], sortOrder: 4 }),
      item('later', '2030-02-25', '2030-02-27', { dependsOn: ['next'], sortOrder: 5 }),
    ],
    OPTIONS,
  )
}

function find(items: Item[], id: string): Item {
  const found = items.find((entry) => entry.id === id)
  if (!found) throw new Error(`No fixture item ${id}`)
  return found
}

describe('lateness', () => {
  it('is null when nothing unfinished is past its end', () => {
    expect(lateness(plan(), '2030-02-07')).toBeNull()
  })

  it('measures from the oldest late item, ignoring what is done', () => {
    const behind = lateness(plan(), '2030-02-17')

    expect(behind?.since).toBe('2030-02-09')
    expect(behind?.days).toBe(8)
    expect(behind?.items.map((entry) => entry.id)).toEqual(['loose', 'in-hand', 'next'])
  })

  it('recommends rescheduling from a full week behind, not before', () => {
    expect(needsReschedule(plan(), '2030-02-15')).toBe(false)
    expect(needsReschedule(plan(), '2030-02-16')).toBe(true)
  })
})

describe('reschedulePlan', () => {
  it('starts the earliest unfinished item on the restart date', () => {
    const result = reschedulePlan(plan(), '2030-02-14', OPTIONS)

    expect(find(result.items, 'in-hand').projectedStartDate).toBe('2030-02-14')
    expect(result.shift).toBe(7)
  })

  it('moves every unfinished item by the same study days, linked or not', () => {
    const result = reschedulePlan(plan(), '2030-02-14', OPTIONS)

    expect(find(result.items, 'loose').projectedStartDate).toBe('2030-02-15')
    // Seven study days after 02-11 steps over the break (02-18 to 02-24).
    expect(find(result.items, 'next').projectedStartDate).toBe('2030-02-25')
    expect(result.moved.sort()).toEqual(['in-hand', 'later', 'loose', 'next'])
  })

  it('keeps each item the same number of study days long', () => {
    const result = reschedulePlan(plan(), '2030-02-14', OPTIONS)

    const next = find(result.items, 'next')
    expect([next.projectedStartDate, next.projectedEndDate]).toEqual(['2030-02-25', '2030-02-27'])
  })

  it('writes the new dates as the plan, so nothing reads as slipped afterwards', () => {
    const result = reschedulePlan(plan(), '2030-02-14', OPTIONS)

    for (const entry of result.items.filter((candidate) => candidate.state !== 'done')) {
      expect(entry.baselineStartDate).toBe(entry.projectedStartDate)
      expect(entry.baselineEndDate).toBe(entry.projectedEndDate)
    }
  })

  it('leaves done items where they ended', () => {
    const result = reschedulePlan(plan(), '2030-02-14', OPTIONS)

    const done = find(result.items, 'done')
    expect([done.baselineStartDate, done.projectedEndDate]).toEqual(['2030-02-04', '2030-02-06'])
  })

  it('keeps an item in progress in progress, with its declared hours', () => {
    const result = reschedulePlan(plan(), '2030-02-14', OPTIONS)

    const inHand = find(result.items, 'in-hand')
    expect([inHand.state, inHand.hoursDone]).toEqual(['in_progress', 3])
  })

  it('restarts on the first study day when the date falls in a pause', () => {
    const result = reschedulePlan(plan(), '2030-02-20', OPTIONS)

    expect(result.restart).toBe('2030-02-25')
    expect(find(result.items, 'in-hand').projectedStartDate).toBe('2030-02-25')
  })

  it('moves an item from where it really is when a late finish already pushed it', () => {
    const pushed = recomputeProjections(
      plan().map((entry) =>
        entry.id === 'done' ? { ...entry, completedAt: '2030-02-09T18:00:00-05:00' } : entry,
      ),
      OPTIONS,
    )
    expect(find(pushed, 'in-hand').projectedStartDate).toBe('2030-02-10')

    const result = reschedulePlan(pushed, '2030-02-14', OPTIONS)

    // `loose` (02-08) is now the earliest unfinished start; in-hand keeps its
    // two-day distance from it.
    expect(find(result.items, 'loose').projectedStartDate).toBe('2030-02-14')
    expect(find(result.items, 'in-hand').projectedStartDate).toBe('2030-02-16')
  })

  it('never pulls the plan earlier', () => {
    const result = reschedulePlan(plan(), '2030-02-05', OPTIONS)

    expect(result.shift).toBe(0)
    expect(result.moved).toEqual([])
    expect(find(result.items, 'in-hand').projectedStartDate).toBe('2030-02-07')
  })

  it('moves nothing when everything is done', () => {
    const finished = plan().map((entry) => ({
      ...entry,
      state: 'done' as const,
      completedAt: entry.completedAt ?? '2030-02-06T18:00:00-05:00',
    }))

    expect(reschedulePlan(finished, '2030-03-01', OPTIONS).shift).toBe(0)
  })
})
