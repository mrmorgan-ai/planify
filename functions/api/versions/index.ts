import { listVersions } from '../../../src/server/history'
import { only } from '../../../src/server/http'
import type { Env } from '../../../src/server/repository'
import { spaceOf } from '../../../src/server/space'

/** The history of the plan, newest first: what each change replaced, without the plans. */
export const onRequest = only<Env>('GET', async ({ env, data }) => {
  const space = spaceOf(env, data)
  return Response.json(await listVersions(space))
})
