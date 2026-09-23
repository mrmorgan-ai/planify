import { describe, expect, it } from 'vitest'
import { studyDaysBetween, startOfWeek } from '../../src/core/dates'
import { EditError } from '../../src/core/editing'
import { applyEdits } from '../../src/core/edits'
import {
  generate,
  parseGenerateRequest,
  parseTaskLines,
  type GenerateRequest,
} from '../../src/core/generate'
import { seedContent } from '../../src/core/seed'
import type { RoadmapContent } from '../../src/core/types'
import { validate } from '../../src/core/validate'
import { EXAMPLE_SEED, readSeedFile } from './load'

// The example plans 15h a week from 2030-01-07, with a pause from 2030-01-21 to
// 2030-02-03. What its weeks leave free: 4h in the week of 01-07, 3h in 01-14,
// nothing in the pause, 7.5h in 02-04, 11h in 02-11, 13h in 02-18, then all 15.

const example = seedContent(readSeedFile(EXAMPLE_SEED))
const TODAY = '2030-01-01'
const skills = ['Something measurable']
const where = { phase: 1 as const, skills, after: null, from: '' as const }

const course: GenerateRequest = {
  ...where,
  kind: 'course',
  name: 'A course',
  type: 'Course',
  link: null,
  hours: 20,
  weeklyHours: 5,
}
const certification: GenerateRequest = {
  ...where,
  phase: 2,
  kind: 'certification',
  name: 'An exam',
  link: 'https://example.com/exam',
  price: '$100',
  prepHours: 8,
  weeklyHours: 4,
  prepDoneWhen: 'Scored 80% on a practice exam',
  examHours: 2,
  examDate: '',
}
const project: GenerateRequest = {
  ...where,
  after: 'read-the-thing',
  kind: 'project',
  name: 'A project',
  link: null,
  doneWhen: 'It is deployed',
  tasks: [
    { name: 'Set it up', hours: 2 },
    { name: 'Build it', hours: 4 },
    { name: 'Ship it', hours: 3 },
  ],
}
const practice: GenerateRequest = {
  ...where,
  kind: 'practice',
  name: 'Drill',
  hours: 2,
  weeks: 3,
  doneWhen: 'Solved it without notes',
}

const run = (request: GenerateRequest, content: RoadmapContent = example) => {
  const generated = generate(content, TODAY, request)
  return { ...generated, after: applyEdits(content, generated.edits) }
}
const item = (content: RoadmapContent, id: string) => content.items.find((each) => each.id === id)!
const newIssues = (after: RoadmapContent) => {
  const before = new Set(validate(example).map((issue) => issue.message))
  return validate(after).filter((issue) => !before.has(issue.message))
}

