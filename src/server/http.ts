import { InvalidWriteError, StaleRevisionError } from './repository'

/** The revision a write says it was made from, or null when it names none. */
export function revisionOf(body: unknown): number | null {
  const revision = (body as { revision?: unknown } | null)?.revision
  return typeof revision === 'number' && Number.isInteger(revision) && revision >= 0
    ? revision
    : null
}

export function missingRevision(): Response {
  return Response.json(
    { error: 'revision must be the revision this change was made from' },
    { status: 400 },
  )
}

/**
 * The response for a write the roadmap refused on its own terms, or null when
 * the error is something else. A stale write answers 409 with the current
 * world, so the client replaces its copy instead of fetching it again; a write
 * that would break a rule answers 422 with the errors it would have introduced.
 */
export function refusal(error: unknown): Response | null {
  if (error instanceof StaleRevisionError) {
    return Response.json({ error: error.message, state: error.state }, { status: 409 })
  }
  if (error instanceof InvalidWriteError) {
    return Response.json({ error: error.message, issues: error.issues }, { status: 422 })
  }
  return null
}

/**
 * Restricts a route to one method. Without this, Pages lets an unhandled method
 * fall through to the static asset server, and the SPA fallback answers an API
 * call with 200 and a page of HTML — which reads like success to a client.
 */
export function only<Env>(method: string, handler: PagesFunction<Env>): PagesFunction<Env> {
  return async (context) => {
    if (context.request.method !== method) {
      return Response.json(
        { error: `Only ${method} is allowed on this route` },
        { status: 405, headers: { Allow: method } },
      )
    }
    return handler(context)
  }
}
