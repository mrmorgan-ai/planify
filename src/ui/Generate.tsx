import { useId, useState } from 'react'
import {
  COURSE_TYPES,
  GENERATOR_KINDS,
  parseTaskLines,
  type GenerateRequest,
  type GeneratorKind,
  type Placed,
} from '../core/generate'
import type { AppState, CivilDate, PhaseNumber } from '../core/types'
import { StaleStateError, previewGenerate, type GeneratePreview } from './api'
import { ChangeReview, type ReviewWords } from './ChangeReview'
import { DatePicker } from './DatePicker'
import { dateRange } from './format'
import { Field, SkillPicker } from './ItemForm'

const KIND_LABEL: Record<GeneratorKind, string> = {
  course: 'Course',
  certification: 'Certification',
  project: 'Project',
  practice: 'Practice',
}

const KIND_HELP: Record<GeneratorKind, string> = {
  course:
    'A part a week, each holding what your capacity leaves free that week, up to the pace you set.',
  certification:
    'The prep a part a week, like a course, then the exam on the first day with room or on the day you pick.',
  project: 'Tasks one after another, each in the first week with room for its hours.',
  practice: 'One block a week, at the end of the week, in the next weeks with room.',
}

const GENERATE_WORDS: ReviewWords = {
  subject: 'This',
  apply: 'Add them',
  applying: 'Adding…',
  after: 'after adding them',
  fix: () => 'Change the answers above:',
}

/** Every answer the forms ask for, as the inputs hold them. Kept across kinds. */
type Answers = {
  name: string
  phase: PhaseNumber
  skills: string[]
  /** Empty for nothing. */
  after: string
  from: CivilDate
  link: string
  type: (typeof COURSE_TYPES)[number]
  hours: string
  weeklyHours: string
  price: string
  prepHours: string
  prepDoneWhen: string
  examHours: string
  examOnDay: boolean
  examDate: CivilDate
  doneWhen: string
  tasks: string
  blockHours: string
  weeks: string
}

type Review =
  | { kind: 'checking' }
  | { kind: 'failed'; message: string }
  | { kind: 'ready'; request: GenerateRequest; preview: GeneratePreview }

/**
 * Adds a whole course, certification, project or run of practice blocks at
 * once, placed by the server in the hours the plan leaves free. What it would add
 * is previewed first — the items with their dates, and what they change — and
 * nothing is written until the person confirms.
 */
