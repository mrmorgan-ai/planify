/**
 * Sign-in is Cloudflare Access, in front of the app: there is no login code
 * here. Access answers these two paths on the app's own domain, before the
 * request reaches Pages. Without Access (local development, or a domain it does
 * not cover) the identity path falls through to the app shell, which is not
 * JSON, so there is no session to show and nothing to log out of.
 */
export const LOGOUT_URL = '/cdn-cgi/access/logout'
const IDENTITY_URL = '/cdn-cgi/access/get-identity'

export function identityEmail(body: unknown): string | null {
  const email = (body as { email?: unknown } | null)?.email
  return typeof email === 'string' && email.includes('@') ? email : null
}

export async function fetchSessionEmail(): Promise<string | null> {
  try {
    const response = await fetch(IDENTITY_URL)
    if (!response.ok) return null
    return identityEmail(await response.json())
  } catch {
    return null
  }
}
