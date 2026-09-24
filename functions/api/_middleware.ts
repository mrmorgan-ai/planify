import { authenticate, type AccessEnv } from '../../src/server/access'
import type { Env } from '../../src/server/repository'
import { NoRoadmapError, ON_BEHALF_OF, resolveRoadmap } from '../../src/server/space'

/**
 * Every API request: who Access signed in, then which roadmap that is. The
 * roadmap goes to the route in `data.roadmapId`, and routes read it with
 * `spaceOf` — this is the only place it is decided.
 */
export const onRequest: PagesFunction<AccessEnv & Env> = async ({ request, env, next, data }) => {
  const caller = await authenticate(request, env)
  if (caller instanceof Response) return caller

  try {
    data.roadmapId = await resolveRoadmap(env.DB, caller, request.headers.get(ON_BEHALF_OF))
  } catch (error) {
    if (error instanceof NoRoadmapError) {
      return Response.json({ error: error.message }, { status: 403 })
    }
    throw error
  }
  return next()
}
