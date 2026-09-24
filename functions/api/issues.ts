import { validate } from '../../src/core/validate'
import { only, refusal } from '../../src/server/http'
import type { Env } from '../../src/server/repository'
import { loadTarget } from '../../src/server/target'
import { spaceOf } from '../../src/server/space'

/**
 * Every rule the plan breaks, with the revision it was checked at:
 * `GET /api/issues`, or `?draft=1` for the draft. The app checks in the browser
 * with the same code; this is for callers that do not carry it, like an agent.
 */
export const onRequest = only<Env>('GET', async ({ env, data, request }) => {
  const space = spaceOf(env, data)
  const draft = new URL(request.url).searchParams.get('draft') === '1'
  try {
    const state = await loadTarget(space, draft ? 'draft' : 'live')
    return Response.json({ revision: state.revision, issues: validate(state) })
  } catch (error) {
    const refused = refusal(error)
    if (refused) return refused
    const message = error instanceof Error ? error.message : 'Unknown error'
    return Response.json({ error: message }, { status: 500 })
  }
})
