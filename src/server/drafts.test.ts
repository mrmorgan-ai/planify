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
import type { Space } from './space'
import { sqliteD1 } from './testing/sqliteD1'

const example = seedContent(readSeedFile(EXAMPLE_SEED))
const NOW = '2030-01-10T09:00:00.000Z'

/** A database holding the example: revision 1. */
async function loaded() {
  const { space } = sqliteD1()
  await mutateContent(space, 0, () => example)
  return space
}

const rename = (id: string, name: string): Edit => ({ op: 'updateItem', id, fields: { name } })
const inDraft = (space: Space, revision: number, edits: Edit[]) =>
  mutateDraft(space, revision, (state) => applyEdits(state, edits), { now: NOW })
const nameOf = (state: AppState, id: string) => state.items.find((item) => item.id === id)?.name
const finish = (space: Space, revision: number, id: string) =>
  mutate(space, revision, (state) =>
    state.items.map((item) =>
      item.id === id
        ? { ...item, state: 'done' as const, completedAt: '2030-01-09T10:00:00Z', hoursDone: 2 }
        : item,
    ),
  )

describe('a draft', () => {
  it('starts as a copy of the live plan, and the live world says one is in progress', async () => {
    const space = await loaded()
    expect((await loadAppState(space)).draft).toBeNull()

    const draft = await startDraft(space, NOW)
    expect(draft.revision).toBe(1)
    expect(draft.draft).toEqual({ startedAt: NOW, updatedAt: NOW })
    expect(toSeedFile(draft)).toEqual(toSeedFile(await loadAppState(space)))
    expect((await loadAppState(space)).draft).toEqual({ startedAt: NOW, updatedAt: NOW })
  })

  it('opens the one in progress rather than starting another', async () => {
    const space = await loaded()
    await startDraft(space, NOW)
    await inDraft(space, 1, [rename('read-the-thing', 'Drafted')])

    const again = await startDraft(space)
    expect(again.revision).toBe(2)
    expect(nameOf(again, 'read-the-thing')).toBe('Drafted')
  })

  it('takes edits without touching the live roadmap or its history', async () => {
    const space = await loaded()
    await startDraft(space, NOW)
    const edited = await inDraft(space, 1, [rename('read-the-thing', 'Drafted')])

    expect(edited.revision).toBe(2)
    expect(nameOf(edited, 'read-the-thing')).toBe('Drafted')
    expect(nameOf(await loadDraftState(space), 'read-the-thing')).toBe('Drafted')
    const live = await loadAppState(space)
    expect(nameOf(live, 'read-the-thing')).toBe('Read the thing')
    expect(live.revision).toBe(1)
    expect(await listVersions(space)).toEqual([])
  })

  it('shows the live roadmap’s progress, including what was ticked after it started', async () => {
    const space = await loaded()
    await startDraft(space, NOW)
    await finish(space, 1, 'read-the-thing')

    expect(
      (await loadDraftState(space)).items.find((item) => item.id === 'read-the-thing'),
    ).toMatchObject({
      state: 'done',
      hoursDone: 2,
    })
  })

  it('refuses a change made from an old copy of the draft, answering with the current one', async () => {
    const space = await loaded()
    await startDraft(space, NOW)
    await inDraft(space, 1, [rename('read-the-thing', 'First')])

    const stale = inDraft(space, 1, [rename('read-the-thing', 'Second')])
    await expect(stale).rejects.toBeInstanceOf(StaleRevisionError)
    await expect(stale).rejects.toMatchObject({ state: { revision: 2 } })
  })

  it('may break a rule the live roadmap refuses, and shows it', async () => {
    const space = await loaded()
    await startDraft(space, NOW)
    const cycle: Edit = {
      op: 'setDependencies',
      id: 'read-the-thing',
      dependsOn: ['the-next-thing'],
    }

    await expect(
      mutateContent(space, 1, (state) => applyEdits(state, [cycle])),
    ).rejects.toBeInstanceOf(InvalidWriteError)
    const drafted = await inDraft(space, 1, [cycle])
    expect(drafted.items.find((item) => item.id === 'read-the-thing')?.dependsOn).toEqual([
      'the-next-thing',
    ])
  })

  it('says so when there is none to change', async () => {
    const space = await loaded()
    await expect(loadDraftState(space)).rejects.toBeInstanceOf(NoDraftError)
    await expect(inDraft(space, 1, [rename('read-the-thing', 'X')])).rejects.toBeInstanceOf(
      NoDraftError,
    )
  })

  it('is dropped by discarding it, leaving the live roadmap as it was', async () => {
    const space = await loaded()
    await startDraft(space, NOW)
    await inDraft(space, 1, [rename('read-the-thing', 'Drafted')])

    const live = await discardDraft(space)
    expect(live.draft).toBeNull()
    expect(nameOf(live, 'read-the-thing')).toBe('Read the thing')
    await expect(loadDraftState(space)).rejects.toBeInstanceOf(NoDraftError)
  })
})

