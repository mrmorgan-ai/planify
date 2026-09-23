import { describe, expect, it } from 'vitest'
import { applyEdits, type Edit, type NewItem } from '../../src/core/edits'
import { describeChanges, versionFileName } from '../../src/core/history'
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

describe('versionFileName', () => {
  it('stamps the time in the roadmap’s timezone, then the version’s number', () => {
    const version = { id: 5, createdAt: '2026-09-23T18:32:05.123Z' }
    expect(versionFileName(version, 'America/Lima')).toBe('roadmap-2026-09-23-1332-v5.json')
  })

  it('takes the date from the timezone too, not from UTC', () => {
    const version = { id: 12, createdAt: '2026-09-24T03:10:00Z' }
    expect(versionFileName(version, 'America/Lima')).toBe('roadmap-2026-09-23-2210-v12.json')
  })

  it('falls back to UTC for a timezone the runtime does not know', () => {
    const version = { id: 1, createdAt: '2026-09-24T03:10:00Z' }
    expect(versionFileName(version, 'Not/AZone')).toBe('roadmap-2026-09-24-0310-v1.json')
  })
})
