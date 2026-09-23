import { existsSync, readFileSync } from 'node:fs'
import { parseSeed, type SeedFile } from '../../src/core/seed'

const SEED_DIR = new URL('../../seed/', import.meta.url)
export const PRIVATE_SEED = new URL('roadmap.json', SEED_DIR)
export const EXAMPLE_SEED = new URL('roadmap.example.json', SEED_DIR)

/**
 * Every seed file present. The example is tracked and always validated — it is
 * what keeps CI able to check the rules without seeing the real roadmap.
 */
export function availableSeeds(): Array<{ label: string; seed: SeedFile }> {
  const found: Array<{ label: string; seed: SeedFile }> = [
    { label: 'roadmap.example.json', seed: readSeedFile(EXAMPLE_SEED) },
  ]
  if (existsSync(PRIVATE_SEED)) {
    found.push({ label: 'roadmap.json', seed: readSeedFile(PRIVATE_SEED) })
  }
  return found
}

export function readSeedFile(path: URL): SeedFile {
  return parseSeed(JSON.parse(readFileSync(path, 'utf8')))
}
