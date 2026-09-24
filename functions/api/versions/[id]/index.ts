import { roadmapFileName } from '../../../../src/core/seed'
import { loadVersion, versionId } from '../../../../src/server/history'
import { only } from '../../../../src/server/http'
import { loadAppState, type Env } from '../../../../src/server/repository'
import { spaceOf } from '../../../../src/server/space'

/**
 * One version of the plan as a roadmap file, like the export. It names the
 * revision it was the plan at, so importing it later compares it with the
 * roadmap as it is now instead of silently undoing what changed since.
 */
export const onRequest = only<Env>('GET', async ({ env, data, params }) => {
  const space = spaceOf(env, data)
  const id = versionId(params.id)
  const kept = id === null ? null : await loadVersion(space, id)
  if (!kept) return Response.json({ error: 'No such version' }, { status: 404 })

  const { roadmap } = await loadAppState(space)
  const name = roadmapFileName(kept.version.createdAt, roadmap.timeZone, kept.version.id)
  const file = { revision: kept.version.revision, ...kept.plan }
  return new Response(`${JSON.stringify(file, null, 2)}\n`, {
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'content-disposition': `attachment; filename="${name}"`,
    },
  })
})

