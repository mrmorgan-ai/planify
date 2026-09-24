import { describe, expect, it } from 'vitest'
import { applyEdits, type Edit } from '../core/edits'
import { seedContent, toSeedFile } from '../core/seed'
import type { AppState } from '../core/types'
import { EXAMPLE_SEED, readSeedFile } from '../../tools/seed/load'
import { HISTORY_LIMIT, listVersions, loadVersion } from './history'
import {
  UnknownVersionError,
  applyImport,
  applyRestore,
  previewRestore,
} from './importing'
import {
  InvalidWriteError,
  StaleRevisionError,
  loadAppState,
  mutate,
  mutateContent,
} from './repository'
import type { Space } from './space'
import { sqliteD1 } from './testing/sqliteD1'

const example = seedContent(readSeedFile(EXAMPLE_SEED))
const T0 = Date.parse('2030-01-10T09:00:00Z')
/** An instant `minutes` after T0. */
const at = (minutes: number) => new Date(T0 + minutes * 60_000).toISOString()

/** A database holding the example, with nothing in its history yet: revision 1. */
async function loaded() {
  const database = sqliteD1()
  await mutateContent(database.space, 0, () => example)
  return database
}

const rename = (id: string, name: string): Edit => ({ op: 'updateItem', id, fields: { name } })

/** Applies edits from the current revision, as the edits endpoint does. */
async function edit(space: Space, edits: Edit[], minutes: number): Promise<AppState> {
  const { revision } = await loadAppState(space)
  return mutateContent(space, revision, (state) => applyEdits(state, edits), { now: at(minutes) })
}

describe('keeping versions', () => {
  it('keeps nothing for the first plan: there was none before it', async () => {
    const { space } = await loaded()
    expect(await listVersions(space)).toEqual([])
  })

  it('keeps the plan an edit replaces, with a line saying what the edit did', async () => {
    const { space } = await loaded()
    const plan = toSeedFile(await loadAppState(space))
    await edit(space, [rename('read-the-thing', 'Read it again')], 0)

    const [version] = await listVersions(space)
    expect(version).toEqual({
      id: 1,
      createdAt: at(0),
      reason: 'edit',
      summary: 'Edited Read the thing (name)',
      laterChanges: 0,
      revision: 1,
    })
    expect((await loadVersion(space, 1))?.plan).toEqual(plan)
  })

  it('keeps nothing for progress: a tick is not a change of plan', async () => {
    const { space } = await loaded()
    await mutate(space, 1, (state) =>
      state.items.map((item) =>
        item.id === 'read-the-thing'
          ? { ...item, state: 'done' as const, completedAt: '2030-01-09T10:00:00Z', hoursDone: 3 }
          : item,
      ),
    )
    expect(await listVersions(space)).toEqual([])
  })

  it('folds edits minutes apart into one version, holding the plan from before the first', async () => {
    const { space } = await loaded()
    const plan = toSeedFile(await loadAppState(space))
    await edit(space, [rename('read-the-thing', 'One')], 0)
    await edit(space, [rename('read-the-thing', 'Two')], 4)
    await edit(space, [rename('the-next-thing', 'Three')], 9)

    const versions = await listVersions(space)
    expect(versions).toHaveLength(1)
    expect(versions[0]).toMatchObject({ summary: 'Edited Read the thing (name)', laterChanges: 2 })
    expect((await loadVersion(space, versions[0]!.id))?.plan).toEqual(plan)
  })

  it('starts a new version once the edits stop for a while', async () => {
    const { space } = await loaded()
    await edit(space, [rename('read-the-thing', 'One')], 0)
    await edit(space, [rename('read-the-thing', 'Two')], 11)

    const versions = await listVersions(space)
    expect(versions.map((version) => version.revision)).toEqual([2, 1])
    expect(versions.map((version) => version.laterChanges)).toEqual([0, 0])
  })

  it('never folds an import into the edits before it', async () => {
    const { space } = await loaded()
    await edit(space, [rename('read-the-thing', 'One')], 0)
    const file = toSeedFile(await loadAppState(space))
    file.items = file.items.filter((item) => item.id !== 'the-optional-thing')
    await applyImport(space, 2, file)

    const versions = await listVersions(space)
    expect(versions.map((version) => version.reason)).toEqual(['import', 'edit'])
    expect(versions[0]!.summary).toBe('Imported a file: Deleted Something optional')
  })

  it(`keeps the newest ${HISTORY_LIMIT}`, async () => {
    const { space } = await loaded()
    for (let round = 0; round < HISTORY_LIMIT + 3; round++) {
      await edit(space, [rename('read-the-thing', `Name ${round}`)], round * 11)
    }

    const versions = await listVersions(space)
    expect(versions).toHaveLength(HISTORY_LIMIT)
    expect(versions.at(-1)?.id).toBe(4)
  })

  it('keeps nothing when the change is refused', async () => {
    const { space } = await loaded()
    const intoPause = structuredClone(example)
    intoPause.items.find((item) => item.id === 'build-part-2')!.baselineStartDate = '2030-02-03'

    await expect(mutateContent(space, 1, () => intoPause)).rejects.toBeInstanceOf(InvalidWriteError)
    expect(await listVersions(space)).toEqual([])
  })

  it('keeps nothing when another write lands first', async () => {
    const { space, sqlite } = await loaded()
    const racing = mutateContent(space, 1, (state) => {
      sqlite.exec("UPDATE meta SET value = '2' WHERE key = 'revision'")
      return applyEdits(state, [rename('read-the-thing', 'Racing')])
    })

    await expect(racing).rejects.toBeInstanceOf(StaleRevisionError)
    expect(await listVersions(space)).toEqual([])
  })
})

