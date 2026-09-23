import { describe, expect, it } from 'vitest'
import type { Item } from '../core/types'
import {
  fromItem,
  fromWorkItem,
  toItem,
  toMeta,
  toPhase,
  toSkillDimension,
  toWorkItem,
  type ItemRow,
} from './rows'

function row(overrides: Partial<ItemRow> = {}): ItemRow {
  return {
    id: 'read-the-thing',
    name: 'Read the thing',
    type: 'Book',
    phase: 1,
    work_item_id: null,
    skills: '["Something measurable"]',
    depends_on: '[]',
    baseline_start: '2030-01-01',
    baseline_end: '2030-01-07',
    projected_start: '2030-01-01',
    projected_end: '2030-01-07',
    price: '',
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

describe('toItem', () => {
  it('maps snake_case columns onto the domain shape', () => {
    const item = toItem(row({ depends_on: '["a","b"]', sort_order: 4 }))
    expect(item.dependsOn).toEqual(['a', 'b'])
    expect(item.baselineStartDate).toBe('2030-01-01')
    expect(item.projectedEndDate).toBe('2030-01-07')
    expect(item.sortOrder).toBe(4)
  })

  it('normalises an empty link to null', () => {
    expect(toItem(row({ link: '' })).link).toBeNull()
    expect(toItem(row({ link: 'https://example.com' })).link).toBe('https://example.com')
  })

  it('refuses a type, state or phase the schema should never have allowed', () => {
    expect(() => toItem(row({ type: 'Podcast' }))).toThrow(/unknown type/)
    expect(() => toItem(row({ state: 'started' }))).toThrow(/unknown state/)
    expect(() => toItem(row({ phase: 9 }))).toThrow(/out-of-range phase/)
  })

  it('refuses JSON columns that are not arrays of strings', () => {
    expect(() => toItem(row({ skills: 'not json' }))).toThrow(/valid JSON/)
    expect(() => toItem(row({ skills: '{"a":1}' }))).toThrow(/array of strings/)
    expect(() => toItem(row({ depends_on: '[1,2]' }))).toThrow(/array of strings/)
  })
})

describe('work items', () => {
  it('carries the work item an item belongs to, and reads an empty one as none', () => {
    expect(toItem(row({ work_item_id: 'the-course' })).workItemId).toBe('the-course')
    expect(toItem(row({ work_item_id: null })).workItemId).toBeNull()
    expect(toItem(row({ work_item_id: '' })).workItemId).toBeNull()
  })

  it('maps a work item row, parsing its resources', () => {
    const workItem = toWorkItem({
      id: 'the-course',
      name: 'The course',
      type: 'Course',
      link: '',
      resources: '[{"label":"Code","url":"https://example.com/code"}]',
      notes: 'What it is.',
    })
    expect(workItem.link).toBeNull()
    expect(workItem.resources).toEqual([{ label: 'Code', url: 'https://example.com/code' }])
  })

  it('refuses a work item type the schema should never have allowed', () => {
    expect(() =>
      toWorkItem({ id: 'x', name: 'x', type: 'Podcast', link: null, resources: '[]', notes: '' }),
    ).toThrow(/unknown type/)
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

describe('fromItem and fromWorkItem', () => {
  it('store an item as columns that read back as the same item', () => {
    const item: Item = {
      ...toItem(row()),
      workItemId: 'the-course',
      dependsOn: ['a', 'b'],
      resources: [{ label: 'Code', url: 'https://example.com/repo' }],
      state: 'done',
      completedAt: '2030-01-05T12:00:00Z',
      hoursDone: 2.5,
    }
    expect(toItem(fromItem(item))).toEqual(item)
  })

  it('store a work item as columns that read back as the same work item', () => {
    const workItem = toWorkItem({
      id: 'the-course',
      name: 'The course',
      type: 'Course',
      link: 'https://example.com/course',
      resources: '[{"label":"Code","url":"https://example.com/code"}]',
      notes: 'What it is.',
    })
    expect(toWorkItem(fromWorkItem(workItem))).toEqual(workItem)
  })
})

describe('resources', () => {
  it('maps a JSON array of label and url', () => {
    const item = toItem(row({ resources: '[{"label":"Code","url":"https://example.com/repo"}]' }))

    expect(item.resources).toEqual([{ label: 'Code', url: 'https://example.com/repo' }])
  })

  it('reads an empty column as no resources rather than throwing', () => {
    expect(toItem(row({ resources: '' })).resources).toEqual([])
  })

  it('refuses an entry missing its url', () => {
    expect(() => toItem(row({ resources: '[{"label":"Code"}]' }))).toThrow(/label and url/)
  })

  it('refuses a column that is not JSON', () => {
    expect(() => toItem(row({ resources: 'not json' }))).toThrow(/not valid JSON/)
  })
})
