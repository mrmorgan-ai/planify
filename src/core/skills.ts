import { aliasesAmong } from './catalog'
import type { RoadmapContent } from './types'
import { mentions, wordsOf } from './words'

// Which skills a task feeds, read off what is already written down: the tasks
// next to it in its story, and the skills its own name, link and notes mention.
// Nothing here writes. The form, the generators and the API each show what this
// finds, and whoever is adding the task chooses.
//
// Only skills on the roadmap's map are ever answered: a suggestion can be taken
// as it is, with no trip to the settings first.

/** What is known about a task while its skills are being chosen. */
export type SkillSubject = {
  name: string
  /** The story it is, or will be, a step of. */
  storyId?: string | null
  /** The task itself once it exists, so it is not counted as its own neighbour. */
  id?: string | null
  link?: string | null
  notes?: string
}

export type SkillSuggestion = {
  skill: string
  /** Higher is surer. Only the order means anything. */
  score: number
  /** Why, in words that fit after the skill's name: "named in the task". */
  reason: string
}

type Content = Pick<RoadmapContent, 'roadmap' | 'tasks' | 'stories' | 'features'>

// How far each sign is trusted. A skill the task's own name mentions is nearly
// always one it feeds; one its description or link mentions, usually; one its
// story's name mentions, about as often as not. What the neighbours carry says
// the least — a story's tasks differ more than they repeat — so it counts by
// how many of them agree, and not at all below half.
const NAMED = 1
const IN_NOTES = 0.7
const IN_LINK = 0.6
const SHARED = 0.6
const IN_STORY = 0.4
/** A skill on fewer of the story's other tasks than this is theirs, not the story's. */
const SHARED_BY = 1 / 2

// A new task starts with its story's skills only when the story has shown what
// they are: enough tasks, nearly all agreeing. Short of that they are offered,
// one click away, since a skill added unasked and wrong is worse than one missing.
const INHERITS_FROM = 3
const INHERITED_BY = 2 / 3

/**
 * The skills a text names, among those given: by the skill's own name or by
 * another name it goes by. Whole words, in order — "RAG" is not in "storage".
 */
export function namedSkills(text: string, skills: readonly string[]): string[] {
  const words = wordsOf(text)
  if (words.length === 0) return []
  const aliases = aliasesAmong(skills)
  return skills.filter((skill) =>
    [skill, ...(aliases[skill] ?? [])].some((name) => mentions(words, wordsOf(name))),
  )
}

/**
 * The skills a story's tasks nearly all carry — two in three of them, once
 * there are three: what a new task in it starts with. Empty before that.
 */
export function inheritedSkills(
  storyId: string,
  { tasks, roadmap }: Pick<RoadmapContent, 'tasks' | 'roadmap'>,
  self: string | null = null,
): string[] {
  const shared = sharedIn(storyId, tasks, self)
  if (shared.of < INHERITS_FROM) return []
  return [...shared.count]
    .filter(
      ([skill, count]) => count / shared.of >= INHERITED_BY && skill in roadmap.skillDimension,
    )
    .sort(([a, countA], [b, countB]) => countB - countA || a.localeCompare(b))
    .map(([skill]) => skill)
}

/**
 * The mapped skills a task probably feeds, surest first, each with why.
 * Skills it already carries are answered too: the caller knows what to leave out.
 */
