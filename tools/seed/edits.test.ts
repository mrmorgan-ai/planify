import { describe, expect, it } from 'vitest'
import { EditError, applyEdits, parseEdits, slugOf, type Edit, type NewTask } from '../../src/core/edits'
import { recomputeProjections } from '../../src/core/schedule'
import { seedContent } from '../../src/core/seed'
import type { Task, RoadmapContent } from '../../src/core/types'
import { validate } from '../../src/core/validate'
import { EXAMPLE_SEED, readSeedFile } from './load'

const example = seedContent(readSeedFile(EXAMPLE_SEED))

/** The example with one task finished, so progress has something to lose. */
function underway(): RoadmapContent {
  const tasks = example.tasks.map((task): Task =>
    task.id === 'read-the-thing'
      ? { ...task, state: 'done', completedAt: '2030-01-09T10:00:00Z', hoursDone: 3 }
      : task,
  )
  const options = { blackouts: example.roadmap.blackouts, timeZone: example.roadmap.timeZone }
  return { ...example, tasks: recomputeProjections(tasks, options) }
}

const apply = (edits: Edit[], content = underway()) => applyEdits(content, edits)
const task = (content: RoadmapContent, id: string) => content.tasks.find((each) => each.id === id)

const newTask: NewTask = {
  name: 'One more thing',
  storyId: 'the-optional-thing-story',
  baselineStartDate: '2030-02-25',
  baselineEndDate: '2030-02-26',
  skills: ['Something else'],
  duration: '~2h',
}

describe('parseEdits', () => {
  it.each([
    ['nothing', undefined, /non-empty array/],
    ['an empty list', [], /non-empty array/],
    ['an unknown operation', [{ op: 'renameEverything' }], /not an edit this roadmap knows/],
    ['a phase change', [{ op: 'updateTask', id: 'x', fields: { phase: 2 } }], /phase cannot be edited/],
    ['a date change', [{ op: 'updateTask', id: 'x', fields: { baselineStartDate: '2030-01-01' } }], /cannot be edited/],
    ['an id change', [{ op: 'updateTask', id: 'x', fields: { id: 'y' } }], /id cannot be edited/],
    ['a type on a task, which is its story’s', [{ op: 'updateTask', id: 'x', fields: { type: 'Book' } }], /type cannot be edited/],
    ['dependencies that are not strings', [{ op: 'setDependencies', id: 'x', dependsOn: [1] }], /array of strings/],
  ])('refuses %s', (_, raw, message) => {
    expect(() => parseEdits(raw)).toThrow(message)
  })
})

describe('updateTask', () => {
  it('changes the fields asked for and nothing else', () => {
    const after = apply([
      { op: 'updateTask', id: 'read-the-thing', fields: { name: 'Read it again', duration: '~5h' } },
    ])
    expect(task(after, 'read-the-thing')).toEqual({
      ...task(underway(), 'read-the-thing'),
      name: 'Read it again',
      duration: '~5h',
    })
    expect(validate(after).filter((issue) => issue.severity !== 'info')).toEqual([])
  })

  it('moves a task to another story, and to the end of that story’s phase', () => {
    const after = apply([
      { op: 'updateTask', id: 'read-the-thing', fields: { storyId: 'the-next-thing-story' } },
    ])
    const lastInPhase2 = Math.max(
      ...example.tasks.filter((each) => each.phase === 2).map((each) => each.sortOrder),
    )
    expect(task(after, 'read-the-thing')).toMatchObject({
      storyId: 'the-next-thing-story',
      phase: 2,
      sortOrder: lastInPhase2 + 1,
    })
  })

  it('refuses a story that does not exist', () => {
    expect(() =>
      apply([{ op: 'updateTask', id: 'read-the-thing', fields: { storyId: 'nowhere' } }]),
    ).toThrow(/No story with id nowhere/)
  })

  it.each([
    ['an empty name', { name: '' }, /name must not be empty/],
    ['an empty link', { link: '' }, /use null/],
    ['a resource with no url', { resources: [{ label: 'Code' }] }, /url must be a string/],
    ['no skills', { skills: [] }, /skills must not be empty/],
  ])('refuses %s with the seed file’s own message', (_, fields, message) => {
    const edit = { op: 'updateTask', id: 'read-the-thing', fields } as Edit
    expect(() => apply([edit])).toThrow(EditError)
    expect(() => apply([edit])).toThrow(message)
  })

  it('refuses a task that does not exist', () => {
    expect(() => apply([{ op: 'updateTask', id: 'nope', fields: { name: 'x' } }])).toThrow(
      /No task with id nope/,
    )
  })
})

