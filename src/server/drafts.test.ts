import { describe, expect, it } from 'vitest'
import { applyEdits, type Edit } from '../core/edits'
import { seedContent, toSeedFile } from '../core/seed'
import type { AppState } from '../core/types'
import { EXAMPLE_SEED, readSeedFile } from '../../tools/seed/load'
import {
  NoDraftError,
  discardDraft,
  loadDraftState,
  mutateDraft,
  previewPublish,
  publishDraft,
  startDraft,
} from './drafts'
import { listVersions } from './history'
import {
  InvalidWriteError,
  StaleRevisionError,
  loadAppState,
  mutate,
  mutateContent,
} from './repository'
import { sqliteD1 } from './testing/sqliteD1'

const example = seedContent(readSeedFile(EXAMPLE_SEED))
const NOW = '2030-01-10T09:00:00.000Z'

/** A database holding the example: revision 1. */
async function loaded() {
  const { db } = sqliteD1()
  await mutateContent(db, 0, () => example)
  return db
}

const rename = (id: string, name: string): Edit => ({ op: 'updateItem', id, fields: { name } })
const inDraft = (db: D1Database, revision: number, edits: Edit[]) =>
  mutateDraft(db, revision, (state) => applyEdits(state, edits), { now: NOW })
const nameOf = (state: AppState, id: string) => state.items.find((item) => item.id === id)?.name
const finish = (db: D1Database, revision: number, id: string) =>
  mutate(db, revision, (state) =>
    state.items.map((item) =>
      item.id === id
        ? { ...item, state: 'done' as const, completedAt: '2030-01-09T10:00:00Z', hoursDone: 2 }
        : item,
    ),
  )

describe('a draft', () => {
  it('starts as a copy of the live plan, and the live world says one is in progress', async () => {
    const db = await loaded()
    expect((await loadAppState(db)).draft).toBeNull()

    const draft = await startDraft(db, NOW)
    expect(draft.revision).toBe(1)
    expect(draft.draft).toEqual({ startedAt: NOW, updatedAt: NOW })
    expect(toSeedFile(draft)).toEqual(toSeedFile(await loadAppState(db)))
    expect((await loadAppState(db)).draft).toEqual({ startedAt: NOW, updatedAt: NOW })
  })

  it('opens the one in progress rather than starting another', async () => {
    const db = await loaded()
    await startDraft(db, NOW)
    await inDraft(db, 1, [rename('read-the-thing', 'Drafted')])

    const again = await startDraft(db)
    expect(again.revision).toBe(2)
    expect(nameOf(again, 'read-the-thing')).toBe('Drafted')
  })

  it('takes edits without touching the live roadmap or its history', async () => {
    const db = await loaded()
    await startDraft(db, NOW)
    const edited = await inDraft(db, 1, [rename('read-the-thing', 'Drafted')])

    expect(edited.revision).toBe(2)
    expect(nameOf(edited, 'read-the-thing')).toBe('Drafted')
    expect(nameOf(await loadDraftState(db), 'read-the-thing')).toBe('Drafted')
    const live = await loadAppState(db)
    expect(nameOf(live, 'read-the-thing')).toBe('Read the thing')
    expect(live.revision).toBe(1)
    expect(await listVersions(db)).toEqual([])
  })

  it('shows the live roadmap’s progress, including what was ticked after it started', async () => {
    const db = await loaded()
    await startDraft(db, NOW)
    await finish(db, 1, 'read-the-thing')

    expect(
      (await loadDraftState(db)).items.find((item) => item.id === 'read-the-thing'),
    ).toMatchObject({
      state: 'done',
      hoursDone: 2,
    })
  })

  it('refuses a change made from an old copy of the draft, answering with the current one', async () => {
    const db = await loaded()
    await startDraft(db, NOW)
    await inDraft(db, 1, [rename('read-the-thing', 'First')])

    const stale = inDraft(db, 1, [rename('read-the-thing', 'Second')])
    await expect(stale).rejects.toBeInstanceOf(StaleRevisionError)
    await expect(stale).rejects.toMatchObject({ state: { revision: 2 } })
  })

  it('may break a rule the live roadmap refuses, and shows it', async () => {
    const db = await loaded()
    await startDraft(db, NOW)
    const cycle: Edit = {
      op: 'setDependencies',
      id: 'read-the-thing',
      dependsOn: ['the-next-thing'],
    }

    await expect(
      mutateContent(db, 1, (state) => applyEdits(state, [cycle])),
    ).rejects.toBeInstanceOf(InvalidWriteError)
    const drafted = await inDraft(db, 1, [cycle])
    expect(drafted.items.find((item) => item.id === 'read-the-thing')?.dependsOn).toEqual([
      'the-next-thing',
    ])
  })

  it('says so when there is none to change', async () => {
    const db = await loaded()
    await expect(loadDraftState(db)).rejects.toBeInstanceOf(NoDraftError)
    await expect(inDraft(db, 1, [rename('read-the-thing', 'X')])).rejects.toBeInstanceOf(
      NoDraftError,
    )
  })

  it('is dropped by discarding it, leaving the live roadmap as it was', async () => {
    const db = await loaded()
    await startDraft(db, NOW)
    await inDraft(db, 1, [rename('read-the-thing', 'Drafted')])

    const live = await discardDraft(db)
    expect(live.draft).toBeNull()
    expect(nameOf(live, 'read-the-thing')).toBe('Read the thing')
    await expect(loadDraftState(db)).rejects.toBeInstanceOf(NoDraftError)
  })
})

