import { useEffect, useState, type DragEvent, type ReactNode } from 'react'
import {
  estimatedHours,
  hoursInWeek,
  progressHours,
  inWeek,
  sumHours,
  weekOf,
} from '../core/hours'
import { STATES } from '../core/constants'
import { BOARD_COLUMNS, groupByState, isOverdue, unfinishedDependencies } from '../core/selectors'
import type { Week } from '../core/hours'
import type { AppState, Task, Phase, Resource, State } from '../core/types'
import { linksOf, taskLabel, type TaskLabel } from '../core/stories'
import { dateRange } from './format'
import { TaskDetail } from './TaskDetail'
import { PartOf } from './PartOf'
import type { Store } from './useAppState'

const COLUMN_LABEL: Record<State, string> = {
  pending: 'Pending',
  in_progress: 'In progress',
  done: 'Done',
}

/**
 * The day-to-day surface, over the same `state` field as the backlog — never a
 * second source of truth.
 *
 * Scoped to the active phase and nothing else: no phase picker, because the
 * board is for the work in hand and the backlog is where you go to look around.
 * Inside Pending, what this week touches is separated from what comes later —
 * a week holds one to five tasks in this roadmap, too few to be a column of its
 * own, but the scope you actually plan against.
 *
 * The board still never blocks. A task started before its dependencies are
 * done is marked, not refused.
 */
export function Kanban({ state, pendingId, changeState, changeHours }: Store & { state: AppState }) {
  const [dragging, setDragging] = useState<Task | null>(null)
  const [over, setOver] = useState<State | null>(null)
  /** One card open at a time: the board stays a board and not a list of essays. */
  const [expanded, setExpanded] = useState<string | null>(null)
  const [collapsed, toggleColumn] = useCollapsed()

  const phase = activePhase(state)
  const tasks = state.tasks.filter((task) => phase === null || task.phase === phase.number)
  const columns = groupByState(tasks)

  const capacity = state.roadmap.weeklyHours
  // Before the plan starts, the current week ends before any of it: showing that
  // week is correct and useless. The scope is then the week the plan begins.
  const anchor =
    state.roadmap.startDate !== '' && state.today < state.roadmap.startDate
      ? state.roadmap.startDate
      : state.today
  const week = weekOf(anchor, capacity)
  const started = anchor === state.today
  const thisWeek = new Set(inWeek(tasks, week).map((task) => task.id))
  const names = new Map(state.tasks.map((task) => [task.id, task.name]))

  /**
   * One place builds a card, so the two groups inside Pending and the other two
   * columns cannot drift apart, and the groups do not have to carry every
   * callback down as a prop.
   */
  const card = (task: Task) => (
    <Card
      key={task.id}
      task={task}
      today={state.today}
      blockers={unfinishedDependencies(task, state.tasks)}
      part={taskLabel(task, state.stories, state.tasks)}
      links={linksOf(task, state.stories)}
      names={names}
      open={expanded === task.id}
      busy={pendingId === task.id}
      onToggle={() => setExpanded((current) => (current === task.id ? null : task.id))}
      onChange={(next) => changeState(task.id, next)}
      onHours={(hours) => changeHours(task.id, hours)}
      onDragStart={() => setDragging(task)}
      onDragEnd={() => {
        setDragging(null)
        setOver(null)
      }}
    />
  )

  /**
   * The dropped id comes from the drag payload, not from React state: the
   * browser carries it for exactly this, and reading it here means the drop
   * never depends on a re-render having landed between dragstart and drop.
   */
  function drop(event: DragEvent<HTMLDivElement>, column: State) {
    event.preventDefault()
    setDragging(null)
    setOver(null)
    const id = event.dataTransfer.getData('text/plain')
    const task = state.tasks.find((candidate) => candidate.id === id)
    if (task && task.state !== column) void changeState(task.id, column)
  }

  return (
    <section className="kanban">
      <h2 className="board-title">
        {phase ? `Phase ${phase.number} · ${phase.name}` : 'Everything'}
      </h2>

      <WeekPanel
        week={week}
        started={started}
        scheduled={hoursInWeek(tasks, week, state.roadmap.blackouts)}
      />

      <div className="board">
        {BOARD_COLUMNS.map((column) => (
          <div
            key={column}
            className={[
              'column',
              column,
              collapsed.has(column) ? 'collapsed' : '',
              over === column && dragging?.state !== column ? 'over' : '',
            ]
              .filter(Boolean)
              .join(' ')}
            onDragOver={(event) => {
              // Preventing the dragover default is what marks an element as a
              // valid drop target; without it the browser refuses the drop.
              event.preventDefault()
              setOver(column)
            }}
            onDragLeave={() => setOver((current) => (current === column ? null : current))}
            onDrop={(event) => drop(event, column)}
          >
            {/* The head folds the column on a narrow screen, where three
                columns stacked end to end are one very long scroll. Folded it
                still carries its counts, so folding costs no information. */}
            <header className="column-head">
              <button
                type="button"
                className="column-toggle"
                aria-expanded={!collapsed.has(column)}
                onClick={() => toggleColumn(column)}
              >
                <span className="disclosure" aria-hidden="true">
                  {collapsed.has(column) ? '\u25b8' : '\u25be'}
                </span>
                <span className="column-name">{COLUMN_LABEL[column]}</span>
              </button>
              <Totals tasks={columns[column].length} hours={sumHours(columns[column])} />
            </header>

            {collapsed.has(column) ? null : columns[column].length === 0 ? (
              <p className="column-empty">Nothing here.</p>
            ) : column === 'pending' ? (
              <Split
                tasks={columns[column]}
                thisWeek={thisWeek}
                week={week}
                state={state}
                card={card}
                collapsed={collapsed}
                onToggle={toggleColumn}
              />
            ) : (
              columns[column].map(card)
            )}
          </div>
        ))}
      </div>
    </section>
  )
}

