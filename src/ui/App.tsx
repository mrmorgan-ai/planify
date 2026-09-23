import { Link, NavLink, Navigate, Route, Routes } from 'react-router-dom'
import { activeContext } from '../core/dashboard'
import { planProgress } from '../core/hours'
import type { AppState } from '../core/types'
import { Backlog } from './Backlog'
import { Dashboard } from './Dashboard'
import { Gantt } from './Gantt'
import { shortDate } from './format'
import { Kanban } from './Kanban'
import { PlanIssues } from './PlanIssues'
import { LateBanner, RescheduleDialog, useLateAlert } from './Reschedule'
import { Session } from './Session'
import { Settings } from './Settings'
import { useAppState } from './useAppState'
import { WorkItems } from './WorkItems'

const VIEWS = [
  { path: '/dashboard', label: 'Dashboard' },
  { path: '/backlog', label: 'Backlog' },
  { path: '/work-items', label: 'Work items' },
  { path: '/kanban', label: 'Kanban' },
  { path: '/gantt', label: 'Gantt' },
  { path: '/settings', label: 'Settings' },
] as const

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
  const { items, today, roadmap } = state
  const context = activeContext(today, roadmap, items)
  const { done, total } = planProgress(
    items,
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
      <span title={`${round(done)} of ${round(total)} planned hours done`}>
        Plan {percent}%
      </span>
    </>
  )
}

function whereYouAre(state: AppState, context: ReturnType<typeof activeContext>): string {
  if (context.kind === 'phase') return `Phase ${context.phase.number} · ${context.phase.name}`
  if (context.kind === 'blackout') return context.blackout.reason
  const start = state.items.reduce<string | null>(
    (earliest, item) =>
      earliest === null || item.projectedStartDate < earliest ? item.projectedStartDate : earliest,
    null,
  )
  return start !== null && state.today < start ? `Plan starts ${shortDate(start)}` : 'Plan finished'
}

function round(hours: number): string {
  return String(Math.round(hours))
}

export function App() {
  const store = useAppState()
  const { state, error } = store
  const alert = useLateAlert(state)

  return (
    <div className="app">
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
        <Session />
      </header>

      <LateBanner alert={alert} />

      <main>
        {!state && !error && <p className="empty">Loading the roadmap…</p>}
        {state && (
          <Routes>
            <Route path="/" element={<Navigate to="/dashboard" replace />} />
            <Route path="/dashboard" element={<Dashboard state={state} />} />
            <Route
              path="/gantt"
              element={<Gantt state={state} onReschedule={alert.openDialog} />}
            />
            <Route path="/backlog" element={<Backlog {...store} state={state} />} />
            <Route path="/kanban" element={<Kanban {...store} state={state} />} />
            <Route path="/work-items" element={<WorkItems state={state} />} />
            <Route
              path="/settings"
              element={<Settings {...store} state={state} />}
            />
            <Route path="*" element={<Placeholder view="Not found" />} />
          </Routes>
        )}
      </main>

      {state && (
        <RescheduleDialog
          state={state}
          alert={alert}
          busy={store.rescheduling}
          onConfirm={store.reschedulePlan}
        />
      )}

      <footer>
        <span className="credit">
          Made with <span className="heart" aria-label="love">❤</span> by AI PlayGrounds
        </span>
        <span className="footer-status">
          {error && <span className="bad">{error}</span>}
          {state && <Status state={state} />}
        </span>
      </footer>
    </div>
  )
}
