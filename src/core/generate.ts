import { PHASE_NUMBERS } from './constants'
import {
  addDays,
  firstStudyDayFrom,
  isBlackoutDay,
  isCivilDate,
  maxDate,
  startOfWeek,
  studyDayAfter,
  studyDaysBetween,
} from './dates'
import { EditError, takenIds, unusedId } from './editing'
import type { Edit } from './edits'
import { hoursByWeek } from './hours'
import type { CivilDate, Item, ItemType, PhaseNumber, RoadmapContent } from './types'

// Generators turn a few answers — a course of 20 hours at 5 a week, a project in
// six tasks — into the items the plan is made of, already placed. What they
// produce is a list of edits like any other, so it lands through the same write,
// the same validator and the same history as an edit made by hand.
//
// Placement fills what the weekly capacity leaves free, week by week, reading the
// plan's own dates the way the capacity check does. Every new item lives inside
// one week and on study days only, so none of them is too long, starts in a
// pause or pushes a week over capacity.

export const GENERATOR_KINDS = ['course', 'certification', 'project', 'practice'] as const
export type GeneratorKind = (typeof GENERATOR_KINDS)[number]

/** What a course generator can make: something read or watched, by the week. */
export const COURSE_TYPES = ['Course', 'Book', 'Documentation'] as const satisfies ItemType[]

/** Where the new items go, and what each of them feeds. */
export type Placement = {
  phase: PhaseNumber
  skills: string[]
  /** The first of them waits on this item, and starts after it ends. */
  after: string | null
  /** Nothing starts before this day. Empty for today. */
  from: CivilDate | ''
}

export type ProjectTask = { name: string; hours: number }

export type GenerateRequest = Placement &
  (
    | {
        kind: 'course'
        name: string
        type: (typeof COURSE_TYPES)[number]
        link: string | null
        hours: number
        /** The most it gets in a week. Each week's part holds what is free, up to this. */
        weeklyHours: number
      }
    | {
        kind: 'certification'
        name: string
        link: string | null
        price: string
        /** Zero for an exam with no prep. */
        prepHours: number
        weeklyHours: number
        prepDoneWhen: string
        examHours: number
        /** The day of the exam, after the prep. Empty for the first day with room. */
        examDate: CivilDate | ''
      }
    | {
        kind: 'project'
        name: string
        link: string | null
        /** What done means for the whole project. */
        doneWhen: string
        tasks: ProjectTask[]
      }
    | {
        kind: 'practice'
        name: string
        /** Each block's. */
        hours: number
        /** One block a week, for this many weeks with room. */
        weeks: number
        doneWhen: string
      }
  )

/** A new item where the generator put it. */
export type Placed = {
  id: string
  name: string
  start: CivilDate
  end: CivilDate
  hours: number
}

export type Generated = {
  edits: Edit[]
  placed: Placed[]
  /** The history's line for it. */
  summary: string
}

/** How far ahead a placement looks before saying there is no room. */
const HORIZON_WEEKS = 104
/** A week with less free than this gets no part: a 20-minute part is noise. */
const MIN_PART_HOURS = 1
/** The same slack the capacity check allows. */
const TOLERANCE = 0.01
const MAX_WEEKS = 52
const MAX_TASKS = 50

/**
 * The edits that add what the request describes, placed in the plan.
 *
 * The first item waits on `after`, or, with nothing named, on the previous
 * phase's closing milestone, so the phase stays gated. The phase's own
 * milestone is made to wait on the new items when they end before it starts;
 * when they do not, it is left alone and the review shows the warning. New items
 * take their place in the backlog's order by date.
 */
