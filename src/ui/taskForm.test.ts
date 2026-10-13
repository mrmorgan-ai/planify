import { describe, expect, it } from 'vitest'
import type { Roadmap, Task } from '../core/types'
import { blankDraft, dependentIds, inStory, neededByEdits } from './TaskForm'

function task(id: string, dependsOn: string[] = []): Task {
  return {
    id,
    name: id,
    phase: 1,
    skills: ['A skill'],
    storyId: 'story',
    baselineStartDate: '2030-01-07',
    baselineEndDate: '2030-01-08',
    projectedStartDate: '2030-01-07',
    projectedEndDate: '2030-01-08',
    dependsOn,
    link: null,
    resources: [],
    duration: '',
    notes: '',
    doneWhen: '',
    state: 'pending',
    completedAt: null,
    hoursDone: 0,
    sortOrder: 1,
  }
}

describe('Needed by', () => {
  const tasks = [task('a'), task('b', ['a']), task('c', ['x']), task('d', ['a', 'x'])]

  it('reads the tasks that wait on one', () => {
    expect(dependentIds('a', tasks)).toEqual(['b', 'd'])
  })

  it('changes only the tasks that start or stop waiting, keeping what else they wait on', () => {
    expect(neededByEdits('a', tasks, ['b', 'c'])).toEqual([
      { op: 'setDependencies', id: 'c', dependsOn: ['x', 'a'] },
      { op: 'setDependencies', id: 'd', dependsOn: ['x'] },
    ])
  })

  it('changes nothing when the list is what it was', () => {
    expect(neededByEdits('a', tasks, ['d', 'b'])).toEqual([])
  })

  it('makes tasks wait on one that does not exist yet, for a task created in the same write', () => {
    expect(neededByEdits('new', tasks, ['a'])).toEqual([
      { op: 'setDependencies', id: 'a', dependsOn: ['new'] },
    ])
  })
})

describe('the skills a new task starts with', () => {
  const roadmap = {
    dimensions: ['Axis'],
    skillDimension: { Shared: 'Axis', Rare: 'Axis', Other: 'Axis' },
  } as unknown as Roadmap
  const in_ = (id: string, storyId: string, skills: string[]): Task => ({
    ...task(id),
    storyId,
    skills,
  })
  const content = {
    roadmap,
    tasks: [
      in_('a', 'course', ['Shared', 'Rare']),
      in_('b', 'course', ['Shared']),
      in_('c', 'course', ['Shared']),
      in_('d', 'project', ['Other']),
      in_('e', 'project', ['Other']),
      in_('f', 'project', ['Other']),
    ],
  }

  it('are the ones nearly all of its story’s tasks carry', () => {
    expect(blankDraft('course', content).skills).toEqual(['Shared'])
  })

  it('are none without a story, or without the roadmap to read them from', () => {
    expect(blankDraft('', content).skills).toEqual([])
    expect(blankDraft('course').skills).toEqual([])
  })

  it('follow the task to another story while nobody has chosen any', () => {
    const moved = inStory(blankDraft('course', content), 'project', content, true)
    expect(moved).toMatchObject({ storyId: 'project', skills: ['Other'] })
  })

  it('stay as chosen once somebody has', () => {
    const chosen = { ...blankDraft('course', content), skills: ['Rare'] }
    const moved = inStory(chosen, 'project', content, false)
    expect(moved).toMatchObject({ storyId: 'project', skills: ['Rare'] })
  })
})