describe('generate', () => {
  it('splits a course into a part a week, holding what each week has free up to its pace', () => {
    const { placed, after } = run(course)
    expect(placed.map(({ start, end, hours }) => [start, end, hours])).toEqual([
      ['2030-01-07', '2030-01-13', 4],
      ['2030-01-14', '2030-01-20', 3],
      // The pause's two weeks hold nothing.
      ['2030-02-04', '2030-02-10', 5],
      ['2030-02-11', '2030-02-17', 5],
      ['2030-02-18', '2030-02-24', 3],
    ])
    expect(after.workItems).toContainEqual(
      expect.objectContaining({ id: 'a-course', name: 'A course', type: 'Course' }),
    )
    const parts = placed.map((piece) => item(after, piece.id))
    expect(parts.map((part) => part.name)).toEqual(
      [1, 2, 3, 4, 5].map((n) => `A course — part ${n}`),
    )
    expect(parts.map((part) => part.duration)).toEqual(['~4h', '~3h', '~5h', '~5h', '~3h'])
    expect(parts.every((part) => part.workItemId === 'a-course')).toBe(true)
    // A chain: each part waits on the one before.
    expect(parts.map((part) => part.dependsOn)).toEqual([
      [],
      [placed[0]!.id],
      [placed[1]!.id],
      [placed[2]!.id],
      [placed[3]!.id],
    ])
  })

  it('breaks none of the rules that placing is meant to keep, for any generator', () => {
    const kept = [
      'over-capacity',
      'too-long',
      'blackout-edge',
      'before-start',
      'late-dependency',
      'overlapping-parts',
      'project-chain',
      'single-part',
      'no-estimate',
      'done-when',
    ]
    for (const request of [course, certification, project, practice]) {
      const { placed, after } = run(request)
      expect(newIssues(after).filter((issue) => kept.includes(issue.rule))).toEqual([])
      for (const piece of placed) {
        expect(startOfWeek(piece.start)).toBe(startOfWeek(piece.end))
      }
    }
  })

  it('waits on the previous phase’s closing milestone when told nothing else', () => {
    const { placed, after } = run(certification)
    expect(placed.map(({ start, end, hours }) => [start, end, hours])).toEqual([
      ['2030-02-11', '2030-02-17', 4],
      ['2030-02-18', '2030-02-24', 4],
      ['2030-02-25', '2030-02-25', 2],
    ])
    expect(item(after, placed[0]!.id).dependsOn).toEqual(['phase-1-exam'])
    const exam = item(after, placed[2]!.id)
    expect(exam).toMatchObject({
      name: 'An exam — exam',
      type: 'Certification',
      price: '$100',
      dependsOn: [placed[1]!.id],
      workItemId: 'an-exam',
    })
    expect(item(after, placed[0]!.id)).toMatchObject({
      name: 'An exam — prep 1',
      type: 'Exam prep',
      doneWhen: 'Scored 80% on a practice exam',
    })
    // The link belongs to the unit, not to each part.
    expect(after.workItems.find((each) => each.id === 'an-exam')?.link).toBe(
      'https://example.com/exam',
    )
  })

  it('puts an exam on the day asked for, and refuses one before the prep ends or in a pause', () => {
    const { placed } = run({ ...certification, examDate: '2030-03-08' })
    expect(placed.at(-1)).toMatchObject({ start: '2030-03-08', end: '2030-03-08' })

    expect(() => run({ ...certification, examDate: '2030-02-20' })).toThrow(
      'An exam is on 2030-02-20, but the earliest it can be is 2030-02-25',
    )
    const paused = { ...certification, phase: 1 as const, prepHours: 0, examDate: '2030-01-25' }
    expect(() => run(paused)).toThrow('inside a pause')
  })

  it('chains a project’s tasks after the item named, each where its hours fit', () => {
    const { placed, after } = run(project)
    expect(placed.map(({ id, start, end }) => [id, start, end])).toEqual([
      // read-the-thing ends on 01-10; 2h of the week's 4 free.
      ['a-project-set-it-up', '2030-01-11', '2030-01-11'],
      // 4h fits neither the 2h left nor the next week's 3h.
      ['a-project-build-it', '2030-02-04', '2030-02-05'],
      ['a-project-ship-it', '2030-02-06', '2030-02-07'],
    ])
    expect(item(after, 'a-project-set-it-up')).toMatchObject({
      name: 'Set it up',
      dependsOn: ['read-the-thing'],
      workItemId: 'a-project',
    })
    expect(after.workItems.find((each) => each.id === 'a-project')?.notes).toBe('It is deployed')
  })

  it('makes the phase’s milestone wait on what ends before it, and leaves it when not', () => {
    const milestone = item(example, 'phase-1-exam')

    const chained = run(project).after
    expect(item(chained, 'phase-1-exam').dependsOn).toEqual([
      ...milestone.dependsOn,
      'a-project-ship-it',
    ])

    // The last drill falls after the milestone starts: waiting on it would move the exam.
    const drilled = run(practice).after
    expect(item(drilled, 'phase-1-exam').dependsOn).toEqual(milestone.dependsOn)
  })

  it('puts one practice block a week, at the end of the week', () => {
    const { placed, after } = run(practice)
    expect(placed.map(({ start, end }) => [start, end])).toEqual([
      ['2030-01-13', '2030-01-13'],
      ['2030-01-20', '2030-01-20'],
      ['2030-02-10', '2030-02-10'],
    ])
    expect(placed.map((piece) => item(after, piece.id).name)).toEqual([
      'Drill — week 1',
      'Drill — week 2',
      'Drill — week 3',
    ])
    expect(placed.every((piece) => item(after, piece.id).dependsOn.length === 0)).toBe(true)
  })

  it('makes a single item, with no work item, when one is enough', () => {
    const { placed, edits, after } = run({ ...course, hours: 3 })
    expect(placed).toHaveLength(1)
    expect(edits.some((edit) => edit.op === 'createWorkItem')).toBe(false)
    expect(item(after, 'a-course')).toMatchObject({ name: 'A course', workItemId: null })
  })

  it('slots the new items into the backlog’s order by date', () => {
    const { after } = run(project)
    const order = after.items
      .filter((each) => each.phase === 1)
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .map((each) => each.id)
    expect(order.indexOf('a-project-set-it-up')).toBeLessThan(order.indexOf('course-part-2'))
    expect(order.indexOf('a-project-ship-it')).toBe(order.indexOf('phase-1-exam') - 1)
  })

  it('starts no earlier than the day asked for', () => {
    const { placed } = run({ ...course, from: '2030-03-06' })
    expect(placed[0]).toMatchObject({ start: '2030-03-06', end: '2030-03-10', hours: 5 })
    expect(studyDaysBetween(placed[0]!.start, placed[0]!.end, [])).toBe(5)
  })

  it('says when a piece is more than a week can hold, or there is no capacity to fill', () => {
    const huge = { ...project, tasks: [{ name: 'Everything', hours: 20 }] }
    expect(() => run(huge)).toThrow('Everything takes 20h, more than a week holds (15h); split it')

    const undeclared = { ...example, roadmap: { ...example.roadmap, weeklyHours: { normal: 0 } } }
    expect(() => run(course, undeclared)).toThrow(EditError)
    expect(() => run({ ...course, after: 'nothing-like-it' })).toThrow(
      'No item with id nothing-like-it',
    )
  })

  it('writes the history’s line', () => {
    expect(run(course).summary).toBe('Generated A course: 5 items, 2030-01-07 to 2030-02-24')
  })
})

