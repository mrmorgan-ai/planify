import { describe, expect, it } from 'vitest'
import { EditError, applyEdits, type Edit } from '../core/edits'
import { seedContent } from '../core/seed'
import { EXAMPLE_SEED, readSeedFile } from '../../tools/seed/load'
import { InvalidWriteError, loadAppState, mutateContent } from './repository'
import type { Space } from './space'
import { sqliteD1 } from './testing/sqliteD1'

const example = seedContent(readSeedFile(EXAMPLE_SEED))

async function loaded() {
  const { space } = sqliteD1()
  await mutateContent(space, 0, () => example)
  return space
}

const edit = (space: Space, revision: number, edits: Edit[]) =>
  mutateContent(space, revision, (state) => applyEdits(state, edits))

// The path POST /api/edits takes, against the real schema.
describe('edits, written', () => {
  it('lands a created item and a dependency on it as one write', async () => {
    const space = await loaded()
    const state = await edit(space, 1, [
      {
        op: 'createItem',
        item: {
          name: 'One more thing',
          type: 'Paper',
          phase: 2,
          baselineStartDate: '2030-02-25',
          baselineEndDate: '2030-02-26',
          skills: ['Something else'],
          duration: '~2h',
        },
      },
      { op: 'updateItem', id: 'the-optional-thing', fields: { notes: 'Now with a follow-up.' } },
    ])

    const stored = await loadAppState(space)
    expect(stored).toEqual(state)
    expect(stored.revision).toBe(2)
    expect(stored.items.find((item) => item.id === 'one-more-thing')?.state).toBe('pending')
    expect(stored.items.find((item) => item.id === 'the-optional-thing')?.notes).toBe(
      'Now with a follow-up.',
    )
  })

  it('deletes an item and rewires what waited on it', async () => {
    const space = await loaded()
    await edit(space, 1, [{ op: 'deleteItem', id: 'the-next-thing', rewire: true }])
    const stored = await loadAppState(space)
    expect(stored.items.some((item) => item.id === 'the-next-thing')).toBe(false)
    expect(stored.items.find((item) => item.id === 'the-optional-thing')?.dependsOn).toEqual([
      'phase-1-exam',
    ])
  })

  it('writes none of a list when one edit cannot be applied', async () => {
    const space = await loaded()
    await expect(
      edit(space, 1, [
        { op: 'updateItem', id: 'the-optional-thing', fields: { notes: 'changed' } },
        { op: 'deleteItem', id: 'the-next-thing' },
      ]),
    ).rejects.toBeInstanceOf(EditError)
    const stored = await loadAppState(space)
    expect(stored.revision).toBe(1)
    expect(stored.items.find((item) => item.id === 'the-optional-thing')?.notes).not.toBe('changed')
  })

  it('refuses a cycle as a rule it would break', async () => {
    const space = await loaded()
    await expect(
      edit(space, 1, [{ op: 'setDependencies', id: 'course-part-1', dependsOn: ['course-part-2'] }]),
    ).rejects.toBeInstanceOf(InvalidWriteError)
    expect((await loadAppState(space)).revision).toBe(1)
  })

  it('moves a closing milestone and deletes the old one in the same write', async () => {
    const space = await loaded()
    await edit(space, 1, [
      { op: 'updatePhase', number: 1, fields: { closingMilestoneId: 'exam-prep' } },
      { op: 'deleteItem', id: 'phase-1-exam', rewire: true },
    ])
    const stored = await loadAppState(space)
    expect(stored.roadmap.phases[0]?.closingMilestoneId).toBe('exam-prep')
    expect(stored.items.some((item) => item.id === 'phase-1-exam')).toBe(false)
  })

  it('drops an axis while its skill moves to a new one, and deletes a work item', async () => {
    const space = await loaded()
    await edit(space, 1, [
      {
        op: 'setSkillMap',
        dimensions: ['New axis', 'First axis'],
        skills: { 'Something measurable': 'First axis', 'Something else': 'New axis' },
      },
      { op: 'deleteWorkItem', id: 'the-project' },
    ])
    const stored = await loadAppState(space)
    expect(stored.roadmap.dimensions).toEqual(['New axis', 'First axis'])
    expect(stored.roadmap.skillDimension['Something else']).toBe('New axis')
    expect(stored.workItems.some((workItem) => workItem.id === 'the-project')).toBe(false)
    expect(stored.items.find((item) => item.id === 'build-part-1')?.workItemId).toBeNull()
  })
})
