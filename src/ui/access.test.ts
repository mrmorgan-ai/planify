import { describe, expect, it } from 'vitest'
import { identityEmail } from './access'

describe('identityEmail', () => {
  it('reads the email from an Access identity', () => {
    expect(identityEmail({ email: 'someone@example.com', name: 'Someone' })).toBe('someone@example.com')
  })

  it('finds no session when the body is not an identity', () => {
    expect(identityEmail(null)).toBeNull()
    expect(identityEmail('<!doctype html>')).toBeNull()
    expect(identityEmail({})).toBeNull()
    expect(identityEmail({ email: '' })).toBeNull()
    expect(identityEmail({ email: 42 })).toBeNull()
  })
})