describe('publishing a draft', () => {
  /** A draft that renames one item and deletes another, over a live roadmap at revision 1. */
  async function drafted() {
    const space = await loaded()
    await startDraft(space, NOW)
    await inDraft(space, 1, [
      rename('read-the-thing', 'Drafted'),
      { op: 'deleteItem', id: 'the-optional-thing' },
    ])
    return space
  }

  it('previews what it changes on the live roadmap, and writes nothing', async () => {
    const space = await drafted()
    const preview = await previewPublish(space, 2)

    expect(preview.revision).toBe(1)
    expect(preview.changes.items.removed.map((item) => item.id)).toEqual(['the-optional-thing'])
    expect(preview.changes.items.changed).toEqual([{ id: 'read-the-thing', fields: ['name'] }])
    expect(preview.introduced).toEqual([])
    expect(preview.liveChanged).toBe(false)
    expect((await loadAppState(space)).revision).toBe(1)
  })

  it('makes the draft the plan in one write, keeps progress and the history, and ends the draft', async () => {
    const space = await drafted()
    await finish(space, 1, 'the-next-thing')

    const live = await publishDraft(space, 2, 2, { now: NOW })
    expect(live.revision).toBe(3)
    expect(live.draft).toBeNull()
    expect(nameOf(live, 'read-the-thing')).toBe('Drafted')
    expect(live.items.some((item) => item.id === 'the-optional-thing')).toBe(false)
    expect(live.items.find((item) => item.id === 'the-next-thing')?.state).toBe('done')

    expect((await loadAppState(space)).draft).toBeNull()
    await expect(loadDraftState(space)).rejects.toBeInstanceOf(NoDraftError)
    const [version] = await listVersions(space)
    expect(version).toMatchObject({
      reason: 'publish',
      summary: 'Published a draft: Deleted Something optional; Edited Read the thing (name)',
      revision: 2,
    })
  })

  it('says when the live plan changed after the draft started', async () => {
    const space = await drafted()
    const live = await loadAppState(space)
    await mutateContent(space, live.revision, (state) =>
      applyEdits(state, [rename('the-next-thing', 'Changed live')]),
    )

    const preview = await previewPublish(space, 2)
    expect(preview.liveChanged).toBe(true)
    // The draft never had the live rename: publishing it puts the old name back.
    expect(preview.changes.items.changed).toContainEqual({
      id: 'the-next-thing',
      fields: ['name'],
    })
  })

  it('does not count progress as a change to the live plan', async () => {
    const space = await drafted()
    await finish(space, 1, 'the-next-thing')
    expect((await previewPublish(space, 2)).liveChanged).toBe(false)
  })

  it('refuses when either revision is not the one reviewed, answering with the draft', async () => {
    const space = await drafted()
    await expect(publishDraft(space, 1, 1)).rejects.toMatchObject({ state: { revision: 2 } })

    await finish(space, 1, 'the-next-thing')
    const stale = publishDraft(space, 1, 2)
    await expect(stale).rejects.toBeInstanceOf(StaleRevisionError)
    await expect(stale).rejects.toMatchObject({
      message: expect.stringContaining('Review it again'),
      state: { revision: 2, draft: { startedAt: NOW } },
    })
  })

  it('refuses a draft that would bring in an error, and keeps it', async () => {
    const space = await loaded()
    await startDraft(space, NOW)
    await inDraft(space, 1, [
      { op: 'setDependencies', id: 'read-the-thing', dependsOn: ['the-next-thing'] },
    ])

    const preview = await previewPublish(space, 2)
    expect(preview.introduced.map((issue) => issue.rule)).toContain('cycle')
    await expect(publishDraft(space, 1, 2)).rejects.toBeInstanceOf(InvalidWriteError)
    expect((await loadDraftState(space)).revision).toBe(2)
  })
})