export function suggestSkills(
  subject: SkillSubject,
  content: Content,
  limit = 5,
): SkillSuggestion[] {
  const { roadmap, tasks, stories, features } = content
  const mapped = Object.keys(roadmap.skillDimension)
  const found = new Map<string, { score: number; best: number; reason: string }>()
  const add = (skill: string, weight: number, reason: string) => {
    const so = found.get(skill)
    if (!so) found.set(skill, { score: weight, best: weight, reason })
    else {
      so.score += weight
      // The strongest signal is the one worth saying.
      if (weight > so.best) Object.assign(so, { best: weight, reason })
    }
  }

  for (const skill of namedSkills(subject.name, mapped)) add(skill, NAMED, 'named in the task')
  for (const skill of namedSkills(subject.notes ?? '', mapped)) {
    add(skill, IN_NOTES, 'named in its description')
  }
  for (const skill of namedSkills(subject.link ?? '', mapped)) {
    add(skill, IN_LINK, 'named in its link')
  }

  const story = stories.find((each) => each.id === subject.storyId)
  if (story) {
    const feature = features.find((each) => each.id === story.featureId)
    for (const skill of namedSkills(`${story.name} ${feature?.name ?? ''}`, mapped)) {
      add(skill, IN_STORY, 'named in its story')
    }
    const shared = sharedIn(story.id, tasks, subject.id ?? null)
    for (const [skill, count] of shared.count) {
      if (!(skill in roadmap.skillDimension) || count / shared.of < SHARED_BY) continue
      add(
        skill,
        (SHARED * count) / shared.of,
        shared.of === 1 ? 'on the other task of its story' : `on ${count} of ${shared.of} tasks in its story`,
      )
    }
  }

  return [...found]
    .map(([skill, { score, reason }]) => ({ skill, score, reason }))
    .sort((a, b) => b.score - a.score || a.skill.localeCompare(b.skill))
    .slice(0, limit)
}

/**
 * The mapped skills a name most likely meant: what to answer when a task names
 * one that is on no axis. A different spelling, another name for it, or a name
 * sharing most of its words; nothing when nothing is close.
 */
export function closestSkills(name: string, skills: readonly string[], limit = 3): string[] {
  const asked = wordsOf(name)
  if (asked.length === 0) return []
  const aliases = aliasesAmong(skills)
  return skills
    .map((skill) => ({
      skill,
      score: Math.max(
        ...[skill, ...(aliases[skill] ?? [])].map((known) => closeness(asked, wordsOf(known))),
      ),
    }))
    .filter(({ score }) => score >= CLOSE_ENOUGH)
    .sort((a, b) => b.score - a.score || a.skill.localeCompare(b.skill))
    .slice(0, limit)
    .map(({ skill }) => skill)
}

/** Below this, two names only happen to share a word. */
const CLOSE_ENOUGH = 0.4
/** Below this, two spellings are two words. */
const SAME_SPELLING = 0.7

/** How alike two names are, 0 to 1: by the words they share, or by spelling. */
function closeness(a: readonly string[], b: readonly string[]): number {
  if (b.length === 0) return 0
  const [joinedA, joinedB] = [a.join(''), b.join('')]
  if (joinedA === joinedB) return 1

  const wordsB = new Set(b)
  const both = new Set(a.filter((word) => wordsB.has(word))).size
  const shared = both / (new Set(a).size + wordsB.size - both)

  const longest = Math.max(joinedA.length, joinedB.length)
  const spelling = 1 - editDistance(joinedA, joinedB) / longest
  return Math.max(shared, spelling >= SAME_SPELLING ? spelling : 0)
}

/** Insertions, deletions and substitutions between two strings. */
function editDistance(a: string, b: string): number {
  let previous = Array.from({ length: b.length + 1 }, (_, index) => index)
  for (let i = 1; i <= a.length; i++) {
    const current = [i]
    for (let j = 1; j <= b.length; j++) {
      current[j] = Math.min(
        previous[j]! + 1,
        current[j - 1]! + 1,
        previous[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1),
      )
    }
    previous = current
  }
  return previous[b.length]!
}

/** How many of a story's other tasks carry each skill, and out of how many. */
function sharedIn(
  storyId: string,
  tasks: RoadmapContent['tasks'],
  self: string | null,
): { count: Map<string, number>; of: number } {
  const siblings = tasks.filter((task) => task.storyId === storyId && task.id !== self)
  const count = new Map<string, number>()
  for (const task of siblings) {
    for (const skill of new Set(task.skills)) count.set(skill, (count.get(skill) ?? 0) + 1)
  }
  return { count, of: siblings.length }
}
