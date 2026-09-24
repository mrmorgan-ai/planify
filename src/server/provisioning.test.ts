import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { applyEdits } from '../core/edits'
import { parseSeed, seedContent } from '../core/seed'
import { validate } from '../core/validate'
import { EXAMPLE_SEED, readSeedFile } from '../../tools/seed/load'
import {
  addDelegateSql,
  addMemberSql,
  createRoadmapSql,
  removeMemberSql,
} from '../../tools/roadmaps/roadmaps-sql.mjs'
import { seedSql } from '../../tools/seed/seed-sql.mjs'
import { loadAppState, mutateContent } from './repository'
import { resolveRoadmap } from './space'
import { sqliteD1 } from './testing/sqliteD1'

// The SQL tools/roadmaps and tools/seed run through wrangler, run here against
// the schema instead: a new roadmap has to be one the app can read and write.

const STARTER = JSON.parse(
  readFileSync(new URL('../../templates/starter.json', import.meta.url), 'utf8'),
) as unknown

describe('the starter template', () => {
  it('is a roadmap file that breaks no rule, so a new user can add items at once', () => {
    const issues = validate(seedContent(parseSeed(STARTER)))
    expect(issues.filter((issue) => issue.severity === 'error')).toEqual([])
  })
})

describe('a new roadmap', () => {
  function created(member?: string) {
    const found = sqliteD1()
    const run = (statements: string[]) => found.sqlite.exec(statements.join('\n'))
    run(createRoadmapSql({ id: 2, name: 'Second', now: '2030-01-01T00:00:00Z', template: STARTER, member }))
    return { ...found, run, second: { db: found.db, roadmapId: 2 } }
  }

  it('reads as the template, at revision 0, with no plan of anyone else’s', async () => {
    const { second } = created()
    const state = await loadAppState(second)
    expect(state.revision).toBe(0)
    expect(state.items).toEqual([])
    expect(state.roadmap.phases).toEqual([{ number: 1, name: 'Phase 1', closingMilestoneId: null }])
    expect(state.roadmap.dimensions).toEqual(['Foundations', 'Tools', 'Building', 'Communication'])
    expect(state.roadmap.timeZone).toBe('UTC')
  })

  it('takes its first item, since the template maps skills', async () => {
    const { second } = created()
    const after = await mutateContent(second, 0, (state) =>
      applyEdits(state, [
        {
          op: 'createItem',
          item: {
            name: 'The first thing',
            type: 'Course',
            phase: 1,
            baselineStartDate: '2030-01-07',
            baselineEndDate: '2030-01-09',
            skills: ['Core concepts'],
            duration: '~3h',
          },
        },
      ]),
    )
    expect(after.revision).toBe(1)
    expect(after.items.map((item) => item.name)).toEqual(['The first thing'])
  })

  it('makes its member the only one who reaches it', async () => {
    const { db, run } = created('second@example.com')
    run(addMemberSql(1, 'owner@example.com'))

    const caller = (principal: string) => ({ principal, local: false })
    expect(await resolveRoadmap(db, caller('second@example.com'), null)).toBe(2)
    expect(await resolveRoadmap(db, caller('owner@example.com'), null)).toBe(1)

    run(removeMemberSql('second@example.com'))
    await expect(resolveRoadmap(db, caller('second@example.com'), null)).rejects.toThrow()
  })

  it('is served to the delegate that names its member', async () => {
    const { db, run } = created('second@example.com')
    run(addDelegateSql('mcp.access'))
    run(addDelegateSql('mcp.access'))
    expect(await resolveRoadmap(db, { principal: 'mcp.access', local: false }, 'second@example.com')).toBe(2)
  })

  it('stores a principal the way the API compares it', () => {
    expect(addMemberSql(2, ' Them@Example.COM ')[0]).toContain("'them@example.com'")
  })

  it('closes the open door with its first member, for good', async () => {
    const { db, run } = created('second@example.com')
    run(removeMemberSql('second@example.com'))
    const caller = { principal: 'owner@example.com', local: false }
    await expect(resolveRoadmap(db, caller, null)).rejects.toThrow(/no roadmap/)
  })

  it('refuses a roadmap file whose numbers are not numbers', () => {
    const hostile = structuredClone(readSeedFile(EXAMPLE_SEED)) as unknown as {
      items: Array<{ phase: unknown }>
    }
    hostile.items[0]!.phase = "1); INSERT INTO delegates VALUES ('me'); --"
    expect(() => seedSql(hostile, { roadmapId: 2, version: 'x' })).toThrow(/whole number/)
  })

  it('refuses a name that is only spaces', () => {
    expect(() => createRoadmapSql({ id: 3, name: '  ', now: '2030-01-01T00:00:00Z' })).toThrow()
    expect(() => addMemberSql(2, ' ')).toThrow()
  })
})

describe('loading a seed into one roadmap', () => {
  it('fills that roadmap and leaves the other alone', async () => {
    const { sqlite, space, roadmap } = sqliteD1()
    const second = roadmap(2)
    const example = readSeedFile(EXAMPLE_SEED)
    await mutateContent(space, 0, () => seedContent(example))

    sqlite.exec(seedSql(example, { roadmapId: 2, withDates: true, version: 'x' }).join('\n'))
    const smaller = { ...example, items: example.items.filter((i) => i.id !== 'the-optional-thing') }
    sqlite.exec(seedSql(smaller, { roadmapId: 2, version: 'y' }).join('\n'))

    const ids = async (where: typeof space) => (await loadAppState(where)).items.map((i) => i.id)
    expect(await ids(second)).toHaveLength(example.items.length - 1)
    expect(await ids(space)).toHaveLength(example.items.length)
  })
})