const NARROW = '(max-width: 1024px)'
const COLLAPSED_KEY = 'planify.board.collapsed'

/**
 * Which sections start folded. On a narrow screen: what is finished, and what
 * comes after this week — the two that are furthest from today's work. On a wide
 * one, nothing: the columns sit side by side and cost nothing to leave open.
 *
 * The choice is remembered per device, like the phase list's.
 */
function useCollapsed(): [ReadonlySet<string>, (section: string) => void] {
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(() => {
    const stored = localStorage.getItem(COLLAPSED_KEY)
    if (stored !== null) return new Set(JSON.parse(stored) as string[])
    return window.matchMedia(NARROW).matches ? new Set(['done', 'later']) : new Set()
  })

  const toggle = (section: string) => {
    setCollapsed((current) => {
      const next = new Set(current)
      if (!next.delete(section)) next.add(section)
      localStorage.setItem(COLLAPSED_KEY, JSON.stringify([...next]))
      return next
    })
  }

  return [collapsed, toggle]
}

/**
 * Pending, cut in two: this week above the line, the rest of the phase below.
 * Both groups keep their heading even when empty — an empty "this week" is
 * information, not a reason to hide the label.
 */
function Split({
  tasks,
  thisWeek,
  week,
  state,
  card,
  collapsed,
  onToggle,
}: {
  tasks: Task[]
  thisWeek: Set<string>
  week: Week
  state: AppState
  card: (task: Task) => ReactNode
  collapsed: ReadonlySet<string>
  onToggle: (section: string) => void
}) {
  const now = tasks.filter((task) => thisWeek.has(task.id))
  const later = tasks.filter((task) => !thisWeek.has(task.id))

  return (
    <>
      {[
        {
          key: 'this-week',
          label: 'This week',
          group: now,
          empty: 'nothing scheduled this week',
          // The share of each task that actually lands in the week, so this
          // total and the one in the header are the same number.
          hours: hoursInWeek(now, week, state.roadmap.blackouts),
        },
        {
          key: 'later',
          label: 'Later in this phase',
          group: later,
          empty: 'nothing left after this week',
          hours: sumHours(later),
        },
      ].map(({ key, label, group, empty, hours }) => (
        <div key={key} className={collapsed.has(key) ? 'group collapsed' : 'group'}>
          <div className="group-head">
            <button
              type="button"
              className="group-toggle"
              aria-expanded={!collapsed.has(key)}
              onClick={() => onToggle(key)}
            >
              <span className="disclosure" aria-hidden="true">
                {collapsed.has(key) ? '\u25b8' : '\u25be'}
              </span>
              <span className="group-name">{label}</span>
            </button>
            <Totals tasks={group.length} hours={hours} />
          </div>
          {collapsed.has(key) ? null : group.length === 0 ? (
            <p className="column-empty">{empty}</p>
          ) : (
            group.map(card)
          )}
        </div>
      ))}
    </>
  )
}

