import { describe, expect, it } from 'vitest'
import { EditError, applyEdits, parseEdits, slugOf, type Edit, type NewItem } from '../../src/core/edits'
import { recomputeProjections } from '../../src/core/schedule'
import { seedContent } from '../../src/core/seed'
import type { Item, RoadmapContent } from '../../src/core/types'
import { validate } from '../../src/core/validate'
import { EXAMPLE_SEED, readSeedFile } from './load'

const example = seedContent(readSeedFile(EXAMPLE_SEED))

/** The example with one item finished, so progress has something to lose. */
function underway(): RoadmapContent {
  const items = example.items.map((item): Item =>
    item.id === 'read-the-thing'
      ? { ...item, state: 'done', completedAt: '2030-01-09T10:00:00Z', hoursDone: 3 }
      : item,
  )
  const options = { blackouts: example.roadmap.blackouts, timeZone: example.roadmap.timeZone }
  return { ...example, items: recomputeProjections(items, options) }
}

const apply = (edits: Edit[], content = underway()) => applyEdits(content, edits)
const item = (content: RoadmapContent, id: string) => content.items.find((each) => each.id === id)

const newItem: NewItem = {
  name: 'One more thing',
  type: 'Paper',
  phase: 2,
  baselineStartDate: '2030-02-25',
  baselineEndDate: '2030-02-26',
  skills: ['Something else'],
  duration: '~2h',
}

describe('parseEdits', () => {
  it.each([
    ['nothing', undefined, /non-empty array/],
    ['an empty list', [], /non-empty array/],
    ['an unknown operation', [{ op: 'renameEverything' }], /not an edit this roadmap knows/],
    ['a phase change', [{ op: 'updateItem', id: 'x', fields: { phase: 2 } }], /phase cannot be edited/],
    ['a date change', [{ op: 'updateItem', id: 'x', fields: { baselineStartDate: '2030-01-01' } }], /cannot be edited/],
    ['an id change', [{ op: 'updateItem', id: 'x', fields: { id: 'y' } }], /id cannot be edited/],
    ['dependencies that are not strings', [{ op: 'setDependencies', id: 'x', dependsOn: [1] }], /array of strings/],
  ])('refuses %s', (_, raw, message) => {
    expect(() => parseEdits(raw)).toThrow(message)
  })
})

describe('updateItem', () => {
  it('changes the fields asked for and nothing else', () => {
    const after = apply([
      { op: 'updateItem', id: 'read-the-thing', fields: { name: 'Read it again', duration: '~5h' } },
    ])
    expect(item(after, 'read-the-thing')).toEqual({
      ...item(underway(), 'read-the-thing'),
      name: 'Read it again',
      duration: '~5h',
    })
    expect(validate(after)).toEqual([])
  })

  it.each([
    ['an empty name', { name: '' }, /name must not be empty/],
    ['an unknown type', { type: 'Podcast' }, /type is not valid/],
    ['an empty link', { link: '' }, /use null/],
    ['a resource with no url', { resources: [{ label: 'Code' }] }, /url must be a string/],
    ['no skills', { skills: [] }, /skills must not be empty/],
  ])('refuses %s with the seed file’s own message', (_, fields, message) => {
    const edit = { op: 'updateItem', id: 'read-the-thing', fields } as Edit
    expect(() => apply([edit])).toThrow(EditError)
    expect(() => apply([edit])).toThrow(message)
  })

  it('refuses an item that does not exist', () => {
    expect(() => apply([{ op: 'updateItem', id: 'nope', fields: { name: 'x' } }])).toThrow(
      /No item with id nope/,
    )
  })
})

describe('setDependencies', () => {
  it('moves the projection when the new dependency ends later', () => {
    // Exam prep is planned from Feb 4; build part 2 ends Feb 6.
    const after = apply([{ op: 'setDependencies', id: 'exam-prep', dependsOn: ['build-part-2'] }])
    expect(item(after, 'exam-prep')).toMatchObject({
      dependsOn: ['build-part-2'],
      baselineStartDate: '2030-02-04',
      projectedStartDate: '2030-02-07',
    })
  })

  it('lets a cycle through to the validator, which names it', () => {
    const after = apply([
      { op: 'setDependencies', id: 'course-part-1', dependsOn: ['course-part-2'] },
    ])
    expect(validate(after).map((issue) => issue.rule)).toContain('cycle')
  })
})

describe('createItem', () => {
  it('derives the id from the name and puts it last in its phase, pending', () => {
    const after = apply([{ op: 'createItem', item: newItem }])
    const created = item(after, 'one-more-thing')
    expect(created).toMatchObject({
      phase: 2,
      sortOrder: Math.max(...example.items.filter((each) => each.phase === 2).map((each) => each.sortOrder)) + 1,
      state: 'pending',
      hoursDone: 0,
      completedAt: null,
      dependsOn: [],
      projectedStartDate: '2030-02-25',
    })
  })

  it('never reuses an id, of an item or of a work item', () => {
    const after = apply([
      { op: 'createItem', item: { ...newItem, name: 'Read the thing' } },
      { op: 'createItem', item: { ...newItem, name: 'The course' } },
    ])
    expect(after.items.slice(-2).map((each) => each.id)).toEqual(['read-the-thing-2', 'the-course-2'])
  })

  it('refuses an id that is asked for and already taken', () => {
    expect(() => apply([{ op: 'createItem', item: { ...newItem, id: 'the-next-thing' } }])).toThrow(
      /already taken/,
    )
  })

  it('can be depended on by a later edit in the same list', () => {
    const after = apply([
      { op: 'createItem', item: newItem },
      { op: 'setDependencies', id: 'the-optional-thing', dependsOn: ['the-next-thing', 'one-more-thing'] },
    ])
    expect(validate(after).filter((issue) => issue.severity === 'error')).toEqual([])
  })
})

describe('deleteItem', () => {
  it('refuses to delete what others depend on, naming them', () => {
    expect(() => apply([{ op: 'deleteItem', id: 'the-next-thing' }])).toThrow(
      new RegExp(`needed by ${item(example, 'the-optional-thing')!.name}`),
    )
  })

  it('connects the dependents to what it depended on, when asked', () => {
    const after = apply([{ op: 'deleteItem', id: 'the-next-thing', rewire: true }])
    expect(item(after, 'the-next-thing')).toBeUndefined()
    expect(item(after, 'the-optional-thing')?.dependsOn).toEqual(['phase-1-exam'])
  })

  it('refuses to delete a closing milestone', () => {
    expect(() => apply([{ op: 'deleteItem', id: 'phase-1-exam', rewire: true }])).toThrow(
      /closes phase 1/,
    )
  })

  it('refuses to throw away progress unless told to', () => {
    const edit: Edit = { op: 'deleteItem', id: 'read-the-thing', rewire: true }
    expect(() => apply([edit])).toThrow(/has progress/)
    const after = apply([{ ...edit, discardProgress: true }])
    expect(item(after, 'read-the-thing')).toBeUndefined()
    expect(item(after, 'build-part-1')?.dependsOn).toEqual([])
  })
})

describe('slugOf', () => {
  it.each([
    ['Build part 2 — the API', 'build-part-2-the-api'],
    ['Économie & Café', 'economie-cafe'],
    ['   ', 'item'],
  ])('%s → %s', (name, slug) => {
    expect(slugOf(name)).toBe(slug)
  })
})
