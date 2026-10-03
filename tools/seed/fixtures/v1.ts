import { readFileSync } from 'node:fs'

// The first format, as the example roadmap was written before stories: items,
// some grouped into work items. Kept as a fixture so the upgrade is always tested
// against a real file of that format, not only against cases built for it.
export const V1_EXAMPLE = new URL('roadmap.v1.json', import.meta.url)

export type V1 = {
  items: Array<Record<string, unknown>>
  workItems: Array<Record<string, unknown>>
  [key: string]: unknown
}

export const readV1 = (): V1 => JSON.parse(readFileSync(V1_EXAMPLE, 'utf8')) as V1

/**
 * The v1 example plus what it does not show: a work item read across two
 * phases, priced in the second; a work item with no parts yet.
 */
export function v1WithEveryCase(): V1 {
  const file = readV1()
  const item = (overrides: Record<string, unknown>) => ({
    type: 'Book',
    skills: ['Something measurable'],
    dependsOn: [],
    price: '',
    link: null,
    resources: [],
    duration: '~2h',
    notes: '',
    doneWhen: '',
    ...overrides,
  })
  file.workItems.push(
    {
      id: 'the-book',
      name: 'The book',
      type: 'Book',
      link: 'https://example.com/book',
      resources: [{ label: 'Errata', url: 'https://example.com/errata' }],
      notes: 'Read across the plan.',
    },
    { id: 'someday', name: 'Someday', type: 'Paper', link: null, resources: [], notes: '' },
  )
  file.items.push(
    item({
      id: 'chapter-1',
      name: 'Chapter 1',
      phase: 1,
      workItemId: 'the-book',
      baselineStartDate: '2030-01-08',
      baselineEndDate: '2030-01-08',
      sortOrder: 20,
    }),
    item({
      id: 'chapter-2',
      name: 'Chapter 2',
      phase: 2,
      workItemId: 'the-book',
      price: '$10',
      baselineStartDate: '2030-02-19',
      baselineEndDate: '2030-02-19',
      sortOrder: 20,
    }),
  )
  return file
}
