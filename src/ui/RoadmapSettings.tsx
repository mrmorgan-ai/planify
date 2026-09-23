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
function Section({
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
    return Object.keys(fields).length > 0 ? [{ op: 'updatePhase', number: phase.number, fields }] : []
  })
  const problems = draft.some((phase) => phase.name.trim() === '') ? ['Every phase needs a name.'] : []
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
                setDraft(draft.map((each, at) => (at === index ? { ...each, name: event.target.value } : each)))
              }
            />
            <select
              aria-label={`Closing milestone of phase ${phase.number}`}
              value={phase.closingMilestoneId ?? ''}
              disabled={saver.busy}
              onChange={(event) =>
                setDraft(
                  draft.map((each, at) =>
                    at === index ? { ...each, closingMilestoneId: event.target.value || null } : each,
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
    ...(draft.some((blackout) => blackout.reason.trim() === '') ? ['Every pause needs a reason.'] : []),
    ...(draft.some((blackout) => blackout.to < blackout.from) ? ['A pause cannot end before it starts.'] : []),
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
            blackouts: sorted.map((blackout) => ({ ...blackout, reason: blackout.reason.trim() })),
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
                onChange={(from) => update(index, { from, to: blackout.to < from ? from : blackout.to })}
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
          <input type="checkbox" checked={keep} disabled={saver.busy} onChange={(event) => setKeep(event.target.checked)} />
          <span>
            Keep the plan's study days: move unfinished items around the change
            {keep && problems.length === 0 && (
              <span className="muted">
                {' '}
                — {moving === 0 ? 'nothing moves' : `${moving} ${moving === 1 ? 'item moves' : 'items move'}`}
              </span>
            )}
          </span>
        </label>
      )}
    </Section>
  )
}

type AxisDraft = { key: string; name: string }
type SkillDraft = { key: string; original: string | null; name: string; axis: string }

/**
 * The radar's axes and the skills on each. A skill's new name follows it into
 * every item that uses it; a skill still in use cannot be removed, and neither
 * can an axis that still holds skills.
 */
