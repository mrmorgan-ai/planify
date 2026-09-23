import { describe, expect, it } from 'vitest'
import { recomputeProjections } from '../../src/core/schedule'
import { seedContent } from '../../src/core/seed'
import type { Item, RoadmapContent } from '../../src/core/types'
import { RULES, introducedErrors, validate, type Rule } from '../../src/core/validate'
import { EXAMPLE_SEED, availableSeeds, readSeedFile } from './load'

// Runs against every seed file present: the tracked example always — which is
// what lets CI check the rules without seeing the real roadmap — and the
// private roadmap when it is on this machine. A seed must pass clean, warnings
// included: warnings exist for edits in progress, not for a finished plan.
describe.each(availableSeeds())('$label', ({ seed }) => {
  const content = seedContent(seed)

  it('breaks no rule', () => {
    expect(validate(content)).toEqual([])
  })

  it('projects every item onto its own baseline when nothing is done', () => {
    // Pins the late-dependency rule to the engine it predicts: a plan with no
    // warning must be born on time, not already slipped.
    const options = { blackouts: content.roadmap.blackouts, timeZone: content.roadmap.timeZone }
    for (const projected of recomputeProjections(content.items, options)) {
      expect(projected.projectedStartDate, `${projected.id} start`).toBe(projected.baselineStartDate)
      expect(projected.projectedEndDate, `${projected.id} end`).toBe(projected.baselineEndDate)
    }
  })
})

// Each rule broken on purpose, on a copy of the example, one at a time.
describe('every rule fires', () => {
  const example = seedContent(readSeedFile(EXAMPLE_SEED))

  const item = (content: RoadmapContent, id: string): Item => {
    const found = content.items.find((candidate) => candidate.id === id)
    if (!found) throw new Error(`The example seed has no item ${id}`)
    return found
  }

  const breakers: Record<Rule, (content: RoadmapContent) => void> = {
    'item-id': (c) => {
      item(c, 'read-the-thing').id = 'Read-The-Thing'
    },
    'duplicate-id': (c) => {
      item(c, 'read-the-thing').id = 'course-part-1'
    },
    'work-item-id': (c) => {
      c.workItems.push({ ...c.workItems[0]!, id: 'read-the-thing' })
    },
    'phase-numbering': (c) => {
      c.roadmap.phases[1]!.number = 3
    },
    'unknown-phase': (c) => {
      item(c, 'the-optional-thing').phase = 3
    },
    'closing-milestone': (c) => {
      c.roadmap.phases[0]!.closingMilestoneId = 'the-next-thing'
    },
    'sort-order': (c) => {
      item(c, 'read-the-thing').sortOrder = 1
    },
    'time-zone': (c) => {
      c.roadmap.timeZone = 'Mars/Olympus_Mons'
    },
    link: (c) => {
      item(c, 'course-part-1').link = 'http://example.com'
    },
    dates: (c) => {
      item(c, 'read-the-thing').baselineEndDate = '2030-01-06'
    },
    'blackout-edge': (c) => {
      item(c, 'build-part-2').baselineStartDate = '2030-02-03'
    },
    'before-start': (c) => {
      c.roadmap.startDate = '2030-01-08'
    },
    dependency: (c) => {
      item(c, 'read-the-thing').dependsOn = ['nothing-by-that-name']
    },
    cycle: (c) => {
      item(c, 'course-part-1').dependsOn = ['course-part-2']
    },
    'unknown-work-item': (c) => {
      item(c, 'read-the-thing').workItemId = 'no-such-unit'
    },
    'unmapped-skill': (c) => {
      item(c, 'read-the-thing').skills = ['Not on the radar']
    },
    'unknown-dimension': (c) => {
      c.roadmap.skillDimension['Something else'] = 'No such axis'
    },

    'too-long': (c) => {
      item(c, 'the-optional-thing').baselineEndDate = '2030-02-25'
    },
    'phase-order': (c) => {
      item(c, 'read-the-thing').phase = 2
    },
    'late-dependency': (c) => {
      item(c, 'the-optional-thing').baselineStartDate = '2030-02-17'
    },
    'phase-gate': (c) => {
      item(c, 'the-next-thing').dependsOn = []
    },
    'milestone-coverage': (c) => {
      const milestone = item(c, 'phase-1-exam')
      milestone.dependsOn = milestone.dependsOn.filter((id) => id !== 'exam-prep')
    },
    'project-chain': (c) => {
      item(c, 'build-part-2').dependsOn = []
    },
    'single-part': (c) => {
      item(c, 'exam-prep').workItemId = null
    },
    'overlapping-parts': (c) => {
      item(c, 'course-part-2').baselineStartDate = '2030-01-13'
    },
    'done-when': (c) => {
      item(c, 'practice-week-1').doneWhen = ''
    },
    'no-estimate': (c) => {
      item(c, 'read-the-thing').duration = 'a while'
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
    items: content.items.map((item) => (item.id === id ? { ...item, baselineStartDate: start } : item)),
  })

  it('reports an error the change brings in', () => {
    const intoPause = moved(example, 'build-part-2', '2030-02-03')
    const introduced = introducedErrors(example, intoPause)
    expect(introduced.map((issue) => issue.rule)).toEqual(['blackout-edge'])
    expect(introduced[0]?.itemId).toBe('build-part-2')
  })

  it('lets a change through when the roadmap already had the same error', () => {
    const broken = structuredClone(example)
    broken.items.find((item) => item.id === 'course-part-1')!.link = 'http://example.com'
    const edited = moved(broken, 'the-optional-thing', '2030-02-19')
    expect(introducedErrors(broken, edited)).toEqual([])
  })

  it('ignores warnings, which never refuse a change', () => {
    const tooLong = moved(example, 'the-optional-thing', '2030-02-14')
    expect(validate(tooLong).some((issue) => issue.severity === 'warning')).toBe(true)
    expect(introducedErrors(example, tooLong)).toEqual([])
  })
})