describe('restoring a version', () => {
  /** The example with one item finished, then another deleted: revision 3. */
  async function afterADelete() {
    const { space } = await loaded()
    await mutate(space, 1, (state) =>
      state.items.map((item) =>
        item.id === 'read-the-thing'
          ? { ...item, state: 'done' as const, completedAt: '2030-01-09T10:00:00Z', hoursDone: 3 }
          : item,
      ),
    )
    await edit(space, [{ op: 'deleteItem', id: 'the-optional-thing' }], 0)
    return space
  }

  it('previews what coming back would change, and writes nothing', async () => {
    const space = await afterADelete()
    const preview = await previewRestore(space, 3, 1)

    expect(preview.changes.items.added).toEqual(['the-optional-thing'])
    expect(preview.introduced).toEqual([])
    expect((await loadAppState(space)).revision).toBe(3)
  })

  it('brings the plan back, keeps the progress, and can itself be undone', async () => {
    const space = await afterADelete()
    const restored = await applyRestore(space, 3, 1)

    expect(restored.items.map((item) => item.id)).toContain('the-optional-thing')
    expect(restored.items.find((item) => item.id === 'read-the-thing')).toMatchObject({
      state: 'done',
      hoursDone: 3,
    })
    const [latest] = await listVersions(space)
    expect(latest).toMatchObject({
      reason: 'restore',
      summary: 'Went back to #1: Added Something optional',
      revision: 3,
    })

    const undone = await applyRestore(space, 4, latest!.id)
    expect(undone.items.map((item) => item.id)).not.toContain('the-optional-thing')
  })

  it('refuses a restore made from an old copy of the roadmap', async () => {
    const space = await afterADelete()
    await expect(applyRestore(space, 2, 1)).rejects.toBeInstanceOf(StaleRevisionError)
  })

  it('says so for a version the history does not have', async () => {
    const space = await afterADelete()
    await expect(applyRestore(space, 3, 99)).rejects.toBeInstanceOf(UnknownVersionError)
    await expect(previewRestore(space, 3, 99)).rejects.toBeInstanceOf(UnknownVersionError)
  })
})