export function generate(
  content: RoadmapContent,
  today: CivilDate,
  request: GenerateRequest,
): Generated {
  const { roadmap, items } = content
  const { blackouts } = roadmap
  const phase = roadmap.phases.find((each) => each.number === request.phase)
  if (!phase) throw new EditError(`No phase ${request.phase}`)

  const byId = new Map(items.map((item) => [item.id, item]))
  const after = request.after === null ? null : byId.get(request.after)
  if (after === undefined) throw new EditError(`No item with id ${request.after}`)
  const previous = roadmap.phases.find((each) => each.number === phase.number - 1)
  const gate = previous?.closingMilestoneId ? (byId.get(previous.closingMilestoneId) ?? null) : null
  const waitsOn = after ?? gate

  const floors = [today, request.from, roadmap.startDate].filter(
    (day): day is CivilDate => day !== '',
  )
  if (waitsOn) floors.push(studyDayAfter(waitsOn.baselineEndDate, blackouts))
  const from = firstStudyDayFrom(maxDate(today, ...floors), blackouts)

  const weeks = freeWeeks(content)
  const name = request.name
  const taken = takenIds(content)
  const pieces: Piece[] = []
  const units: Array<{
    id: string
    name: string
    type: ItemType
    link: string | null
    notes: string
  }> = []
  const unit = (type: ItemType, link: string | null, notes = '') => {
    const id = unusedId(name, taken)
    taken.add(id)
    units.push({ id, name, type, link, notes })
    return id
  }
  const first = waitsOn ? [waitsOn.id] : []

  switch (request.kind) {
    case 'course': {
      const parts = weeks.stream(request.hours, request.weeklyHours, from, name)
      const workItemId = parts.length > 1 ? unit(request.type, request.link) : null
      parts.forEach((part, index) =>
        pieces.push({
          ...part,
          name: workItemId ? `${name} — part ${index + 1}` : name,
          type: request.type,
          workItemId,
          chained: true,
          link: workItemId ? null : request.link,
        }),
      )
      break
    }
    case 'certification': {
      const prep =
        request.prepHours > 0
          ? weeks.stream(request.prepHours, request.weeklyHours, from, `The prep for ${name}`)
          : []
      const examFrom = prep.length > 0 ? studyDayAfter(prep[prep.length - 1]!.end, blackouts) : from
      const exam =
        request.examDate === ''
          ? weeks.fixed(request.examHours, 1, examFrom, name, 'early')
          : weeks.on(request.examDate, request.examHours, examFrom, name)
      const workItemId = prep.length > 0 ? unit('Certification', request.link) : null
      prep.forEach((part, index) =>
        pieces.push({
          ...part,
          name: prep.length > 1 ? `${name} — prep ${index + 1}` : `${name} — prep`,
          type: 'Exam prep',
          workItemId,
          chained: true,
          doneWhen: request.prepDoneWhen,
        }),
      )
      pieces.push({
        ...exam,
        hours: request.examHours,
        name: workItemId ? `${name} — exam` : name,
        type: 'Certification',
        workItemId,
        chained: true,
        link: workItemId ? null : request.link,
        price: request.price,
      })
      break
    }
    case 'project': {
      let cursor = from
      const slots = request.tasks.map((task) => {
        const slot = weeks.fixed(task.hours, weeks.daysFor(task.hours), cursor, task.name, 'early')
        cursor = studyDayAfter(slot.end, blackouts)
        return { ...slot, hours: task.hours, name: task.name }
      })
      const workItemId = slots.length > 1 ? unit('Project', request.link, request.doneWhen) : null
      slots.forEach((slot) =>
        pieces.push({
          ...slot,
          name: workItemId ? slot.name : name,
          // "Deploy it" is a fine name inside its project and a poor id outside it.
          idFrom: workItemId ? `${name} ${slot.name}` : name,
          type: 'Project',
          workItemId,
          chained: true,
          link: workItemId ? null : request.link,
          doneWhen: workItemId ? '' : request.doneWhen,
        }),
      )
      break
    }
    case 'practice': {
      let cursor = from
      const slots = Array.from({ length: request.weeks }, () => {
        const slot = weeks.fixed(request.hours, weeks.daysFor(request.hours), cursor, name, 'late')
        // One block a week: the next looks from the Monday after this one's.
        cursor = firstStudyDayFrom(addDays(startOfWeek(slot.start), 7), blackouts)
        return slot
      })
      const workItemId = slots.length > 1 ? unit('Practice', null) : null
      slots.forEach((slot, index) =>
        pieces.push({
          ...slot,
          hours: request.hours,
          name: workItemId ? `${name} — week ${index + 1}` : name,
          type: 'Practice',
          workItemId,
          chained: false,
          doneWhen: request.doneWhen,
        }),
      )
      break
    }
  }

  const placed: Placed[] = []
  const edits: Edit[] = units.map((each) => ({
    op: 'createWorkItem',
    workItem: { ...each, resources: [] },
  }))
  pieces.forEach((piece, index) => {
    const id = unusedId(piece.idFrom ?? piece.name, taken)
    taken.add(id)
    const before = placed[index - 1]
    edits.push({
      op: 'createItem',
      item: {
        id,
        name: piece.name,
        type: piece.type,
        phase: phase.number,
        skills: request.skills,
        workItemId: piece.workItemId,
        baselineStartDate: piece.start,
        baselineEndDate: piece.end,
        dependsOn: piece.chained && before ? [before.id] : first,
        duration: `~${hoursText(piece.hours)}h`,
        link: piece.link ?? null,
        doneWhen: piece.doneWhen ?? '',
        price: piece.price ?? '',
      },
    })
    placed.push({ id, name: piece.name, start: piece.start, end: piece.end, hours: piece.hours })
  })

  edits.push(...inPlanOrder(items, phase.number, placed))
  edits.push(...closingOn(phase.closingMilestoneId, byId, pieces, placed))

  const last = placed.reduce((latest, piece) => (piece.end > latest ? piece.end : latest), from)
  return {
    edits,
    placed,
    summary: `Generated ${name}: ${placed.length} ${placed.length === 1 ? 'item' : 'items'}, ${placed[0]!.start} to ${last}`,
  }
}

