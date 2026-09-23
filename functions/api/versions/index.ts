import { listVersions } from '../../../src/server/history'
import { only } from '../../../src/server/http'
import type { Env } from '../../../src/server/repository'

/** The history of the plan, newest first: what each change replaced, without the plans. */
export const onRequest = only<Env>('GET', async ({ env }) => {
  return Response.json(await listVersions(env.DB))
})
