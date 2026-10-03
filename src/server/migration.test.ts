import type { DatabaseSync } from 'node:sqlite'
import { describe, expect, it } from 'vitest'
import { parseSeed, seedContent } from '../core/seed'
import type { RoadmapContent, Task } from '../core/types'
import { readV1, v1WithEveryCase, type V1 } from '../../tools/seed/fixtures/v1'
import { loadDraftState, publishDraft } from './drafts'
import { applyRestore } from './importing'
import { loadAppState } from './repository'
import { sqliteD1 } from './testing/sqliteD1'

// migrations/0013_stories.sql and src/core/upgrade.ts turn the first format into
// the second by the same rules: one for what is stored, the other for files and
// for the plans kept in the history. This holds them to the same result, on the
// schema the migration runs against, with progress stored as it would be.

/** One roadmap of the first format, written into the tables it was stored in. */
function storeV1(sqlite: DatabaseSync, roadmapId: number, file: V1) {
  const run = (sql: string, ...values: Array<string | number | null>) =>
    sqlite.prepare(sql).run(...values)
  for (const workItem of file.workItems) {
    run(
      'INSERT INTO work_items (roadmap_id, id, name, type, link, resources, notes) VALUES (?, ?, ?, ?, ?, ?, ?)',
      roadmapId,
      String(workItem.id),
      String(workItem.name),
      String(workItem.type),
      (workItem.link as string | null) ?? null,
      JSON.stringify(workItem.resources ?? []),
      String(workItem.notes ?? ''),
    )
  }
  for (const item of file.items) {
    const done = item.id === 'read-the-thing'
    run(
      `INSERT INTO items (roadmap_id, id, name, type, phase, work_item_id, skills, depends_on,
         baseline_start, baseline_end, projected_start, projected_end, price, link, notes,
         state, completed_at, sort_order, duration, resources, done_when, hours_done)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      roadmapId,
      String(item.id),
      String(item.name),
      String(item.type),
      Number(item.phase),
      (item.workItemId as string | null) ?? null,
      JSON.stringify(item.skills),
      JSON.stringify(item.dependsOn ?? []),
      String(item.baselineStartDate),
      String(item.baselineEndDate),
      String(item.baselineStartDate),
      String(item.baselineEndDate),
      String(item.price ?? ''),
      (item.link as string | null) ?? null,
      String(item.notes ?? ''),
      // One task underway, so the test sees progress cross the migration.
      done ? 'done' : 'pending',
      done ? '2030-01-09T10:00:00Z' : null,
      Number(item.sortOrder),
      String(item.duration ?? ''),
      JSON.stringify(item.resources ?? []),
      String(item.doneWhen ?? ''),
      done ? 3 : 0,
    )
  }
  for (const phase of file.phases as Array<Record<string, unknown>>) {
    run(
      'INSERT INTO phases (roadmap_id, number, name, closing_milestone_id) VALUES (?, ?, ?, ?)',
      roadmapId,
      Number(phase.number),
      String(phase.name),
      (phase.closingMilestoneId as string | null) ?? null,
    )
  }
  run(
    "INSERT INTO meta (roadmap_id, key, value) VALUES (?, 'time_zone', 'UTC') ON CONFLICT(roadmap_id, key) DO NOTHING",
    roadmapId,
  )
}

/** What upgrading the file gives, with the progress `storeV1` recorded. */
function upgraded(file: V1): RoadmapContent {
  const content = seedContent(parseSeed(file))
  const tasks = content.tasks.map(
    (task): Task =>
      task.id === 'read-the-thing'
        ? { ...task, state: 'done', completedAt: '2030-01-09T10:00:00Z', hoursDone: 3 }
        : task,
  )
  return { ...content, tasks }
}

const byId = <T extends { id: string }>(list: readonly T[]) =>
  [...list].sort((a, b) => a.id.localeCompare(b.id))

describe('migration 0013', () => {
  it('stores what the file upgrade gives, progress included', async () => {
    const file = v1WithEveryCase()
    const database = sqliteD1({ before: '0013' })
    storeV1(database.sqlite, 1, file)
    database.migrate()

    const stored = await loadAppState(database.space)
    const expected = upgraded(file)
    expect(byId(stored.features)).toEqual(byId(expected.features))
    expect(byId(stored.stories)).toEqual(byId(expected.stories))
    expect(byId(stored.tasks)).toEqual(byId(expected.tasks))
    expect(stored.roadmap.phases.map((phase) => phase.closingMilestoneId)).toEqual(
      expected.roadmap.phases.map((phase) => phase.closingMilestoneId),
    )
  })

  it('keeps each roadmap’s rows to itself, even where their ids meet', async () => {
    const database = sqliteD1({ before: '0013' })
    database.sqlite
      .prepare("INSERT INTO roadmaps (id, name, created_at) VALUES (2, 'Second', '2030-01-01T00:00:00Z')")
      .run()
    storeV1(database.sqlite, 1, readV1())
    // In the second roadmap the course is a lone item, with the id the first's
    // work item has: the migration must not read one roadmap's groups into the other.
    const second = readV1()
    second.workItems = []
    second.items = second.items
      .filter((item) => item.id === 'course-part-1')
      .map((item) => ({ ...item, id: 'the-course', workItemId: null, dependsOn: [] }))
    second.phases = [{ number: 1, name: 'Only', closingMilestoneId: null }]
    storeV1(database.sqlite, 2, second)
    database.migrate()

    const first = await loadAppState(database.space)
    const other = await loadAppState({ db: database.db, roadmapId: 2 })
    expect(byId(first.stories)).toEqual(byId(upgraded(readV1()).stories))
    expect(other.stories.map((story) => story.id)).toEqual(['the-course-story'])
    expect(other.tasks.map((task) => [task.id, task.storyId])).toEqual([['the-course', 'the-course-story']])
  })

  it('reads a plan kept in the history, or a draft, in the first format', async () => {
    const database = sqliteD1({ before: '0013' })
    storeV1(database.sqlite, 1, readV1())
    const renamed = (name: string) => {
      const plan = readV1()
      plan.items = plan.items.map((item) => (item.id === 'read-the-thing' ? { ...item, name } : item))
      return JSON.stringify(plan)
    }
    database.sqlite
      .prepare(
        `INSERT INTO plan_versions (roadmap_id, created_at, reason, summary, later_changes, revision, plan)
         VALUES (1, '2030-01-01T00:00:00Z', 'edit', 'Before stories', 0, 0, ?)`,
      )
      .run(renamed('Kept in the history'))
    database.sqlite
      .prepare(
        `INSERT INTO draft (roadmap_id, revision, started_at, updated_at, base_hash, plan)
         VALUES (1, 1, '2030-01-01T00:00:00Z', '2030-01-01T00:00:00Z', 'old', ?)`,
      )
      .run(renamed('Drafted before stories'))
    database.migrate()

    const nameOf = (tasks: readonly Task[]) => tasks.find((task) => task.id === 'read-the-thing')?.name
    expect(nameOf((await loadDraftState(database.space)).tasks)).toBe('Drafted before stories')

    const restored = await applyRestore(database.space, 0, 1)
    expect(nameOf(restored.tasks)).toBe('Kept in the history')
    expect(restored.tasks.find((task) => task.id === 'read-the-thing')?.state).toBe('done')

    const published = await publishDraft(database.space, restored.revision, 1)
    expect(nameOf(published.tasks)).toBe('Drafted before stories')
    expect(published.stories.map((story) => story.id)).toContain('read-the-thing-story')
  })
})
