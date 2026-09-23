import { only, refusal, revisionOf } from '../../src/server/http'
import { mutate, reproject, type Env } from '../../src/server/repository'

/**
 * Recomputes every projection from the current baselines. Run after reloading
 * the seed: the upsert updates baselines and dependencies but deliberately never
 * touches the projected dates, so this is what brings them back in line.
 *
 * The revision is optional here, unlike every other write: a full recompute is
 * derived from what is stored and cannot overwrite anyone's change, and scripts
 * call it with no body at all.
 */
export const onRequest = only<Env>('POST', async ({ env, request }) => {
  const body: unknown = await request.json().catch(() => null)

  try {
    return Response.json(await mutate(env.DB, revisionOf(body), reproject))
  } catch (error) {
    const refused = refusal(error)
    if (refused) return refused
    const message = error instanceof Error ? error.message : 'Unknown error'
    return Response.json({ error: message }, { status: 500 })
  }
})
