import type { AppState, CivilDate, State } from '../core/types'

/**
 * Every call answers with the whole world, so the client replaces its state
 * instead of merging a patch. The API reports the error message itself; falling
 * back to the status code only matters when the response is not JSON at all.
 */
async function call(url: string, init?: RequestInit): Promise<AppState> {
  const response = await fetch(url, init)
  const body: unknown = await response.json().catch(() => null)

  if (!response.ok) {
    const { error: reported, state } = (body ?? {}) as { error?: string; state?: AppState }
    const message = reported ?? `HTTP ${response.status}`
    if (response.status === 409 && state) throw new StaleStateError(message, state)
    throw new Error(message)
  }
  return body as AppState
}

/** A write refused for being made from an old copy. Carries the current one. */
export class StaleStateError extends Error {
  constructor(
    message: string,
    readonly state: AppState,
  ) {
    super(message)
  }
}

export function fetchState(): Promise<AppState> {
  return call('/api/state')
}

// Every write names the revision it was made from, so the server can refuse one
// made from a copy another device has already changed.

export function setItemState(id: string, state: State, revision: number): Promise<AppState> {
  return call(`/api/items/${encodeURIComponent(id)}/state`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ state, revision }),
  })
}

/** Moves an item's plan. The server recomputes every projection and returns it. */
export function setItemDates(
  id: string,
  baselineStartDate: CivilDate,
  baselineEndDate: CivilDate,
  revision: number,
): Promise<AppState> {
  return call(`/api/items/${encodeURIComponent(id)}/dates`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ baselineStartDate, baselineEndDate, revision }),
  })
}

/** Declares hours spent. Progress only: the item's state does not move. */
export function setItemHours(id: string, hours: number, revision: number): Promise<AppState> {
  return call(`/api/items/${encodeURIComponent(id)}/hours`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ hours, revision }),
  })
}

/**
 * Moves every unfinished item so the plan restarts on this date. The server
 * keeps the plan it replaces, and returns the new world.
 */
export function reschedule(restartDate: CivilDate, revision: number): Promise<AppState> {
  return call('/api/reschedule', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ restartDate, revision }),
  })
}
