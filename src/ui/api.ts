import type { Edit } from '../core/edits'
import type { GenerateRequest, Placed } from '../core/generate'
import type { PlanVersion } from '../core/history'
import type { ImportPreview } from '../core/importing'
import type { AppState, CivilDate, State } from '../core/types'

/**
 * Every call answers with the whole world, so the client replaces its state
 * instead of merging a patch. The API reports the error message itself; falling
 * back to the status code only matters when the response is not JSON at all.
 */
async function call<T = AppState>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init)
  const body: unknown = await response.json().catch(() => null)

  if (!response.ok) {
    const { error: reported, state } = (body ?? {}) as { error?: string; state?: AppState }
    const message = reported ?? `HTTP ${response.status}`
    if (response.status === 409 && state) throw new StaleStateError(message, state)
    throw new RequestError(message, response.status)
  }
  return body as T
}

/** A refused request, with its status: 404 is how a draft that has ended is told apart. */
export class RequestError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message)
  }
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

/** Moves an item's plan, live or in the draft. The server recomputes every projection. */
export function setItemDates(
  id: string,
  baselineStartDate: CivilDate,
  baselineEndDate: CivilDate,
  revision: number,
  draft = false,
): Promise<AppState> {
  return call(`/api/items/${encodeURIComponent(id)}/dates`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ baselineStartDate, baselineEndDate, revision, draft }),
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

/** Changes the roadmap's content, or the draft's. The list lands as one write or not at all. */
export function sendEdits(edits: Edit[], revision: number, draft = false): Promise<AppState> {
  return call('/api/edits', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ edits, revision, draft }),
  })
}

/**
 * What importing a roadmap file would change, without changing it. `roadmap` is
 * the file as read — the server parses it, so a file that is not a roadmap comes
 * back as an error naming the first field that is wrong.
 */
export function previewImport(roadmap: unknown, revision: number): Promise<ImportPreview> {
  return call<ImportPreview>('/api/import', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ roadmap, revision, dryRun: true }),
  })
}

/** Replaces the roadmap's content with the file's. Progress on kept items stays. */
export function importRoadmap(roadmap: unknown, revision: number): Promise<AppState> {
  return call('/api/import', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ roadmap, revision }),
  })
}

/** The versions of the plan the history keeps, newest first. */
export function fetchVersions(): Promise<PlanVersion[]> {
  return call<PlanVersion[]>('/api/versions')
}

/** One version's plan, as a roadmap file. */
export function fetchVersionPlan(id: number): Promise<unknown> {
  return call<unknown>(`/api/versions/${id}`)
}

/** What bringing a version back would change, without changing it. */
export function previewRestore(id: number, revision: number): Promise<ImportPreview> {
  return call<ImportPreview>(`/api/versions/${id}/restore`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ revision, dryRun: true }),
  })
}

/** Brings a version of the plan back. Progress on the items it keeps stays. */
export function restoreVersion(id: number, revision: number): Promise<AppState> {
  return call(`/api/versions/${id}/restore`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ revision }),
  })
}

/** What a generator would add, placed, and what that does to the roadmap. */
export type GeneratePreview = ImportPreview & { placed: Placed[] }

/** The items a generator would add and where, without adding them. */
export function previewGenerate(
  generator: GenerateRequest,
  revision: number,
  draft = false,
): Promise<GeneratePreview> {
  return call<GeneratePreview>('/api/generate', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ generator, revision, draft, dryRun: true }),
  })
}

/** Adds what a generator makes, placed where its preview said. */
export function generateItems(
  generator: GenerateRequest,
  revision: number,
  draft = false,
): Promise<AppState> {
  return call('/api/generate', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ generator, revision, draft }),
  })
}

// The draft: one at a time, shared by every device. Its world carries the
// draft's plan with the live roadmap's progress, and its own revision.

/** The draft's world, or null when there is none. */
export async function fetchDraft(): Promise<AppState | null> {
  try {
    return await call('/api/draft')
  } catch (cause: unknown) {
    if (cause instanceof RequestError && cause.status === 404) return null
    throw cause
  }
}

/** Starts a draft from the live plan, or opens the one in progress. */
export function startDraft(): Promise<AppState> {
  return call('/api/draft', { method: 'POST' })
}

/** Drops the draft. Answers with the live world. */
export function discardDraft(): Promise<AppState> {
  return call('/api/draft', { method: 'DELETE' })
}

/** What publishing the draft would change on the live roadmap. */
export type PublishPreview = ImportPreview & { liveChanged: boolean }

export function previewPublish(draftRevision: number): Promise<PublishPreview> {
  return call<PublishPreview>('/api/draft/publish', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ draftRevision, dryRun: true }),
  })
}

/** Makes the draft the plan, from the revisions its preview was made at. Answers with the live world. */
export function publishDraft(revision: number, draftRevision: number): Promise<AppState> {
  return call('/api/draft/publish', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ revision, draftRevision }),
  })
}
