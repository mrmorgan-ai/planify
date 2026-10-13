import { describe, expect, it } from 'vitest'
import { closestSkills, inheritedSkills, namedSkills, suggestSkills } from './skills'
import type { Feature, Roadmap, Story, Task } from './types'
import { keyOf, mentions, wordsOf } from './words'

const SKILLS = {
  Kubernetes: 'Infra',
  Docker: 'Infra',
  'Model deployment': 'Ops',
  'Experiment tracking': 'Ops',
  'Feature stores': 'Data',
  RAG: 'LLM',
  'CI/CD': 'Ops',
}

const roadmap: Roadmap = {
  timeZone: 'UTC',
  startDate: '',
  weeklyHours: { normal: 10 },
  phases: [{ number: 1, name: 'One', closingMilestoneId: null }],
  blackouts: [],
  dimensions: ['Infra', 'Ops', 'Data', 'LLM'],
  skillDimension: SKILLS,
}

function task(id: string, storyId: string, skills: string[]): Task {
  return {
    id,
    name: id,
    phase: 1,
    skills,
    storyId,
    baselineStartDate: '2030-02-04',
    baselineEndDate: '2030-02-08',
    projectedStartDate: '2030-02-04',
    projectedEndDate: '2030-02-08',
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
  }
}

function story(id: string, name: string, featureId: string | null = null): Story {
  return {
    id,
    name,
    type: null,
    phase: 1,
    featureId,
    link: null,
    resources: [],
    price: '',
    notes: '',
    doneWhen: '',
  }
}

const content = (
  tasks: Task[],
  stories: Story[] = [story('course', 'A course')],
  features: Feature[] = [],
) => ({ roadmap, tasks, stories, features })

describe('words', () => {
  it('reads a name by its words, whatever the spelling', () => {
    expect(wordsOf('Feature-Stores')).toEqual(['feature', 'store'])
    expect(keyOf('CI/CD')).toBe('ci cd')
    expect(keyOf('Señales útiles')).toBe('senale utile')
  })

  it('leaves short names alone, which are not plurals', () => {
    expect(wordsOf('k8s AWS class')).toEqual(['k8s', 'aws', 'class'])
  })

  it('finds a phrase only as whole words in order', () => {
    expect(mentions(wordsOf('set up the feature store'), wordsOf('Feature stores'))).toBe(true)
    expect(mentions(wordsOf('store every feature'), wordsOf('Feature stores'))).toBe(false)
    expect(mentions(wordsOf('cheap storage'), wordsOf('RAG'))).toBe(false)
  })
})

describe('namedSkills', () => {
  const mapped = Object.keys(SKILLS)

  it('finds a skill by its own name', () => {
    expect(namedSkills('Ship the Docker image through CI/CD', mapped)).toEqual(['Docker', 'CI/CD'])
  })

  it('finds a skill by another name it goes by', () => {
    expect(namedSkills('k8s deployment', mapped)).toEqual(['Kubernetes', 'Model deployment'])
    expect(namedSkills('Log the run in MLflow', mapped)).toEqual(['Experiment tracking'])
  })

  it('does not use an alias the map keeps as a skill of its own', () => {
    const apart = [...mapped, 'kubectl']
    expect(namedSkills('kubectl apply', apart)).toEqual(['kubectl'])
  })

  it('finds nothing in nothing', () => {
    expect(namedSkills('', mapped)).toEqual([])
    expect(namedSkills('Read chapter 3', mapped)).toEqual([])
  })
})

describe('inheritedSkills', () => {
  const tasks = [
    task('a', 'course', ['Kubernetes', 'Docker']),
    task('b', 'course', ['Kubernetes', 'Docker']),
    task('c', 'course', ['Kubernetes', 'RAG']),
    task('elsewhere', 'other', ['CI/CD']),
  ]

  it('is what two in three of the story’s tasks carry, most shared first', () => {
    expect(inheritedSkills('course', content(tasks))).toEqual(['Kubernetes', 'Docker'])
    const four = [...tasks, task('d', 'course', ['Kubernetes'])]
    expect(inheritedSkills('course', content(four))).toEqual(['Kubernetes'])
  })

  it('does not count the task itself, and waits for three others', () => {
    expect(inheritedSkills('course', content(tasks), 'a')).toEqual([])
    expect(inheritedSkills('course', content(tasks.slice(0, 2)))).toEqual([])
    expect(inheritedSkills('course', content([]))).toEqual([])
  })

  it('skips a skill that is no longer on the map', () => {
    const gone = ['a', 'b', 'c'].map((id) => task(id, 'course', ['Gone', 'Docker']))
    expect(inheritedSkills('course', content(gone))).toEqual(['Docker'])
  })
})

