import { SECTION_LABEL, importChanges } from './importing'
import type { IsoDateTime, RoadmapContent } from './types'

/** What replaced a version of the plan. */
export type VersionReason = 'edit' | 'import' | 'reschedule' | 'restore'

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
 * The name a version downloads as: `roadmap-2026-09-23-1332-v5.json`. When the
 * change was made, in the roadmap's timezone like every date in the app, then
 * its number in the history — so a folder of them sorts by date, and each one
 * matches its `#5` in the list.
 */
export function versionFileName(
  version: Pick<PlanVersion, 'id' | 'createdAt'>,
  timeZone: string,
): string {
  const part = partsIn(new Date(version.createdAt), timeZone)
  const stamp = `${part('year')}-${part('month')}-${part('day')}-${part('hour')}${part('minute')}`
  return `roadmap-${stamp}-v${version.id}.json`
}

/** The calendar and clock fields of an instant in a timezone, UTC for one the runtime lacks. */
function partsIn(instant: Date, timeZone: string): (type: Intl.DateTimeFormatPartTypes) => string {
  const options: Intl.DateTimeFormatOptions = {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }
  let format: Intl.DateTimeFormat
  try {
    format = new Intl.DateTimeFormat('en-CA', { ...options, timeZone })
  } catch {
    format = new Intl.DateTimeFormat('en-CA', { ...options, timeZone: 'UTC' })
  }
  const parts = format.formatToParts(instant)
  return (type) => parts.find((part) => part.type === type)?.value ?? ''
}

/**
 * What a change did to the plan, in a line a person can scan: "Added Read the
 * thing; Edited Build part 2 (baselineStartDate, baselineEndDate)". One thing is
 * named, several are counted. The names are the ones the change saw, so the
 * line still reads right after an item is renamed again or deleted.
 */
export function describeChanges(before: RoadmapContent, after: RoadmapContent): string {
  const changes = importChanges(before, after)
  // The name an item had before the change, which is what it is called in the
  // version this line describes; one the change adds only has its new name.
  const names = new Map([...after.items, ...before.items].map((item) => [item.id, item.name]))
  const units = new Map(
    [...after.workItems, ...before.workItems].map((workItem) => [workItem.id, workItem.name]),
  )
  const name = (id: string) => names.get(id) ?? id
  const unit = (id: string) => units.get(id) ?? id

  const { added, removed, changed } = changes.items
  const parts = [
    counted('Added', added, name, 'items'),
    counted('Deleted', removed.map((item) => item.id), name, 'items'),
    changed.length === 1
      ? `Edited ${name(changed[0]!.id)} (${changed[0]!.fields.join(', ')})`
      : counted('Edited', changed.map((item) => item.id), name, 'items'),
    counted('Added work item', changes.workItems.added, unit, 'work items', 'Added'),
    counted('Deleted work item', changes.workItems.removed, unit, 'work items', 'Deleted'),
    counted('Edited work item', changes.workItems.changed, unit, 'work items', 'Edited'),
    changes.settings.length > 0
      ? `Changed the ${changes.settings.map((key) => SECTION_LABEL[key] ?? key).join(', ')}`
      : '',
  ]
  return parts.filter((part) => part !== '').join('; ') || 'No change to the plan'
}

/** "Added Read the thing" for one, "Added 3 items" for more, nothing for none. */
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
