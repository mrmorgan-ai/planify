import type { CivilDate } from '../core/types'

// Dates as the board prints them, shared so the footer and the board can never
// drift into two formats. Noon UTC, so a civil date cannot land a day off.

/** "Sep 14" */
export function shortDate(date: CivilDate): string {
  const month = new Date(`${date}T12:00:00Z`).toLocaleDateString('en', {
    month: 'short',
    timeZone: 'UTC',
  })
  return `${month} ${Number(date.slice(8, 10))}`
}

/** "Sep 14 – 20", or both months when the range straddles one. */
export function dateRange(from: CivilDate, to: CivilDate): string {
  return from.slice(0, 7) === to.slice(0, 7)
    ? `${shortDate(from)} – ${Number(to.slice(8, 10))}`
    : `${shortDate(from)} – ${shortDate(to)}`
}
