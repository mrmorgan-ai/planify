import { describe, expect, it } from 'vitest'
import type { Item, WorkItem } from './types'
import { linksOf, partLabel, partsOf, unitHours, unitPhases, unitState, unitsOf } from './workItems'

function item(id: string, overrides: Partial<Item> = {}): Item {
  return {
    id,
    name: id,
    type: 'Course',
    phase: 1,
    skills: [],
    workItemId: null,
    baselineStartDate: '2030-02-04',
    baselineEndDate: '2030-02-10',
    projectedStartDate: '2030-02-04',
    projectedEndDate: '2030-02-10',
    dependsOn: [],
    price: '',
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

const course: WorkItem = {
  id: 'course',
  name: 'The course',
  type: 'Course',
  link: 'https://example.com/course',
  resources: [{ label: 'Code', url: 'https://example.com/code' }],
  notes: '',
}

describe('partsOf and partLabel', () => {
  // Deliberately out of order, and across two phases, the way a book read in
  // pieces over the plan is.
  const items = [
    item('late', { workItemId: 'course', phase: 2, sortOrder: 1 }),
    item('early', { workItemId: 'course', phase: 1, sortOrder: 5 }),
    item('alone', { sortOrder: 2 }),
  ]

  it('orders the parts by phase, then by the curated order', () => {
    expect(partsOf('course', items).map((part) => part.id)).toEqual(['early', 'late'])
  })

  it('numbers a part within its work item', () => {
    const label = partLabel(items[0]!, [course], items)
    expect(label).toEqual({ workItem: course, index: 2, total: 2 })
  })

  it('gives a standalone item no label', () => {
    expect(partLabel(items[2]!, [course], items)).toBeNull()
  })
})

describe('unitState', () => {
  it('is pending while nothing has moved', () => {
    expect(unitState([item('a'), item('b')])).toBe('pending')
  })

  it('is in progress as soon as any part is done, even with the rest untouched', () => {
    expect(unitState([item('a', { state: 'done' }), item('b')])).toBe('in_progress')
  })

  it('is done only when every part is', () => {
    expect(unitState([item('a', { state: 'done' }), item('b', { state: 'done' })])).toBe('done')
  })
})

describe('unitHours', () => {
  it('sums the estimates, counts what is done, and reports what carries none', () => {
    const hours = unitHours([
      item('a', { duration: '~4h', state: 'done' }),
      item('b', { duration: '~2.5h' }),
      item('c'),
    ])
    expect(hours).toEqual({ total: 6.5, done: 4, unestimated: 1 })
  })
})

describe('unitPhases', () => {
  it('lists each phase once, ascending', () => {
    expect(unitPhases([item('a', { phase: 4 }), item('b', { phase: 1 }), item('c', { phase: 4 })]))
      .toEqual([1, 4])
  })
})

describe('unitsOf', () => {
  it('places every item in exactly one unit, standalone ones as units of one', () => {
    const items = [
      item('part-2', { workItemId: 'course', sortOrder: 3 }),
      item('paper', { type: 'Paper', sortOrder: 2 }),
      item('part-1', { workItemId: 'course', sortOrder: 1 }),
    ]
    const units = unitsOf(items, [course])

    expect(units.map((unit) => unit.id)).toEqual(['course', 'paper'])
    expect(units[0]?.parts.map((part) => part.id)).toEqual(['part-1', 'part-2'])
    expect(units[0]?.standalone).toBe(false)
    expect(units[1]?.standalone).toBe(true)
    expect(units.flatMap((unit) => unit.parts)).toHaveLength(items.length)
  })

  it('keeps an item whose work item is missing, rather than dropping it', () => {
    const units = unitsOf([item('orphan', { workItemId: 'gone' })], [])
    expect(units).toHaveLength(1)
    expect(units[0]?.standalone).toBe(true)
  })
})

describe('linksOf', () => {
  it('uses the part’s own links when it has any', () => {
    const part = item('ch-3', { workItemId: 'course', link: 'https://example.com/ch3' })
    expect(linksOf(part, [course])).toEqual({ link: 'https://example.com/ch3', resources: [] })
  })

  it('falls back to the work item’s links when the part has none', () => {
    const part = item('ep-1', { workItemId: 'course' })
    expect(linksOf(part, [course])).toEqual({ link: course.link, resources: course.resources })
  })
})
