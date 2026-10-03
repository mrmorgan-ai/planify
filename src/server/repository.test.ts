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
function content({ roadmap, features, stories, tasks }: RoadmapContent): RoadmapContent {
  return {
    roadmap: {
      ...roadmap,
      phases: [...roadmap.phases].sort((a, b) => a.number - b.number),
      blackouts: [...roadmap.blackouts].sort((a, b) => a.from.localeCompare(b.from)),
    },
    features: [...features].sort((a, b) => a.id.localeCompare(b.id)),
    stories: [...stories].sort((a, b) => a.id.localeCompare(b.id)),
    tasks: [...tasks].sort((a, b) => a.phase - b.phase || a.sortOrder - b.sortOrder),
  }
}

async function loaded(roadmap: RoadmapContent = example) {
  const database = sqliteD1()
  const state = await mutateContent(database.space, 0, () => roadmap)
  return { ...database, state }
}

/**
 * The example after a round of editing that touches every foreign key: the
 * closing milestone moves to a new task and the old one goes, a story goes
 * while its tasks move to another, a feature comes in with a story serving it,
 * an axis goes while its skill moves to a new one, the axes change order, and
 * the pause moves.
 */
function edited(): RoadmapContent {
  const next = structuredClone(example)
  const renamed = (id: string) => (id === 'phase-1-exam' ? 'phase-1-final' : id)
  next.tasks = next.tasks.map((task) => ({
    ...task,
    id: renamed(task.id),
    dependsOn: task.dependsOn.map(renamed),
    storyId: task.storyId === 'practice-phase-1' ? 'the-course' : task.storyId,
  }))
  next.stories = next.stories
    .filter((story) => story.id !== 'practice-phase-1')
    .map((story) => (story.id === 'the-exam' ? { ...story, featureId: 'a-goal' } : story))
  next.features = [{ id: 'a-goal', name: 'A goal', type: 'Certification', link: null, notes: '' }]
  next.roadmap.phases[0]!.closingMilestoneId = 'phase-1-final'
  next.roadmap.dimensions = ['Third axis', 'First axis']
  next.roadmap.skillDimension = { 'Something measurable': 'First axis', 'Something else': 'Third axis' }
  next.roadmap.blackouts = [{ from: '2030-01-22', to: '2030-02-03', reason: 'A shorter pause' }]
  next.roadmap.weeklyHours = { normal: 20 }
  return next
}

describe('mutateContent', () => {
  it('writes a whole roadmap into an empty database, and it reads back the same', async () => {
    const { space, state } = await loaded()
    expect(state.revision).toBe(1)
    expect(content(await loadAppState(space))).toEqual(content(example))
  })

  it('turns one roadmap into another in one batch, foreign keys and all', async () => {
    const { space } = await loaded()
    const next = edited()
    await mutateContent(space, 1, () => next)
    expect(content(await loadAppState(space))).toEqual(content(next))
  })

  it('writes nothing when nothing differs', () => {
    expect(contentWrites(example, structuredClone(example), 1)).toEqual([])
  })

  it('sends the same number of statements for ten tasks or a thousand', () => {
    // D1 counts each statement of a batch against a per-request query limit.
    const empty = { ...example, stories: [], tasks: [] }
    const many = {
      ...example,
      tasks: Array.from({ length: 100 }, (_, copy) =>
        example.tasks.map((task) => ({ ...task, id: `${task.id}-${copy}` })),
      ).flat(),
    }
    const few = contentWrites(empty, example, 1).length
    expect(contentWrites(empty, many, 1)).toHaveLength(few)
    expect(few).toBeLessThan(10)
  })

  it('refuses a change that would break a rule, and writes nothing', async () => {
    const { space } = await loaded()
    const intoPause = structuredClone(example)
    intoPause.tasks.find((task) => task.id === 'build-part-2')!.baselineStartDate = '2030-02-03'

    await expect(mutateContent(space, 1, () => intoPause)).rejects.toBeInstanceOf(InvalidWriteError)
    const after = await loadAppState(space)
    expect(after.revision).toBe(1)
    expect(content(after)).toEqual(content(example))
  })
})

describe('the revision check', () => {
  const finish = (state: AppState) =>
    state.tasks.map((task) =>
      task.id === 'read-the-thing'
        ? { ...task, state: 'done' as const, completedAt: '2030-01-08T10:00:00Z' }
        : task,
    )

  it('refuses a write made from a revision another write already moved past', async () => {
    const { space } = await loaded()
    await mutate(space, 1, finish)

    const refused = mutate(space, 1, finish)
    await expect(refused).rejects.toBeInstanceOf(StaleRevisionError)
    await expect(refused).rejects.toHaveProperty('state.revision', 2)
  })

  it('catches a write that lands between the read and the batch, and rolls back', async () => {
    const { space, sqlite } = await loaded()

    const racing = mutate(space, 1, (state) => {
      // Another device saves while this request is still working.
      sqlite.exec("UPDATE meta SET value = '2' WHERE key = 'revision'")
      return finish(state)
    })

    await expect(racing).rejects.toBeInstanceOf(StaleRevisionError)
    const after = await loadAppState(space)
    expect(after.revision).toBe(2)
    expect(after.tasks.find((task) => task.id === 'read-the-thing')?.state).toBe('pending')
  })
})
