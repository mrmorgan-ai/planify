import { describe, expect, it } from 'vitest'
import { parseSeed, seedContent } from '../../src/core/seed'
import { isFormatV1, upgradeV1 } from '../../src/core/upgrade'
import { validate } from '../../src/core/validate'
import { readV1, v1WithEveryCase } from './fixtures/v1'

describe('isFormatV1', () => {
  it('knows a file of the first format by its items', () => {
    expect(isFormatV1(readV1())).toBe(true)
  })

  it('leaves a file of the current format alone, and anything that is not a roadmap', () => {
    expect(isFormatV1(upgradeV1(readV1()))).toBe(false)
    expect(isFormatV1({ items: [], format: 2 })).toBe(false)
    expect(isFormatV1(null)).toBe(false)
    expect(isFormatV1([])).toBe(false)
  })
})

describe('upgradeV1', () => {
  const v1 = v1WithEveryCase()
  const v2 = parseSeed(upgradeV1(v1))
  const story = (id: string) => v2.stories.find((each) => each.id === id)
  const task = (id: string) => v2.tasks.find((each) => each.id === id)

  it('keeps every item as one task with the same id, so dependencies still resolve', () => {
    expect(v2.tasks.map((each) => each.id)).toEqual(v1.items.map((each) => each.id))
    const ids = new Set(v2.tasks.map((each) => each.id))
    for (const each of v2.tasks) {
      for (const dependency of each.dependsOn) expect(ids.has(dependency), dependency).toBe(true)
    }
    for (const phase of v2.phases) {
      if (phase.closingMilestoneId !== null) expect(ids.has(phase.closingMilestoneId)).toBe(true)
    }
  })

  it('puts every task in a story that exists, in the phase its item was in', () => {
    const phaseOf = new Map(v2.stories.map((each) => [each.id, each.phase]))
    const content = seedContent(v2)
    for (const before of v1.items) {
      const after = content.tasks.find((each) => each.id === before.id)!
      expect(phaseOf.has(after.storyId), after.storyId).toBe(true)
      expect(after.phase, String(before.id)).toBe(before.phase)
    }
  })

  it('makes a work item in one phase a story with its id, its links and its parts’ price', () => {
    expect(story('the-exam')).toEqual({
      id: 'the-exam',
      name: 'The exam that closes phase 1',
      type: 'Certification',
      phase: 1,
      featureId: null,
      link: 'https://example.com/exam',
      resources: [],
      price: '$100 USD · 90 min',
      notes: 'The preparation and the sitting, as one unit.',
      doneWhen: '',
    })
    expect(task('exam-prep')?.storyId).toBe('the-exam')
  })

  it('makes a work item across phases a feature, with a story in each phase', () => {
    expect(v2.features).toEqual([
      {
        id: 'the-book',
        name: 'The book',
        type: 'Book',
        link: 'https://example.com/book',
        notes: 'Read across the plan.',
      },
    ])
    expect(story('the-book-p1')).toMatchObject({
      name: 'The book — phase 1',
      phase: 1,
      featureId: 'the-book',
      link: 'https://example.com/book',
      resources: [{ label: 'Errata', url: 'https://example.com/errata' }],
      price: '',
    })
    expect(story('the-book-p2')).toMatchObject({ phase: 2, featureId: 'the-book', price: '$10' })
    expect([task('chapter-1')?.storyId, task('chapter-2')?.storyId]).toEqual(['the-book-p1', 'the-book-p2'])
  })

  it('makes a work item with no parts a story in the first phase', () => {
    expect(story('someday')).toMatchObject({ name: 'Someday', type: 'Paper', phase: 1 })
  })

  it('gives an item on its own a story of its own, which takes its links and price', () => {
    expect(story('the-next-thing-story')).toMatchObject({
      name: 'Something in the next phase',
      type: 'Course',
      phase: 2,
      link: 'https://example.com/next',
      price: 'Free',
    })
    expect(task('the-next-thing')).toMatchObject({
      storyId: 'the-next-thing-story',
      link: null,
      resources: [],
    })
  })

  it('treats an item whose work item is missing as an item on its own', () => {
    const file = readV1()
    file.items[1]!.workItemId = 'no-such-thing'
    const upgraded = parseSeed(upgradeV1(file))
    expect(upgraded.tasks[1]?.storyId).toBe(`${String(file.items[1]!.id)}-story`)
  })

  it('turns the example into a plan that breaks no rule, notes aside', () => {
    const content = seedContent(parseSeed(upgradeV1(readV1())))
    expect(validate(content).filter((issue) => issue.severity !== 'info')).toEqual([])
  })

  it('is what parseSeed does with a file of the first format', () => {
    expect(parseSeed(readV1())).toEqual(parseSeed(upgradeV1(readV1())))
  })
})
