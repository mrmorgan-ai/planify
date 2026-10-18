import type { WorkType, PhaseNumber, State } from './types'

// Application structure only. Everything that describes a particular roadmap —
// phase names, non-study periods, radar axes, the skill map, the timezone — is
// content: it lives in the database and never in this repository.

/** The most phases a roadmap may have. The database only asks for a positive number. */
export const MAX_PHASES = 20

export function isPhaseNumber(value: unknown): value is PhaseNumber {
  return Number.isInteger(value) && (value as number) >= 1 && (value as number) <= MAX_PHASES
}

export const STATES: readonly State[] = ['pending', 'in_progress', 'done'] as const

export const WORK_TYPES: readonly WorkType[] = [
  'Certification',
  'Course',
  'Book',
  'Documentation',
  'Paper',
  'Case study',
  'Project',
  'Practice',
  'Exam prep',
] as const

/** Used only when the database has no timezone configured. */
export const DEFAULT_TIME_ZONE = 'UTC'