describe('parseTaskLines', () => {
  it('reads a task and its hours from each line, however the hours are written', () => {
    expect(parseTaskLines('Set it up, 2h\n\nBuild it — 3.5 hours\nShip it (1,5h)')).toEqual({
      tasks: [
        { name: 'Set it up', hours: 2 },
        { name: 'Build it', hours: 3.5 },
        { name: 'Ship it', hours: 1.5 },
      ],
      problems: [],
    })
  })

  it('names the lines it cannot read', () => {
    expect(parseTaskLines('Set it up\n2h').problems).toEqual([
      'Line 1 needs a name and its hours, like "Set up the repo, 2h"',
      'Line 2 needs a name and its hours, like "Set up the repo, 2h"',
    ])
  })
})

describe('parseGenerateRequest', () => {
  it('accepts each generator as the forms send it', () => {
    for (const request of [course, certification, project, practice]) {
      expect(parseGenerateRequest(JSON.parse(JSON.stringify(request)))).toEqual(request)
    }
  })

  it('refuses what is not one, naming the field', () => {
    expect(() => parseGenerateRequest({ ...course, kind: 'book' })).toThrow('generator.kind')
    expect(() => parseGenerateRequest({ ...course, skills: [] })).toThrow('generator.skills')
    expect(() => parseGenerateRequest({ ...course, hours: 0 })).toThrow('generator.hours')
    expect(() => parseGenerateRequest({ ...practice, weeks: 1.5 })).toThrow('generator.weeks')
    expect(() => parseGenerateRequest({ ...project, tasks: [] })).toThrow('generator.tasks')
    expect(() => parseGenerateRequest({ ...course, from: 'soon' })).toThrow('generator.from')
  })
})