/**
 * The week as its own panel rather than a line of subtitle: label above value,
 * and the one comparison that matters — scheduled against available — drawn as a
 * meter, because "7.6 of 15" is a ratio and a ratio is read faster as a bar.
 */
function WeekPanel({
  week,
  started,
  scheduled,
}: {
  week: Week
  started: boolean
  scheduled: number
}) {
  const declared = week.hours > 0
  const ratio = declared ? Math.min(scheduled / week.hours, 1) : 0
  const over = declared && scheduled > week.hours

  return (
    <div className="week-panel">
      <div className="stat">
        <div className="stat-label">Week</div>
        <div className="stat-value">{dateRange(week.from, week.to)}</div>
        <div className="stat-note">{started ? 'in progress' : 'the plan starts here'}</div>
      </div>

      <div className="stat">
        <div className="stat-label">Available</div>
        <div className="stat-value">{declared ? `${week.hours}h` : '—'}</div>
        <div className="stat-note">
          {declared ? 'this week' : 'no capacity declared'}
        </div>
      </div>

      <div className="stat">
        <div className="stat-label">Scheduled</div>
        <div className={over ? 'stat-value bad' : 'stat-value'}>{scheduled.toFixed(1)}h</div>
        <div className="stat-note">
          {declared ? (
            <>
              <div className="meter">
                <div
                  className={over ? 'meter-fill over' : 'meter-fill'}
                  style={{ width: `${Math.round(ratio * 100)}%` }}
                />
              </div>
              {Math.round((scheduled / week.hours) * 100)}% of the week
            </>
          ) : (
            'nothing to compare against'
          )}
        </div>
      </div>
    </div>
  )
}

/** Two labelled numbers, inline: the recommended shape for secondary figures. */
function Totals({ tasks, hours }: { tasks: number; hours: number }) {
  return (
    <span className="totals">
      <span className="total">
        <span className="total-label">Tasks</span> {tasks}
      </span>
      <span className="total">
        <span className="total-label">Hours</span> {hours.toFixed(1)}h
      </span>
    </span>
  )
}

function Card({
  task,
  today,
  blockers,
  part,
  links,
  names,
  open,
  busy,
  onToggle,
  onChange,
  onHours,
  onDragStart,
  onDragEnd,
}: {
  task: Task
  today: string
  blockers: Task[]
  part: TaskLabel | null
  links: { link: string | null; resources: Resource[] }
  names: Map<string, string>
  open: boolean
  busy: boolean
  onToggle: () => void
  onChange: (next: State) => void
  onHours: (hours: number) => void
  onDragStart: () => void
  onDragEnd: () => void
}) {
  const late = isOverdue(task, today)
  const hours = estimatedHours(task)
  const done = progressHours(task)
  // Started or finished with dependencies still open. Reported, never refused.
  const outOfOrder = task.state !== 'pending' && blockers.length > 0

  return (
    <article
      className={[
        'card',
        task.state,
        busy ? 'busy' : '',
        outOfOrder ? 'out-of-order' : '',
        open ? 'open' : '',
      ]
        .filter(Boolean)
        .join(' ')}
      draggable={!busy}
      onDragStart={(event) => {
        // Firefox only starts a drag when the event carries data.
        event.dataTransfer.setData('text/plain', task.id)
        event.dataTransfer.effectAllowed = 'move'
        onDragStart()
      }}
      onDragEnd={onDragEnd}
    >
      <div className="card-head">
        {part?.story.type && <span className="type-tag">{part.story.type}</span>}
        <span className="card-hours">
          {hours === null ? 'no estimate' : done > 0 ? `${trim(done)} / ${trim(hours)}h` : `${trim(hours)}h`}
        </span>
        <span className={late ? 'card-date bad' : 'card-date'}>
          {task.state === 'done' ? 'ended' : 'ends'} {task.projectedEndDate}
        </span>
      </div>

      <button
        type="button"
        className="card-name"
        aria-expanded={open}
        aria-label={`Details of ${task.name}`}
        onClick={onToggle}
      >
        <span className="disclosure" aria-hidden="true">
          {open ? '\u25be' : '\u25b8'}
        </span>
        {task.name}
      </button>

      {task.doneWhen && !open && (
        <div className="card-done-when">
          <span className="card-done-label">Done when</span> {task.doneWhen}
        </div>
      )}
      {part && !open && <PartOf part={part} />}

      {/* Closed, the bar is the whole answer to "how far in am I?"; open, the
          field below is where that number is declared. */}
      {hours !== null && done > 0 && !open && (
        <div className="card-progress" title={`${trim(done)} of ${trim(hours)} hours`}>
          <div className="meter">
            <div className="meter-fill" style={{ width: `${Math.round((done / hours) * 100)}%` }} />
          </div>
        </div>
      )}

      {open && (
        <TaskDetail
          task={task}
          part={part}
          links={links}
          names={names}
          showResources
          showProgress={false}
        />
      )}

      {open && hours !== null && task.state !== 'done' && (
        <HoursEditor task={task} estimate={hours} done={done} busy={busy} onSave={onHours} />
      )}

      {/* Dragging a card needs a mouse. On a touch screen the same move is made
          by picking the state here, so the board works with a finger too. */}
      <select
        className={`card-state state-select ${task.state}`}
        value={task.state}
        disabled={busy}
        aria-label={`State of ${task.name}`}
        onChange={(event) => onChange(event.target.value as State)}
      >
        {STATES.map((candidate) => (
          <option key={candidate} value={candidate}>
            {COLUMN_LABEL[candidate]}
          </option>
        ))}
      </select>

      {blockers.length > 0 && (
        <div
          className={outOfOrder ? 'card-note warn' : 'card-note'}
          title={blockers.map((blocker) => blocker.name).join('\n')}
        >
          {outOfOrder ? 'started out of order — waiting on ' : 'depends on: '}
          {summarize(blockers)}
        </div>
      )}
    </article>
  )
}

