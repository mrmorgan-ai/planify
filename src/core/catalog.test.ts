import { describe, expect, it } from 'vitest'
import { PACKS, aliasesAmong, missingFrom, packById, parsePack, skillMapOf } from './catalog'
import { keyOf } from './words'

const pack = (skills: unknown[]) => ({ id: 'area', name: 'An area', axes: ['One', 'Two'], skills })
const skill = (overrides: Record<string, unknown> = {}) => ({
  id: 'a-skill',
  name: 'A skill',
  kind: 'concept',
  axis: 'One',
  aliases: [],
  ...overrides,
})

describe.each(PACKS)('the $id pack', (each) => {
  it('has every axis in use, and enough on each to read a radar by', () => {
    for (const axis of each.axes) {
      expect(each.skills.filter((one) => one.axis === axis).length, axis).toBeGreaterThanOrEqual(4)
    }
  })

  it('is a skill map a roadmap can take whole', () => {
    const { dimensions, skillDimension } = skillMapOf(each)
    expect(dimensions).toEqual(each.axes)
    expect(Object.keys(skillDimension)).toHaveLength(each.skills.length)
    expect(new Set(Object.values(skillDimension))).toEqual(new Set(each.axes))
  })

  it('is found by its id', () => {
    expect(packById(each.id)).toBe(each)
  })
})

describe('parsePack', () => {
  it('reads a sound pack', () => {
    expect(parsePack(pack([skill()])).skills).toHaveLength(1)
  })

  it.each([
    ['an id that is not kebab-case', [skill({ id: 'A Skill' })], 'kebab-case'],
    ['an id used twice', [skill(), skill({ name: 'Another' })], 'used twice'],
    ['a kind it does not know', [skill({ kind: 'topic' })], 'must be one of'],
    ['an axis the pack does not have', [skill({ axis: 'Three' })], 'not one of its axes'],
    [
      'an alias that is another skill’s name',
      [skill(), skill({ id: 'b', name: 'Another', aliases: ['a skills'] })],
      'names both A skill and Another',
    ],
    [
      'one alias on two skills',
      [skill({ aliases: ['x'] }), skill({ id: 'b', name: 'Another', aliases: ['X'] })],
      'names both A skill and Another',
    ],
    ['a name with nothing to match on', [skill({ name: '++' })], 'no words'],
  ])('refuses %s', (_what, skills, message) => {
    expect(() => parsePack(pack(skills))).toThrow(message)
  })
})

describe('aliasesAmong', () => {
  it('knows a skill under any spelling of its name', () => {
    expect(aliasesAmong(['kubernetes'])['kubernetes']).toContain('k8s')
  })

  it('leaves out a skill no pack knows', () => {
    expect(aliasesAmong(['Watercolour'])).toEqual({})
  })

  it('leaves out an alias the map keeps as a skill of its own', () => {
    const aliases = aliasesAmong(['Kubernetes', 'kubectl'])
    expect(aliases['Kubernetes']).toContain('k8s')
    expect(aliases['Kubernetes']).not.toContain('kubectl')
  })
})

describe('missingFrom', () => {
  it('is what the map does not have yet, under any spelling', () => {
    const [first] = PACKS
    const all = skillMapOf(first!).skillDimension
    expect(missingFrom(first!, all)).toEqual([])

    const [kept, ...rest] = Object.keys(all)
    const respelt = { [kept!.toUpperCase()]: 'Anywhere' }
    expect(missingFrom(first!, respelt).map((one) => keyOf(one.name))).toEqual(rest.map(keyOf))
  })
})
