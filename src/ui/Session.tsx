import { useEffect, useState } from 'react'
import { LOGOUT_URL, fetchSessionEmail } from './access'

/**
 * Who is signed in, and the way out. Renders nothing without an Access session.
 * The logout is a plain link, not a router link: Access serves that path, so
 * the browser has to leave the app to reach it.
 */
export function Session() {
  const [email, setEmail] = useState<string | null>(null)

  useEffect(() => {
    let live = true
    fetchSessionEmail().then((found) => {
      if (live) setEmail(found)
    })
    return () => {
      live = false
    }
  }, [])

  if (!email) return null

  return (
    <div className="session">
      <span className="session-email">{email}</span>
      <a className="session-logout" href={LOGOUT_URL}>
        Log out
      </a>
    </div>
  )
}
