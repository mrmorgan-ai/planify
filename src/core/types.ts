/** Study hours available per week. Roadmap content: capacity is personal. */
export type WeeklyHours = {
  normal: number
}

/** A civil date, `YYYY-MM-DD`. No time, no timezone — see dates.ts. */
export type CivilDate = string

/** An ISO datetime with offset. Only `completedAt` uses one. */
export type IsoDateTime = string

export type State = 'pending' | 'in_progress' | 'done'

/**
 * What a story or a feature is — a course, a certification, a project — picked
 * from a fixed list. A label for reading and grouping, never required: nothing
 * about the plan depends on it beyond the conventions some rules check when it
 * is set. Tasks carry none; a task is what its story is.
 */
export type WorkType =
  | 'Certification'
  | 'Course'
  | 'Book'
  | 'Documentation'
  | 'Paper'
  | 'Case study'
  | 'Project'
  /** The weekly block that applies what the week covered. */
  | 'Practice'
  /** Exam guides, practice questions and practice exams — kept apart from the exam. */
  | 'Exam prep'

export type PhaseNumber = 1 | 2 | 3 | 4 | 5 | 6

/**
 * A radar axis. Deliberately a plain string: the axes are roadmap content and
 * live in the database, not in this repository.
 */
export type Dimension = string

/** An extra link a task carries, beyond its own `link`. */
export type Resource = {
  label: string
  url: string
}

/**
 * One scheduled step, finishable inside a week: what the engine places, the
 * board moves and progress is recorded on. Every task belongs to a story.
 */
export type Task = {
  id: string
  name: string
  /**
   * Its story's phase, never its own: filled in from the story whenever a roadmap
   * is read or changed (see `withStoryPhases`), and not stored with the task.
   */
  phase: PhaseNumber
  skills: string[]

  /** The story this task is one step of. */
  storyId: string

  /** The original plan. Never recalculated. */
  baselineStartDate: CivilDate
  baselineEndDate: CivilDate

  /** The live projection. Written only by the recalculation engine. */
  projectedStartDate: CivilDate
  projectedEndDate: CivilDate

  /** Ids scheduled before this one. A date relationship, never a lock. */
  dependsOn: string[]

  /** Its own links. Empty, it shows its story's (see `linksOf`). */
  link: string | null
  resources: Resource[]
  /**
   * How long it takes, as written: "~25h, 7 videos". The text is what is stored;
   * `estimatedHours` in hours.ts reads a number out of it when there is one.
   */
  duration: string
  /** A plain description of what the task is. No durations, no links. */
  notes: string
  /**
   * What finishing it produces, stated so it can be checked — "gradients match
   * autograd within 1e-6". Empty when the task's end is obvious, like a chapter.
   */
  doneWhen: string

  state: State
  completedAt: IsoDateTime | null
  /**
   * Hours spent so far, declared by hand. Never larger than the estimate, and
   * meaningless without one — see `progressHours` in hours.ts, which is what
   * every count should go through.
   */
  hoursDone: number

  /** Curated order within a phase, for the backlog. */
  sortOrder: number
}

/**
 * A deliverable inside one phase, made of tasks: a course's weeks in that phase,
 * a project's numbered steps, a paper read in one sitting. It has no dates, state
 * or dependencies of its own — all of that is read off its tasks, so it can never
 * disagree with them, and the engine does not know it exists. Anything longer
 * than a phase is a feature, split into a story per phase.
 */
export type Story = {
  id: string
  name: string
  /** What it is, or null when it is not labelled. */
  type: WorkType | null
  /** The phase it and every one of its tasks sit in. */
  phase: PhaseNumber
  /** The wider goal it serves, or null when it stands on its own. */
  featureId: string | null
  /** Where the whole story lives, when its tasks share one link. */
  link: string | null
  resources: Resource[]
  price: string
  /** What the story is as a whole. */
  notes: string
  /** What finishing it produces, stated so it can be checked. */
  doneWhen: string
}

/**
 * A goal wider than a phase — a certification, a large project — served by
 * stories in one or more phases. Like a story, it holds no dates or state: its
 * span and progress are read off its stories' tasks.
 */
export type Feature = {
  id: string
  name: string
  /** What it is, or null when it is not labelled. */
  type: WorkType | null
  link: string | null
  notes: string
}

export type Phase = {
  number: PhaseNumber
  name: string
  /**
   * The task that closes the phase. Not derivable from `type`: a phase with no
   * certification closes on a deliverable instead.
   */
  closingMilestoneId: string | null
}

export type Blackout = {
  from: CivilDate
  to: CivilDate
  reason: string
}

/**
 * Everything about a roadmap that is content rather than application: the phase
 * names, the non-study periods, the radar axes and which axis each skill feeds.
 * Loaded from the database, never hardcoded here.
 */
export type Roadmap = {
  timeZone: string
  /**
   * The day the plan starts. Baseline dates are editable, so this is the floor
   * an edit may not go below — a mistyped year would otherwise reschedule the
   * past in silence. Empty means no floor is configured.
   */
  startDate: CivilDate | ''
  /** Study capacity per week, used to size the board's weekly scope. */
  weeklyHours: WeeklyHours
  phases: Phase[]
  blackouts: Blackout[]
  dimensions: Dimension[]
  skillDimension: Record<string, Dimension>
}

/** What the engine needs to reason about dates. */
export type ScheduleOptions = {
  blackouts: readonly Blackout[]
  timeZone: string
}

/** A roadmap on its own: what is validated, imported and exported. */
export type RoadmapContent = {
  roadmap: Roadmap
  features: Feature[]
  stories: Story[]
  tasks: Task[]
}

/**
 * A draft of the plan in progress: changes staged apart from the live roadmap,
 * published as one. There is one at a time, shared by every device.
 */
export type DraftMark = {
  startedAt: IsoDateTime
  updatedAt: IsoDateTime
}

/** What every API response carries: the world, plus the server's idea of today. */
export type AppState = {
  today: CivilDate
  /** Bumped on every write. Lets a second tab notice it is looking at stale data. */
  revision: number
  /** Which seed the database was loaded from — the answer to "is this the roadmap I just edited?". */
  seedVersion: string
  /**
   * The draft in progress, or null for none. On the draft's own world it is
   * always set, and `revision` is the draft's rather than the roadmap's.
   */
  draft: DraftMark | null
  roadmap: Roadmap
  features: Feature[]
  stories: Story[]
  tasks: Task[]
}
