import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { addDays, maxDate, startOfWeek } from '../core/dates'
import { lateness, needsReschedule, reschedulePlan, type Lateness } from '../core/reschedule'
import type { AppState, CivilDate, Item } from '../core/types'
import { DatePicker } from './DatePicker'
import { shortDate } from './format'

const DISMISSED_KEY = 'planify.reschedule.dismissed'

export type LateAlert = {
  /** Where the plan stands, or null when nothing is late. */
  behind: Lateness | null
  /** Late enough to recommend rescheduling. */
  recommended: boolean
  dialogOpen: boolean
  openDialog: () => void
  /** Closes the dialog; the pop-up then stays away for the rest of the week. */
  closeDialog: () => void
}

/**
 * When to recommend rescheduling. The pop-up opens by itself once per week
 * while the plan is a week or more behind; "Not now" puts it away until the next
 * Monday and leaves the banner, which stays on every view until the plan is
 * rescheduled or caught up.
 *
 * The dismissal is kept in the browser: it is a convenience for whoever is
 * looking, not a fact about the plan.
 */
export function useLateAlert(state: AppState | null): LateAlert {
  const [dialogOpen, setDialogOpen] = useState(false)
  const behind = state ? lateness(state.items, state.today) : null
  const recommended = state !== null && needsReschedule(state.items, state.today)
  const week = state ? startOfWeek(state.today) : null

  useEffect(() => {
    if (recommended && week !== null && readDismissed() !== week) setDialogOpen(true)
  }, [recommended, week])

  const openDialog = useCallback(() => setDialogOpen(true), [])
  const closeDialog = useCallback(() => {
    setDialogOpen(false)
    if (week !== null) writeDismissed(week)
  }, [week])

  return { behind, recommended, dialogOpen, openDialog, closeDialog }
}

/** The line across every view while the plan is a week or more behind. */
export function LateBanner({ alert }: { alert: LateAlert }) {
  if (!alert.recommended || !alert.behind) return null
  const { days, items } = alert.behind
  return (
    <div className="late-banner" role="status">
      <span>
        ⚠ {days} days behind · {items.length} {items.length === 1 ? 'item' : 'items'} past their end
      </span>
      <button type="button" className="late-banner-action" onClick={alert.openDialog}>
        Reschedule…
      </button>
    </div>
  )
}

/**
 * Picks the week the plan restarts in and shows what that does before anything is
 * written. The preview runs the same engine function the server runs, on the
 * same data, so what it shows is what the server will write.
 */
export function RescheduleDialog({
  state,
  alert,
  busy,
  onConfirm,
}: {
  state: AppState
  alert: LateAlert
  busy: boolean
  onConfirm: (restartDate: CivilDate) => Promise<boolean>
}) {
  const dialog = useRef<HTMLDialogElement>(null)
  const { today, roadmap } = state
  const earliest = roadmap.startDate === '' ? today : maxDate(today, roadmap.startDate)
  const [restart, setRestart] = useState<CivilDate>(earliest)

  useEffect(() => {
    const element = dialog.current
    if (!element) return
    if (alert.dialogOpen && !element.open) {
      setRestart(earliest)
      element.showModal()
    }
    if (!alert.dialogOpen && element.open) element.close()
  }, [alert.dialogOpen, earliest])

  const preview = useMemo(() => {
    try {
      return reschedulePlan(state.items, restart, {
        blackouts: roadmap.blackouts,
        timeZone: roadmap.timeZone,
      })
    } catch {
      return null
    }
  }, [state.items, restart, roadmap.blackouts, roadmap.timeZone])

  // The plan moves by whole weeks, so a choice names a week. This week is
  // picked by today's date, since the server refuses a date already past.
  const monday = startOfWeek(today)
  const choices = [
    { label: 'This week', date: earliest },
    { label: 'Next week', date: maxDate(addDays(monday, 7), earliest) },
    { label: 'In two weeks', date: maxDate(addDays(monday, 14), earliest) },
  ].filter((choice, index, all) => all.findIndex((other) => sameWeek(other.date, choice.date)) === index)

  const { behind } = alert
  const nothing = !preview || preview.shift === 0

  return (
    <dialog
      ref={dialog}
      className="reschedule"
      aria-labelledby="reschedule-title"
      onClose={() => {
        if (alert.dialogOpen) alert.closeDialog()
      }}
    >
      <h2 id="reschedule-title">
        {alert.recommended && behind ? `You're ${behind.days} days behind` : 'Reschedule the plan'}
      </h2>

      {behind ? (
        <p className="muted">
          {behind.items.length} unfinished {behind.items.length === 1 ? 'item is' : 'items are'} past
          their end date; the oldest ended {shortDate(behind.since)}.
        </p>
      ) : (
        <p className="muted">Nothing is late. Rescheduling moves every unfinished item later.</p>
      )}

      <div className="reschedule-field">
        <span className="reschedule-label">Restart in</span>
        <div className="filters">
          {choices.map((choice) => (
            <button
              key={choice.label}
              type="button"
              className={sameWeek(restart, choice.date) ? 'chip active' : 'chip'}
              onClick={() => setRestart(choice.date)}
            >
              {choice.label}
            </button>
          ))}
        </div>
        <div className="reschedule-date">
          <DatePicker
            value={restart}
            min={earliest}
            label="Restart the plan in the week of"
            onChange={setRestart}
          />
        </div>
        {preview && (
          <p className="reschedule-note">
            {sameWeek(preview.restart, restart)
              ? `The plan restarts in the week of ${shortDate(preview.restart)}. Every item keeps its weekday.`
              : `The week of ${shortDate(startOfWeek(restart))} is a pause; the plan restarts on ${shortDate(preview.restart)}.`}
          </p>
        )}
      </div>

      {preview && !nothing ? (
        <Preview state={state} after={preview.items} moved={preview.moved} shift={preview.shift} />
      ) : (
        <p className="notice">
          Nothing to move: the plan is not behind the week of {shortDate(startOfWeek(restart))}.
        </p>
      )}

      <div className="reschedule-actions">
        <button type="button" className="button" disabled={busy} onClick={alert.closeDialog}>
          Not now
        </button>
        <button
          type="button"
          className="button primary"
          disabled={busy || nothing}
          onClick={async () => {
            if (await onConfirm(restart)) alert.closeDialog()
          }}
        >
          {busy ? 'Rescheduling…' : 'Reschedule plan'}
        </button>
      </div>
    </dialog>
  )
}

