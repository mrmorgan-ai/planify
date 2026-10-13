import mlopsLlmops from '../../templates/skills/mlops-llmops.json'
import type { Dimension, Roadmap } from './types'
import { keyOf } from './words'

// The skills a roadmap could have, by area. A roadmap's skill map stays its own
// — a name on an axis, edited freely — and a pack is where it can be filled
// from: axes, skills, and the other names each skill goes by, which is what
// lets "k8s" in a task's name find Kubernetes on the map.
//
// Packs are files in templates/skills/, so the command that creates a roadmap
// reads the same ones the app does.

export const SKILL_KINDS = ['concept', 'tool', 'practice'] as const
export type SkillKind = (typeof SKILL_KINDS)[number]

export type PackSkill = {
  /** Kebab-case, unique in its pack. Stays when the name is reworded. */
  id: string
  name: string
  kind: SkillKind
  /** One of the pack's axes. */
  axis: Dimension
  /** Other names it goes by. A tool and the concept behind it are one skill. */
  aliases: string[]
}

export type SkillPack = {
  id: string
  name: string
  axes: Dimension[]
  skills: PackSkill[]
}

/** Other names a skill goes by, keyed by the skill's name on the roadmap's map. */
export type SkillAliases = Readonly<Record<string, readonly string[]>>

/** Checks a pack file's shape and that it never names one thing twice. */
export function parsePack(raw: unknown): SkillPack {
  const pack = raw as Partial<SkillPack> | null
  if (typeof pack !== 'object' || pack === null) throw new Error('A pack must be an object')
  const { id, name, axes, skills } = pack
  if (typeof id !== 'string' || id === '') throw new Error('A pack needs an id')
  const at = `pack ${id}`
  if (typeof name !== 'string' || name === '') throw new Error(`${at} needs a name`)
  if (!Array.isArray(axes) || axes.length === 0 || axes.some((axis) => typeof axis !== 'string')) {
    throw new Error(`${at} needs its axes`)
  }
  if (!Array.isArray(skills)) throw new Error(`${at} needs its skills`)

  const ids = new Set<string>()
  // Every name and alias, by the words it is matched on: a second skill
  // answering to the same words would make a suggestion a coin toss.
  const taken = new Map<string, string>()
  const claim = (label: string, skill: string) => {
    const key = keyOf(label)
    if (key === '') throw new Error(`${at}: "${label}" has no words to match on`)
    const holder = taken.get(key)
    if (holder !== undefined && holder !== skill) {
      throw new Error(`${at}: "${label}" names both ${holder} and ${skill}`)
    }
    taken.set(key, skill)
  }

  for (const skill of skills as Partial<PackSkill>[]) {
    if (typeof skill.id !== 'string' || !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(skill.id)) {
      throw new Error(`${at}: a skill id must be kebab-case, got ${String(skill.id)}`)
    }
    if (ids.has(skill.id)) throw new Error(`${at}: the id ${skill.id} is used twice`)
    ids.add(skill.id)
    if (typeof skill.name !== 'string' || skill.name === '') {
      throw new Error(`${at}: ${skill.id} needs a name`)
    }
    if (!(SKILL_KINDS as readonly unknown[]).includes(skill.kind)) {
      throw new Error(`${at}: ${skill.id} must be one of ${SKILL_KINDS.join(', ')}`)
    }
    if (typeof skill.axis !== 'string' || !axes.includes(skill.axis)) {
      throw new Error(`${at}: ${skill.id} is on ${String(skill.axis)}, which is not one of its axes`)
    }
    if (!Array.isArray(skill.aliases) || skill.aliases.some((alias) => typeof alias !== 'string')) {
      throw new Error(`${at}: ${skill.id} needs its aliases, even if none`)
    }
    claim(skill.name, skill.name)
    for (const alias of skill.aliases) claim(alias, skill.name)
  }

  return { id, name, axes: axes as Dimension[], skills: skills as PackSkill[] }
}

export const PACKS: readonly SkillPack[] = [parsePack(mlopsLlmops)]

export function packById(id: string): SkillPack | null {
  return PACKS.find((pack) => pack.id === id) ?? null
}

/** A pack as a roadmap's skill map: its axes, and every skill on its own. */
export function skillMapOf(pack: SkillPack): Pick<Roadmap, 'dimensions' | 'skillDimension'> {
  return {
    dimensions: [...pack.axes],
    skillDimension: Object.fromEntries(pack.skills.map((skill) => [skill.name, skill.axis])),
  }
}

/** The skills of a pack a roadmap's map does not have yet, under any spelling. */
export function missingFrom(pack: SkillPack, skillDimension: Roadmap['skillDimension']): PackSkill[] {
  const mapped = new Set(Object.keys(skillDimension).map(keyOf))
  return pack.skills.filter((skill) => !mapped.has(keyOf(skill.name)))
}

const ALIASES: ReadonlyMap<string, readonly string[]> = new Map(
  PACKS.flatMap((pack) => pack.skills.map((skill) => [keyOf(skill.name), skill.aliases] as const)),
)

/**
 * The other names each of these skills goes by, from every pack that knows it.
 * A name that is a skill of its own on the same map is nobody's alias there:
 * a roadmap that keeps kubectl apart from Kubernetes meant to.
 */
export function aliasesAmong(skills: readonly string[]): SkillAliases {
  const own = new Set(skills.map(keyOf))
  const found: Record<string, string[]> = {}
  for (const skill of skills) {
    const aliases = (ALIASES.get(keyOf(skill)) ?? []).filter((alias) => !own.has(keyOf(alias)))
    if (aliases.length > 0) found[skill] = aliases
  }
  return found
}
