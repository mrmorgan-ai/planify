import { useLayoutEffect, useRef, type MouseEvent, type RefObject } from 'react'
import {
  Link,
  NavLink,
  Navigate,
  Route,
  Routes,
  useLocation,
  useNavigate,
} from 'react-router-dom'
import { activeContext } from '../core/dashboard'
import { planProgress } from '../core/hours'
import type { AppState } from '../core/types'
import { Backlog } from './Backlog'
import { Dashboard } from './Dashboard'
import { DraftBar, DraftButton } from './Draft'
import { Gantt } from './Gantt'
import { shortDate } from './format'
import { Kanban } from './Kanban'
import { PlanIssues } from './PlanIssues'
import { LateBanner, RescheduleDialog, useLateAlert } from './Reschedule'
import { Session } from './Session'
import { Settings } from './Settings'
import { useAppState } from './useAppState'
import { Stories } from './Stories'

const VIEWS = [
  { path: '/dashboard', label: 'Dashboard' },
  { path: '/backlog', label: 'Backlog' },
  { path: '/stories', label: 'Stories' },
  { path: '/kanban', label: 'Kanban' },
  { path: '/gantt', label: 'Gantt' },
] as const

/** Where the gear was pressed from: the address, and how far `main` had scrolled. */
type Place = { to: string; scroll: number }

/**
 * Settings is the plan's setup, not a view of it and not part of the account, so
 * the gear leaves the header for the footer's left end, away from the session.
 *
 * It opens settings and, pressed again, closes them: back to the view it was
 * opened from, at the scroll it had. That place is remembered here rather than
 * read from history, because the settings pages push entries of their own and
 * a reload or a link straight into settings leaves no history to go back to —
 * then it falls back to the dashboard. The name shows beside the icon for a
 * pointer; a finger gets the icon alone (see the stylesheet).
 */
function SettingsLink({ main }: { main: RefObject<HTMLElement | null> }) {
  const { pathname, search, hash } = useLocation()
  const navigate = useNavigate()
  const open = pathname === '/settings' || pathname.startsWith('/settings/')
  const from = useRef<Place | null>(null)
  const restore = useRef<number | null>(null)

  // After the view is back on screen: scrolling first would be clamped to the
  // height of the settings page.
  useLayoutEffect(() => {
    if (open || restore.current === null) return
    main.current?.scrollTo({ top: restore.current })
    restore.current = null
  }, [open, main])

  const toggle = (event: MouseEvent) => {
    // Leave a click that opens a new tab or window to the browser.
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
      return
    }
    if (open) {
      event.preventDefault()
      const place = from.current ?? { to: '/dashboard', scroll: 0 }
      from.current = null
      restore.current = place.scroll
      navigate(place.to)
    } else {
      from.current = { to: pathname + search + hash, scroll: main.current?.scrollTop ?? 0 }
      // Settings start at the top; main keeps its scroll across views.
      main.current?.scrollTo({ top: 0 })
    }
  }

  return (
    <NavLink className="settings-link" to="/settings" aria-label="Settings" onClick={toggle}>
      <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
        <path
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Z M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1Z"
        />
      </svg>
      <span className="settings-label">Settings</span>
    </NavLink>
  )
}

function Placeholder({ view }: { view: string }) {
  return (
    <section className="placeholder">
      <h2>{view}</h2>
      <p>Not built yet.</p>
    </section>
  )
}

/**
 * Where the plan stands, on every screen: the phase you are in, today in the
 * board's date format, and how much of the plan is done — by hours, because a
 * 25-minute case study and an 8-hour course are not the same amount of plan.
 */
function Status({ state }: { state: AppState }) {
  const { tasks, today, roadmap } = state
  const context = activeContext(today, roadmap, tasks)
  const { done, total } = planProgress(
    tasks,
    roadmap.phases.map((phase) => phase.number),
    today,
  )
  const percent = total === 0 ? 0 : Math.round((done / total) * 100)

  return (
    <>
      {/* The phase is the first thing to go on a phone: it is the longest line
          in the footer and the board already says it. */}
      <span className="footer-where">{whereYouAre(state, context)}</span>
      <span className="footer-sep footer-where">·</span>
      <span>{shortDate(today)}</span>
      <span className="footer-sep">·</span>
      <span title={`${round(done)} of ${round(total)} planned hours done`}>Plan {percent}%</span>
    </>
  )
}

function whereYouAre(state: AppState, context: ReturnType<typeof activeContext>): string {
  if (context.kind === 'phase') return `Phase ${context.phase.number} · ${context.phase.name}`
  if (context.kind === 'blackout') return context.blackout.reason
  const start = state.tasks.reduce<string | null>(
    (earliest, task) =>
      earliest === null || task.projectedStartDate < earliest ? task.projectedStartDate : earliest,
    null,
  )
  return start !== null && state.today < start ? `Plan starts ${shortDate(start)}` : 'Plan finished'
}

function round(hours: number): string {
  return String(Math.round(hours))
}

export function App() {
  const store = useAppState()
  const { state, error, mode } = store
  const drafting = mode === 'draft'
  // Rescheduling moves the live plan: a draft is replanned by editing it.
  const alert = useLateAlert(drafting ? null : state)
  const main = useRef<HTMLElement>(null)

  return (
    <div className={drafting ? 'app drafting' : 'app'}>
      <header>
        <Link className="brand" to="/dashboard">
          Planify
        </Link>
        <nav>
          {VIEWS.map((view) => (
            <NavLink key={view.path} to={view.path}>
              {view.label}
            </NavLink>
          ))}
        </nav>
        {state && <PlanIssues state={state} />}
        {state && <DraftButton {...store} state={state} />}
        <Session />
      </header>

      {state && <DraftBar {...store} state={state} />}
      <LateBanner alert={alert} />

      {/* Keyed by the world on screen, so no form carries a draft's values into the live roadmap. */}
      <main ref={main} key={mode}>
        {!state && !error && <p className="empty">Loading the roadmap…</p>}
        {/* Nothing loaded at all: someone signed in with no roadmap, say. The
            footer is too small a place for the only thing on the screen. */}
        {!state && error && <p className="empty">{error}</p>}
        {state && (
          <Routes>
            <Route path="/" element={<Navigate to="/dashboard" replace />} />
            <Route path="/dashboard" element={<Dashboard state={state} />} />
            <Route
              path="/gantt"
              element={
                <Gantt state={state} onReschedule={drafting ? undefined : alert.openDialog} />
              }
            />
            <Route path="/backlog" element={<Backlog {...store} state={state} />} />
            <Route path="/kanban" element={<Kanban {...store} state={state} />} />
            <Route path="/stories" element={<Stories {...store} state={state} />} />
            <Route path="/settings/*" element={<Settings {...store} state={state} />} />
            <Route path="*" element={<Placeholder view="Not found" />} />
          </Routes>
        )}
      </main>

      {state && !drafting && (
        <RescheduleDialog
          state={state}
          alert={alert}
          busy={store.rescheduling}
          onConfirm={store.reschedulePlan}
        />
      )}

      <footer>
        <SettingsLink main={main} />
        <span className="credit">
          Made with{' '}
          <span className="heart" aria-label="love">
            ❤
          </span>{' '}
          by AI PlayGrounds
        </span>
        <span className="footer-status">
          {error && <span className="bad">{error}</span>}
          {state && <Status state={state} />}
        </span>
      </footer>
    </div>
  )
}
