import { describe, expect, it } from 'vitest'
import { applyEdits, parseEdits, type Edit } from '../../src/core/edits'
import { seedContent } from '../../src/core/seed'
import type { Task, RoadmapContent } from '../../src/core/types'
import { validate } from '../../src/core/validate'
import { EXAMPLE_SEED, readSeedFile } from './load'

const example = seedContent(readSeedFile(EXAMPLE_SEED))
const apply = (edits: Edit[], content: RoadmapContent = example) => applyEdits(content, parseEdits(edits))
const task = (content: RoadmapContent, id: string) => content.tasks.find((each) => each.id === id)!
const errors = (content: RoadmapContent) => validate(content).filter((issue) => issue.severity === 'error')

describe('stories', () => {
  it('creates one with an id from its name, and tasks can join it in the same list', () => {
    const after = apply([
      { op: 'createStory', story: { name: 'A reading list', type: 'Book', phase: 1 } },
      { op: 'updateTask', id: 'read-the-thing', fields: { storyId: 'a-reading-list' } },
    ])
    expect(after.stories.at(-1)).toEqual({
      id: 'a-reading-list',
      name: 'A reading list',
      type: 'Book',
      phase: 1,
      featureId: null,
      link: null,
      resources: [],
      price: '',
      notes: '',
      doneWhen: '',
    })
    expect(task(after, 'read-the-thing').storyId).toBe('a-reading-list')
  })

  it('takes a type only when given one: the type is an optional label', () => {
    const after = apply([{ op: 'createStory', story: { name: 'Untyped', phase: 2 } }])
    expect(after.stories.at(-1)?.type).toBeNull()
    expect(() => apply([{ op: 'updateStory', id: 'the-course', fields: { type: 'Podcast' } }] as unknown as Edit[])).toThrow(
      /type is not valid/,
    )
  })

  it('moves every one of its tasks when it moves to another phase', () => {
    const after = apply([{ op: 'updateStory', id: 'the-course', fields: { phase: 2 } }])
    expect([task(after, 'course-part-1').phase, task(after, 'course-part-2').phase]).toEqual([2, 2])
    expect(task(after, 'course-part-2').sortOrder).toBeGreaterThan(task(after, 'course-part-1').sortOrder)
    expect(
      after.tasks.filter((each) => each.phase === 2).map((each) => each.sortOrder).sort((a, b) => a - b),
    ).toEqual([1, 2, 3, 4])
  })

  it('edits one with the seed file’s rules', () => {
    const after = apply([{ op: 'updateStory', id: 'the-course', fields: { name: 'Renamed' } }])
    expect(after.stories.find((each) => each.id === 'the-course')?.name).toBe('Renamed')
    expect(() => apply([{ op: 'updateStory', id: 'the-course', fields: { link: '' } }])).toThrow(/use null/)
    expect(() => parseEdits([{ op: 'updateStory', id: 'the-course', fields: { id: 'x' } }])).toThrow(/cannot be edited/)
  })

  it('deletes one only once it has no tasks, since every task needs a story', () => {
    expect(() => apply([{ op: 'deleteStory', id: 'the-course' }])).toThrow(/still has 2 tasks/)
    const after = apply([
      { op: 'updateTask', id: 'read-the-thing', fields: { storyId: 'the-course' } },
      { op: 'deleteStory', id: 'read-the-thing-story' },
    ])
    expect(after.stories.some((each) => each.id === 'read-the-thing-story')).toBe(false)
    expect(errors(after)).toEqual([])
  })

  it('refuses a feature that does not exist', () => {
    expect(() => apply([{ op: 'updateStory', id: 'the-course', fields: { featureId: 'nope' } }])).toThrow(
      /No feature with id nope/,
    )
  })
})