/** What the reschedule changes: how much, the milestones, the end of the plan. */
function Preview({
  state,
  after,
  moved,
  shift,
}: {
  state: AppState
  after: Item[]
  moved: string[]
  shift: number
}) {
  const before = new Map(state.items.map((item) => [item.id, item]))
  const now = new Map(after.map((item) => [item.id, item]))

  const milestones = state.roadmap.phases.flatMap((phase) => {
    const id = phase.closingMilestoneId
    const old = id ? before.get(id) : undefined
    const next = id ? now.get(id) : undefined
    if (!old || !next || old.projectedEndDate === next.projectedEndDate) return []
    return [{ phase, from: old.projectedEndDate, to: next.projectedEndDate }]
  })

  const endOf = (items: Iterable<Item>) =>
    [...items].reduce((last, item) => (item.projectedEndDate > last ? item.projectedEndDate : last), '')
  const planBefore = endOf(before.values())
  const planAfter = endOf(now.values())

  const movedItems = after.filter((item) => moved.includes(item.id))

  return (
    <div className="reschedule-preview">
      <ul>
        <li>
          {moved.length} unfinished {moved.length === 1 ? 'item moves' : 'items move'}{' '}
          {weeksOf(shift)}
        </li>
        {milestones.map(({ phase, from, to }) => (
          <li key={phase.number}>
            Phase {phase.number} closes <Change from={from} to={to} />
          </li>
        ))}
        {planBefore !== planAfter && (
          <li>
            Plan ends <Change from={planBefore} to={planAfter} />
          </li>
        )}
      </ul>

      <details>
        <summary>See every item that moves</summary>
        <table className="reschedule-list">
          <tbody>
            {movedItems.map((item) => (
              <tr key={item.id}>
                <td>{item.name}</td>
                <td>
                  <Change from={before.get(item.id)?.projectedStartDate ?? ''} to={item.projectedStartDate} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </div>
  )
}

function Change({ from, to }: { from: CivilDate; to: CivilDate }) {
  return (
    <span className="change">
      {shortDate(from)} → <strong>{shortDate(to)}</strong>
    </span>
  )
}

function sameWeek(a: CivilDate, b: CivilDate): boolean {
  return startOfWeek(a) === startOfWeek(b)
}

/** A move in study days, said in weeks when it is whole weeks, as it is with whole-week pauses. */
function weeksOf(days: number): string {
  if (days % 7 !== 0) return `+${days} study ${days === 1 ? 'day' : 'days'}`
  const weeks = days / 7
  return `+${weeks} ${weeks === 1 ? 'week' : 'weeks'}`
}

function readDismissed(): string | null {
  try {
    return window.localStorage.getItem(DISMISSED_KEY)
  } catch {
    return null
  }
}

function writeDismissed(week: CivilDate): void {
  try {
    window.localStorage.setItem(DISMISSED_KEY, week)
  } catch {
    // Private windows and blocked storage: the pop-up just comes back next time.
  }
}
