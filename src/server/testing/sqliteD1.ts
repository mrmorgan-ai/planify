import { readdirSync, readFileSync } from 'node:fs'
import { DatabaseSync, type SQLInputValue } from 'node:sqlite'

const MIGRATIONS = new URL('../../../migrations/', import.meta.url)

/**
 * The part of D1 the repository uses — prepare, bind, run, first, batch — over an
 * in-memory SQLite with every migration applied. Same engine, same foreign keys
 * and constraint messages, so the order of a write batch is tested against the
 * schema it runs on in production.
 *
 * A batch is one transaction, as in D1. `sqlite` is exposed so a test can act
 * as another device writing in the middle of a request.
 */
export function sqliteD1(): { db: D1Database; sqlite: DatabaseSync } {
  const sqlite = new DatabaseSync(':memory:')
  sqlite.exec('PRAGMA foreign_keys = ON')
  for (const file of readdirSync(MIGRATIONS).filter((name) => name.endsWith('.sql')).sort()) {
    sqlite.exec(readFileSync(new URL(file, MIGRATIONS), 'utf8'))
  }

  const statement = (sql: string, params: SQLInputValue[] = []) => ({
    sql,
    params,
    bind: (...values: SQLInputValue[]) => statement(sql, values),
    all: () => ({ results: sqlite.prepare(sql).all(...params) }),
    first: async () => sqlite.prepare(sql).get(...params) ?? null,
    run: async () => ({ meta: { changes: Number(sqlite.prepare(sql).run(...params).changes) } }),
  })

  const db = {
    prepare: (sql: string) => statement(sql),
    batch: async (statements: Array<ReturnType<typeof statement>>) => {
      sqlite.exec('BEGIN')
      try {
        const results = statements.map((each) => each.all())
        sqlite.exec('COMMIT')
        return results
      } catch (error) {
        sqlite.exec('ROLLBACK')
        throw error
      }
    },
  }
  return { db: db as unknown as D1Database, sqlite }
}
