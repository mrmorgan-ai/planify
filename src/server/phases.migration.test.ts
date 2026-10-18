import { describe, expect, it } from 'vitest'
import { sqliteD1 } from './testing/sqliteD1'

// migrations/0014_more_phases.sql rebuilds stories, tasks and phases to lift the
// six-phase CHECK. This fills the schema as it was, runs the migration over it,
// and holds what was stored to the same rows, with the same foreign keys.

describe('0014_more_phases', () => {
  it('keeps what was stored and accepts phases past the sixth', () => {
    const { sqlite, migrate } = sqliteD1({ before: '0014_more_phases.sql' })
    const run = (sql: string, ...values: Array<string | number | null>) =>
      sqlite.prepare(sql).run(...values)

    run(`INSERT INTO stories (roadmap_id, id, name, phase) VALUES (1, 'story-a', 'Story A', 6)`)
    run(
      `INSERT INTO tasks (roadmap_id, id, name, story_id, baseline_start, baseline_end,
         projected_start, projected_end, state, completed_at, sort_order, hours_done)
       VALUES (1, 'task-a', 'Task A', 'story-a', '2030-01-07', '2030-01-13',
         '2030-01-07', '2030-01-13', 'done', '2030-01-10T10:00:00Z', 1, 2.5)`,
    )
    run(`INSERT INTO phases (roadmap_id, number, name, closing_milestone_id) VALUES (1, 6, 'Last', 'task-a')`)
    expect(() => run(`INSERT INTO phases (roadmap_id, number, name) VALUES (1, 7, 'Seventh')`)).toThrow()

    migrate()

    expect(sqlite.prepare(`SELECT id, phase FROM stories WHERE roadmap_id = 1`).all()).toEqual([
      { id: 'story-a', phase: 6 },
    ])
    expect(
      sqlite.prepare(`SELECT state, hours_done, completed_at FROM tasks WHERE id = 'task-a'`).get(),
    ).toEqual({ state: 'done', hours_done: 2.5, completed_at: '2030-01-10T10:00:00Z' })
    expect(sqlite.prepare(`SELECT closing_milestone_id AS c FROM phases WHERE number = 6`).get()).toEqual({
      c: 'task-a',
    })

    run(`INSERT INTO phases (roadmap_id, number, name) VALUES (1, 13, 'Move')`)
    run(`INSERT INTO stories (roadmap_id, id, name, phase) VALUES (1, 'story-b', 'Story B', 13)`)
    expect(() => run(`INSERT INTO phases (roadmap_id, number, name) VALUES (1, 0, 'Zero')`)).toThrow()
    expect(() =>
      run(
        `INSERT INTO tasks (roadmap_id, id, name, story_id, baseline_start, baseline_end,
           projected_start, projected_end, sort_order)
         VALUES (1, 'task-b', 'Task B', 'no-such-story', '2030-01-07', '2030-01-13',
           '2030-01-07', '2030-01-13', 2)`,
      ),
    ).toThrow()
    expect(sqlite.prepare(`PRAGMA foreign_key_check`).all()).toEqual([])
  })
})
