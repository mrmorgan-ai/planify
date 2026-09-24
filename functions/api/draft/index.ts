import { discardDraft, loadDraftState, startDraft } from '../../../src/server/drafts'
import { refusal } from '../../../src/server/http'
import type { Env } from '../../../src/server/repository'
import { spaceOf } from '../../../src/server/space'

const METHODS = ['GET', 'POST', 'DELETE']

/**
 * The draft of the plan. GET answers with its world — its plan, the live
 * roadmap's progress — or 404 when there is none. POST starts one from the live
 * plan, or opens the one already in progress, and answers with its world.
 * DELETE drops it and answers with the live world.
 */
export const onRequest: PagesFunction<Env> = async ({ env, data, request }) => {
  const space = spaceOf(env, data)
  try {
    switch (request.method) {
      case 'GET':
        return Response.json(await loadDraftState(space))
      case 'POST':
        return Response.json(await startDraft(space))
      case 'DELETE':
        return Response.json(await discardDraft(space))
      default:
        return Response.json(
          { error: `Only ${METHODS.join(', ')} are allowed on this route` },
          { status: 405, headers: { Allow: METHODS.join(', ') } },
        )
    }
  } catch (error) {
    const refused = refusal(error)
    if (refused) return refused
    const message = error instanceof Error ? error.message : 'Unknown error'
    return Response.json({ error: message }, { status: 500 })
  }
}