export function GeneratePanel({
  state,
  phase,
  draft,
  error,
  generate,
  onCancel,
  onDone,
}: {
  state: AppState
  phase: PhaseNumber
  /** Place them in the draft rather than the live roadmap. */
  draft: boolean
  /** The server's answer to the last attempt to add them, when it refused it. */
  error: string | null
  generate: (generator: GenerateRequest, revision: number) => Promise<boolean>
  onCancel: () => void
  onDone: (placed: Placed[], phase: PhaseNumber) => void
}) {
  const id = useId()
  const { roadmap } = state
  const [kind, setKind] = useState<GeneratorKind>('course')
  const [answers, setAnswers] = useState<Answers>(() => blankAnswers(state, phase))
  const [review, setReview] = useState<Review | null>(null)
  const [busy, setBusy] = useState(false)
  const [refused, setRefused] = useState(false)

  const set = <K extends keyof Answers>(key: K, value: Answers[K]) => {
    setAnswers((current) => ({ ...current, [key]: value }))
    // A preview answers the questions as they were.
    setReview(null)
    setRefused(false)
  }
  const { request, problems } = requestOf(kind, answers)
  const capacity = roadmap.weeklyHours.normal

  async function check(request: GenerateRequest) {
    setReview({ kind: 'checking' })
    setRefused(false)
    try {
      let preview: GeneratePreview
      try {
        preview = await previewGenerate(request, state.revision, draft)
      } catch (cause: unknown) {
        // Another device changed the roadmap: place them in it as it is now.
        if (!(cause instanceof StaleStateError)) throw cause
        preview = await previewGenerate(request, cause.state.revision, draft)
      }
      setReview({ kind: 'ready', request, preview })
    } catch (cause: unknown) {
      setReview({
        kind: 'failed',
        message: cause instanceof Error ? cause.message : 'Unknown error',
      })
    }
  }

  async function apply(request: GenerateRequest, preview: GeneratePreview) {
    setBusy(true)
    const done = await generate(request, preview.revision)
    setBusy(false)
    if (done) onDone(preview.placed, request.phase)
    else {
      setReview(null)
      setRefused(true)
    }
  }

  const input = (
    key: keyof Answers,
    props: { label: string; placeholder?: string; type?: string },
  ) => (
    <Field label={props.label} htmlFor={`${id}-${key}`}>
      <input
        id={`${id}-${key}`}
        type={props.type ?? 'text'}
        min={props.type === 'number' ? 0 : undefined}
        step={props.type === 'number' ? 'any' : undefined}
        value={String(answers[key])}
        placeholder={props.placeholder}
        disabled={busy}
        onChange={(event) => set(key, event.target.value as never)}
      />
    </Field>
  )
  const textarea = (
    key: 'prepDoneWhen' | 'doneWhen' | 'tasks',
    label: string,
    placeholder: string,
    rows = 2,
  ) => (
    <Field label={label} htmlFor={`${id}-${key}`}>
      <textarea
        id={`${id}-${key}`}
        value={answers[key]}
        rows={rows}
        placeholder={placeholder}
        disabled={busy}
        onChange={(event) => set(key, event.target.value)}
      />
    </Field>
  )

  return (
    <div className="new-item generate">
      <h3>Generate</h3>
      <div className="filters" role="group" aria-label="What to generate">
        {GENERATOR_KINDS.map((candidate) => (
          <button
            key={candidate}
            type="button"
            className={candidate === kind ? 'chip active' : 'chip'}
            aria-pressed={candidate === kind}
            disabled={busy}
            onClick={() => {
              setKind(candidate)
              setReview(null)
            }}
          >
            {KIND_LABEL[candidate]}
          </button>
        ))}
      </div>
      <p className="muted generate-help">{KIND_HELP[kind]}</p>

      <form
        className="item-form"
        onSubmit={(event) => {
          event.preventDefault()
          if (request) void check(request)
        }}
      >
        {input('name', { label: 'Name' })}

        {kind === 'course' && (
          <Field label="Type" htmlFor={`${id}-type`}>
            <select
              id={`${id}-type`}
              value={answers.type}
              disabled={busy}
              onChange={(event) => set('type', event.target.value as Answers['type'])}
            >
              {COURSE_TYPES.map((type) => (
                <option key={type}>{type}</option>
              ))}
            </select>
          </Field>
        )}
        {kind === 'course' && input('hours', { label: 'Hours in all', type: 'number' })}
        {kind === 'course' &&
          input('weeklyHours', {
            label: 'Most a week',
            type: 'number',
            placeholder: `Of ${capacity}h`,
          })}

        {kind === 'certification' &&
          input('prepHours', { label: 'Prep hours', type: 'number', placeholder: '0 for none' })}
        {kind === 'certification' &&
          input('weeklyHours', {
            label: 'Prep a week',
            type: 'number',
            placeholder: `Of ${capacity}h`,
          })}
        {kind === 'certification' &&
          textarea('prepDoneWhen', 'Prep done when', 'Scored 80% on a full practice exam')}
        {kind === 'certification' && input('examHours', { label: 'Exam hours', type: 'number' })}
        {kind === 'certification' && (
          <Field label="Exam day">
            <div className="form-dates">
              <label className="generate-toggle">
                <input
                  type="checkbox"
                  checked={answers.examOnDay}
                  disabled={busy}
                  onChange={(event) => set('examOnDay', event.target.checked)}
                />
                On a day I pick
              </label>
              {answers.examOnDay && (
                <DatePicker
                  value={answers.examDate}
                  min={answers.from}
                  disabled={busy}
                  label="Day of the exam"
                  onChange={(day) => set('examDate', day)}
                />
              )}
            </div>
          </Field>
        )}
        {kind === 'certification' && input('price', { label: 'Price', placeholder: 'Free' })}

        {kind === 'project' &&
          textarea(
            'tasks',
            'Tasks',
            'One a line, with its hours:\nSet up the repo, 2h\nBuild the API, 4h',
            5,
          )}
        {kind === 'project' &&
          textarea('doneWhen', 'Done when', 'What finishing the whole project produces')}

        {kind === 'practice' && input('blockHours', { label: 'Hours a block', type: 'number' })}
        {kind === 'practice' && input('weeks', { label: 'Weeks', type: 'number' })}
        {kind === 'practice' &&
          textarea(
            'doneWhen',
            'Done when',
            'What each block produces, stated so it can be checked',
          )}

        {kind !== 'practice' &&
          input('link', { label: 'Link', type: 'url', placeholder: 'https://…' })}

        <Field label="Skills">
          <SkillPicker
            roadmap={roadmap}
            skills={answers.skills}
            disabled={busy}
            onChange={(skills) => set('skills', skills)}
          />
        </Field>

        <Field label="Phase" htmlFor={`${id}-phase`}>
          <select
            id={`${id}-phase`}
            value={answers.phase}
            disabled={busy}
            onChange={(event) => {
              const next = Number(event.target.value) as PhaseNumber
              set('phase', next)
              set('after', lastOf(state, next))
            }}
          >
            {roadmap.phases.map((each) => (
              <option key={each.number} value={each.number}>
                Phase {each.number} · {each.name}
              </option>
            ))}
          </select>
        </Field>

        <Field label="Starts after" htmlFor={`${id}-after`}>
          <select
            id={`${id}-after`}
            value={answers.after}
            disabled={busy}
            onChange={(event) => set('after', event.target.value)}
          >
            <option value="">Nothing — the first week with room</option>
            {roadmap.phases.map((each) => (
              <optgroup key={each.number} label={`Phase ${each.number} · ${each.name}`}>
                {state.items
                  .filter((item) => item.phase === each.number)
                  .sort((a, b) => a.sortOrder - b.sortOrder)
                  .map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.name}
                    </option>
                  ))}
              </optgroup>
            ))}
          </select>
        </Field>

        <Field label="Not before">
          <div className="form-dates">
            <DatePicker
              value={answers.from}
              min={state.today}
              disabled={busy}
              label="Earliest day the new items can start"
              onChange={(day) => set('from', day)}
            />
          </div>
        </Field>

        {problems.length > 0 && (
          <ul className="form-problems">
            {problems.map((problem) => (
              <li key={problem}>{problem}</li>
            ))}
          </ul>
        )}
        {refused && error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        {review?.kind === 'failed' && (
          <p className="form-error" role="alert">
            {review.message}
          </p>
        )}

        {review?.kind !== 'ready' && (
          <div className="form-actions">
            <button type="button" className="button" disabled={busy} onClick={onCancel}>
              Cancel
            </button>
            <button
              type="submit"
              className="button primary"
              disabled={busy || request === null || review?.kind === 'checking'}
            >
              {review?.kind === 'checking' ? 'Placing…' : 'Preview'}
            </button>
          </div>
        )}
      </form>

      {review?.kind === 'ready' && (
        <ChangeReview
          state={state}
          title={`${review.preview.placed.length} ${review.preview.placed.length === 1 ? 'item' : 'items'} to add`}
          source={{ items: review.preview.placed }}
          note={<PlacedList placed={review.preview.placed} />}
          preview={review.preview}
          busy={busy}
          words={GENERATE_WORDS}
          onCancel={() => setReview(null)}
          onApply={() => void apply(review.request, review.preview)}
        />
      )}
    </div>
  )
}

