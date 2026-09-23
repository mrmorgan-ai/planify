import { describe, expect, it } from 'vitest'
import { applyEdits, type Edit, type NewItem } from '../../src/core/edits'
import { describeChanges } from '../../src/core/history'
import { seedContent } from '../../src/core/seed'
import { EXAMPLE_SEED, readSeedFile } from './load'

const example = seedContent(readSeedFile(EXAMPLE_SEED))
const describe_ = (edits: Edit[]) => describeChanges(example, applyEdits(example, edits))

const newItem: NewItem = {
  name: 'One more thing',
  type: 'Paper',
  phase: 2,
  baselineStartDate: '2030-02-25',
  baselineEndDate: '2030-02-26',
  skills: ['Something else'],
  duration: '~2h',
}

describe('describeChanges', () => {
  it('names one edited item by the name it had, with the fields that changed', () => {
    const fields = { name: 'Read it', duration: '~4h' }
    expect(describe_([{ op: 'updateItem', id: 'read-the-thing', fields }])).toBe(
      'Edited Read the thing (name, duration)',
    )
  })

  it('counts several', () => {
    expect(
      describe_([
        { op: 'updateItem', id: 'read-the-thing', fields: { duration: '~4h' } },
        { op: 'updateItem', id: 'the-next-thing', fields: { duration: '~9h' } },
      ]),
    ).toBe('Edited 2 items')
  })

  it('names an added item by its new name, and a deleted one by its old one', () => {
    expect(
      describe_([
        { op: 'createItem', item: newItem },
        { op: 'deleteItem', id: 'the-optional-thing' },
      ]),
    ).toBe('Added One more thing; Deleted Something optional')
  })

  it('names the roadmap-wide sections a change touches', () => {
    const after = structuredClone(example)
    after.roadmap.weeklyHours = { normal: 20 }
    after.roadmap.blackouts = []
    expect(describeChanges(example, after)).toBe('Changed the weekly capacity, pauses')
  })

  it('says so when the plan did not change', () => {
    expect(describeChanges(example, structuredClone(example))).toBe('No change to the plan')
  })
})
