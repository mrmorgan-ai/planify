import { describe, expect, it } from 'vitest'
import { applyEdits, type Edit } from '../core/edits'
import { seedContent } from '../core/seed'
import { EXAMPLE_SEED, readSeedFile } from '../../tools/seed/load'
import { loadDraftState, mutateDraft, startDraft } from './drafts'
import { listVersions, loadVersion } from './history'
import { applyImport } from './importing'
import { loadAppState, mutateContent } from './repository'
import { NoRoadmapError, resolveRoadmap, type Caller } from './space'
import { sqliteD1 } from './testing/sqliteD1'

const example = seedContent(readSeedFile(EXAMPLE_SEED))

const person = (principal: string): Caller => ({ principal, local: false })
const MCP = person('mcp-token.access')

describe('resolveRoadmap', () => {
  function database() {
    const found = sqliteD1()
    found.roadmap(2)
    const add = (principal: string, roadmap: number) => {
      found.sqlite
        .prepare('INSERT INTO roadmap_members (principal, roadmap_id) VALUES (?, ?)')
        .run(principal, roadmap)
      found.sqlite.exec(
        "INSERT OR IGNORE INTO members_required (id, since) VALUES (1, '2030-01-01T00:00:00Z')",
      )
    }
    return { ...found, add }
  }

  it('lets anyone Access signed in reach the first roadmap until there is a member', async () => {
    const { db } = database()
    expect(await resolveRoadmap(db, person('owner@example.com'), null)).toBe(1)
    expect(await resolveRoadmap(db, person('someone@example.com'), null)).toBe(1)
  })

  it('sends each member to their own roadmap, and refuses everyone else', async () => {
    const { db, add } = database()
    add('owner@example.com', 1)
    add('second@example.com', 2)

    expect(await resolveRoadmap(db, person('owner@example.com'), null)).toBe(1)
    expect(await resolveRoadmap(db, person('second@example.com'), null)).toBe(2)
    await expect(resolveRoadmap(db, person('stranger@example.com'), null)).rejects.toThrow(
      /no roadmap for stranger@example.com/,
    )
  })

  it('never opens the first roadmap again once there has been a member', async () => {
    const { db, sqlite, add } = database()
    add('owner@example.com', 1)
    sqlite.exec('DELETE FROM roadmap_members')
    await expect(resolveRoadmap(db, person('owner@example.com'), null)).rejects.toBeInstanceOf(
      NoRoadmapError,
    )
  })

  it('lets a delegate act for a member, on that member’s roadmap', async () => {
    const { db, sqlite, add } = database()
    add('second@example.com', 2)
    sqlite.prepare('INSERT INTO delegates (principal) VALUES (?)').run(MCP.principal)

    expect(await resolveRoadmap(db, MCP, 'second@example.com')).toBe(2)
    await expect(resolveRoadmap(db, MCP, 'stranger@example.com')).rejects.toBeInstanceOf(
      NoRoadmapError,
    )
  })

  it('refuses anyone but a delegate who names someone else', async () => {
    const { db, add } = database()
    add('owner@example.com', 1)
    add('second@example.com', 2)

    await expect(
      resolveRoadmap(db, person('second@example.com'), 'owner@example.com'),
    ).rejects.toThrow(/may not act on behalf/)
    await expect(resolveRoadmap(db, MCP, 'owner@example.com')).rejects.toThrow(
      /may not act on behalf/,
    )
  })

  it('lets the local development identity act for anyone, as a delegate would', async () => {
    const { db, add } = database()
    add('second@example.com', 2)
    const local: Caller = { principal: 'dev@localhost', local: true }
    expect(await resolveRoadmap(db, local, 'second@example.com')).toBe(2)
  })

  it('finds a member whatever the capitals Access reports the email in', async () => {
    const { db, add } = database()
    add('second@example.com', 2)
    expect(await resolveRoadmap(db, person('Second@Example.com'), null)).toBe(2)
    expect(await resolveRoadmap(db, { principal: 'dev@localhost', local: true }, ' SECOND@example.com ')).toBe(2)
  })

  it('ignores an empty header', async () => {
    const { db, add } = database()
    add('owner@example.com', 1)
    expect(await resolveRoadmap(db, person('owner@example.com'), '')).toBe(1)
  })
})

describe('two roadmaps in one database', () => {
  const rename = (id: string, name: string): Edit => ({ op: 'updateItem', id, fields: { name } })

  /** Both roadmaps holding the example, so every id exists twice. */
  async function twoLoaded() {
    const found = sqliteD1()
    const first = found.space
    const second = found.roadmap(2)
    await mutateContent(first, 0, () => example)
    await mutateContent(second, 0, () => example)
    return { ...found, first, second }
  }

  const nameOf = async (space: Parameters<typeof loadAppState>[0], id: string) =>
    (await loadAppState(space)).items.find((item) => item.id === id)?.name

  it('keeps the same ids apart, with a revision each', async () => {
    const { first, second } = await twoLoaded()
    await mutateContent(second, 1, (state) => applyEdits(state, [rename('read-the-thing', 'Mine')]))

    expect(await nameOf(second, 'read-the-thing')).toBe('Mine')
    expect(await nameOf(first, 'read-the-thing')).toBe('Read the thing')
    expect((await loadAppState(first)).revision).toBe(1)
    expect((await loadAppState(second)).revision).toBe(2)
  })

  it('deletes only among its own rows', async () => {
    const { first, second } = await twoLoaded()
    const smaller = readSeedFile(EXAMPLE_SEED)
    smaller.items = smaller.items.filter((item) => item.id !== 'the-optional-thing')
    await applyImport(second, 1, smaller)

    const ids = async (space: typeof first) => (await loadAppState(space)).items.map((i) => i.id)
    expect(await ids(second)).not.toContain('the-optional-thing')
    expect(await ids(first)).toContain('the-optional-thing')
  })

  it('keeps a history each, and never hands one roadmap another’s version', async () => {
    const { first, second } = await twoLoaded()
    await mutateContent(second, 1, (state) => applyEdits(state, [rename('read-the-thing', 'Mine')]))

    const [kept] = await listVersions(second)
    expect(kept).toBeDefined()
    expect(await listVersions(first)).toEqual([])
    expect(await loadVersion(first, kept!.id)).toBeNull()
    expect(await loadVersion(second, kept!.id)).not.toBeNull()
  })

  it('keeps a draft each', async () => {
    const { first, second } = await twoLoaded()
    await startDraft(second)
    await mutateDraft(second, 1, (state) => applyEdits(state, [rename('read-the-thing', 'Drafted')]))

    expect((await loadDraftState(second)).items.find((i) => i.id === 'read-the-thing')?.name).toBe(
      'Drafted',
    )
    expect((await loadAppState(first)).draft).toBeNull()
    await expect(loadDraftState(first)).rejects.toThrow(/no draft/)
  })
})
