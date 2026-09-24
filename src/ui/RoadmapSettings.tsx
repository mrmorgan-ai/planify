import { useMemo, useState, type ReactNode } from 'react'
import { addDays } from '../core/dates'
import type { Edit } from '../core/edits'
import { keepStudyDays } from '../core/structure'
import type { AppState, Blackout, CivilDate } from '../core/types'
import { DatePicker } from './DatePicker'

/** How a section saves: its own busy flag and refusal, so one section's error stays in it. */
export type Saver = {
  busy: boolean
  error: string | null
  save: (edits: Edit[]) => Promise<boolean>
}

/**
 * One block of settings with its own draft and its own Save. Nothing is written
 * until Save, and Reset puts the draft back to what is stored.
 */
export function Section({
  title,
  intro,
  saver,
  dirty,
  problems = [],
  onSave,
  onReset,
  children,
}: {
  title: string
  intro?: ReactNode
  saver: Saver
  dirty: boolean
  problems?: string[]
  onSave: () => void
  onReset: () => void
  children: ReactNode
}) {
  return (
    <section className="block settings-section">
      <h2>{title}</h2>
      {intro && <p className="settings-text">{intro}</p>}
      {children}
      {/* Stuck to the bottom of the screen while there is something to save: in a
          long section, Save would otherwise appear far below the change that
          called for it. */}
      {(dirty || saver.error) && (
        <div className={dirty ? 'settings-save' : undefined}>
          {dirty && problems.length > 0 && (
            <ul className="form-problems">
              {problems.map((problem) => (
                <li key={problem}>{problem}</li>
              ))}
            </ul>
          )}
          {saver.error && (
            <p className="form-error" role="alert">
              {saver.error}
            </p>
          )}
          {dirty && (
            <div className="form-actions">
              <span className="muted settings-unsaved">Unsaved changes</span>
              <button type="button" className="button" disabled={saver.busy} onClick={onReset}>
                Reset
              </button>
              <button
                type="button"
                className="button primary"
                disabled={saver.busy || problems.length > 0}
                onClick={onSave}
              >
                {saver.busy ? 'Saving…' : 'Save'}
              </button>
            </div>
          )}
        </div>
      )}
    </section>
  )
}

/** When the plan starts, in which time zone its days turn, and the hours a week holds. */
export function PlanSettings({ state, saver }: { state: AppState; saver: Saver }) {
  const { roadmap } = state
  const initial = {
    startDate: roadmap.startDate || state.today,
    timeZone: roadmap.timeZone,
    weeklyHours: roadmap.weeklyHours.normal > 0 ? String(roadmap.weeklyHours.normal) : '',
  }
  const [draft, setDraft] = useState(initial)
  const zones = useMemo(timeZones, [])

  const hours = draft.weeklyHours.trim() === '' ? 0 : Number(draft.weeklyHours)
  const problems = [
    ...(Number.isFinite(hours) && hours >= 0 ? [] : ['Weekly hours must be a number, or empty.']),
    ...(draft.timeZone.trim() === '' ? ['The time zone cannot be empty.'] : []),
  ]
  const fields = {
    ...(draft.startDate !== roadmap.startDate ? { startDate: draft.startDate } : {}),
    ...(draft.timeZone.trim() !== roadmap.timeZone ? { timeZone: draft.timeZone.trim() } : {}),
    ...(hours !== roadmap.weeklyHours.normal ? { weeklyHours: hours } : {}),
  }

  return (
    <Section
      title="Plan"
      intro="Nothing can be planned before the start date. Weekly hours size each week on the board; leave it empty to not declare any."
      saver={saver}
      dirty={Object.keys(fields).length > 0}
      problems={problems}
      onReset={() => setDraft(initial)}
      onSave={() => void saver.save([{ op: 'updateSettings', fields }])}
    >
      <div className="settings-grid">
        <label className="settings-field">
          <span>Starts on</span>
          <DatePicker
            value={draft.startDate}
            disabled={saver.busy}
            label="The day the plan starts"
            onChange={(startDate) => setDraft({ ...draft, startDate })}
          />
        </label>
        <label className="settings-field">
          <span>Time zone</span>
          <input
            list="settings-time-zones"
            value={draft.timeZone}
            disabled={saver.busy}
            onChange={(event) => setDraft({ ...draft, timeZone: event.target.value })}
          />
          <datalist id="settings-time-zones">
            {zones.map((zone) => (
              <option key={zone} value={zone} />
            ))}
          </datalist>
        </label>
        <label className="settings-field">
          <span>Hours a week</span>
          <input
            inputMode="decimal"
            value={draft.weeklyHours}
            placeholder="Not declared"
            disabled={saver.busy}
            onChange={(event) => setDraft({ ...draft, weeklyHours: event.target.value })}
          />
        </label>
      </div>
    </Section>
  )
}

