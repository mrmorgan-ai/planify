import { DEFAULT_TIME_ZONE } from '../core/constants'
import { recomputeProjections } from '../core/schedule'
import type { AppState, Item, Roadmap, ScheduleOptions } from '../core/types'
import { todayIn } from './clock'
import {
  changedItems,
  toBlackout,
  toItem,
  toMeta,
  toPhase,
  toSkillDimension,
  toWorkItem,
  type BlackoutRow,
  type DimensionRow,
  type ItemRow,
  type MetaRow,
  type PhaseRow,
  type SkillRow,
  type WorkItemRow,
} from './rows'

export type Env = {
  DB: D1Database
}

const ITEM_COLUMNS = `id, name, type, phase, work_item_id, skills, depends_on,
  baseline_start, baseline_end, projected_start, projected_end,
  price, link, resources, duration, notes, done_when, state, completed_at,
  hours_done, sort_order`

/**
 * Reads the whole world in one batch. The roadmap is small enough that paging or
 * caching would cost more complexity than it saves, and the engine needs the
 * full dependency graph on every call anyway.
 */
export async function loadAppState(db: D1Database): Promise<AppState> {
  const [items, workItems, phases, blackouts, dimensions, skills, meta] = await db.batch([
    db.prepare(`SELECT ${ITEM_COLUMNS} FROM items ORDER BY phase, sort_order`),
    db.prepare('SELECT id, name, type, link, resources, notes FROM work_items ORDER BY id'),
    db.prepare('SELECT number, name, closing_milestone_id FROM phases ORDER BY number'),
    db.prepare('SELECT from_date, to_date, reason FROM blackouts ORDER BY from_date'),
    db.prepare('SELECT name FROM dimensions ORDER BY sort_order'),
    db.prepare('SELECT name, dimension FROM skills ORDER BY name'),
    db.prepare('SELECT key, value FROM meta'),
  ])

  const settings = toMeta((meta?.results ?? []) as MetaRow[])
  const roadmap: Roadmap = {
    timeZone: settings.time_zone ?? DEFAULT_TIME_ZONE,
    startDate: settings.start_date ?? '',
    weeklyHours: {
      // Zero reads as "not declared" downstream, which is the honest default:
      // the app never invents a capacity on the owner's behalf.
      normal: Number(settings.weekly_hours_normal ?? '0'),
    },
    phases: ((phases?.results ?? []) as PhaseRow[]).map(toPhase),
    blackouts: ((blackouts?.results ?? []) as BlackoutRow[]).map(toBlackout),
    dimensions: ((dimensions?.results ?? []) as DimensionRow[]).map((row) => row.name),
    skillDimension: toSkillDimension((skills?.results ?? []) as SkillRow[]),
  }

  return {
    today: todayIn(roadmap.timeZone),
    revision: Number(settings.revision ?? '0'),
    seedVersion: settings.seed_version ?? '0',
    roadmap,
    workItems: ((workItems?.results ?? []) as WorkItemRow[]).map(toWorkItem),
    items: ((items?.results ?? []) as ItemRow[]).map(toItem),
  }
}

export function scheduleOptions(roadmap: Roadmap): ScheduleOptions {
  return { blackouts: roadmap.blackouts, timeZone: roadmap.timeZone }
}

/**
 * A write made from a copy of the roadmap that is no longer current: another
 * device or tab saved in between. Carries the current world, so the client can
 * catch up instead of guessing.
 */
export class StaleRevisionError extends Error {
  constructor(readonly state: AppState) {
    super(
      `The roadmap changed since this copy was loaded (it is now at revision ${state.revision}). ` +
        'It has been reloaded; make the change again.',
    )
  }
}

/**
 * Loads, transforms, writes back only what moved, and returns the new world
 * without reading the database again. D1 has no interactive transactions, so the
 * writes go out as one batch — which it runs as a single implicit transaction.
 *
 * Every write is a compare-and-swap on `revision`. The client says which
 * revision it was looking at, and a write from an older one is refused before
 * anything runs. The batch then re-checks the revision it read against the one
 * stored, inside the transaction, so a write that lands between the read and the
 * batch is caught too rather than overwritten.
 */
export async function mutate(
  db: D1Database,
  /** The revision the client made this change from; null accepts any. */
  expectedRevision: number | null,
  transform: (state: AppState) => Item[],
  /** More writes for the same batch, which lands whole or not at all. */
  alongside: (state: AppState) => D1PreparedStatement[] = () => [],
): Promise<AppState> {
  const state = await loadAppState(db)
  if (expectedRevision !== null && expectedRevision !== state.revision) {
    throw new StaleRevisionError(state)
  }

  const items = transform(state)
  const changed = changedItems(state.items, items)
  const revision = state.revision + 1

  const writes = changed.map((item) =>
    db
      .prepare(
        `UPDATE items
         SET state = ?, completed_at = ?, hours_done = ?,
             baseline_start = ?, baseline_end = ?,
             projected_start = ?, projected_end = ?
         WHERE id = ?`,
      )
      .bind(
        item.state,
        item.completedAt,
        item.hoursDone,
        item.baselineStartDate,
        item.baselineEndDate,
        item.projectedStartDate,
        item.projectedEndDate,
        item.id,
      ),
  )
  writes.unshift(...alongside(state))
  // The guard: when the stored revision is no longer the one read above, this
  // selects a row, the insert collides with the existing 'revision' key, and the
  // whole batch rolls back before any of it lands.
  writes.unshift(
    db
      .prepare(
        `INSERT INTO meta (key, value)
         SELECT 'revision', '' WHERE (SELECT value FROM meta WHERE key = 'revision') <> ?`,
      )
      .bind(String(state.revision)),
  )
  writes.push(
    db.prepare("UPDATE meta SET value = ? WHERE key = 'revision'").bind(String(revision)),
  )

  try {
    await db.batch(writes)
  } catch (error) {
    if (error instanceof Error && error.message.includes('UNIQUE constraint failed: meta.key')) {
      throw new StaleRevisionError(await loadAppState(db))
    }
    throw error
  }

  return { ...state, revision, items }
}

/** Recomputes every projection from the current baselines and completions. */
export function reproject(state: AppState): Item[] {
  return recomputeProjections(state.items, scheduleOptions(state.roadmap))
}

/**
 * Keeps the plan as it stood before a reschedule replaces it. Returned as a
 * statement for `mutate` to run in its own batch, so the new plan is never
 * written without the old one kept.
 */
export function savePlanVersion(
  db: D1Database,
  state: AppState,
  version: { createdAt: string; restartDate: string; shiftDays: number },
): D1PreparedStatement {
  const plan = state.items.map((item) => ({
    id: item.id,
    state: item.state,
    baselineStart: item.baselineStartDate,
    baselineEnd: item.baselineEndDate,
    projectedStart: item.projectedStartDate,
    projectedEnd: item.projectedEndDate,
  }))
  return db
    .prepare(
      `INSERT INTO plan_versions (created_at, reason, restart_date, shift_days, plan)
       VALUES (?, 'reschedule', ?, ?, ?)`,
    )
    .bind(version.createdAt, version.restartDate, version.shiftDays, JSON.stringify(plan))
}
