import { DEFAULT_TIME_ZONE } from '../../src/core/constants'
import { todayIn } from '../../src/server/clock'
import { only } from '../../src/server/http'
import type { Env } from '../../src/server/repository'
import { spaceOf } from '../../src/server/space'

/**
 * Proves the whole chain end to end: the Workers runtime runs, the D1 binding
 * resolves, the schema exists, the caller has a roadmap and its timezone is
 * readable. Kept after the scaffold as the smoke test a deploy is verified with.
 * The counts are the caller's roadmap's.
 */
export const onRequest = only<Env>('GET', async ({ env, data }) => {
  const { db, roadmapId } = spaceOf(env, data)
  const results = await db.batch([
    db
      .prepare(
        `SELECT (SELECT COUNT(*) FROM items WHERE roadmap_id = ?1) AS items,
                (SELECT COUNT(*) FROM phases WHERE roadmap_id = ?1) AS phases`,
      )
      .bind(roadmapId),
    db
      .prepare("SELECT value FROM meta WHERE roadmap_id = ? AND key = 'time_zone'")
      .bind(roadmapId),
  ])

  const totals = results[0]?.results?.[0] as { items: number; phases: number } | undefined
  const configured = results[1]?.results?.[0] as { value: string } | undefined
  const zone = configured?.value ?? DEFAULT_TIME_ZONE

  return Response.json({
    ok: true,
    today: todayIn(zone),
    items: totals?.items ?? 0,
    phases: totals?.phases ?? 0,
  })
})
