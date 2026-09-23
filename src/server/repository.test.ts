import { describe, expect, it } from 'vitest'
import { seedContent } from '../core/seed'
import type { AppState, RoadmapContent } from '../core/types'
import { EXAMPLE_SEED, readSeedFile } from '../../tools/seed/load'
import { contentWrites } from './diff'
import {
  InvalidWriteError,
  StaleRevisionError,
  loadAppState,
  mutate,
  mutateContent,
} from './repository'
import { sqliteD1 } from './testing/sqliteD1'

const example = seedContent(readSeedFile(EXAMPLE_SEED))

/** What the database holds, in the order it reads it back. */
function content({ roadmap, workItems, items }: RoadmapContent): RoadmapContent {
  return {
    roadmap: {
      ...roadmap,
      phases: [...roadmap.phases].sort((a, b) => a.number - b.number),
      blackouts: [...roadmap.blackouts].sort((a, b) => a.from.localeCompare(b.from)),
    },
    workItems: [...workItems].sort((a, b) => a.id.localeCompare(b.id)),
    items: [...items].sort((a, b) => a.phase - b.phase || a.sortOrder - b.sortOrder),
  }
}

async function loaded(roadmap: RoadmapContent = example) {
  const database = sqliteD1()
  const state = await mutateContent(database.db, 0, () => roadmap)
  return { ...database, state }
}

/**
 * The example after a round of editing that touches every foreign key: the
 * closing milestone moves to a new item and the old one goes, a work item goes
 * while its parts stay, an axis goes while its skill moves to a new one, the
 * axes change order, and the pause moves.
 */
function edited(): RoadmapContent {
  const next = structuredClone(example)
  const renamed = (id: string) => (id === 'phase-1-exam' ? 'phase-1-final' : id)
  next.items = next.items.map((item) => ({
    ...item,
    id: renamed(item.id),
    dependsOn: item.dependsOn.map(renamed),
    workItemId: item.workItemId === 'practice-phase-1' ? null : item.workItemId,
  }))
  next.workItems = next.workItems.filter((workItem) => workItem.id !== 'practice-phase-1')
  next.roadmap.phases[0]!.closingMilestoneId = 'phase-1-final'
  next.roadmap.dimensions = ['Third axis', 'First axis']
  next.roadmap.skillDimension = { 'Something measurable': 'First axis', 'Something else': 'Third axis' }
  next.roadmap.blackouts = [{ from: '2030-01-22', to: '2030-02-03', reason: 'A shorter pause' }]
  next.roadmap.weeklyHours = { normal: 20 }
  return next
}

describe('mutateContent', () => {
  it('writes a whole roadmap into an empty database, and it reads back the same', async () => {
    const { db, state } = await loaded()
    expect(state.revision).toBe(1)
    expect(content(await loadAppState(db))).toEqual(content(example))
  })

  it('turns one roadmap into another in one batch, foreign keys and all', async () => {
    const { db } = await loaded()
    const next = edited()
    await mutateContent(db, 1, () => next)
    expect(content(await loadAppState(db))).toEqual(content(next))
  })

  it('writes nothing when nothing differs', () => {
    expect(contentWrites(example, structuredClone(example))).toEqual([])
  })

  it('sends the same number of statements for ten items or a thousand', () => {
    // D1 counts each statement of a batch against a per-request query limit.
    const empty = { ...example, workItems: [], items: [] }
    const many = {
      ...example,
      items: Array.from({ length: 100 }, (_, copy) =>
        example.items.map((item) => ({ ...item, id: `${item.id}-${copy}` })),
      ).flat(),
    }
    const few = contentWrites(empty, example).length
    expect(contentWrites(empty, many)).toHaveLength(few)
    expect(few).toBeLessThan(10)
  })

  it('refuses a change that would break a rule, and writes nothing', async () => {
    const { db } = await loaded()
    const intoPause = structuredClone(example)
    intoPause.items.find((item) => item.id === 'build-part-2')!.baselineStartDate = '2030-02-03'

    await expect(mutateContent(db, 1, () => intoPause)).rejects.toBeInstanceOf(InvalidWriteError)
    const after = await loadAppState(db)
    expect(after.revision).toBe(1)
    expect(content(after)).toEqual(content(example))
  })
})

describe('the revision check', () => {
  const finish = (state: AppState) =>
    state.items.map((item) =>
      item.id === 'read-the-thing'
        ? { ...item, state: 'done' as const, completedAt: '2030-01-08T10:00:00Z' }
        : item,
    )

  it('refuses a write made from a revision another write already moved past', async () => {
    const { db } = await loaded()
    await mutate(db, 1, finish)

    const refused = mutate(db, 1, finish)
    await expect(refused).rejects.toBeInstanceOf(StaleRevisionError)
    await expect(refused).rejects.toHaveProperty('state.revision', 2)
  })

  it('catches a write that lands between the read and the batch, and rolls back', async () => {
    const { db, sqlite } = await loaded()

    const racing = mutate(db, 1, (state) => {
      // Another device saves while this request is still working.
      sqlite.exec("UPDATE meta SET value = '2' WHERE key = 'revision'")
      return finish(state)
    })

    await expect(racing).rejects.toBeInstanceOf(StaleRevisionError)
    const after = await loadAppState(db)
    expect(after.revision).toBe(2)
    expect(after.items.find((item) => item.id === 'read-the-thing')?.state).toBe('pending')
  })
})