describe('setDependencies', () => {
  it('moves the projection when the new dependency ends later', () => {
    // Exam prep is planned from Feb 4; build part 2 ends Feb 6.
    const after = apply([{ op: 'setDependencies', id: 'exam-prep', dependsOn: ['build-part-2'] }])
    expect(task(after, 'exam-prep')).toMatchObject({
      dependsOn: ['build-part-2'],
      baselineStartDate: '2030-02-04',
      projectedStartDate: '2030-02-07',
    })
  })

  it('lets a cycle through to the validator, which names it', () => {
    const after = apply([
      { op: 'setDependencies', id: 'course-part-1', dependsOn: ['course-part-2'] },
    ])
    expect(validate(after).map((issue) => issue.rule)).toContain('cycle')
  })
})

describe('createTask', () => {
  it('derives the id from the name and puts it last in its story’s phase, pending', () => {
    const after = apply([{ op: 'createTask', task: newTask }])
    const created = task(after, 'one-more-thing')
    expect(created).toMatchObject({
      phase: 2,
      sortOrder: Math.max(...example.tasks.filter((each) => each.phase === 2).map((each) => each.sortOrder)) + 1,
      state: 'pending',
      hoursDone: 0,
      completedAt: null,
      dependsOn: [],
      projectedStartDate: '2030-02-25',
    })
  })

  it('never reuses an id, of a task or of a story', () => {
    const after = apply([
      { op: 'createTask', task: { ...newTask, name: 'Read the thing' } },
      { op: 'createTask', task: { ...newTask, name: 'The course' } },
    ])
    expect(after.tasks.slice(-2).map((each) => each.id)).toEqual(['read-the-thing-2', 'the-course-2'])
  })

  it('refuses a story that does not exist', () => {
    expect(() => apply([{ op: 'createTask', task: { ...newTask, storyId: 'nowhere' } }])).toThrow(
      /No story with id nowhere/,
    )
  })

  it('refuses an id that is asked for and already taken', () => {
    expect(() => apply([{ op: 'createTask', task: { ...newTask, id: 'the-next-thing' } }])).toThrow(
      /already taken/,
    )
  })

  it('can be depended on by a later edit in the same list', () => {
    const after = apply([
      { op: 'createTask', task: newTask },
      { op: 'setDependencies', id: 'the-optional-thing', dependsOn: ['the-next-thing', 'one-more-thing'] },
    ])
    expect(validate(after).filter((issue) => issue.severity === 'error')).toEqual([])
  })
})

describe('deleteTask', () => {
  it('refuses to delete what others depend on, naming them', () => {
    expect(() => apply([{ op: 'deleteTask', id: 'the-next-thing' }])).toThrow(
      new RegExp(`needed by ${task(example, 'the-optional-thing')!.name}`),
    )
  })

  it('connects the dependents to what it depended on, when asked', () => {
    const after = apply([{ op: 'deleteTask', id: 'the-next-thing', rewire: true }])
    expect(task(after, 'the-next-thing')).toBeUndefined()
    expect(task(after, 'the-optional-thing')?.dependsOn).toEqual(['phase-1-exam'])
  })

  it('refuses to delete a closing milestone', () => {
    expect(() => apply([{ op: 'deleteTask', id: 'phase-1-exam', rewire: true }])).toThrow(
      /closes phase 1/,
    )
  })

  it('refuses to throw away progress unless told to', () => {
    const edit: Edit = { op: 'deleteTask', id: 'read-the-thing', rewire: true }
    expect(() => apply([edit])).toThrow(/has progress/)
    const after = apply([{ ...edit, discardProgress: true }])
    expect(task(after, 'read-the-thing')).toBeUndefined()
    expect(task(after, 'build-part-1')?.dependsOn).toEqual([])
  })
})

describe('slugOf', () => {
  it.each([
    ['Build part 2 — the API', 'build-part-2-the-api'],
    ['Économie & Café', 'economie-cafe'],
    ['   ', 'task'],
  ])('%s → %s', (name, slug) => {
    expect(slugOf(name)).toBe(slug)
  })
})
