import { inheritedSkills, suggestSkills } from '../../../src/core/skills'
import { only, refusal } from '../../../src/server/http'
import type { Env } from '../../../src/server/repository'
import { loadTarget } from '../../../src/server/target'
import { spaceOf } from '../../../src/server/space'

const MOST = 20

/**
 * The mapped skills a task probably feeds, surest first, each with its axis and
 * why: `GET /api/skills/suggest?name=…`, with `storyId`, `id` (the task itself,
 * when it exists), `link`, `notes` and `limit` as wanted, and `draft=1` for the
 * draft. `inherited` is what nearly all of the story's tasks carry, once it has
 * three — what the app starts a new task in that story with.
 *
 * It reads and never writes. The app suggests in the browser with the same
 * code; this is for callers that do not carry it, like an agent.
 */
export const onRequest = only<Env>('GET', async ({ env, data, request }) => {
  const space = spaceOf(env, data)
  const params = new URL(request.url).searchParams
  const name = params.get('name') ?? ''
  const storyId = params.get('storyId')
  const id = params.get('id')
  if (name.trim() === '' && storyId === null) {
    return Response.json({ error: 'name or storyId is needed to suggest from' }, { status: 400 })
  }
  const asked = Number(params.get('limit') ?? 5)
  if (!Number.isInteger(asked) || asked < 1) {
    return Response.json({ error: 'limit must be a whole number above zero' }, { status: 400 })
  }

  try {
    const state = await loadTarget(space, params.get('draft') === '1' ? 'draft' : 'live')
    const subject = { name, storyId, id, link: params.get('link'), notes: params.get('notes') ?? '' }
    return Response.json({
      revision: state.revision,
      suggestions: suggestSkills(subject, state, Math.min(asked, MOST)).map((each) => ({
        ...each,
        axis: state.roadmap.skillDimension[each.skill],
      })),
      inherited: storyId === null ? [] : inheritedSkills(storyId, state, id),
    })
  } catch (error) {
    const refused = refusal(error)
    if (refused) return refused
    const message = error instanceof Error ? error.message : 'Unknown error'
    return Response.json({ error: message }, { status: 500 })
  }
})
