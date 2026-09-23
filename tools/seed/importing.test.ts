import { describe, expect, it } from 'vitest'
import { importChanges, importedContent } from '../../src/core/importing'
import { recomputeProjections } from '../../src/core/schedule'
import { seedContent, toSeedFile } from '../../src/core/seed'
import type { Item, RoadmapContent } from '../../src/core/types'
import { validate } from '../../src/core/validate'
import { EXAMPLE_SEED, readSeedFile } from './load'

/** The example a little way in: one item finished, one started. */
function underway(): RoadmapContent {
  const content = seedContent(readSeedFile(EXAMPLE_SEED))
  const items: Item[] = content.items.map((item) => {
    if (item.id === 'read-the-thing') {
      return { ...item, state: 'done', completedAt: '2030-01-09T10:00:00Z', hoursDone: 3 }
    }
    if (item.id === 'course-part-1') return { ...item, state: 'in_progress', hoursDone: 2 }
    return item
  })
  const options = { blackouts: content.roadmap.blackouts, timeZone: content.roadmap.timeZone }
  return { ...content, items: recomputeProjections(items, options) }
}

const byId = (content: RoadmapContent, id: string) => content.items.find((item) => item.id === id)

describe('importedContent', () => {
  it('gives back the same roadmap, progress included, when the file is its own export', () => {
    const current = underway()
    const after = importedContent(current, toSeedFile(current))
    expect(after).toEqual(current)
    expect(importChanges(current, after)).toEqual({
      items: { added: [], removed: [], changed: [] },
      workItems: { added: [], removed: [], changed: [] },
      settings: [],
    })
  })

  it('keeps the progress of items the file keeps, and starts new ones pending', () => {
    const current = underway()
    const file = toSeedFile(current)
    file.items.push({ ...file.items.at(-1)!, id: 'one-more-thing', sortOrder: 99 })

    const after = importedContent(current, file)
    expect(byId(after, 'read-the-thing')).toMatchObject({ state: 'done', hoursDone: 3 })
    expect(byId(after, 'course-part-1')).toMatchObject({ state: 'in_progress', hoursDone: 2 })
    expect(byId(after, 'one-more-thing')).toMatchObject({
      state: 'pending',
      completedAt: null,
      hoursDone: 0,
    })
  })

  it('takes the planned dates from the file and projects from them', () => {
    const current = underway()
    const file = toSeedFile(current)
    const moved = file.items.find((item) => item.id === 'the-optional-thing')!
    moved.baselineStartDate = '2030-02-19'
    moved.baselineEndDate = '2030-02-25'

    expect(byId(importedContent(current, file), 'the-optional-thing')).toMatchObject({
      baselineStartDate: '2030-02-19',
      projectedStartDate: '2030-02-19',
      projectedEndDate: '2030-02-25',
    })
  })
})

describe('importChanges', () => {
  it('lists what is added, what is removed with its progress, and what is edited', () => {
    const current = underway()
    const file = toSeedFile(current)
    file.items = file.items.filter((item) => item.id !== 'read-the-thing')
    file.items.push({ ...file.items.at(-1)!, id: 'one-more-thing', sortOrder: 99 })
    const edited = file.items.find((item) => item.id === 'course-part-2')!
    edited.name = 'Renamed'
    edited.duration = '~8h'
    file.workItems = file.workItems.filter((workItem) => workItem.id !== 'practice-phase-1')
    file.weeklyHours = { normal: 20 }
    file.blackouts = []

    const changes = importChanges(current, importedContent(current, file))
    expect(changes.items).toEqual({
      added: ['one-more-thing'],
      removed: [{ id: 'read-the-thing', name: 'Read the thing', state: 'done', hoursDone: 3 }],
      changed: [{ id: 'course-part-2', fields: ['name', 'duration'] }],
    })
    expect(changes.workItems).toEqual({ added: [], removed: ['practice-phase-1'], changed: [] })
    expect(changes.settings).toEqual(['weeklyHours', 'blackouts'])
  })
})

describe('a file the engine cannot place', () => {
  it('still previews, and the validator says what is wrong', () => {
    const current = underway()
    const file = toSeedFile(current)
    file.items.find((item) => item.id === 'course-part-1')!.dependsOn = ['course-part-2']

    const after = importedContent(current, file)
    expect(importChanges(current, after).items.changed).toEqual([
      { id: 'course-part-1', fields: ['dependsOn'] },
    ])
    expect(validate(after).map((issue) => issue.rule)).toContain('cycle')
  })
})
