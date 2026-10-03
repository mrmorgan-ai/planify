import { SECTION_LABEL, importChanges } from './importing'
import type { IsoDateTime, RoadmapContent } from './types'

/** What replaced a version of the plan. */
export type VersionReason = 'edit' | 'import' | 'reschedule' | 'restore' | 'generate' | 'publish'

/** A version of the plan as the history lists it: everything but the plan itself. */
export type PlanVersion = {
  id: number
  /** When the change that replaced it was made. */
  createdAt: IsoDateTime
  reason: VersionReason
  /** What that change did, in a line. */
  summary: string
  /** Edits made shortly after it, folded into the same version. */
  laterChanges: number
  /** The revision the roadmap was at with this plan. */
  revision: number
}

/**
 * What a change did to the plan, in a line a person can scan: "Added Read the
 * thing; Edited Build part 2 (baselineStartDate, baselineEndDate)". One thing is
 * named, several are counted. The names are the ones the change saw, so the
 * line still reads right after a task is renamed again or deleted.
 */
export function describeChanges(before: RoadmapContent, after: RoadmapContent): string {
  const changes = importChanges(before, after)
  // The name a task had before the change, which is what it is called in the
  // version this line describes; one the change adds only has its new name.
  const names = new Map([...after.tasks, ...before.tasks].map((task) => [task.id, task.name]))
  const groups = new Map(
    [...after.stories, ...before.stories, ...after.features, ...before.features].map((each) => [
      each.id,
      each.name,
    ]),
  )
  const name = (id: string) => names.get(id) ?? id
  const group = (id: string) => groups.get(id) ?? id

  const { added, removed, changed } = changes.tasks
  const parts = [
    counted('Added', added, name, 'tasks'),
    counted('Deleted', removed.map((task) => task.id), name, 'tasks'),
    changed.length === 1
      ? `Edited ${name(changed[0]!.id)} (${changed[0]!.fields.join(', ')})`
      : counted('Edited', changed.map((task) => task.id), name, 'tasks'),
    counted('Added story', changes.stories.added, group, 'stories', 'Added'),
    counted('Deleted story', changes.stories.removed, group, 'stories', 'Deleted'),
    counted('Edited story', changes.stories.changed, group, 'stories', 'Edited'),
    counted('Added feature', changes.features.added, group, 'features', 'Added'),
    counted('Deleted feature', changes.features.removed, group, 'features', 'Deleted'),
    counted('Edited feature', changes.features.changed, group, 'features', 'Edited'),
    changes.settings.length > 0
      ? `Changed the ${changes.settings.map((key) => SECTION_LABEL[key] ?? key).join(', ')}`
      : '',
  ]
  return parts.filter((part) => part !== '').join('; ') || 'No change to the plan'
}

/** "Added Read the thing" for one, "Added 3 tasks" for more, nothing for none. */
function counted(
  verb: string,
  ids: readonly string[],
  name: (id: string) => string,
  plural: string,
  pluralVerb = verb,
): string {
  if (ids.length === 0) return ''
  if (ids.length === 1) return `${verb} ${name(ids[0]!)}`
  return `${pluralVerb} ${ids.length} ${plural}`
}
