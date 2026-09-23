import type { PlanVersion, VersionReason } from '../core/history'
import { parseSeed, type SeedFile } from '../core/seed'
import type { IsoDateTime } from '../core/types'

/** How many versions the history keeps. Older ones go as new ones arrive. */
export const HISTORY_LIMIT = 50

/**
 * Edits closer together than this are one change. Saving a form section by
 * section, or fixing a typo right after, should not push real versions out.
 */
export const BURST_MINUTES = 10

/** A plan about to be replaced, and what is replacing it. */
export type Replaced = {
  /** The plan as the roadmap file, already serialized. */
  plan: string
  revision: number
  reason: VersionReason
  summary: string
  now: IsoDateTime
}

/**
 * The statements that keep the plan a change replaces, for the change's own
 * batch: the version lands with the change or not at all.
 *
 * An edit within `BURST_MINUTES` of the version before it, itself an edit, is
 * folded into that one — it already holds the plan from before the burst — and
 * only counted. Both statements test the same condition, and the update does
 * not change what it tests, so exactly one of them acts.
 */
export function keepVersion(db: D1Database, replaced: Replaced): D1PreparedStatement[] {
  const insert = `INSERT INTO plan_versions (created_at, reason, summary, revision, plan)
    SELECT ?, ?, ?, ?, ?`
  const values = [replaced.now, replaced.reason, replaced.summary, replaced.revision, replaced.plan]
  const prune = db.prepare(
    `DELETE FROM plan_versions
     WHERE id NOT IN (SELECT id FROM plan_versions ORDER BY id DESC LIMIT ${HISTORY_LIMIT})`,
  )
  if (replaced.reason !== 'edit') return [db.prepare(insert).bind(...values), prune]

  const burstStart = new Date(Date.parse(replaced.now) - BURST_MINUTES * 60_000).toISOString()
  const recentEdit = `SELECT id FROM plan_versions
    WHERE id = (SELECT max(id) FROM plan_versions) AND reason = 'edit' AND created_at > ?`
  return [
    db
      .prepare(`UPDATE plan_versions SET later_changes = later_changes + 1 WHERE id IN (${recentEdit})`)
      .bind(burstStart),
    db.prepare(`${insert} WHERE NOT EXISTS (${recentEdit})`).bind(...values, burstStart),
    prune,
  ]
}

/** A version id from a route's path, or null when it is not one. */
export function versionId(param: string | string[] | undefined): number | null {
  const raw = Array.isArray(param) ? param[0] : param
  const id = Number(raw)
  return Number.isInteger(id) && id > 0 ? id : null
}

type VersionRow = {
  id: number
  created_at: string
  reason: VersionReason
  summary: string
  later_changes: number
  revision: number
}

/** The history, newest first, without the plans themselves. */
export async function listVersions(db: D1Database): Promise<PlanVersion[]> {
  const { results } = await db
    .prepare(
      `SELECT id, created_at, reason, summary, later_changes, revision
       FROM plan_versions ORDER BY id DESC`,
    )
    .all<VersionRow>()
  return results.map((row) => ({
    id: row.id,
    createdAt: row.created_at,
    reason: row.reason,
    summary: row.summary,
    laterChanges: row.later_changes,
    revision: row.revision,
  }))
}

/** One version with its plan, or null when there is no such version. */
export async function loadVersion(
  db: D1Database,
  id: number,
): Promise<{ version: PlanVersion; plan: SeedFile } | null> {
  const row = await db
    .prepare(
      `SELECT id, created_at, reason, summary, later_changes, revision, plan
       FROM plan_versions WHERE id = ?`,
    )
    .bind(id)
    .first<VersionRow & { plan: string }>()
  if (!row) return null
  return {
    version: {
      id: row.id,
      createdAt: row.created_at,
      reason: row.reason,
      summary: row.summary,
      laterChanges: row.later_changes,
      revision: row.revision,
    },
    plan: parseSeed(JSON.parse(row.plan)),
  }
}