describe('publishing a draft', () => {
  /** A draft that renames one item and deletes another, over a live roadmap at revision 1. */
  async function drafted() {
    const db = await loaded()
    await startDraft(db, NOW)
    await inDraft(db, 1, [
      rename('read-the-thing', 'Drafted'),
      { op: 'deleteItem', id: 'the-optional-thing' },
    ])
    return db
  }

  it('previews what it changes on the live roadmap, and writes nothing', async () => {
    const db = await drafted()
    const preview = await previewPublish(db, 2)

    expect(preview.revision).toBe(1)
    expect(preview.changes.items.removed.map((item) => item.id)).toEqual(['the-optional-thing'])
    expect(preview.changes.items.changed).toEqual([{ id: 'read-the-thing', fields: ['name'] }])
    expect(preview.introduced).toEqual([])
    expect(preview.liveChanged).toBe(false)
    expect((await loadAppState(db)).revision).toBe(1)
  })

  it('makes the draft the plan in one write, keeps progress and the history, and ends the draft', async () => {
    const db = await drafted()
    await finish(db, 1, 'the-next-thing')

    const live = await publishDraft(db, 2, 2, { now: NOW })
    expect(live.revision).toBe(3)
    expect(live.draft).toBeNull()
    expect(nameOf(live, 'read-the-thing')).toBe('Drafted')
    expect(live.items.some((item) => item.id === 'the-optional-thing')).toBe(false)
    expect(live.items.find((item) => item.id === 'the-next-thing')?.state).toBe('done')

    expect((await loadAppState(db)).draft).toBeNull()
    await expect(loadDraftState(db)).rejects.toBeInstanceOf(NoDraftError)
    const [version] = await listVersions(db)
    expect(version).toMatchObject({
      reason: 'publish',
      summary: 'Published a draft: Deleted Something optional; Edited Read the thing (name)',
      revision: 2,
    })
  })

  it('says when the live plan changed after the draft started', async () => {
    const db = await drafted()
    const live = await loadAppState(db)
    await mutateContent(db, live.revision, (state) =>
      applyEdits(state, [rename('the-next-thing', 'Changed live')]),
    )

    const preview = await previewPublish(db, 2)
    expect(preview.liveChanged).toBe(true)
    // The draft never had the live rename: publishing it puts the old name back.
    expect(preview.changes.items.changed).toContainEqual({
      id: 'the-next-thing',
      fields: ['name'],
    })
  })

  it('does not count progress as a change to the live plan', async () => {
    const db = await drafted()
    await finish(db, 1, 'the-next-thing')
    expect((await previewPublish(db, 2)).liveChanged).toBe(false)
  })

  it('refuses when either revision is not the one reviewed, answering with the draft', async () => {
    const db = await drafted()
    await expect(publishDraft(db, 1, 1)).rejects.toMatchObject({ state: { revision: 2 } })

    await finish(db, 1, 'the-next-thing')
    const stale = publishDraft(db, 1, 2)
    await expect(stale).rejects.toBeInstanceOf(StaleRevisionError)
    await expect(stale).rejects.toMatchObject({
      message: expect.stringContaining('Review it again'),
      state: { revision: 2, draft: { startedAt: NOW } },
    })
  })

  it('refuses a draft that would bring in an error, and keeps it', async () => {
    const db = await loaded()
    await startDraft(db, NOW)
    await inDraft(db, 1, [
      { op: 'setDependencies', id: 'read-the-thing', dependsOn: ['the-next-thing'] },
    ])

    const preview = await previewPublish(db, 2)
    expect(preview.introduced.map((issue) => issue.rule)).toContain('cycle')
    await expect(publishDraft(db, 1, 2)).rejects.toBeInstanceOf(InvalidWriteError)
    expect((await loadDraftState(db)).revision).toBe(2)
  })
})