/**
 * Each phase's name and the item that closes it. Adding one puts it after the
 * last; only an empty last phase can be removed, so no item is ever left in a
 * phase that does not exist.
 */
export function PhasesSettings({ state, saver }: { state: AppState; saver: Saver }) {
  const { roadmap } = state
  const initial = roadmap.phases.map((phase) => ({ ...phase }))
  const [draft, setDraft] = useState(initial)
  const [newPhase, setNewPhase] = useState('')

  const edits: Edit[] = draft.flatMap((phase, index) => {
    const stored = roadmap.phases[index]
    if (!stored) return []
    const fields = {
      ...(phase.name.trim() !== stored.name ? { name: phase.name.trim() } : {}),
      ...(phase.closingMilestoneId !== stored.closingMilestoneId
        ? { closingMilestoneId: phase.closingMilestoneId }
        : {}),
    }
    return Object.keys(fields).length > 0
      ? [{ op: 'updatePhase', number: phase.number, fields }]
      : []
  })
  const problems = draft.some((phase) => phase.name.trim() === '')
    ? ['Every phase needs a name.']
    : []
  const last = roadmap.phases.at(-1)
  const lastIsEmpty = last !== undefined && !state.items.some((item) => item.phase === last.number)

  return (
    <Section
      title="Phases"
      intro="A phase closes on its closing milestone: the next one waits on it."
      saver={saver}
      dirty={edits.length > 0}
      problems={problems}
      onReset={() => setDraft(initial)}
      onSave={() => void saver.save(edits)}
    >
      <ol className="settings-rows">
        {draft.map((phase, index) => (
          <li key={phase.number} className="settings-row settings-phase">
            <span className="settings-number">{phase.number}</span>
            <input
              aria-label={`Name of phase ${phase.number}`}
              value={phase.name}
              disabled={saver.busy}
              onChange={(event) =>
                setDraft(
                  draft.map((each, at) =>
                    at === index ? { ...each, name: event.target.value } : each,
                  ),
                )
              }
            />
            <select
              aria-label={`Closing milestone of phase ${phase.number}`}
              value={phase.closingMilestoneId ?? ''}
              disabled={saver.busy}
              onChange={(event) =>
                setDraft(
                  draft.map((each, at) =>
                    at === index
                      ? {
                          ...each,
                          closingMilestoneId: event.target.value || null,
                        }
                      : each,
                  ),
                )
              }
            >
              <option value="">Closes on nothing</option>
              {state.items
                .filter((item) => item.phase === phase.number)
                .sort((a, b) => a.sortOrder - b.sortOrder)
                .map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
            </select>
            {phase.number === last?.number && (
              <button
                type="button"
                className="chip-remove"
                aria-label={`Remove phase ${phase.number}`}
                title={lastIsEmpty ? 'Remove this phase' : 'Move or delete its items first'}
                disabled={saver.busy || !lastIsEmpty || edits.length > 0}
                onClick={() => void saver.save([{ op: 'removePhase', number: phase.number }])}
              >
                ×
              </button>
            )}
          </li>
        ))}
      </ol>
      {roadmap.phases.length < 6 && edits.length === 0 && (
        <div className="settings-add">
          <input
            aria-label="Name of the new phase"
            value={newPhase}
            placeholder="A new phase after the last"
            disabled={saver.busy}
            onChange={(event) => setNewPhase(event.target.value)}
          />
          <button
            type="button"
            className="button"
            disabled={saver.busy || newPhase.trim() === ''}
            onClick={async () => {
              if (await saver.save([{ op: 'addPhase', name: newPhase.trim() }])) setNewPhase('')
            }}
          >
            Add phase
          </button>
        </div>
      )}
    </Section>
  )
}

/**
 * The days nothing is studied. By default the plan keeps its study days around
 * a change: a new pause pushes every unfinished item after it by its length,
 * and the preview says how many move before anything is saved.
 */
export function PausesSettings({ state, saver }: { state: AppState; saver: Saver }) {
  const { roadmap } = state
  const initial = roadmap.blackouts.map((blackout) => ({ ...blackout }))
  const [draft, setDraft] = useState<Blackout[]>(initial)
  const [keep, setKeep] = useState(true)

  const sorted = [...draft].sort((a, b) => a.from.localeCompare(b.from))
  const problems = [
    ...(draft.some((blackout) => blackout.reason.trim() === '')
      ? ['Every pause needs a reason.']
      : []),
    ...(draft.some((blackout) => blackout.to < blackout.from)
      ? ['A pause cannot end before it starts.']
      : []),
    ...(sorted.some((blackout, index) => index > 0 && blackout.from <= sorted[index - 1]!.to)
      ? ['Two pauses overlap.']
      : []),
  ]
  const dirty = JSON.stringify(sorted) !== JSON.stringify(initial)
  // The same function the server runs, so the count is what the save moves.
  const moving =
    dirty && problems.length === 0 && keep
      ? keepStudyDays(state, roadmap.blackouts, sorted).filter(
          (item, index) => item.baselineStartDate !== state.items[index]?.baselineStartDate,
        ).length
      : 0

  const update = (index: number, change: Partial<Blackout>) =>
    setDraft(draft.map((each, at) => (at === index ? { ...each, ...change } : each)))

  return (
    <Section
      title="Pauses"
      intro="Days with no study at all: holidays, a move, a new baby. Nothing is planned inside one."
      saver={saver}
      dirty={dirty}
      problems={problems}
      onReset={() => setDraft(initial)}
      onSave={() =>
        void saver.save([
          {
            op: 'setBlackouts',
            blackouts: sorted.map((blackout) => ({
              ...blackout,
              reason: blackout.reason.trim(),
            })),
            keepStudyDays: keep,
          },
        ])
      }
    >
      <ul className="settings-rows">
        {draft.map((blackout, index) => (
          <li key={index} className="settings-row settings-pause">
            <div className="form-dates">
              <DatePicker
                value={blackout.from}
                disabled={saver.busy}
                label={`First day of pause ${index + 1}`}
                onChange={(from) =>
                  update(index, {
                    from,
                    to: blackout.to < from ? from : blackout.to,
                  })
                }
              />
              <span className="faint">to</span>
              <DatePicker
                value={blackout.to}
                min={blackout.from}
                disabled={saver.busy}
                label={`Last day of pause ${index + 1}`}
                onChange={(to) => update(index, { to })}
              />
            </div>
            <input
              aria-label={`Reason for pause ${index + 1}`}
              value={blackout.reason}
              placeholder="Reason"
              disabled={saver.busy}
              onChange={(event) => update(index, { reason: event.target.value })}
            />
            <button
              type="button"
              className="chip-remove"
              aria-label={`Remove pause ${index + 1}`}
              title="Remove this pause"
              disabled={saver.busy}
              onClick={() => setDraft(draft.filter((_, at) => at !== index))}
            >
              ×
            </button>
          </li>
        ))}
      </ul>
      <button
        type="button"
        className="link-button"
        disabled={saver.busy}
        onClick={() => setDraft([...draft, newPause(state.today)])}
      >
        + Add a pause
      </button>
      {dirty && (
        <label className="settings-check">
          <input
            type="checkbox"
            checked={keep}
            disabled={saver.busy}
            onChange={(event) => setKeep(event.target.checked)}
          />
          <span>
            Keep the plan's study days: move unfinished items around the change
            {keep && problems.length === 0 && (
              <span className="muted">
                {' '}
                —{' '}
                {moving === 0
                  ? 'nothing moves'
                  : `${moving} ${moving === 1 ? 'item moves' : 'items move'}`}
              </span>
            )}
          </span>
        </label>
      )}
    </Section>
  )
}

function newPause(today: CivilDate): Blackout {
  return { from: today, to: addDays(today, 6), reason: '' }
}

function timeZones(): string[] {
  try {
    return Intl.supportedValuesOf('timeZone')
  } catch {
    return []
  }
}
