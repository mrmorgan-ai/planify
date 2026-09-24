import { toSeedFile } from '../core/seed'
import type { RoadmapContent } from '../core/types'
import { fromItem, fromWorkItem } from './rows'

/** One SQL statement and what it binds, before it meets a database. */
export type Statement = { sql: string; params: Array<string | number | null> }

/**
 * The statements that turn one roadmap into another in the database, touching
 * only the rows that differ. Pure, so the order can be tested against a real
 * SQLite without a Worker.
 *
 * Each table gets at most one statement to write and one to delete, whatever
 * the number of rows: the rows travel as one JSON parameter and `json_each`
 * unpacks them. D1 counts every statement of a batch against its per-request
 * query limit, so a statement per row would cap the size of an import or a
 * reschedule.
 *
 * The order follows the foreign keys: a part needs its work item, a phase's
 * closing milestone needs its item, a skill needs its axis. What is written comes
 * first, parents before children, and what is removed goes last, children
 * before parents — so a milestone moved to a new item already points at it by
 * the time the old one is deleted.
 *
 * Every statement is bound to `roadmapId`: it writes that roadmap's rows and
 * deletes only among them, whatever the others hold.
 */
export function contentWrites(
  before: RoadmapContent,
  after: RoadmapContent,
  roadmapId: number,
): Statement[] {
  const writes: Statement[] = []
  const removals: Statement[] = []

  const workItems = diff(before.workItems.map(fromWorkItem), after.workItems.map(fromWorkItem), (row) => row.id)
  const items = diff(before.items.map(fromItem), after.items.map(fromItem), (row) => row.id)
  const phases = diff(
    before.roadmap.phases.map(phaseRow),
    after.roadmap.phases.map(phaseRow),
    (row) => String(row.number),
  )
  const blackouts = diff(
    before.roadmap.blackouts.map(blackoutRow),
    after.roadmap.blackouts.map(blackoutRow),
    (row) => String(row.from_date),
  )
  const dimensions = diff(dimensionRows(before), dimensionRows(after), (row) => String(row.name))
  const skills = diff(skillRows(before), skillRows(after), (row) => String(row.name))
  const meta = diff(metaRows(before), metaRows(after), (row) => String(row.key))

  const upsert = (table: string, key: string, rows: Row[]) => upsertIn(roadmapId, table, key, rows)
  if (workItems.written.length > 0) writes.push(upsert('work_items', 'id', workItems.written))
  if (items.written.length > 0) writes.push(upsert('items', 'id', items.written))
  if (dimensions.written.length > 0) {
    // sort_order is unique and SQLite checks that row by row, so reordering the
    // axes in place would collide halfway. Parking every existing axis on a
    // negative order first leaves the new orders nothing to collide with, and
    // every axis is then written back, moved or not.
    writes.push({
      sql: 'UPDATE dimensions SET sort_order = -sort_order WHERE roadmap_id = ?',
      params: [roadmapId],
    })
    writes.push(upsert('dimensions', 'name', dimensionRows(after)))
  }
  if (skills.written.length > 0) writes.push(upsert('skills', 'name', skills.written))
  if (phases.written.length > 0) writes.push(upsert('phases', 'number', phases.written))
  if (blackouts.written.length > 0) writes.push(upsert('blackouts', 'from_date', blackouts.written))
  if (meta.written.length > 0) writes.push(upsert('meta', 'key', meta.written))

  // Settings are never removed: a key a roadmap does not set is written empty.
  for (const [table, key, removed] of [
    ['phases', 'number', phases.removed],
    ['blackouts', 'from_date', blackouts.removed],
    ['skills', 'name', skills.removed],
    ['dimensions', 'name', dimensions.removed],
    ['items', 'id', items.removed],
    ['work_items', 'id', workItems.removed],
  ] as const) {
    if (removed.length > 0) removals.push(remove(roadmapId, table, key, removed))
  }

  return [...writes, ...removals]
}

/**
 * The plan alone, as the roadmap file has it: what the validator judges and the
 * history keeps. State, hours and projections are left out, so two roadmaps
 * with the same plan give the same text, and ticking an item off changes
 * nothing here — it never pays for a full check or keeps a version.
 */
export function planOf(content: RoadmapContent): string {
  return JSON.stringify(toSeedFile(content))
}

type Row = Record<string, string | number | null>

function diff<T extends Row>(before: T[], after: T[], key: (row: T) => string) {
  const previous = new Map(before.map((row) => [key(row), JSON.stringify(row)]))
  const kept = new Set(after.map(key))
  return {
    written: after.filter((row) => previous.get(key(row)) !== JSON.stringify(row)),
    removed: before.map(key).filter((id) => !kept.has(id)),
  }
}

function upsertIn(roadmapId: number, table: string, key: string, rows: Row[]): Statement {
  const columns = Object.keys(rows[0]!)
  const values = columns.map((column) => `json_extract(value, '$.${column}')`)
  const updates = columns
    .filter((column) => column !== key)
    .map((column) => `${column} = excluded.${column}`)
  // `WHERE true` is SQLite's own requirement: without it, an upsert fed by a
  // SELECT cannot tell its ON CONFLICT from a join's ON.
  return {
    sql:
      `INSERT INTO ${table} (roadmap_id, ${columns.join(', ')}) ` +
      `SELECT ?, ${values.join(', ')} FROM json_each(?) WHERE true ` +
      `ON CONFLICT(roadmap_id, ${key}) DO UPDATE SET ${updates.join(', ')}`,
    params: [roadmapId, JSON.stringify(rows)],
  }
}

function remove(roadmapId: number, table: string, key: string, ids: string[]): Statement {
  // Phase numbers go in as numbers, so they compare equal to the stored ones.
  const values = table === 'phases' ? ids.map(Number) : ids
  return {
    sql: `DELETE FROM ${table} WHERE roadmap_id = ? AND ${key} IN (SELECT value FROM json_each(?))`,
    params: [roadmapId, JSON.stringify(values)],
  }
}

function phaseRow(phase: RoadmapContent['roadmap']['phases'][number]): Row {
  return { number: phase.number, name: phase.name, closing_milestone_id: phase.closingMilestoneId }
}

function blackoutRow(blackout: RoadmapContent['roadmap']['blackouts'][number]): Row {
  return { from_date: blackout.from, to_date: blackout.to, reason: blackout.reason }
}

function dimensionRows(content: RoadmapContent): Row[] {
  return content.roadmap.dimensions.map((name, index) => ({ name, sort_order: index + 1 }))
}

function skillRows(content: RoadmapContent): Row[] {
  return Object.entries(content.roadmap.skillDimension).map(([name, dimension]) => ({ name, dimension }))
}

function metaRows({ roadmap }: RoadmapContent): Row[] {
  return [
    { key: 'time_zone', value: roadmap.timeZone },
    { key: 'start_date', value: roadmap.startDate },
    // Empty rather than zero: an undeclared capacity is stored the way the seed
    // loader has always stored it.
    {
      key: 'weekly_hours_normal',
      value: roadmap.weeklyHours.normal > 0 ? String(roadmap.weeklyHours.normal) : '',
    },
  ]
}
