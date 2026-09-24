/**
 * One roadmap's share of the database. Every function that reads or writes a
 * roadmap takes one, and every query it makes names `roadmapId`, so a request
 * can only ever reach the roadmap its space was made for.
 *
 * A space is made in one place: the API's middleware, from who Access signed in
 * (see `resolveRoadmap`). Nothing a request sends in its body or its path picks
 * the roadmap.
 */
export type Space = {
  db: D1Database
  roadmapId: number
}

/** The header the MCP server names the person it acts for with. */
export const ON_BEHALF_OF = 'X-Planify-On-Behalf-Of'

/** The roadmap everything lived in before there were several. */
export const FIRST_ROADMAP = 1

/** Who a request comes from, as Access signed it. */
export type Caller = {
  /** An email for a person, a client id for a service token. */
  principal: string
  /**
   * Local development: no Access in front, so the development identity stands
   * in for a person, and may act for anyone as a delegate would.
   */
  local: boolean
}

/**
 * A principal as members and delegates are stored: trimmed and lower case.
 * Emails reach Access from whichever provider signed the person in, and one
 * that capitalises differently must still find its roadmap. Client ids are
 * lower case already.
 */
export function normalPrincipal(principal: string): string {
  return principal.trim().toLowerCase()
}

/** A request that reached the API but has no roadmap to act on. Answered 403. */
export class NoRoadmapError extends Error {}

/**
 * The roadmap a request acts on.
 *
 * The caller is who Access signed in. A delegate — the MCP server's service
 * token — may name someone else in `X-Planify-On-Behalf-Of`, and then acts on
 * that person's roadmap; anyone else naming someone is refused, so the header
 * cannot be used to reach another person's plan.
 *
 * Until the first member is ever added, anyone Access lets in reaches the first
 * roadmap, which is how the app worked before it had members: deploying this
 * never locks the owner out. From the first member on, a principal that is not
 * a member is refused, even if every member is later removed.
 */
export async function resolveRoadmap(
  db: D1Database,
  caller: Caller,
  onBehalfOf: string | null,
): Promise<number> {
  const acting =
    onBehalfOf === null || normalPrincipal(onBehalfOf) === '' ? null : normalPrincipal(onBehalfOf)
  const principal = acting ?? normalPrincipal(caller.principal)

  const [delegate, member, anyone] = await db.batch([
    db
      .prepare('SELECT 1 AS yes FROM delegates WHERE principal = ?')
      .bind(normalPrincipal(caller.principal)),
    db.prepare('SELECT roadmap_id FROM roadmap_members WHERE principal = ?').bind(principal),
    db.prepare('SELECT EXISTS (SELECT 1 FROM members_required) AS yes'),
  ])

  if (acting !== null && !caller.local && (delegate?.results ?? []).length === 0) {
    throw new NoRoadmapError(`${caller.principal} may not act on behalf of someone else`)
  }

  const found = (member?.results ?? [])[0] as { roadmap_id: number } | undefined
  if (found) return found.roadmap_id

  const closed = ((anyone?.results ?? [])[0] as { yes: number } | undefined)?.yes === 1
  if (!closed) return FIRST_ROADMAP

  throw new NoRoadmapError(
    `There is no roadmap for ${principal}. Ask the owner of this Planify to add you.`,
  )
}

/**
 * The space a route acts on, as the middleware resolved it. Throws when the
 * middleware did not run, which would be a routing mistake rather than a
 * request to answer.
 */
export function spaceOf(env: { DB: D1Database }, data: Record<string, unknown>): Space {
  const roadmapId = data.roadmapId
  if (typeof roadmapId !== 'number') {
    throw new Error('No roadmap was resolved for this request')
  }
  return { db: env.DB, roadmapId }
}
