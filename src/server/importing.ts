import { describeChanges } from '../core/history'
import { importedContent, previewOf, type ImportPreview } from '../core/importing'
import type { SeedFile } from '../core/seed'
import type { AppState } from '../core/types'
import { loadVersion } from './history'
import { StaleRevisionError, loadAppState, mutateContent } from './repository'
import type { Space } from './space'

/**
 * The preview runs the same function the import runs, on the same data, so
 * what it shows is what applying writes. A file from an older revision is
 * refused here already, before anyone reads a preview of it.
 */
export async function previewImport(
  space: Space,
  revision: number,
  seed: SeedFile,
): Promise<ImportPreview> {
  const state = await loadAppState(space)
  if (revision !== state.revision) throw new StaleRevisionError(state)
  return previewOf(state, importedContent(state, seed))
}

/**
 * Replaces the roadmap's content with the file's in one batch, and records which
 * file it came from — the answer to "is this the roadmap I just imported?".
 */
export async function applyImport(
  space: Space,
  revision: number,
  seed: SeedFile,
): Promise<AppState> {
  const version = await fingerprint(seed)
  const state = await mutateContent(space, revision, (current) => importedContent(current, seed), {
    alongside: () => [
      space.db
        .prepare(
          `INSERT INTO meta (roadmap_id, key, value) VALUES (?, 'seed_version', ?)
           ON CONFLICT(roadmap_id, key) DO UPDATE SET value = excluded.value`,
        )
        .bind(space.roadmapId, version),
    ],
    reason: 'import',
    summary: (before, after) => `Imported a file: ${describeChanges(before, after)}`,
  })
  return { ...state, seedVersion: version }
}

/** A version the history does not have. */
export class UnknownVersionError extends Error {
  constructor(id: number) {
    super(`There is no version ${id} in the history`)
  }
}

/**
 * Brings a version of the plan back, the way an import brings a file in: the
 * plan becomes the version's, and progress on the items it keeps stays. The plan
 * it replaces is kept in turn, so a restore can itself be undone.
 */
export async function applyRestore(
  space: Space,
  revision: number,
  id: number,
): Promise<AppState> {
  const kept = await loadVersion(space, id)
  if (!kept) throw new UnknownVersionError(id)
  return mutateContent(space, revision, (current) => importedContent(current, kept.plan), {
    reason: 'restore',
    summary: (before, after) => `Went back to #${id}: ${describeChanges(before, after)}`,
  })
}

/** `previewImport` for a version of the plan: what restoring it would change. */
export async function previewRestore(
  space: Space,
  revision: number,
  id: number,
): Promise<ImportPreview> {
  const kept = await loadVersion(space, id)
  if (!kept) throw new UnknownVersionError(id)
  return previewImport(space, revision, kept.plan)
}

/** The first 12 hex digits of the file's SHA-256, as the seed loader has always done. */
async function fingerprint(seed: SeedFile): Promise<string> {
  const bytes = new TextEncoder().encode(JSON.stringify(seed))
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')
    .slice(0, 12)
}