type Slot = { start: CivilDate; end: CivilDate }

type Piece = Slot & {
  name: string
  /** What its id is made from, when not its name: a task's, with its project's. */
  idFrom?: string
  type: ItemType
  hours: number
  workItemId: string | null
  /** Waits on the piece before it, rather than on what the whole thing waits on. */
  chained: boolean
  link?: string | null
  doneWhen?: string
  price?: string
}

/**
 * The plan's weeks, with what each has left: its capacity, less the pauses in
 * it, less the hours the plan already puts there. Placing a piece takes its
 * hours from its week, so the next piece sees what is left after it.
 */
function freeWeeks({ roadmap, items }: RoadmapContent) {
  const { blackouts } = roadmap
  const capacity = roadmap.weeklyHours.normal
  if (capacity <= 0) {
    throw new EditError(
      'Set the weekly capacity in the settings first: new items are placed in the hours it leaves free',
    )
  }
  // What a study day holds at full capacity: how long a piece of so many hours takes.
  const perDay = capacity / 7

  // Planned dates, as the capacity check reads them. An item with dates the
  // validator already refuses takes no room.
  const planned = items
    .filter(
      (item) =>
        isCivilDate(item.baselineStartDate) &&
        isCivilDate(item.baselineEndDate) &&
        item.baselineStartDate <= item.baselineEndDate,
    )
    .map((item) => ({
      ...item,
      projectedStartDate: item.baselineStartDate,
      projectedEndDate: item.baselineEndDate,
    }))
  const used = hoursByWeek(planned, blackouts)

  const free = (monday: CivilDate) =>
    (capacity * studyDaysBetween(monday, addDays(monday, 6), blackouts)) / 7 -
    (used.get(monday) ?? 0)
  const take = (day: CivilDate, hours: number) => {
    const monday = startOfWeek(day)
    used.set(monday, (used.get(monday) ?? 0) + hours)
  }
  /** The study days of a week, from `from` on. */
  const openDays = (monday: CivilDate, from: CivilDate) => {
    const days: CivilDate[] = []
    for (let day = maxDate(monday, from); day <= addDays(monday, 6); day = addDays(day, 1)) {
      if (!isBlackoutDay(day, blackouts)) days.push(day)
    }
    return days
  }
  const noRoom = (name: string, from: CivilDate) =>
    new EditError(`There is no room for ${name} in the ${HORIZON_WEEKS} weeks from ${from}`)

  return {
    daysFor: (hours: number) => Math.max(1, Math.ceil(hours / perDay - TOLERANCE)),

    /**
     * A piece of fixed size in the first week, from `from`, with its hours free
     * and enough study days left: at the start of those days, or at their end —
     * where a week's practice goes, after what it practises.
     */
    fixed(
      hours: number,
      days: number,
      from: CivilDate,
      name: string,
      where: 'early' | 'late',
    ): Slot {
      if (hours > capacity + TOLERANCE) {
        throw new EditError(
          `${name} takes ${hoursText(hours)}h, more than a week holds (${hoursText(capacity)}h); split it`,
        )
      }
      for (
        let week = 0, monday = startOfWeek(from);
        week < HORIZON_WEEKS;
        week++, monday = addDays(monday, 7)
      ) {
        const open = openDays(monday, from)
        if (open.length < days || free(monday) + TOLERANCE < hours) continue
        const slot =
          where === 'early'
            ? { start: open[0]!, end: open[days - 1]! }
            : { start: open[open.length - days]!, end: open[open.length - 1]! }
        take(slot.start, hours)
        return slot
      }
      throw noRoom(name, from)
    },

    /** A one-day piece on a day already chosen, whatever the week holds. */
    on(day: CivilDate, hours: number, from: CivilDate, name: string): Slot {
      if (day < from)
        throw new EditError(`${name} is on ${day}, but the earliest it can be is ${from}`)
      if (isBlackoutDay(day, blackouts)) throw new EditError(`${name} is on ${day}, inside a pause`)
      take(day, hours)
      return { start: day, end: day }
    },

    /**
     * Hours spread over as many weeks as they need: each week from `from` gets
     * one part of what it has free, up to `weekly`, over the rest of its study
     * days. Weeks with less than an hour free are skipped.
     */
    stream(
      hours: number,
      weekly: number,
      from: CivilDate,
      name: string,
    ): Array<Slot & { hours: number }> {
      const parts: Array<Slot & { hours: number }> = []
      let remaining = hours
      for (
        let week = 0, monday = startOfWeek(from);
        remaining > TOLERANCE;
        week++, monday = addDays(monday, 7)
      ) {
        if (week >= HORIZON_WEEKS) throw noRoom(name, from)
        const open = openDays(monday, from)
        if (open.length === 0) continue
        const room = Math.min(weekly, free(monday), open.length * perDay)
        const part = remaining <= room + TOLERANCE ? remaining : Math.floor(room * 2) / 2
        if (part <= 0 || part < Math.min(MIN_PART_HOURS, remaining) - TOLERANCE) continue
        take(open[0]!, part)
        parts.push({ start: open[0]!, end: open[open.length - 1]!, hours: part })
        remaining = Math.round((remaining - part) * 100) / 100
      }
      return parts
    },
  }
}

