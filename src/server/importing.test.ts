import { describe, expect, it } from 'vitest'
import { seedContent, toSeedFile } from '../core/seed'
import { EXAMPLE_SEED, readSeedFile } from '../../tools/seed/load'
import { applyImport, previewImport } from './importing'
import { InvalidWriteError, StaleRevisionError, loadAppState, mutate, mutateContent } from './repository'
import { sqliteD1 } from './testing/sqliteD1'

const example = seedContent(readSeedFile(EXAMPLE_SEED))

/** A database holding the example, with one task finished: revision 2. */
async function underway() {
  const { space } = sqliteD1()
  await mutateContent(space, 0, () => example)
  const state = await mutate(space, 1, (current) =>
    current.tasks.map((task) =>
      task.id === 'read-the-thing'
        ? { ...task, state: 'done' as const, completedAt: '2030-01-09T10:00:00Z', hoursDone: 3 }
        : task,
    ),
  )
  return { space, state }
}

describe('previewImport', () => {
  it('finds nothing to change in the roadmap’s own export', async () => {
    const { space, state } = await underway()
    const preview = await previewImport(space, 2, toSeedFile(state))
    expect(preview.changes.tasks).toEqual({ added: [], removed: [], changed: [] })
    expect(preview.introduced).toEqual([])
    expect(preview.issues.filter((issue) => issue.severity !== 'info')).toEqual([])
  })

  it('shows what would change and writes nothing', async () => {
    const { space, state } = await underway()
    const file = toSeedFile(state)
    file.tasks = file.tasks.filter((task) => task.id !== 'the-optional-thing')

    const preview = await previewImport(space, 2, file)
    expect(preview.changes.tasks.removed.map((task) => task.id)).toEqual(['the-optional-thing'])
    const after = await loadAppState(space)
    expect(after.revision).toBe(2)
    expect(after.tasks).toHaveLength(example.tasks.length)
  })

  it('refuses a file exported before the roadmap last changed', async () => {
    const { space, state } = await underway()
    await expect(previewImport(space, 1, toSeedFile(state))).rejects.toBeInstanceOf(StaleRevisionError)
  })
})

describe('applyImport', () => {
  it('replaces the content, keeps progress, and records the file it came from', async () => {
    const { space, state } = await underway()
    const file = toSeedFile(state)
    file.tasks = file.tasks.filter((task) => task.id !== 'the-optional-thing')
    file.tasks.find((task) => task.id === 'read-the-thing')!.name = 'Read the thing, again'

    const imported = await applyImport(space, 2, file)
    const stored = await loadAppState(space)
    expect(stored).toEqual(imported)
    expect(stored.revision).toBe(3)
    expect(stored.seedVersion).toMatch(/^[0-9a-f]{12}$/)
    expect(stored.tasks.map((task) => task.id)).not.toContain('the-optional-thing')
    expect(stored.tasks.find((task) => task.id === 'read-the-thing')).toMatchObject({
      name: 'Read the thing, again',
      state: 'done',
      hoursDone: 3,
    })
  })

  it('refuses a file that would break a rule, and writes nothing', async () => {
    const { space, state } = await underway()
    const file = toSeedFile(state)
    file.tasks.find((task) => task.id === 'build-part-2')!.baselineStartDate = '2030-02-03'

    await expect(applyImport(space, 2, file)).rejects.toBeInstanceOf(InvalidWriteError)
    expect((await loadAppState(space)).revision).toBe(2)
  })
})