export function SkillsSettings({ state, saver }: { state: AppState; saver: Saver }) {
  const { roadmap } = state
  const initial = useMemo(() => {
    const axes = roadmap.dimensions.map((name) => ({ key: name, name }))
    const skills = Object.entries(roadmap.skillDimension)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([name, axis]) => ({ key: name, original: name, name, axis }))
    return { axes, skills }
  }, [roadmap.dimensions, roadmap.skillDimension])
  const [axes, setAxes] = useState<AxisDraft[]>(initial.axes)
  const [skills, setSkills] = useState<SkillDraft[]>(initial.skills)
  const [adding, setAdding] = useState<Record<string, string>>({})
  const [newAxis, setNewAxis] = useState('')

  const uses = useMemo(() => {
    const count = new Map<string, number>()
    for (const item of state.items) for (const skill of item.skills) count.set(skill, (count.get(skill) ?? 0) + 1)
    return count
  }, [state.items])

  const axisName = new Map(axes.map((axis) => [axis.key, axis.name.trim()]))
  const dimensions = axes.map((axis) => axis.name.trim())
  const map = Object.fromEntries(skills.map((skill) => [skill.name.trim(), axisName.get(skill.axis) ?? '']))
  const renamed = Object.fromEntries(
    skills
      .filter((skill) => skill.original !== null && skill.original !== skill.name.trim())
      .map((skill) => [skill.original!, skill.name.trim()]),
  )
  const dirty =
    JSON.stringify(dimensions) !== JSON.stringify(roadmap.dimensions) ||
    JSON.stringify(Object.entries(map).sort()) !== JSON.stringify(Object.entries(roadmap.skillDimension).sort())
  const problems = [
    ...(dimensions.some((name) => name === '') || skills.some((skill) => skill.name.trim() === '')
      ? ['Every axis and skill needs a name.']
      : []),
    ...(new Set(dimensions).size !== dimensions.length ? ['Two axes have the same name.'] : []),
    ...(new Set(skills.map((skill) => skill.name.trim())).size !== skills.length
      ? ['Two skills have the same name.']
      : []),
  ]

  const move = (index: number, by: number) => {
    const next = [...axes]
    const [axis] = next.splice(index, 1)
    next.splice(index + by, 0, axis!)
    setAxes(next)
  }

  return (
    <Section
      title="Skills"
      intro="The radar's axes, and the skills each item feeds. Renaming a skill renames it in every item."
      saver={saver}
      dirty={dirty}
      problems={problems}
      onReset={() => {
        setAxes(initial.axes)
        setSkills(initial.skills)
      }}
      onSave={() => void saver.save([{ op: 'setSkillMap', dimensions, skills: map, renamed }])}
    >
      {axes.map((axis, index) => {
        const onAxis = skills.filter((skill) => skill.axis === axis.key)
        return (
          <div key={axis.key} className="axis">
            <div className="settings-row settings-axis-line">
              <input
                aria-label={`Name of axis ${index + 1}`}
                className="axis-name"
                value={axis.name}
                disabled={saver.busy}
                onChange={(event) =>
                  setAxes(axes.map((each) => (each.key === axis.key ? { ...each, name: event.target.value } : each)))
                }
              />
              <button type="button" className="icon-button" aria-label={`Move ${axis.name} up`} disabled={saver.busy || index === 0} onClick={() => move(index, -1)}>
                ↑
              </button>
              <button type="button" className="icon-button" aria-label={`Move ${axis.name} down`} disabled={saver.busy || index === axes.length - 1} onClick={() => move(index, 1)}>
                ↓
              </button>
              <button
                type="button"
                className="chip-remove"
                aria-label={`Remove axis ${axis.name}`}
                title={onAxis.length > 0 ? 'Move or remove its skills first' : 'Remove this axis'}
                disabled={saver.busy || onAxis.length > 0 || axes.length === 1}
                onClick={() => setAxes(axes.filter((each) => each.key !== axis.key))}
              >
                ×
              </button>
            </div>
            <ul className="settings-rows skills-list">
              {onAxis.map((skill) => {
                const used = skill.original === null ? 0 : (uses.get(skill.original) ?? 0)
                return (
                  <li key={skill.key} className="settings-row settings-skill">
                    <input
                      aria-label={`Skill ${skill.name}`}
                      value={skill.name}
                      disabled={saver.busy}
                      onChange={(event) =>
                        setSkills(skills.map((each) => (each.key === skill.key ? { ...each, name: event.target.value } : each)))
                      }
                    />
                    <select
                      aria-label={`Axis of ${skill.name}`}
                      value={skill.axis}
                      disabled={saver.busy}
                      onChange={(event) =>
                        setSkills(skills.map((each) => (each.key === skill.key ? { ...each, axis: event.target.value } : each)))
                      }
                    >
                      {axes.map((each) => (
                        <option key={each.key} value={each.key}>
                          {each.name}
                        </option>
                      ))}
                    </select>
                    <span className="faint skill-uses">{used === 0 ? 'unused' : `${used} ${used === 1 ? 'item' : 'items'}`}</span>
                    <button
                      type="button"
                      className="chip-remove"
                      aria-label={`Remove skill ${skill.name}`}
                      title={used > 0 ? `Used by ${used} ${used === 1 ? 'item' : 'items'}` : 'Remove this skill'}
                      disabled={saver.busy || used > 0}
                      onClick={() => setSkills(skills.filter((each) => each.key !== skill.key))}
                    >
                      ×
                    </button>
                  </li>
                )
              })}
            </ul>
            <div className="settings-add">
              <input
                aria-label={`New skill on ${axis.name}`}
                value={adding[axis.key] ?? ''}
                placeholder="A new skill"
                disabled={saver.busy}
                onChange={(event) => setAdding({ ...adding, [axis.key]: event.target.value })}
              />
              <button
                type="button"
                className="button"
                disabled={saver.busy || (adding[axis.key] ?? '').trim() === ''}
                onClick={() => {
                  const name = (adding[axis.key] ?? '').trim()
                  setSkills([...skills, { key: `new:${name}:${skills.length}`, original: null, name, axis: axis.key }])
                  setAdding({ ...adding, [axis.key]: '' })
                }}
              >
                Add skill
              </button>
            </div>
          </div>
        )
      })}
      <div className="settings-add">
        <input
          aria-label="Name of a new axis"
          value={newAxis}
          placeholder="A new axis"
          disabled={saver.busy}
          onChange={(event) => setNewAxis(event.target.value)}
        />
        <button
          type="button"
          className="button"
          disabled={saver.busy || newAxis.trim() === ''}
          onClick={() => {
            setAxes([...axes, { key: `new:${newAxis.trim()}:${axes.length}`, name: newAxis.trim() }])
            setNewAxis('')
          }}
        >
          Add axis
        </button>
      </div>
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