function PlacedList({ placed }: { placed: Placed[] }) {
  return (
    <table className="generated">
      <tbody>
        {placed.map((piece) => (
          <tr key={piece.id}>
            <td>{piece.name}</td>
            <td className="generated-when">{dateRange(piece.start, piece.end)}</td>
            <td className="generated-hours">{Math.round(piece.hours * 100) / 100}h</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

function blankAnswers(state: AppState, phase: PhaseNumber): Answers {
  const capacity = state.roadmap.weeklyHours.normal
  return {
    name: '',
    phase,
    skills: [],
    after: lastOf(state, phase),
    from: state.today,
    link: '',
    type: 'Course',
    hours: '',
    // A third of the week leaves room for what else the week holds.
    weeklyHours: capacity > 0 ? String(Math.max(1, Math.round(capacity / 3))) : '',
    price: '',
    prepHours: '',
    prepDoneWhen: '',
    examHours: '2',
    examOnDay: false,
    examDate: state.today,
    doneWhen: '',
    tasks: '',
    blockHours: '',
    weeks: '4',
  }
}

/** The phase's item that ends last: where new items most often go after. */
function lastOf(state: AppState, phase: PhaseNumber): string {
  const last = state.items
    .filter((item) => item.phase === phase)
    .reduce<AppState['items'][number] | null>(
      (latest, item) =>
        latest === null || item.baselineEndDate > latest.baselineEndDate ? item : latest,
      null,
    )
  return last?.id ?? ''
}

/**
 * The answers as the server's request, or the problems a person can fix before
 * asking. Whether it fits the plan is the server's to say.
 */
function requestOf(
  kind: GeneratorKind,
  answers: Answers,
): { request: GenerateRequest | null; problems: string[] } {
  const problems: string[] = []
  const name = answers.name.trim()
  if (name === '') problems.push('It needs a name.')
  if (answers.skills.length === 0) problems.push('It needs at least one skill.')
  const link = answers.link.trim() === '' ? null : answers.link.trim()
  if (kind !== 'practice' && link !== null && !link.startsWith('https://')) {
    problems.push('The link must start with https://.')
  }
  const hours = (value: string, what: string, zero = false) => {
    const number = Number(value)
    if (value.trim() === '' || !Number.isFinite(number) || number < 0 || (!zero && number === 0)) {
      problems.push(`${what} must be a number of hours${zero ? '' : ' above zero'}.`)
    }
    return number
  }
  const where = {
    phase: answers.phase,
    skills: answers.skills,
    after: answers.after === '' ? null : answers.after,
    from: answers.from,
  }

  let request: GenerateRequest
  switch (kind) {
    case 'course':
      request = {
        ...where,
        kind,
        name,
        type: answers.type,
        link,
        hours: hours(answers.hours, 'Hours in all'),
        weeklyHours: hours(answers.weeklyHours, 'Most a week'),
      }
      break
    case 'certification': {
      const prepHours =
        answers.prepHours.trim() === '' ? 0 : hours(answers.prepHours, 'Prep hours', true)
      request = {
        ...where,
        kind,
        name,
        link,
        price: answers.price.trim(),
        prepHours,
        weeklyHours: prepHours > 0 ? hours(answers.weeklyHours, 'Prep a week') : 0,
        prepDoneWhen: answers.prepDoneWhen.trim(),
        examHours: hours(answers.examHours, 'Exam hours'),
        examDate: answers.examOnDay ? answers.examDate : '',
      }
      break
    }
    case 'project': {
      const { tasks, problems: lines } = parseTaskLines(answers.tasks)
      problems.push(...lines)
      if (tasks.length === 0 && lines.length === 0) problems.push('It needs at least one task.')
      request = { ...where, kind, name, link, doneWhen: answers.doneWhen.trim(), tasks }
      break
    }
    case 'practice': {
      const weeks = Number(answers.weeks)
      if (!Number.isInteger(weeks) || weeks < 1 || weeks > 52) {
        problems.push('Weeks must be a whole number from 1 to 52.')
      }
      request = {
        ...where,
        kind,
        name,
        hours: hours(answers.blockHours, 'Hours a block'),
        weeks,
        doneWhen: answers.doneWhen.trim(),
      }
      break
    }
  }
  return { request: problems.length === 0 ? request : null, problems }
}