describe('features', () => {
  it('creates one that stories can serve in the same list, and deletes it leaving them', () => {
    const after = apply([
      { op: 'createFeature', feature: { name: 'A certification' } },
      { op: 'updateStory', id: 'the-exam', fields: { featureId: 'a-certification' } },
    ])
    expect(after.features).toEqual([
      { id: 'a-certification', name: 'A certification', type: null, link: null, notes: '' },
    ])
    expect(after.stories.find((each) => each.id === 'the-exam')?.featureId).toBe('a-certification')
    expect(errors(after)).toEqual([])

    const deleted = apply([{ op: 'deleteFeature', id: 'a-certification' }], after)
    expect(deleted.features).toEqual([])
    expect(deleted.stories.find((each) => each.id === 'the-exam')?.featureId).toBeNull()
  })

  it('edits one with the seed file’s rules', () => {
    const created = apply([{ op: 'createFeature', feature: { id: 'goal', name: 'Goal' } }])
    expect(apply([{ op: 'updateFeature', id: 'goal', fields: { notes: 'Why.' } }], created).features[0]?.notes).toBe(
      'Why.',
    )
    expect(() => apply([{ op: 'updateFeature', id: 'goal', fields: { link: '' } }], created)).toThrow(/use null/)
    expect(() => parseEdits([{ op: 'updateFeature', id: 'goal', fields: { id: 'x' } }])).toThrow(/cannot be edited/)
  })

  it('never takes an id a task or a story already has', () => {
    expect(() => apply([{ op: 'createFeature', feature: { id: 'the-course', name: 'x' } }])).toThrow(/already taken/)
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

  it('lets a closing milestone be deleted once another task closes its phase', () => {
    const after = apply([
      { op: 'updatePhase', number: 1, fields: { closingMilestoneId: 'exam-prep' } },
      { op: 'deleteTask', id: 'phase-1-exam', rewire: true },
    ])
    expect(after.tasks.some((each) => each.id === 'phase-1-exam')).toBe(false)
    expect(errors(after)).toEqual([])
  })

  it('adds a phase after the last, up to six, and removes only an empty last one', () => {
    const added = apply([{ op: 'addPhase', name: 'Third phase' }])
    expect(added.roadmap.phases.at(-1)).toEqual({ number: 3, name: 'Third phase', closingMilestoneId: null })
    expect(apply([{ op: 'removePhase', number: 3 }], added).roadmap.phases).toHaveLength(2)

    expect(() => apply([{ op: 'removePhase', number: 1 }], added)).toThrow(/Only the last phase/)
    expect(() => apply([{ op: 'removePhase', number: 2 }])).toThrow(/still has 2 stories/)
    const six = apply(['3', '4', '5', '6'].map((n) => ({ op: 'addPhase', name: `Phase ${n}` }) as Edit))
    expect(() => apply([{ op: 'addPhase', name: 'Seventh' }], six)).toThrow(/at most 6 phases/)
  })
})

describe('pauses', () => {
  const pause = { from: '2030-01-14', to: '2030-01-20', reason: 'A week off' }
  const withPause = (keepStudyDays: boolean) =>
    apply([{ op: 'setBlackouts', blackouts: [...example.roadmap.blackouts, pause], keepStudyDays }])

  it('keeps every unfinished task on its study day, so later tasks move past a new pause', () => {
    const after = withPause(true)
    // Planned before the pause: untouched.
    expect(task(after, 'course-part-1')).toMatchObject({ baselineStartDate: '2030-01-07', baselineEndDate: '2030-01-13' })
    // Planned inside it: moved to the next study day, which is after the pause
    // that already follows it, with the same seven study days.
    expect(task(after, 'course-part-2')).toMatchObject({ baselineStartDate: '2030-02-04', baselineEndDate: '2030-02-10' })
    expect(errors(after)).toEqual([])
  })

  it('without that, leaves the plan where it is and the validator says what the pause covers', () => {
    const after = withPause(false)
    expect(task(after, 'course-part-2').baselineStartDate).toBe('2030-01-14')
    // Course part 2 now falls wholly inside the pause: no study day left.
    expect(errors(after).map((issue) => issue.rule)).toContain('dates')
  })

  it('never moves a finished task', () => {
    const done: RoadmapContent = {
      ...example,
      tasks: example.tasks.map((each): Task =>
        each.id === 'course-part-2' ? { ...each, state: 'done', completedAt: '2030-01-20T10:00:00Z' } : each,
      ),
    }
    const after = apply([{ op: 'setBlackouts', blackouts: [...example.roadmap.blackouts, pause], keepStudyDays: true }], done)
    expect(task(after, 'course-part-2').baselineStartDate).toBe('2030-01-14')
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
    expect(task(after, 'course-part-1').skills).toEqual(['Something measurable, renamed'])
    expect(errors(after)).toEqual([])
  })

  it('reports a skill dropped while tasks still use it', () => {
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

describe('moveTask', () => {
  const order = (content: RoadmapContent, phase: number) =>
    content.tasks
      .filter((each) => each.phase === phase)
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .map((each) => `${each.sortOrder}:${each.id}`)

  it('reorders within a phase, renumbering it 1..n', () => {
    const after = apply([{ op: 'moveTask', id: 'build-part-1', before: 'course-part-1' }])
    expect(order(after, 1).slice(0, 3)).toEqual(['1:build-part-1', '2:course-part-1', '3:read-the-thing'])
    expect(after.tasks.filter((each) => each.phase === 1).map((each) => each.sortOrder).sort((a, b) => a - b)).toEqual(
      Array.from({ length: 9 }, (_, index) => index + 1),
    )
  })

  it('puts a task last when told no place', () => {
    const after = apply([{ op: 'moveTask', id: 'read-the-thing' }])
    expect(order(after, 1).at(-1)).toBe('9:read-the-thing')
  })

  it('refuses a place in another phase: a task changes phase by changing story', () => {
    expect(() => apply([{ op: 'moveTask', id: 'the-next-thing', before: 'course-part-1' }])).toThrow(
      /not in phase 2/,
    )
  })

  it('lets the validator refuse a closing milestone moved out of its phase', () => {
    const after = apply([
      { op: 'updateTask', id: 'phase-1-exam', fields: { storyId: 'the-next-thing-story' } },
    ])
    expect(errors(after).map((issue) => issue.rule)).toContain('closing-milestone')
  })
})