/**
 * Moves each new item before the first item of the phase planned to start after
 * it, so the backlog's order stays the plan's. The new items arrive in date
 * order, so each lands after the one before it.
 */
function inPlanOrder(
  items: readonly Item[],
  phase: PhaseNumber,
  placed: readonly Placed[],
): Edit[] {
  const order = items
    .filter((item) => item.phase === phase)
    .sort((a, b) => a.sortOrder - b.sortOrder)
  return placed.flatMap((piece): Edit[] => {
    const next = order.find((item) => item.baselineStartDate > piece.start)
    return next ? [{ op: 'moveItem', id: piece.id, phase, before: next.id }] : []
  })
}

/**
 * Makes the phase's closing milestone wait on the last of the new items, when
 * they all end before it starts. Later than that, waiting on them would move
 * the milestone, and that is the person's call.
 */
function closingOn(
  milestoneId: string | null,
  byId: ReadonlyMap<string, Item>,
  pieces: readonly Piece[],
  placed: readonly Placed[],
): Edit[] {
  const milestone = milestoneId === null ? undefined : byId.get(milestoneId)
  if (!milestone) return []
  // The ones nothing else new waits on: the end of each chain, and every block.
  const lasts = placed.filter((_, index) => !pieces[index]!.chained || !pieces[index + 1]?.chained)
  if (lasts.some((piece) => piece.end >= milestone.baselineStartDate)) return []
  return [
    {
      op: 'setDependencies',
      id: milestone.id,
      dependsOn: [...milestone.dependsOn, ...lasts.map((piece) => piece.id)],
    },
  ]
}

/** "2.5", "3": hours as a duration writes them. */
function hoursText(hours: number): string {
  return String(Math.round(hours * 100) / 100)
}

/**
 * Tasks written one per line with their hours: "Set up the repo, 2h",
 * "Deploy it — 3.5 hours". Blank lines are skipped; a line with no hours is a
 * problem to show, not a guess.
 */
export function parseTaskLines(text: string): { tasks: ProjectTask[]; problems: string[] } {
  const tasks: ProjectTask[] = []
  const problems: string[] = []
  text.split('\n').forEach((raw, index) => {
    const line = raw.trim()
    if (line === '') return
    const match = /^(.*?)[\s,;:(—–-]*~?(\d+(?:[.,]\d+)?)\s*(?:h|hrs?|hours?)\)?\.?$/i.exec(line)
    const name = match?.[1]?.trim() ?? ''
    const hours = Number(match?.[2]?.replace(',', '.'))
    if (!match || name === '' || !(hours > 0)) {
      problems.push(`Line ${index + 1} needs a name and its hours, like "Set up the repo, 2h"`)
    } else {
      tasks.push({ name, hours })
    }
  })
  return { tasks, problems }
}

