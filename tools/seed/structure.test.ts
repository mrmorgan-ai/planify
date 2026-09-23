import { describe, expect, it } from 'vitest'
import { applyEdits, parseEdits, type Edit } from '../../src/core/edits'
import { seedContent } from '../../src/core/seed'
import type { Item, RoadmapContent } from '../../src/core/types'
import { validate } from '../../src/core/validate'
import { EXAMPLE_SEED, readSeedFile } from './load'

const example = seedContent(readSeedFile(EXAMPLE_SEED))
const apply = (edits: Edit[], content: RoadmapContent = example) => applyEdits(content, parseEdits(edits))
const item = (content: RoadmapContent, id: string) => content.items.find((each) => each.id === id)!
const errors = (content: RoadmapContent) => validate(content).filter((issue) => issue.severity === 'error')

describe('work items', () => {
  it('creates one with an id from its name, and parts can join it in the same list', () => {
    const after = apply([
      { op: 'createWorkItem', workItem: { name: 'A reading list', type: 'Book' } },
      { op: 'updateItem', id: 'read-the-thing', fields: { workItemId: 'a-reading-list' } },
    ])
    expect(after.workItems.at(-1)).toEqual({
      id: 'a-reading-list',
      name: 'A reading list',
      type: 'Book',
      link: null,
      resources: [],
      notes: '',
    })
    expect(item(after, 'read-the-thing').workItemId).toBe('a-reading-list')
  })

  it('edits one with the seed file’s rules', () => {
    const after = apply([{ op: 'updateWorkItem', id: 'the-course', fields: { name: 'Renamed' } }])
    expect(after.workItems.find((each) => each.id === 'the-course')?.name).toBe('Renamed')
    expect(() => apply([{ op: 'updateWorkItem', id: 'the-course', fields: { link: '' } }])).toThrow(/use null/)
    expect(() => parseEdits([{ op: 'updateWorkItem', id: 'the-course', fields: { id: 'x' } }])).toThrow(/cannot be edited/)
  })

  it('deletes one and leaves its parts standing on their own', () => {
    const after = apply([{ op: 'deleteWorkItem', id: 'the-course' }])
    expect(after.workItems.some((each) => each.id === 'the-course')).toBe(false)
    expect(item(after, 'course-part-1').workItemId).toBeNull()
    expect(errors(after)).toEqual([])
  })
})

describe('phases', () => {
  it('renames a phase and moves its closing milestone', () => {
    const after = apply([
      { op: 'updatePhase', number: 2, fields: { name: 'Renamed', closingMilestoneId: 'the-optional-thing' } },
    ])
    expect(after.roadmap.phases[1]).toEqual({ number: 2, name: 'Renamed', closingMilestoneId: 'the-optional-thing' })
    expect(errors(after)).toEqual([])
  })

  it('lets a closing milestone be deleted once another item closes its phase', () => {
    const after = apply([
      { op: 'updatePhase', number: 1, fields: { closingMilestoneId: 'exam-prep' } },
      { op: 'deleteItem', id: 'phase-1-exam', rewire: true },
    ])
    expect(after.items.some((each) => each.id === 'phase-1-exam')).toBe(false)
    expect(errors(after)).toEqual([])
  })

  it('adds a phase after the last, up to six, and removes only an empty last one', () => {
    const added = apply([{ op: 'addPhase', name: 'Third phase' }])
    expect(added.roadmap.phases.at(-1)).toEqual({ number: 3, name: 'Third phase', closingMilestoneId: null })
    expect(apply([{ op: 'removePhase', number: 3 }], added).roadmap.phases).toHaveLength(2)

    expect(() => apply([{ op: 'removePhase', number: 1 }], added)).toThrow(/Only the last phase/)
    expect(() => apply([{ op: 'removePhase', number: 2 }])).toThrow(/still has 2 items/)
    const six = apply(['3', '4', '5', '6'].map((n) => ({ op: 'addPhase', name: `Phase ${n}` }) as Edit))
    expect(() => apply([{ op: 'addPhase', name: 'Seventh' }], six)).toThrow(/at most 6 phases/)
  })
})

