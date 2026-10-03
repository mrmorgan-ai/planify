import { describe, expect, it } from 'vitest'
import type { Task } from '../core/types'
import { dependentIds, neededByEdits } from './TaskForm'

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
