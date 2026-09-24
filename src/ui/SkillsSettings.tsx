import { useMemo, useRef, useState, type DragEvent } from 'react'
import type { AppState } from '../core/types'
import { Section, type Saver } from './RoadmapSettings'

type AxisDraft = { key: string; name: string }
type SkillDraft = {
  key: string
  original: string | null
  name: string
  axis: string
}

/** What a dragged chip carries, so a drop from anywhere else is ignored. */
const DRAG_TYPE = 'application/x-planify-skill'

/**
 * The radar's axes and the skills on each, as one card per axis with a chip per
 * skill. There are dozens of skills, so they are read at a glance and edited one
 * at a time: choosing a chip opens its name, its axis and its removal. Dragging
 * a chip onto another card moves it there.
 *
 * A skill's new name follows it into every item that uses it; a skill still in
 * use cannot be removed, and neither can an axis that still holds skills.
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
  const [selected, setSelected] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [unusedOnly, setUnusedOnly] = useState(false)
  const [over, setOver] = useState<string | null>(null)
  /** Keys for skills and axes not saved yet, unique however many come and go. */
  const created = useRef(0)

  const uses = useMemo(() => {
    const count = new Map<string, number>()
    for (const item of state.items)
      for (const skill of item.skills) count.set(skill, (count.get(skill) ?? 0) + 1)
    return count
  }, [state.items])
  const usedBy = (skill: SkillDraft) =>
    skill.original === null ? 0 : (uses.get(skill.original) ?? 0)

  const axisName = new Map(axes.map((axis) => [axis.key, axis.name.trim()]))
  const dimensions = axes.map((axis) => axis.name.trim())
  const map = Object.fromEntries(
    skills.map((skill) => [skill.name.trim(), axisName.get(skill.axis) ?? '']),
  )
  const renamed = Object.fromEntries(
    skills
      .filter((skill) => skill.original !== null && skill.original !== skill.name.trim())
      .map((skill) => [skill.original!, skill.name.trim()]),
  )
  const dirty =
    JSON.stringify(dimensions) !== JSON.stringify(roadmap.dimensions) ||
    JSON.stringify(Object.entries(map).sort()) !==
      JSON.stringify(Object.entries(roadmap.skillDimension).sort())
  const problems = [
    ...(dimensions.some((name) => name === '') || skills.some((skill) => skill.name.trim() === '')
      ? ['Every axis and skill needs a name.']
      : []),
    ...(new Set(dimensions).size !== dimensions.length ? ['Two axes have the same name.'] : []),
    ...(new Set(skills.map((skill) => skill.name.trim())).size !== skills.length
      ? ['Two skills have the same name.']
      : []),
  ]

  const needle = query.trim().toLowerCase()
  const filtering = needle !== '' || unusedOnly
  const shows = (skill: SkillDraft) =>
    (needle === '' || skill.name.toLowerCase().includes(needle)) &&
    (!unusedOnly || usedBy(skill) === 0)
  const unused = skills.filter((skill) => usedBy(skill) === 0).length
  /** New, renamed or moved since the last save: what Save would write. */
  const changed = (skill: SkillDraft) =>
    skill.original === null ||
    skill.name.trim() !== skill.original ||
    skill.axis !== roadmap.skillDimension[skill.original]

  const updateSkill = (key: string, change: Partial<SkillDraft>) =>
    setSkills(skills.map((each) => (each.key === key ? { ...each, ...change } : each)))

  function addSkill(axis: string) {
    const name = (adding[axis] ?? '').trim()
    if (name === '') return
    setSkills([...skills, { key: `new:${created.current++}`, original: null, name, axis }])
    setAdding({ ...adding, [axis]: '' })
  }

  function addAxis() {
    const name = newAxis.trim()
    if (name === '') return
    setAxes([...axes, { key: `new:${created.current++}`, name }])
    setNewAxis('')
  }

  function drop(event: DragEvent, axis: string) {
    const key = event.dataTransfer.getData(DRAG_TYPE)
    setOver(null)
    if (key) {
      event.preventDefault()
      updateSkill(key, { axis })
    }
  }

  return (
    <Section
      title="Skills"
      intro="The radar's axes, and the skills each item feeds. Choose a skill to rename, move or remove it; renaming a skill renames it in every item."
      saver={saver}
      dirty={dirty}
      problems={problems}
      onReset={() => {
        setAxes(initial.axes)
        setSkills(initial.skills)
        setSelected(null)
      }}
      onSave={() => void saver.save([{ op: 'setSkillMap', dimensions, skills: map, renamed }])}
    >
      <div className="skills-toolbar">
        <input
          type="search"
          className="skills-search"
          aria-label="Find a skill"
          placeholder="Find a skill"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        <button
          type="button"
          className={unusedOnly ? 'chip active' : 'chip'}
          aria-pressed={unusedOnly}
          onClick={() => setUnusedOnly(!unusedOnly)}
        >
          Unused <span className="count">{unused}</span>
        </button>
        <span className="faint skills-summary">
          {skills.length} {skills.length === 1 ? 'skill' : 'skills'} on {axes.length}{' '}
          {axes.length === 1 ? 'axis' : 'axes'}
        </span>
      </div>

      <div className="axis-cards">
        {axes.map((axis, index) => {
          const onAxis = skills.filter((skill) => skill.axis === axis.key)
          const shown = onAxis.filter(shows)
          const editing = onAxis.find((skill) => skill.key === selected)
          if (filtering && shown.length === 0 && !editing) return null
          return (
            <div
              key={axis.key}
              className={over === axis.key ? 'axis-card over' : 'axis-card'}
              onDragOver={(event) => {
                if (!event.dataTransfer.types.includes(DRAG_TYPE)) return
                event.preventDefault()
                event.dataTransfer.dropEffect = 'move'
                if (over !== axis.key) setOver(axis.key)
              }}
              onDragLeave={(event) => {
                if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setOver(null)
              }}
              onDrop={(event) => drop(event, axis.key)}
            >
              <div className="axis-card-head">
                <input
                  aria-label={`Name of axis ${index + 1}`}
                  className="axis-name"
                  value={axis.name}
                  disabled={saver.busy}
                  onChange={(event) =>
                    setAxes(
                      axes.map((each) =>
                        each.key === axis.key ? { ...each, name: event.target.value } : each,
                      ),
                    )
                  }
                />
                <span className="count">{onAxis.length}</span>
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

              {shown.length > 0 ? (
                <ul className="skill-chips">
                  {shown.map((skill) => {
                    const used = usedBy(skill)
                    const classes = [
                      'skill-chip',
                      used === 0 && 'unused',
                      changed(skill) && 'changed',
                      skill.key === selected && 'selected',
                    ]
                    return (
                      <li key={skill.key}>
                        <button
                          type="button"
                          className={classes.filter(Boolean).join(' ')}
                          aria-expanded={skill.key === selected}
                          title={used === 0 ? 'Not used by any item' : `Used by ${used}`}
                          draggable={!saver.busy}
                          onDragStart={(event) => {
                            event.dataTransfer.setData(DRAG_TYPE, skill.key)
                            event.dataTransfer.effectAllowed = 'move'
                          }}
                          onDragEnd={() => setOver(null)}
                          onClick={() => setSelected(skill.key === selected ? null : skill.key)}
                        >
                          {skill.name.trim() || <span className="faint">No name</span>}
                          <span className="count">{used}</span>
                        </button>
                      </li>
                    )
                  })}
                </ul>
              ) : (
                <p className="faint skills-empty">No skills yet.</p>
              )}

              {editing && (
                <SkillEditor
                  skill={editing}
                  used={usedBy(editing)}
                  axes={axes}
                  busy={saver.busy}
                  onChange={(change) => updateSkill(editing.key, change)}
                  onRemove={() => {
                    setSkills(skills.filter((each) => each.key !== editing.key))
                    setSelected(null)
                  }}
                  onClose={() => setSelected(null)}
                />
              )}

              <form
                className="settings-add"
                onSubmit={(event) => {
                  event.preventDefault()
                  addSkill(axis.key)
                }}
              >
                <input
                  aria-label={`New skill on ${axis.name}`}
                  value={adding[axis.key] ?? ''}
                  placeholder="Add a skill"
                  disabled={saver.busy}
                  onChange={(event) => setAdding({ ...adding, [axis.key]: event.target.value })}
                />
                <button
                  type="submit"
                  className="button"
                  disabled={saver.busy || (adding[axis.key] ?? '').trim() === ''}
                >
                  Add
                </button>
              </form>
            </div>
          )
        })}

        {filtering && skills.every((skill) => !shows(skill)) && (
          <p className="muted">No skill matches.</p>
        )}

        {!filtering && (
          <form
            className="axis-card axis-card-new"
            onSubmit={(event) => {
              event.preventDefault()
              addAxis()
            }}
          >
            <div className="settings-add">
              <input
                aria-label="Name of a new axis"
                value={newAxis}
                placeholder="A new axis"
                disabled={saver.busy}
                onChange={(event) => setNewAxis(event.target.value)}
              />
              <button
                type="submit"
                className="button"
                disabled={saver.busy || newAxis.trim() === ''}
              >
                Add axis
              </button>
            </div>
          </form>
        )}
      </div>
    </Section>
  )
}

