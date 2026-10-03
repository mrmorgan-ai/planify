import { describe, expect, it } from 'vitest'
import { recomputeProjections } from '../../src/core/schedule'
import { seedContent } from '../../src/core/seed'
import type { RoadmapContent, Story, Task } from '../../src/core/types'
import { RULES, introducedErrors, validate, type Rule } from '../../src/core/validate'
import { EXAMPLE_SEED, availableSeeds, readSeedFile } from './load'

// Runs against every seed file present: the tracked example always — which is
// what lets CI check the rules without seeing the real roadmap — and the
// private roadmap when it is on this machine. A seed must pass clean, warnings
// included: warnings exist for edits in progress, not for a finished plan.
// Notes are not problems — a story of one task is a fine story — so they may stay.
const problems = (content: RoadmapContent) =>
  validate(content).filter((issue) => issue.severity !== 'info')

describe.each(availableSeeds())('$label', ({ seed }) => {
  const content = seedContent(seed)

  it('breaks no rule', () => {
    expect(problems(content)).toEqual([])
  })

  it('projects every task onto its own baseline when nothing is done', () => {
    // Pins the late-dependency rule to the engine it predicts: a plan with no
    // warning must be born on time, not already slipped.
    const options = { blackouts: content.roadmap.blackouts, timeZone: content.roadmap.timeZone }
    for (const projected of recomputeProjections(content.tasks, options)) {
      expect(projected.projectedStartDate, `${projected.id} start`).toBe(projected.baselineStartDate)
      expect(projected.projectedEndDate, `${projected.id} end`).toBe(projected.baselineEndDate)
    }
  })
})

// Each rule broken on purpose, on a copy of the example, one at a time.
describe('every rule fires', () => {
  const example = seedContent(readSeedFile(EXAMPLE_SEED))

  const task = (content: RoadmapContent, id: string): Task => {
    const found = content.tasks.find((candidate) => candidate.id === id)
    if (!found) throw new Error(`The example seed has no task ${id}`)
    return found
  }
  const story = (content: RoadmapContent, id: string): Story => {
    const found = content.stories.find((candidate) => candidate.id === id)
    if (!found) throw new Error(`The example seed has no story ${id}`)
    return found
  }

  const breakers: Record<Rule, (content: RoadmapContent) => void> = {
    'task-id': (c) => {
      task(c, 'read-the-thing').id = 'Read-The-Thing'
    },
    'duplicate-id': (c) => {
      task(c, 'read-the-thing').id = 'course-part-1'
    },
    'story-id': (c) => {
      c.stories.push({ ...c.stories[0]!, id: 'read-the-thing' })
    },
    'feature-id': (c) => {
      c.features.push({ id: 'Not Kebab', name: 'A goal', type: null, link: null, notes: '' })
    },
    'phase-numbering': (c) => {
      c.roadmap.phases[1]!.number = 3
    },
    'unknown-phase': (c) => {
      story(c, 'the-optional-thing-story').phase = 3
    },
    'closing-milestone': (c) => {
      c.roadmap.phases[0]!.closingMilestoneId = 'the-next-thing'
    },
    'sort-order': (c) => {
      task(c, 'read-the-thing').sortOrder = 1
    },
    'time-zone': (c) => {
      c.roadmap.timeZone = 'Mars/Olympus_Mons'
    },
    link: (c) => {
      task(c, 'course-part-1').link = 'http://example.com'
    },
    dates: (c) => {
      task(c, 'read-the-thing').baselineEndDate = '2030-01-06'
    },
    'blackout-edge': (c) => {
      task(c, 'build-part-2').baselineStartDate = '2030-02-03'
    },
    'before-start': (c) => {
      c.roadmap.startDate = '2030-01-08'
    },
    dependency: (c) => {
      task(c, 'read-the-thing').dependsOn = ['nothing-by-that-name']
    },
    cycle: (c) => {
      task(c, 'course-part-1').dependsOn = ['course-part-2']
    },
    'unknown-story': (c) => {
      task(c, 'read-the-thing').storyId = 'no-such-story'
    },
    'unknown-feature': (c) => {
      story(c, 'the-course').featureId = 'no-such-feature'
    },
    'unmapped-skill': (c) => {
      task(c, 'read-the-thing').skills = ['Not on the radar']
    },
    'unknown-dimension': (c) => {
      c.roadmap.skillDimension['Something else'] = 'No such axis'
    },

    'too-long': (c) => {
      task(c, 'the-optional-thing').baselineEndDate = '2030-02-25'
    },
    'phase-order': (c) => {
      story(c, 'read-the-thing-story').phase = 2
      task(c, 'read-the-thing').phase = 2
    },
    'late-dependency': (c) => {
      task(c, 'the-optional-thing').baselineStartDate = '2030-02-17'
    },
    'phase-gate': (c) => {
      task(c, 'the-next-thing').dependsOn = []
    },
    'milestone-coverage': (c) => {
      const milestone = task(c, 'phase-1-exam')
      milestone.dependsOn = milestone.dependsOn.filter((id) => id !== 'exam-prep')
    },
    'project-chain': (c) => {
      task(c, 'build-part-2').dependsOn = []
    },
    'single-task': (c) => {
      c.stories.push({ ...story(c, 'the-exam'), id: 'just-the-prep' })
      task(c, 'exam-prep').storyId = 'just-the-prep'
    },
    'overlapping-tasks': (c) => {
      task(c, 'course-part-2').baselineStartDate = '2030-01-13'
    },
    'done-when': (c) => {
      task(c, 'practice-week-1').doneWhen = ''
    },
    'no-estimate': (c) => {
      task(c, 'read-the-thing').duration = 'a while'
    },
    'over-capacity': (c) => {
      c.roadmap.weeklyHours = { normal: 1 }
    },
    'unused-skill': (c) => {
      c.roadmap.skillDimension['A spare skill'] = 'First axis'
    },
    'empty-axis': (c) => {
      c.roadmap.dimensions.push('Third axis')
    },
  }

  it.each(Object.keys(RULES) as Rule[])('%s', (rule) => {
    const content = structuredClone(example)
    breakers[rule](content)

    const fired = validate(content).filter((issue) => issue.rule === rule)
    expect(fired, `${rule} did not fire`).not.toEqual([])
    for (const issue of fired) {
      expect(issue.severity).toBe(RULES[rule])
      expect(issue.message).not.toBe('')
    }
  })
})

