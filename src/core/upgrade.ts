// The first roadmap format had items, grouped optionally into work items. The
// second has tasks, every one in a story, and stories optionally in a feature.
// This turns a file of the first into the second, on the raw JSON, before the
// parser checks it: an old export, a version kept in the history and a draft
// started before the change all go through it when read.
//
// The same rules are applied to the database by migrations/0013_stories.sql, and
// a test holds the two to the same result. Change one, change both.
//
// - An item becomes a task with the same id, so dependencies and phase
//   milestones keep pointing where they did.
// - A work item whose parts sit in one phase becomes a story with its id.
// - A work item whose parts cross phases becomes a feature with its id, and a
//   story per phase, `<id>-p<phase>`, named "<name> — phase <n>".
// - A work item with no parts becomes a story in the first phase.
// - An item on its own becomes the only task of a story `<id>-story`, which
//   takes its link, its extra links and its price.
// - A story's price is the first one its tasks had, in plan order.
// - A type is kept on what becomes a story or a feature. A task carries none, so
//   an item whose type differs from its work item's — a certification's prep —
//   reads as its story's.

type Raw = Record<string, unknown>

/** Whether a parsed roadmap file is in the first format: items rather than tasks. */
export function isFormatV1(raw: unknown): raw is Raw {
  return (
    typeof raw === 'object' &&
    raw !== null &&
    'items' in raw &&
    !('tasks' in raw) &&
    (raw as Raw).format === undefined
  )
}

/** The id of the story a lone item becomes. */
export const loneStoryId = (itemId: string) => `${itemId}-story`

/** The id of a phase's story of a work item that crosses phases. */
export const phaseStoryId = (workItemId: string, phase: number) => `${workItemId}-p${phase}`

export function upgradeV1(file: Raw): Raw {
  const { items: rawItems, workItems: rawWorkItems, ...rest } = file
  const items = list(rawItems)
  const workItems = list(rawWorkItems)
  const phaseNumbers = list(file.phases)
    .map((phase) => phase.number)
    .filter((number): number is number => typeof number === 'number')
  const firstPhase = phaseNumbers.length > 0 ? Math.min(...phaseNumbers) : 1

  const known = new Set(workItems.map((workItem) => workItem.id))
  const groupOf = (item: Raw) =>
    typeof item.workItemId === 'string' && known.has(item.workItemId) ? item.workItemId : null
  const inPlanOrder = (a: Raw, b: Raw) =>
    num(a.phase) - num(b.phase) || num(a.sortOrder) - num(b.sortOrder)
  const firstPrice = (parts: Raw[]) =>
    parts.map((part) => (typeof part.price === 'string' ? part.price : '')).find((p) => p !== '') ??
    ''

  const features: Raw[] = []
  const stories: Raw[] = []
  /** The story each item's task goes to. */
  const storyOf = new Map<unknown, string>()

  for (const workItem of workItems) {
    const parts = items.filter((item) => groupOf(item) === workItem.id).sort(inPlanOrder)
    const phases = [...new Set(parts.map((part) => num(part.phase)))].sort((a, b) => a - b)
    const shared = {
      type: workItem.type,
      link: workItem.link ?? null,
      resources: workItem.resources ?? [],
      doneWhen: '',
    }

    if (phases.length <= 1) {
      stories.push({
        id: workItem.id,
        name: workItem.name,
        ...shared,
        phase: phases[0] ?? firstPhase,
        featureId: null,
        price: firstPrice(parts),
        notes: workItem.notes ?? '',
      })
      for (const part of parts) storyOf.set(part, String(workItem.id))
      continue
    }

    features.push({
      id: workItem.id,
      name: workItem.name,
      type: workItem.type,
      link: workItem.link ?? null,
      notes: workItem.notes ?? '',
    })
    for (const phase of phases) {
      const id = phaseStoryId(String(workItem.id), phase)
      const inPhase = parts.filter((part) => num(part.phase) === phase)
      stories.push({
        id,
        name: `${String(workItem.name)} — phase ${phase}`,
        ...shared,
        phase,
        featureId: workItem.id,
        price: firstPrice(inPhase),
        notes: '',
      })
      for (const part of inPhase) storyOf.set(part, id)
    }
  }

  const tasks = items.map((item) => {
    const {
      workItemId: _workItemId,
      phase: _phase,
      price: _price,
      type: _type,
      ...task
    } = item
    const grouped = storyOf.get(item)
    if (grouped !== undefined) return { ...task, storyId: grouped }

    const id = loneStoryId(String(item.id))
    stories.push({
      id,
      name: item.name,
      type: item.type,
      phase: item.phase,
      featureId: null,
      link: item.link ?? null,
      resources: item.resources ?? [],
      price: typeof item.price === 'string' ? item.price : '',
      notes: '',
      doneWhen: '',
    })
    return { ...task, link: null, resources: [], storyId: id }
  })

  return { format: 2, ...rest, features, stories, tasks }
}

function list(value: unknown): Raw[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is Raw => typeof entry === 'object' && entry !== null)
    : []
}

function num(value: unknown): number {
  return typeof value === 'number' ? value : 0
}
