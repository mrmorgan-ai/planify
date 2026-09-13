import { describe, expect, it } from 'vitest'
import { addDays, isBlackoutDay, startOfWeek, studyDaysBetween } from '../../src/core/dates'
import { estimatedHours, hoursInWeek, weekOf } from '../../src/core/hours'
import { recomputeProjections, topologicalOrder } from '../../src/core/schedule'
import { partsOf } from '../../src/core/workItems'
import { asItems, availableSeeds } from './load'

// Runs against every seed file present: the tracked example always — which is
// what lets CI check these rules without seeing the real roadmap — and the
// private roadmap when it is on this machine.
describe.each(availableSeeds())('$label', ({ seed }) => {
  const items = asItems(seed)
  const byId = new Map(items.map((item) => [item.id, item]))
  const options = { blackouts: seed.blackouts, timeZone: seed.timeZone }

  const transitiveDependencies = (id: string): Set<string> => {
    const seen = new Set<string>()
    const queue = [...(byId.get(id)?.dependsOn ?? [])]
    while (queue.length > 0) {
      const next = queue.pop()
      if (!next || seen.has(next)) continue
      seen.add(next)
      queue.push(...(byId.get(next)?.dependsOn ?? []))
    }
    return seen
  }

  describe('shape', () => {
    it('carries the item count it declares for each phase', () => {
      for (const [phase, expected] of Object.entries(seed.expectedItemsPerPhase)) {
        const count = items.filter((item) => item.phase === Number(phase)).length
        expect(count, `phase ${phase}`).toBe(expected)
      }
    })

    it('declares an expected count for every phase it defines', () => {
      for (const phase of seed.phases) {
        expect(
          seed.expectedItemsPerPhase[String(phase.number)],
          `phase ${phase.number} has no expected count`,
        ).toBeDefined()
      }
    })

    it('places every item in a phase the seed defines', () => {
      const defined = new Set(seed.phases.map((phase) => phase.number))
      for (const item of items) {
        expect(defined.has(item.phase), `${item.id} sits in undefined phase`).toBe(true)
      }
    })

    it('has unique ids, in kebab-case', () => {
      expect(new Set(items.map((item) => item.id)).size).toBe(items.length)
      for (const item of items) {
        expect(item.id, item.id).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/)
      }
    })

    it('has a unique sort order within each phase', () => {
      for (const phase of seed.phases) {
        const orders = items
          .filter((item) => item.phase === phase.number)
          .map((item) => item.sortOrder)
        expect(new Set(orders).size, `phase ${phase.number}`).toBe(orders.length)
      }
    })

    it('links to https or to nothing at all', () => {
      for (const item of items) {
        if (item.link !== null) expect(item.link, item.id).toMatch(/^https:\/\//)
      }
    })

    it('names a timezone the runtime understands', () => {
      expect(() => new Intl.DateTimeFormat('en-CA', { timeZone: seed.timeZone })).not.toThrow()
    })

    it('numbers phases without gaps, starting at 1', () => {
      const numbers = seed.phases.map((phase) => phase.number).sort((a, b) => a - b)
      numbers.forEach((number, index) => {
        expect(number, 'phase numbers must run 1..n with no gaps').toBe(index + 1)
      })
    })
  })

  describe('baseline dates', () => {
    it('never starts or ends inside a blackout', () => {
      for (const item of items) {
        expect(isBlackoutDay(item.baselineStartDate, seed.blackouts), `${item.id} start`).toBe(false)
        expect(isBlackoutDay(item.baselineEndDate, seed.blackouts), `${item.id} end`).toBe(false)
      }
    })

    it('spans at least one study day, ending on or after it starts', () => {
      for (const item of items) {
        expect(
          studyDaysBetween(item.baselineStartDate, item.baselineEndDate, seed.blackouts),
          item.id,
        ).toBeGreaterThanOrEqual(1)
      }
    })

    it('stays inside its own phase window', () => {
      for (const item of items) {
        const window = seed.phaseWindows[String(item.phase)]
        expect(window, `phase ${item.phase} has no window`).toBeDefined()
        if (!window) continue
        expect(
          item.baselineStartDate >= window.from,
          `${item.id} starts before its phase window`,
        ).toBe(true)
        if (window.to) {
          expect(item.baselineEndDate <= window.to, `${item.id} ends after its phase window`).toBe(
            true,
          )
        }
      }
    })

    it('never spans more than one week of study days, so every item can be finished in a week', () => {
      for (const item of items) {
        expect(
          studyDaysBetween(item.baselineStartDate, item.baselineEndDate, seed.blackouts),
          `${item.id} is too long to finish in a week — split it into parts`,
        ).toBeLessThanOrEqual(7)
      }
    })
  })

  describe('dependency graph', () => {
    it('only points at items that exist, and never at itself', () => {
      for (const item of items) {
        for (const dependency of item.dependsOn) {
          expect(byId.has(dependency), `${item.id} -> ${dependency}`).toBe(true)
          expect(dependency, item.id).not.toBe(item.id)
        }
        expect(new Set(item.dependsOn).size, `${item.id} has duplicate dependencies`).toBe(
          item.dependsOn.length,
        )
      }
    })

    it('is acyclic', () => {
      expect(() => topologicalOrder(items)).not.toThrow()
    })

    it('gates every phase behind the previous phase closing milestone', () => {
      for (const phase of seed.phases) {
        const previous = seed.phases.find((other) => other.number === phase.number - 1)
        if (!previous) continue
        const gate = previous.closingMilestoneId
        expect(gate, `phase ${previous.number} has no closing milestone`).not.toBeNull()
        if (!gate) continue

        for (const item of items.filter((candidate) => candidate.phase === phase.number)) {
          expect(
            transitiveDependencies(item.id).has(gate),
            `${item.id} is not gated behind ${gate}`,
          ).toBe(true)
        }
      }
    })

    it('has each closing milestone waiting on every other item of its phase', () => {
      for (const phase of seed.phases) {
        const milestoneId = phase.closingMilestoneId
        if (!milestoneId) continue

        const milestone = byId.get(milestoneId)
        expect(milestone, milestoneId).toBeDefined()
        expect(milestone?.phase, milestoneId).toBe(phase.number)

        const exceptions = seed.milestoneDependencyExceptions[milestoneId] ?? []
        const reached = transitiveDependencies(milestoneId)

        for (const other of items.filter((candidate) => candidate.phase === phase.number)) {
          if (other.id === milestoneId || exceptions.includes(other.id)) continue
          expect(reached.has(other.id), `${milestoneId} does not wait on ${other.id}`).toBe(true)
        }
      }
    })

    it('chains the parts of a project strictly, one after another', () => {
      for (const workItem of seed.workItems.filter((candidate) => candidate.type === 'Project')) {
        const parts = partsOf(workItem.id, items)
        parts.forEach((part, index) => {
          const previous = parts[index - 1]
          if (!previous) return
          expect(part.dependsOn, `${part.id} does not follow ${previous.id}`).toContain(previous.id)
        })
      }
    })

    it('keeps every milestone exception inside the same phase', () => {
      for (const [milestoneId, excluded] of Object.entries(seed.milestoneDependencyExceptions)) {
        const milestone = byId.get(milestoneId)
        expect(milestone, `exception names unknown milestone ${milestoneId}`).toBeDefined()
        for (const id of excluded) {
          expect(byId.get(id)?.phase, `${id} is not in the same phase as ${milestoneId}`).toBe(
            milestone?.phase,
          )
        }
      }
    })
  })

  describe('work items', () => {
    const workItemIds = new Set(seed.workItems.map((workItem) => workItem.id))

    it('has unique ids, in kebab-case, that never reuse an item id', () => {
      expect(workItemIds.size).toBe(seed.workItems.length)
      for (const workItem of seed.workItems) {
        expect(workItem.id, workItem.id).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/)
        expect(byId.has(workItem.id), `${workItem.id} is both an item and a work item`).toBe(false)
      }
    })

    it('only names work items that exist', () => {
      for (const item of items) {
        if (item.workItemId === null) continue
        expect(workItemIds.has(item.workItemId), `${item.id} -> ${item.workItemId}`).toBe(true)
      }
    })

    it('splits every work item into at least two parts', () => {
      // A unit of one is what a standalone item already is. A work item with a
      // single part says the same thing twice, and one with none is a heading
      // over nothing.
      for (const workItem of seed.workItems) {
        expect(partsOf(workItem.id, items).length, workItem.id).toBeGreaterThanOrEqual(2)
      }
    })

    it('runs the parts of a work item one after another, never overlapping', () => {
      for (const workItem of seed.workItems) {
        const parts = partsOf(workItem.id, items)
        parts.forEach((part, index) => {
          const previous = parts[index - 1]
          if (!previous) return
          expect(
            part.baselineStartDate > previous.baselineEndDate,
            `${part.id} starts before ${previous.id} ends — check the dates or the sort order`,
          ).toBe(true)
        })
      }
    })
  })

  describe('hours', () => {
    it('gives every item an hours estimate in its duration', () => {
      // An item with no estimate counts as zero in every weekly total, which is
      // how a week gets planned past its capacity without anything showing it.
      for (const item of items) {
        expect(estimatedHours(item), `${item.id} has no hours in "${item.duration}"`).not.toBeNull()
      }
    })

    it('never schedules a week above the capacity it declares', () => {
      const capacity = seed.weeklyHours
      if (!capacity) return
      const first = items.reduce(
        (earliest, item) => (item.baselineStartDate < earliest ? item.baselineStartDate : earliest),
        items[0]?.baselineStartDate ?? '',
      )
      const last = items.reduce(
        (latest, item) => (item.baselineEndDate > latest ? item.baselineEndDate : latest),
        '',
      )
      for (let monday = startOfWeek(first); monday <= last; monday = addDays(monday, 7)) {
        const week = weekOf(monday, capacity)
        const scheduled = hoursInWeek(items, week, seed.blackouts)
        // A hundredth of an hour of slack for the pro-rating's floating point.
        expect(scheduled, `week of ${monday}: ${scheduled.toFixed(2)}h in ${week.hours}h`)
          .toBeLessThanOrEqual(week.hours + 0.01)
      }
    })
  })

  describe('skills', () => {
    it('only uses skills that have a dimension', () => {
      for (const item of items) {
        for (const skill of item.skills) {
          expect(seed.skills[skill], `${item.id} uses unmapped skill "${skill}"`).toBeDefined()
        }
      }
    })

    it('covers every mapped skill with at least one item', () => {
      const used = new Set(items.flatMap((item) => item.skills))
      for (const skill of Object.keys(seed.skills)) {
        // An unused skill sits in the radar's denominator forever, capping its axis.
        expect(used.has(skill), `"${skill}" is mapped but no item covers it`).toBe(true)
      }
    })

    it('fills every radar axis with at least one skill', () => {
      const covered = new Set(Object.values(seed.skills))
      for (const dimension of seed.dimensions) {
        expect(covered.has(dimension), `axis "${dimension}" has no skills`).toBe(true)
      }
    })
  })

  describe('the graph agrees with the dates', () => {
    it('projects every item onto its own baseline when nothing is done', () => {
      // The strongest check in the validator: if a dependency ends on or after
      // the baseline start of something that waits on it, the engine shifts that
      // item and the plan is born already slipped.
      for (const projected of recomputeProjections(items, options)) {
        expect(projected.projectedStartDate, `${projected.id} start`).toBe(
          projected.baselineStartDate,
        )
        expect(projected.projectedEndDate, `${projected.id} end`).toBe(projected.baselineEndDate)
      }
    })
  })
})