describe('introducedErrors', () => {
  const example = seedContent(readSeedFile(EXAMPLE_SEED))
  const moved = (content: RoadmapContent, id: string, start: string): RoadmapContent => ({
    ...content,
    tasks: content.tasks.map((task) => (task.id === id ? { ...task, baselineStartDate: start } : task)),
  })

  it('reports an error the change brings in', () => {
    const intoPause = moved(example, 'build-part-2', '2030-02-03')
    const introduced = introducedErrors(example, intoPause)
    expect(introduced.map((issue) => issue.rule)).toEqual(['blackout-edge'])
    expect(introduced[0]?.taskId).toBe('build-part-2')
  })

  it('lets a change through when the roadmap already had the same error', () => {
    const broken = structuredClone(example)
    broken.tasks.find((task) => task.id === 'course-part-1')!.link = 'http://example.com'
    const edited = moved(broken, 'the-optional-thing', '2030-02-19')
    expect(introducedErrors(broken, edited)).toEqual([])
  })

  it('ignores warnings, which never refuse a change', () => {
    const tooLong = moved(example, 'the-optional-thing', '2030-02-14')
    expect(validate(tooLong).some((issue) => issue.severity === 'warning')).toBe(true)
    expect(introducedErrors(example, tooLong)).toEqual([])
  })
})

describe('a cycle', () => {
  it('is named by the tasks that form it, not by everything waiting behind it', () => {
    const looped = structuredClone(seedContent(readSeedFile(EXAMPLE_SEED)))
    looped.tasks.find((task) => task.id === 'course-part-1')!.dependsOn = ['course-part-2']

    const cycles = validate(looped).filter((issue) => issue.rule === 'cycle')
    expect(cycles).toEqual([
      {
        severity: 'error',
        rule: 'cycle',
        message: 'Dependencies go round in a circle: course-part-1 → course-part-2 → course-part-1',
        taskId: 'course-part-1',
      },
    ])
  })
})

describe('rules that read a type', () => {
  it('ask practice for an outcome only while its story says it is practice', () => {
    const content = structuredClone(seedContent(readSeedFile(EXAMPLE_SEED)))
    content.tasks.find((task) => task.id === 'practice-week-1')!.doneWhen = ''
    const fires = () => validate(content).some((issue) => issue.rule === 'done-when')
    expect(fires()).toBe(true)
    content.stories.find((story) => story.id === 'practice-phase-1')!.type = null
    expect(fires()).toBe(false)
  })
})

describe('rules measure the plan, not the projection', () => {
  it('reports no week over capacity when only progress has moved the projection', () => {
    // Every task projected into the plan's first week, far past its capacity:
    // the plan itself is untouched, so its capacity is untouched too.
    const slipped = structuredClone(seedContent(readSeedFile(EXAMPLE_SEED)))
    for (const task of slipped.tasks) {
      task.projectedStartDate = '2030-01-07'
      task.projectedEndDate = '2030-01-13'
    }
    expect(problems(slipped)).toEqual([])
  })
})