/**
 * The one skill being edited: its name, the axis it sits on, and its removal,
 * which waits until no item uses it. The axis list is the way to move a skill
 * where dragging is not available, as on a phone.
 */
function SkillEditor({
  skill,
  used,
  axes,
  busy,
  onChange,
  onRemove,
  onClose,
}: {
  skill: SkillDraft
  used: number
  axes: AxisDraft[]
  busy: boolean
  onChange: (change: Partial<SkillDraft>) => void
  onRemove: () => void
  onClose: () => void
}) {
  return (
    <div
      className="skill-editor"
      onKeyDown={(event) => {
        // Enter only from the name: on a button it has to press that button.
        const typing = event.target instanceof HTMLInputElement
        if (event.key === 'Escape' || (event.key === 'Enter' && typing)) onClose()
      }}
    >
      <label className="settings-field">
        <span>Name</span>
        <input
          autoFocus
          value={skill.name}
          disabled={busy}
          onChange={(event) => onChange({ name: event.target.value })}
        />
      </label>
      <label className="settings-field">
        <span>Axis</span>
        <select
          value={skill.axis}
          disabled={busy}
          onChange={(event) => onChange({ axis: event.target.value })}
        >
          {axes.map((each) => (
            <option key={each.key} value={each.key}>
              {each.name}
            </option>
          ))}
        </select>
      </label>
      <div className="skill-editor-foot">
        <span className="faint">
          {used === 0 ? 'Not used by any item' : `Used by ${used} ${used === 1 ? 'item' : 'items'}`}
          {skill.original !== null && skill.name.trim() !== skill.original && (
            <> · was {skill.original}</>
          )}
        </span>
        <button
          type="button"
          className="button"
          title={used > 0 ? 'Take it off its items first' : 'Remove this skill'}
          disabled={busy || used > 0}
          onClick={onRemove}
        >
          Remove
        </button>
        <button type="button" className="button" onClick={onClose}>
          Done
        </button>
      </div>
    </div>
  )
}
