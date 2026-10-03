import { describe, expect, it } from 'vitest'
import type { Task } from '../core/types'
import {
  fromFeature,
  fromTask,
  fromStory,
  toFeature,
  toTask,
  toMeta,
  toPhase,
  toSkillDimension,
  toStory,
  type StoryRow,
  type TaskRow,
} from './rows'

function row(overrides: Partial<TaskRow> = {}): TaskRow {
  return {
    id: 'read-the-thing',
    name: 'Read the thing',
    story_id: 'the-course',
    skills: '["Something measurable"]',
    depends_on: '[]',
    baseline_start: '2030-01-01',
    baseline_end: '2030-01-07',
    projected_start: '2030-01-01',
    projected_end: '2030-01-07',
    link: null,
    resources: '[]',
    duration: '',
    notes: '',
    done_when: '',
    state: 'pending',
    completed_at: null,
    hours_done: 0,
    sort_order: 1,
    ...overrides,
  }
}

function storyRow(overrides: Partial<StoryRow> = {}): StoryRow {
  return {
    id: 'the-course',
    name: 'The course',
    type: 'Course',
    phase: 2,
    feature_id: null,
    link: 'https://example.com/course',
    resources: '[{"label":"Code","url":"https://example.com/code"}]',
    price: 'Free',
    notes: 'What it is.',
    done_when: 'Every exercise passes.',
    ...overrides,
  }
}

/** A task row read as a task in phase 1, the way the loader passes its story's phase. */
const toTask1 = (taskRow: TaskRow) => toTask(taskRow, 1)

describe('toTask', () => {
  it('maps snake_case columns onto the domain shape', () => {
    const task = toTask1(row({ depends_on: '["a","b"]', sort_order: 4 }))
    expect(task.dependsOn).toEqual(['a', 'b'])
    expect(task.baselineStartDate).toBe('2030-01-01')
    expect(task.projectedEndDate).toBe('2030-01-07')
    expect(task.sortOrder).toBe(4)
  })

  it('normalises an empty link to null', () => {
    expect(toTask1(row({ link: '' })).link).toBeNull()
    expect(toTask1(row({ link: 'https://example.com' })).link).toBe('https://example.com')
  })

  it('takes its phase from the caller: it is the story’s, not a column', () => {
    expect(toTask(row(), 3).phase).toBe(3)
  })

  it('refuses a state the schema should never have allowed', () => {
    expect(() => toTask1(row({ state: 'started' }))).toThrow(/unknown state/)
  })

  it('refuses JSON columns that are not arrays of strings', () => {
    expect(() => toTask1(row({ skills: 'not json' }))).toThrow(/valid JSON/)
    expect(() => toTask1(row({ skills: '{"a":1}' }))).toThrow(/array of strings/)
    expect(() => toTask1(row({ depends_on: '[1,2]' }))).toThrow(/array of strings/)
  })
})

describe('stories', () => {
  it('carries the story a task belongs to', () => {
    expect(toTask1(row({ story_id: 'the-course' })).storyId).toBe('the-course')
  })

  it('maps a story row, parsing its resources and reading an empty feature as none', () => {
    const story = toStory(storyRow({ link: '', feature_id: '' }))
    expect(story.link).toBeNull()
    expect(story.featureId).toBeNull()
    expect(story.phase).toBe(2)
    expect(story.resources).toEqual([{ label: 'Code', url: 'https://example.com/code' }])
  })

  it('reads a story with no type as unlabelled', () => {
    expect(toStory(storyRow({ type: null })).type).toBeNull()
    expect(toStory(storyRow({ type: '' })).type).toBeNull()
  })

  it('refuses a story type or phase the schema should never have allowed', () => {
    expect(() => toStory(storyRow({ type: 'Podcast' }))).toThrow(/unknown type/)
    expect(() => toStory(storyRow({ phase: 9 }))).toThrow(/out-of-range phase/)
  })
})

describe('toPhase', () => {
  it('keeps a null closing milestone null', () => {
    const phase = toPhase({ number: 2, name: 'Second', closing_milestone_id: null })
    expect(phase.closingMilestoneId).toBeNull()
  })

  it('refuses a phase number outside 1-6', () => {
    expect(() => toPhase({ number: 0, name: 'Zero', closing_milestone_id: null })).toThrow()
  })
})

describe('row collections', () => {
  it('turns skill rows into a skill-to-axis map', () => {
    expect(
      toSkillDimension([
        { name: 'Docker', dimension: 'Infra' },
        { name: 'LoRA', dimension: 'LLM' },
      ]),
    ).toEqual({ Docker: 'Infra', LoRA: 'LLM' })
  })

  it('turns meta rows into a settings map', () => {
    expect(toMeta([{ key: 'revision', value: '7' }])).toEqual({ revision: '7' })
  })
})

describe('fromTask, fromStory and fromFeature', () => {
  it('store a task as columns that read back as the same task', () => {
    const task: Task = {
      ...toTask1(row()),
      storyId: 'the-course',
      dependsOn: ['a', 'b'],
      resources: [{ label: 'Code', url: 'https://example.com/repo' }],
      state: 'done',
      completedAt: '2030-01-05T12:00:00Z',
      hoursDone: 2.5,
    }
    expect(toTask(fromTask(task), task.phase)).toEqual(task)
  })

  it('store a story as columns that read back as the same story', () => {
    const story = toStory(storyRow({ feature_id: 'the-certification' }))
    expect(toStory(fromStory(story))).toEqual(story)
  })

  it('store a feature as columns that read back as the same feature', () => {
    const feature = toFeature({
      id: 'cert',
      name: 'Cert',
      type: 'Certification',
      link: null,
      notes: 'The goal.',
    })
    expect(toFeature(fromFeature(feature))).toEqual(feature)
    expect(() => toFeature({ ...fromFeature(feature), type: 'Podcast' })).toThrow(/unknown type/)
  })
})

describe('resources', () => {
  it('maps a JSON array of label and url', () => {
    const task = toTask1(row({ resources: '[{"label":"Code","url":"https://example.com/repo"}]' }))

    expect(task.resources).toEqual([{ label: 'Code', url: 'https://example.com/repo' }])
  })

  it('reads an empty column as no resources rather than throwing', () => {
    expect(toTask1(row({ resources: '' })).resources).toEqual([])
  })

  it('refuses an entry missing its url', () => {
    expect(() => toTask1(row({ resources: '[{"label":"Code"}]' }))).toThrow(/label and url/)
  })

  it('refuses a column that is not JSON', () => {
    expect(() => toTask1(row({ resources: 'not json' }))).toThrow(/not valid JSON/)
  })
})
