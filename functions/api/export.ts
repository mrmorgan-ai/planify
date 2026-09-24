import { roadmapFileName, toSeedFile } from '../../src/core/seed'
import { nowIso } from '../../src/server/clock'
import { only } from '../../src/server/http'
import { loadAppState, type Env } from '../../src/server/repository'
import { spaceOf } from '../../src/server/space'

/**
 * The roadmap as a seed file, for editing elsewhere and importing back. Content
 * only: progress stays in the database. The file names the revision it was
 * taken from, so an import made from it later is refused if the roadmap changed
 * in between instead of undoing that change. It is named for when it was taken.
 */
export const onRequest = only<Env>('GET', async ({ env, data }) => {
  const space = spaceOf(env, data)
  const state = await loadAppState(space)
  const file = { revision: state.revision, ...toSeedFile(state) }
  return new Response(`${JSON.stringify(file, null, 2)}\n`, {
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'content-disposition': `attachment; filename="${roadmapFileName(nowIso(), state.roadmap.timeZone)}"`,
    },
  })
})
