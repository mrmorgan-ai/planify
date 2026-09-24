import { only } from '../../src/server/http'
import { loadAppState, type Env } from '../../src/server/repository'
import { spaceOf } from '../../src/server/space'

/** The whole world: today in the roadmap's timezone, the roadmap, every item. */
export const onRequest = only<Env>('GET', async ({ env, data }) => {
  const space = spaceOf(env, data)
  return Response.json(await loadAppState(space))
})