/** Checks a request's shape and types. Whether it fits the plan is `generate`'s question. */
export function parseGenerateRequest(raw: unknown): GenerateRequest {
  const value = object(raw, 'generator')
  const kind = value.kind
  if (!(GENERATOR_KINDS as readonly unknown[]).includes(kind)) {
    throw new EditError(`generator.kind must be one of ${GENERATOR_KINDS.join(', ')}`)
  }
  const phase = value.phase
  if (!(PHASE_NUMBERS as readonly unknown[]).includes(phase)) {
    throw new EditError('generator.phase must be a phase number')
  }
  const skills = value.skills
  if (
    !Array.isArray(skills) ||
    skills.length === 0 ||
    skills.some((skill) => typeof skill !== 'string')
  ) {
    throw new EditError('generator.skills must name at least one skill')
  }
  const after = value.after ?? null
  if (after !== null && typeof after !== 'string') {
    throw new EditError('generator.after must be an item id or null')
  }
  const placement: Placement = {
    phase: phase as PhaseNumber,
    skills: skills as string[],
    after,
    from: day(value.from, 'generator.from'),
  }
  const name = text(value.name, 'generator.name')
  if (name === '') throw new EditError('generator.name must not be empty')

  switch (kind as GeneratorKind) {
    case 'course': {
      const type = value.type
      if (!(COURSE_TYPES as readonly unknown[]).includes(type)) {
        throw new EditError(`generator.type must be one of ${COURSE_TYPES.join(', ')}`)
      }
      return {
        ...placement,
        kind: 'course',
        name,
        type: type as (typeof COURSE_TYPES)[number],
        link: link(value.link),
        hours: hours(value.hours, 'generator.hours'),
        weeklyHours: hours(value.weeklyHours, 'generator.weeklyHours'),
      }
    }
    case 'certification': {
      const prepHours = value.prepHours ?? 0
      if (typeof prepHours !== 'number' || !Number.isFinite(prepHours) || prepHours < 0) {
        throw new EditError('generator.prepHours must be zero or more')
      }
      return {
        ...placement,
        kind: 'certification',
        name,
        link: link(value.link),
        price: text(value.price ?? '', 'generator.price'),
        prepHours,
        weeklyHours: prepHours > 0 ? hours(value.weeklyHours, 'generator.weeklyHours') : 0,
        prepDoneWhen: text(value.prepDoneWhen ?? '', 'generator.prepDoneWhen'),
        examHours: hours(value.examHours, 'generator.examHours'),
        examDate: day(value.examDate, 'generator.examDate'),
      }
    }
    case 'project': {
      const tasks = value.tasks
      if (!Array.isArray(tasks) || tasks.length === 0 || tasks.length > MAX_TASKS) {
        throw new EditError(`generator.tasks must list 1 to ${MAX_TASKS} tasks`)
      }
      return {
        ...placement,
        kind: 'project',
        name,
        link: link(value.link),
        doneWhen: text(value.doneWhen ?? '', 'generator.doneWhen'),
        tasks: tasks.map((task, index) => {
          const at = `generator.tasks[${index}]`
          const entry = object(task, at)
          const taskName = text(entry.name, `${at}.name`)
          if (taskName === '') throw new EditError(`${at}.name must not be empty`)
          return { name: taskName, hours: hours(entry.hours, `${at}.hours`) }
        }),
      }
    }
    case 'practice': {
      const weeks = value.weeks
      if (typeof weeks !== 'number' || !Number.isInteger(weeks) || weeks < 1 || weeks > MAX_WEEKS) {
        throw new EditError(`generator.weeks must be a whole number from 1 to ${MAX_WEEKS}`)
      }
      return {
        ...placement,
        kind: 'practice',
        name,
        hours: hours(value.hours, 'generator.hours'),
        weeks,
        doneWhen: text(value.doneWhen ?? '', 'generator.doneWhen'),
      }
    }
  }
}

function object(value: unknown, at: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new EditError(`${at} must be an object`)
  }
  return value as Record<string, unknown>
}

function text(value: unknown, at: string): string {
  if (typeof value !== 'string') throw new EditError(`${at} must be a string`)
  return value.trim()
}

function hours(value: unknown, at: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    throw new EditError(`${at} must be a number of hours above zero`)
  }
  return value
}

function day(value: unknown, at: string): CivilDate | '' {
  const raw = value ?? ''
  if (raw !== '' && (typeof raw !== 'string' || !isCivilDate(raw))) {
    throw new EditError(`${at} must be YYYY-MM-DD or empty`)
  }
  return raw as CivilDate | ''
}

function link(value: unknown): string | null {
  if (value === undefined || value === null) return null
  const trimmed = text(value, 'generator.link')
  return trimmed === '' ? null : trimmed
}
