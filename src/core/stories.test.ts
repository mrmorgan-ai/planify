import { describe, expect, it } from 'vitest'
import type { Task, Story } from './types'
import {
  linksOf,
  storyEntries,
  storyHours,
  storyState,
  taskLabel,
  tasksOf,
  withStoryPhases,
} from './stories'

function task(id: string, overrides: Partial<Task> = {}): Task {
  return {
    id,
    name: id,
    phase: 1,
    skills: [],
    storyId: 'course',
    baselineStartDate: '2030-02-04',
    baselineEndDate: '2030-02-10',
    projectedStartDate: '2030-02-04',
    projectedEndDate: '2030-02-10',
    dependsOn: [],
    link: null,
    resources: [],
    duration: '',
    notes: '',
    doneWhen: '',
    state: 'pending',
    completedAt: null,
    hoursDone: 0,
    sortOrder: 1,
    ...overrides,
  }
}

function story(id: string, overrides: Partial<Story> = {}): Story {
  return {
    id,
    name: id,
    type: 'Course',
    phase: 1,
    featureId: null,
    link: null,
    resources: [],
    price: '',
    notes: '',
    doneWhen: '',
    ...overrides,
  }
}

const course = story('course', {
  name: 'The course',
  link: 'https://example.com/course',
  resources: [{ label: 'Code', url: 'https://example.com/code' }],
})

describe('withStoryPhases', () => {
  it('gives each task its story’s phase, and leaves tasks already there in place', () => {
    const stories = [story('a', { phase: 1 }), story('b', { phase: 2 })]
    const tasks = [task('one', { storyId: 'a', sortOrder: 4 }), task('two', { storyId: 'b', phase: 2 })]
    expect(withStoryPhases({ stories, tasks })).toEqual(tasks)
  })

  it('moves a task whose story moved to the end of the new phase, in the order they had', () => {
    const stories = [story('moved', { phase: 2 }), story('there', { phase: 2 })]
    const tasks = [
      task('second', { storyId: 'moved', phase: 1, sortOrder: 7 }),
      task('first', { storyId: 'moved', phase: 1, sortOrder: 3 }),
      task('resident', { storyId: 'there', phase: 2, sortOrder: 5 }),
    ]
    const placed = withStoryPhases({ stories, tasks })
    const at = (id: string) => placed.find((each) => each.id === id)!
    expect([at('first').phase, at('first').sortOrder]).toEqual([2, 6])
    expect([at('second').phase, at('second').sortOrder]).toEqual([2, 7])
    expect(at('resident').sortOrder).toBe(5)
  })

  it('keeps the phase of a task whose story is missing', () => {
    const tasks = [task('orphan', { storyId: 'gone', phase: 3 })]
    expect(withStoryPhases({ stories: [], tasks })).toEqual(tasks)
  })
})

describe('tasksOf and taskLabel', () => {
  const tasks = [
    task('late', { sortOrder: 5 }),
    task('early', { sortOrder: 1 }),
    task('elsewhere', { storyId: 'other', sortOrder: 2 }),
  ]

  it('orders a story’s tasks by the curated order', () => {
    expect(tasksOf('course', tasks).map((each) => each.id)).toEqual(['early', 'late'])
  })

  it('numbers a task within its story', () => {
    expect(taskLabel(tasks[0]!, [course], tasks)).toEqual({ story: course, index: 2, total: 2 })
  })

  it('gives no label when the task’s story is missing', () => {
    expect(taskLabel(tasks[2]!, [course], tasks)).toBeNull()
  })
})

describe('storyState', () => {
  it('is pending while nothing has moved', () => {
    expect(storyState([task('a'), task('b')])).toBe('pending')
  })

  it('is in progress as soon as any task is done, even with the rest untouched', () => {
    expect(storyState([task('a', { state: 'done' }), task('b')])).toBe('in_progress')
  })

  it('is done only when every task is', () => {
    expect(storyState([task('a', { state: 'done' }), task('b', { state: 'done' })])).toBe('done')
  })
})

describe('storyHours', () => {
  it('sums the estimates, counts what is done, and reports what carries none', () => {
    const hours = storyHours([
      task('a', { duration: '~4h', state: 'done' }),
      task('b', { duration: '~2.5h' }),
      task('c'),
    ])
    expect(hours).toEqual({ total: 6.5, done: 4, unestimated: 1 })
  })
})

describe('storyEntries', () => {
  it('lists every story with its tasks in plan order, and empty ones last', () => {
    const paper = story('paper', { type: 'Paper' })
    const empty = story('empty', { phase: 2 })
    const tasks = [
      task('part-2', { sortOrder: 3 }),
      task('read-it', { storyId: 'paper', sortOrder: 2 }),
      task('part-1', { sortOrder: 1 }),
    ]
    const entries = storyEntries(tasks, [empty, paper, course])

    expect(entries.map((entry) => entry.story.id)).toEqual(['course', 'paper', 'empty'])
    expect(entries[0]?.tasks.map((each) => each.id)).toEqual(['part-1', 'part-2'])
    expect(entries[2]?.tasks).toEqual([])
  })

  it('leaves out a task whose story is missing: the validator names it', () => {
    expect(storyEntries([task('orphan', { storyId: 'gone' })], [])).toEqual([])
  })
})

describe('linksOf', () => {
  it('uses the task’s own links when it has any', () => {
    const step = task('ch-3', { link: 'https://example.com/ch3' })
    expect(linksOf(step, [course])).toEqual({ link: 'https://example.com/ch3', resources: [] })
  })

  it('falls back to the story’s links when the task has none', () => {
    const step = task('ep-1')
    expect(linksOf(step, [course])).toEqual({ link: course.link, resources: course.resources })
  })
})
