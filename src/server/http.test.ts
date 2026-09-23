import { describe, expect, it } from 'vitest'
import type { AppState } from '../core/types'
import { refusal, revisionOf } from './http'
import { InvalidWriteError, StaleRevisionError } from './repository'

describe('revisionOf', () => {
  it('reads a whole, non-negative revision', () => {
    expect(revisionOf({ revision: 0 })).toBe(0)
    expect(revisionOf({ revision: 12, hours: 3 })).toBe(12)
  })

  it.each([
    ['no body', null],
    ['no revision', { hours: 3 }],
    ['a string', { revision: '12' }],
    ['a fraction', { revision: 1.5 }],
    ['a negative number', { revision: -1 }],
  ])('refuses %s', (_, body) => {
    expect(revisionOf(body)).toBeNull()
  })
})

describe('refusal', () => {
  it('answers a stale write with 409 and the current world', async () => {
    const current = { revision: 13 } as AppState
    const response = refusal(new StaleRevisionError(current))

    expect(response?.status).toBe(409)
    const body = (await response?.json()) as { error: string; state: AppState }
    expect(body.state.revision).toBe(13)
    expect(body.error).toContain('revision 13')
  })

  it('answers a write that would break a rule with 422 and the errors it would bring in', async () => {
    const issue = {
      severity: 'error',
      rule: 'blackout-edge',
      message: 'x starts inside a pause',
      itemId: 'x',
    } as const
    const response = refusal(new InvalidWriteError([issue]))

    expect(response?.status).toBe(422)
    const body = (await response?.json()) as { error: string; issues: unknown[] }
    expect(body.issues).toEqual([issue])
    expect(body.error).toContain('x starts inside a pause')
  })

  it('leaves any other error to the route', () => {
    expect(refusal(new Error('No item with id x'))).toBeNull()
  })
})
