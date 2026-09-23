import { describe, expect, it } from 'vitest'
import { applyEdits } from '../core/edits'
import type { GenerateRequest } from '../core/generate'
import { seedContent } from '../core/seed'
import { EXAMPLE_SEED, readSeedFile } from '../../tools/seed/load'
import { applyGenerate, previewGenerate } from './generating'
import { listVersions } from './history'
import { StaleRevisionError, loadAppState, mutateContent } from './repository'
import { sqliteD1 } from './testing/sqliteD1'

const example = seedContent(readSeedFile(EXAMPLE_SEED))

/** A database holding the example: revision 1. */
async function loaded() {
  const { db } = sqliteD1()
  await mutateContent(db, 0, () => example)
  return db
}

const project: GenerateRequest = {
  phase: 1,
  skills: ['Something measurable'],
  after: 'read-the-thing',
  from: '',
  kind: 'project',
  name: 'A project',
  link: null,
  doneWhen: 'It is deployed',
  tasks: [
    { name: 'Set it up', hours: 2 },
    { name: 'Ship it', hours: 3 },
  ],
}

describe('generating', () => {
  it('previews the items it would add, and writes nothing', async () => {
    const db = await loaded()
    const preview = await previewGenerate(db, 1, project)

    expect(preview.placed.map((piece) => piece.id)).toEqual([
      'a-project-set-it-up',
      'a-project-ship-it',
    ])
    expect(preview.changes.items.added).toEqual(['a-project-set-it-up', 'a-project-ship-it'])
    expect(preview.changes.workItems.added).toEqual(['a-project'])
    // The milestone now waits on the last task; the items moved down to make room are not listed.
    expect(preview.changes.items.changed).toEqual([{ id: 'phase-1-exam', fields: ['dependsOn'] }])
    expect(preview.introduced).toEqual([])
    expect((await loadAppState(db)).revision).toBe(1)
  })

  it('adds what it previewed, kept in the history as its own change', async () => {
    const db = await loaded()
    // An edit a moment before: a generation is never folded into it.
    const state = await loadAppState(db)
    await mutateContent(db, 1, () =>
      applyEdits(state, [{ op: 'updateItem', id: 'read-the-thing', fields: { notes: 'Read' } }]),
    )
    const preview = await previewGenerate(db, 2, project)
    const written = await applyGenerate(db, 2, project)

    for (const piece of preview.placed) {
      expect(written.items.find((item) => item.id === piece.id)).toMatchObject({
        baselineStartDate: piece.start,
        baselineEndDate: piece.end,
      })
    }
    const versions = await listVersions(db)
    expect(versions.map((version) => version.reason)).toEqual(['generate', 'edit'])
    expect(versions[0]).toMatchObject({
      summary: 'Generated A project: 2 items, 2030-01-11 to 2030-01-15',
      laterChanges: 0,
      revision: 2,
    })
  })

  it('refuses to preview or add from an old copy of the roadmap', async () => {
    const db = await loaded()
    await expect(previewGenerate(db, 0, project)).rejects.toBeInstanceOf(StaleRevisionError)
    await expect(applyGenerate(db, 0, project)).rejects.toBeInstanceOf(StaleRevisionError)
  })
})