describe('suggestSkills', () => {
  const tasks = [
    task('a', 'course', ['Kubernetes', 'Docker']),
    task('b', 'course', ['Kubernetes']),
  ]

  it('puts a skill the task names above one its story shares', () => {
    const found = suggestSkills({ name: 'Track runs in MLflow', storyId: 'course' }, content(tasks))
    expect(found).toEqual([
      { skill: 'Experiment tracking', score: 1, reason: 'named in the task' },
      { skill: 'Kubernetes', score: 0.6, reason: 'on 2 of 2 tasks in its story' },
      { skill: 'Docker', score: 0.3, reason: 'on 1 of 2 tasks in its story' },
    ])
  })

  it('leaves out a skill fewer than half of the story’s tasks carry', () => {
    const three = [...tasks, task('c', 'course', ['Kubernetes', 'RAG'])]
    const found = suggestSkills({ name: 'Anything', storyId: 'course' }, content(three))
    expect(found.map((each) => each.skill)).toEqual(['Kubernetes'])
  })

  it('puts a skill both named and shared first, and says the stronger reason', () => {
    const found = suggestSkills({ name: 'Docker and RAG', storyId: 'course' }, content(tasks))
    expect(found[0]).toMatchObject({ skill: 'Docker', reason: 'named in the task' })
    expect(found.map((each) => each.skill)).toEqual(['Docker', 'RAG', 'Kubernetes'])
  })

  it('reads the notes, the link and the story’s and feature’s names as hints', () => {
    const stories = [story('rag-build', 'Build a RAG service', 'ship')]
    const features: Feature[] = [
      { id: 'ship', name: 'Ship it with CI/CD', type: null, link: null, notes: '' },
    ]
    const found = suggestSkills(
      {
        name: 'Step one',
        storyId: 'rag-build',
        notes: 'Package it with Docker',
        link: 'https://kubernetes.io/docs/concepts/',
      },
      content([], stories, features),
    )
    expect(found).toEqual([
      { skill: 'Docker', score: 0.7, reason: 'named in its description' },
      { skill: 'Kubernetes', score: 0.6, reason: 'named in its link' },
      { skill: 'CI/CD', score: 0.4, reason: 'named in its story' },
      { skill: 'RAG', score: 0.4, reason: 'named in its story' },
    ])
  })

  it('does not count a task among its own neighbours', () => {
    const found = suggestSkills({ name: 'Anything', storyId: 'course', id: 'a' }, content(tasks))
    expect(found).toEqual([
      { skill: 'Kubernetes', score: 0.6, reason: 'on the other task of its story' },
    ])
  })

  it('answers at most the limit, and nothing when nothing is known', () => {
    const all = suggestSkills({ name: 'Docker k8s RAG MLflow', storyId: 'course' }, content(tasks), 2)
    expect(all).toHaveLength(2)
    expect(suggestSkills({ name: '' }, content(tasks))).toEqual([])
  })
})

describe('closestSkills', () => {
  const mapped = Object.keys(SKILLS)

  it('finds another spelling', () => {
    expect(closestSkills('kubernets', mapped)).toEqual(['Kubernetes'])
    expect(closestSkills('feature store', mapped)).toEqual(['Feature stores'])
    expect(closestSkills('ci-cd', mapped)).toEqual(['CI/CD'])
  })

  it('finds a skill by another name it goes by', () => {
    expect(closestSkills('k8s', mapped)).toEqual(['Kubernetes'])
    expect(closestSkills('MLflow', mapped)).toEqual(['Experiment tracking'])
  })

  it('finds names sharing most of their words, closest first', () => {
    expect(closestSkills('Kubernetes deployment', mapped)).toEqual([
      'Kubernetes',
      'Model deployment',
    ])
  })

  it('answers nothing when nothing is close', () => {
    expect(closestSkills('Watercolour', mapped)).toEqual([])
    expect(closestSkills('  ', mapped)).toEqual([])
  })
})
