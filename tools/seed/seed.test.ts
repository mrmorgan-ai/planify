import { describe, expect, it } from 'vitest'
import { parseSeed, roadmapFileName, seedContent, toSeedFile } from '../../src/core/seed'
import { availableSeeds } from './load'

// The export is the way back from the database to a file, so it has to be
// lossless: exporting a roadmap and reading the file again gives the same
// roadmap, for every seed present.
describe.each(availableSeeds())('$label', ({ seed }) => {
  const content = seedContent(seed)

  it('reads back as the same roadmap', () => {
    const file = JSON.parse(JSON.stringify(toSeedFile(content)))
    expect(seedContent(parseSeed(file))).toEqual(content)
  })

  it('carries no progress', () => {
    const started = {
      ...content,
      items: content.items.map((item) => ({
        ...item,
        state: 'done' as const,
        completedAt: '2030-01-08T10:00:00Z',
        hoursDone: 3,
        projectedStartDate: '2031-01-01',
        projectedEndDate: '2031-01-02',
      })),
    }
    const runtime = ['state', 'completedAt', 'hoursDone', 'projectedStartDate', 'projectedEndDate']
    for (const item of toSeedFile(started).items) {
      expect(Object.keys(item).filter((key) => runtime.includes(key))).toEqual([])
    }
  })
})

describe('toSeedFile', () => {
  const content = seedContent(availableSeeds()[0]!.seed)

  it('leaves out a start date and a capacity that are not set', () => {
    const file = toSeedFile({
      ...content,
      roadmap: { ...content.roadmap, startDate: '', weeklyHours: { normal: 0 } },
    })
    expect(file).not.toHaveProperty('startDate')
    expect(file).not.toHaveProperty('weeklyHours')
  })

  it('groups skills by axis, then by name', () => {
    const file = toSeedFile({
      ...content,
      roadmap: {
        ...content.roadmap,
        dimensions: ['B axis', 'A axis'],
        skillDimension: { zeta: 'A axis', alpha: 'A axis', mid: 'B axis' },
      },
    })
    expect(Object.keys(file.skills)).toEqual(['mid', 'alpha', 'zeta'])
  })
})

describe('roadmapFileName', () => {
  it('stamps the time in the roadmap’s timezone', () => {
    expect(roadmapFileName('2026-09-23T18:32:05.123Z', 'America/Lima')).toBe(
      'roadmap-2026-09-23-1332.json',
    )
  })

  it('takes the date from the timezone too, not from UTC', () => {
    expect(roadmapFileName('2026-09-24T03:10:00Z', 'America/Lima')).toBe(
      'roadmap-2026-09-23-2210.json',
    )
  })

  it('adds a version’s number in the history', () => {
    expect(roadmapFileName('2026-09-23T18:32:05.123Z', 'America/Lima', 5)).toBe(
      'roadmap-2026-09-23-1332-v5.json',
    )
  })

  it('falls back to UTC for a timezone the runtime does not know', () => {
    expect(roadmapFileName('2026-09-24T03:10:00Z', 'Not/AZone')).toBe(
      'roadmap-2026-09-24-0310.json',
    )
  })
})
