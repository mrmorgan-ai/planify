import { toSeedFile } from '../../src/core/seed'
import { only } from '../../src/server/http'
import { loadAppState, type Env } from '../../src/server/repository'

/**
 * The roadmap as a seed file, for editing elsewhere and importing back. Content
 * only: progress stays in the database. The file names the revision it was
 * taken from, so an import made from it later is refused if the roadmap changed
 * in between instead of undoing that change.
 */
export const onRequest = only<Env>('GET', async ({ env }) => {
  const state = await loadAppState(env.DB)
  const file = { revision: state.revision, ...toSeedFile(state) }
  return new Response(`${JSON.stringify(file, null, 2)}\n`, {
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'content-disposition': 'attachment; filename="roadmap.json"',
    },
  })
})