/**
 * Hours spent, declared by hand. It never touches the state: finishing is a
 * separate decision, which is why this sits apart from the selector below it.
 *
 * The field is only offered where there is an estimate to be part of. An exam
 * has hours you sit, not hours you accumulate.
 */
function HoursEditor({
  task,
  estimate,
  done,
  busy,
  onSave,
}: {
  task: Task
  estimate: number
  done: number
  busy: boolean
  onSave: (hours: number) => void
}) {
  const [value, setValue] = useState(String(done))

  // A card that moves between columns keeps its component, so the field has to
  // follow the task it is showing rather than whatever was typed on the last one.
  useEffect(() => {
    setValue(String(done))
  }, [task.id, done])

  const parsed = Number(value.replace(',', '.'))
  const invalid = value.trim() === '' || !Number.isFinite(parsed) || parsed < 0
  const changed = !invalid && parsed !== done

  return (
    <div className="card-progress-edit">
      <label className="card-progress-label" htmlFor={`hours-${task.id}`}>
        Hours done
      </label>
      <input
        id={`hours-${task.id}`}
        type="number"
        inputMode="decimal"
        min={0}
        max={estimate}
        step={0.5}
        value={value}
        disabled={busy}
        onChange={(event) => setValue(event.target.value)}
      />
      <span className="card-progress-total">of {trim(estimate)}h</span>
      <button
        type="button"
        className="icon-button save"
        disabled={busy || invalid || !changed}
        title={`Declare the hours done on ${task.name}`}
        aria-label={`Declare the hours done on ${task.name}`}
        onClick={() => onSave(Math.min(parsed, estimate))}
      >
        ✓
      </button>
    </div>
  )
}

/**
 * Two names and a count, never the whole list: a phase-closing milestone depends
 * on everything before it, and printing all eight turns the card into the note.
 */
function summarize(blockers: Task[]): string {
  const shown = blockers.slice(0, 2).map((blocker) => blocker.name)
  const rest = blockers.length - shown.length
  return rest === 0 ? shown.join(' · ') : `${shown.join(' · ')} +${rest} more`
}

/**
 * The phase the board opens on: the first with work left. A finished phase is
 * never where the day-to-day happens.
 */
function activePhase(state: AppState): Phase | null {
  const open = state.roadmap.phases.find((phase) =>
    state.tasks.some((task) => task.phase === phase.number && task.state !== 'done'),
  )
  return open ?? state.roadmap.phases[state.roadmap.phases.length - 1] ?? null
}

function trim(hours: number): string {
  return Number.isInteger(hours) ? String(hours) : hours.toFixed(1)
}
