import { describe, expect, it } from 'vitest'
import { applyEdits, type Edit } from '../core/edits'
import { seedContent } from '../core/seed'
import { EXAMPLE_SEED, readSeedFile } from '../../tools/seed/load'
import { datesMoved } from './dates'
import { startDraft } from './drafts'
import { StaleRevisionError, loadAppState, mutateContent } from './repository'
import { previewIn } from './target'
import { sqliteD1 } from './testing/sqliteD1'

const example = seedContent(readSeedFile(EXAMPLE_SEED))

/** A database holding the example: revision 1. */
async function loaded() {
  const { db } = sqliteD1()
  await mutateContent(db, 0, () => example)
  return db
}

const rename: Edit = { op: 'updateItem', id: 'read-the-thing', fields: { name: 'Renamed' } }

describe('a dry run', () => {
  it('says what an edit would change, and writes nothing', async () => {
    const db = await loaded()
    const preview = await previewIn(db, 'live', 1, (state) => applyEdits(state, [rename]))

    expect(preview.revision).toBe(1)
    expect(preview.changes.items.changed).toEqual([{ id: 'read-the-thing', fields: ['name'] }])
    expect(preview.introduced).toEqual([])
    expect((await loadAppState(db)).items.find((item) => item.id === 'read-the-thing')?.name).toBe(
      'Read the thing',
    )
  })

  it('says what moving an item’s dates would push', async () => {
    const db = await loaded()
    const moved = datesMoved('the-next-thing', '2030-02-18', '2030-02-24')
    const preview = await previewIn(db, 'live', 1, (state) => ({ ...state, items: moved(state) }))

    expect(preview.changes.items.changed.map((change) => change.id).sort()).toEqual([
      'the-next-thing',
      'the-optional-thing',
    ])
  })

  it('names the errors a change would bring in', async () => {
    const db = await loaded()
    const cycle: Edit = {
      op: 'setDependencies',
      id: 'read-the-thing',
      dependsOn: ['the-next-thing'],
    }
    const preview = await previewIn(db, 'live', 1, (state) => applyEdits(state, [cycle]))
    expect(preview.introduced.map((issue) => issue.rule)).toEqual(['cycle'])
  })

  it('works on the draft, against the draft’s revision', async () => {
    const db = await loaded()
    await startDraft(db)
    const preview = await previewIn(db, 'draft', 1, (state) => applyEdits(state, [rename]))
    expect(preview.changes.items.changed).toHaveLength(1)
  })

  it('is refused from an old revision, as the write would be', async () => {
    const db = await loaded()
    await expect(
      previewIn(db, 'live', 0, (state) => applyEdits(state, [rename])),
    ).rejects.toBeInstanceOf(StaleRevisionError)
  })
})