describe('pauses', () => {
  const pause = { from: '2030-01-14', to: '2030-01-20', reason: 'A week off' }
  const withPause = (keepStudyDays: boolean) =>
    apply([{ op: 'setBlackouts', blackouts: [...example.roadmap.blackouts, pause], keepStudyDays }])

  it('keeps every unfinished item on its study day, so later items move past a new pause', () => {
    const after = withPause(true)
    // Planned before the pause: untouched.
    expect(item(after, 'course-part-1')).toMatchObject({ baselineStartDate: '2030-01-07', baselineEndDate: '2030-01-13' })
    // Planned inside it: moved to the next study day, which is after the pause
    // that already follows it, with the same seven study days.
    expect(item(after, 'course-part-2')).toMatchObject({ baselineStartDate: '2030-02-04', baselineEndDate: '2030-02-10' })
    expect(errors(after)).toEqual([])
  })

  it('without that, leaves the plan where it is and the validator says what the pause covers', () => {
    const after = withPause(false)
    expect(item(after, 'course-part-2').baselineStartDate).toBe('2030-01-14')
    // Course part 2 now falls wholly inside the pause: no study day left.
    expect(errors(after).map((issue) => issue.rule)).toContain('dates')
  })

  it('never moves a finished item', () => {
    const done: RoadmapContent = {
      ...example,
      items: example.items.map((each): Item =>
        each.id === 'course-part-2' ? { ...each, state: 'done', completedAt: '2030-01-20T10:00:00Z' } : each,
      ),
    }
    const after = apply([{ op: 'setBlackouts', blackouts: [...example.roadmap.blackouts, pause], keepStudyDays: true }], done)
    expect(item(after, 'course-part-2').baselineStartDate).toBe('2030-01-14')
  })

  it('refuses pauses that overlap or end before they start', () => {
    expect(() =>
      parseEdits([{ op: 'setBlackouts', blackouts: [pause, { ...pause, from: '2030-01-16', to: '2030-01-25' }] }]),
    ).toThrow(/overlap/)
    expect(() => parseEdits([{ op: 'setBlackouts', blackouts: [{ ...pause, to: '2030-01-01' }] }])).toThrow(
      /before it starts/,
    )
  })
})

describe('settings', () => {
  it('sets capacity, start date and time zone', () => {
    const after = apply([
      { op: 'updateSettings', fields: { weeklyHours: 20, startDate: '2030-01-06', timeZone: 'Europe/Madrid' } },
    ])
    expect(after.roadmap).toMatchObject({ weeklyHours: { normal: 20 }, startDate: '2030-01-06', timeZone: 'Europe/Madrid' })
  })

  it('leaves a time zone the runtime does not know to the validator', () => {
    const after = apply([{ op: 'updateSettings', fields: { timeZone: 'Mars/Olympus_Mons' } }])
    expect(errors(after).map((issue) => issue.rule)).toEqual(['time-zone'])
  })

  it.each([
    [{ weeklyHours: -1 }, /zero or more/],
    [{ startDate: 'soon' }, /YYYY-MM-DD/],
    [{ revision: 3 }, /cannot be edited/],
  ])('refuses %j', (fields, message) => {
    expect(() => parseEdits([{ op: 'updateSettings', fields }])).toThrow(message)
  })
})

describe('the skill map', () => {
  it('renames a skill everywhere it is used, and reorders the axes', () => {
    const after = apply([
      {
        op: 'setSkillMap',
        dimensions: ['Second axis', 'First axis'],
        skills: { 'Something measurable, renamed': 'First axis', 'Something else': 'Second axis' },
        renamed: { 'Something measurable': 'Something measurable, renamed' },
      },
    ])
    expect(after.roadmap.dimensions).toEqual(['Second axis', 'First axis'])
    expect(item(after, 'course-part-1').skills).toEqual(['Something measurable, renamed'])
    expect(errors(after)).toEqual([])
  })

  it('reports a skill dropped while items still use it', () => {
    const after = apply([
      { op: 'setSkillMap', dimensions: ['First axis', 'Second axis'], skills: { 'Something else': 'Second axis' } },
    ])
    expect(errors(after).map((issue) => issue.rule)).toContain('unmapped-skill')
  })

  it('refuses a skill on an axis that does not exist, and an axis named twice', () => {
    expect(() => parseEdits([{ op: 'setSkillMap', dimensions: ['A'], skills: { x: 'B' } }])).toThrow(/not an axis/)
    expect(() => parseEdits([{ op: 'setSkillMap', dimensions: ['A', 'A'], skills: {} }])).toThrow(/twice/)
  })
})
