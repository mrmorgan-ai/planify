import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { addDays, startOfWeek } from '../core/dates'
import type { CivilDate } from '../core/types'

const WEEKDAYS = ['M', 'T', 'W', 'T', 'F', 'S', 'S']
const WIDTH = 248
const GUTTER = 8

/**
 * A calendar whose weeks start on Monday, like every other week in the app.
 *
 * The browser's own date input cannot do this: its first weekday follows the
 * browser's locale, and Chrome ignores the page's `lang`. So the month grid is
 * drawn here, from the same `startOfWeek` the board and the Gantt count in.
 *
 * The panel is positioned against the viewport rather than its cell, so the
 * table's own scrolling cannot clip it.
 */
export function DatePicker({
  value,
  min,
  disabled,
  label,
  onChange,
}: {
  value: CivilDate
  min?: CivilDate
  disabled?: boolean
  label: string
  onChange: (date: CivilDate) => void
}) {
  const [open, setOpen] = useState(false)
  const [month, setMonth] = useState(value.slice(0, 7))
  const [position, setPosition] = useState<{ top: number; left: number } | null>(null)
  const trigger = useRef<HTMLButtonElement>(null)
  const panel = useRef<HTMLDivElement>(null)

  useLayoutEffect(() => {
    if (!open || !trigger.current) return
    const rect = trigger.current.getBoundingClientRect()
    const height = panel.current?.offsetHeight ?? 290
    const below = rect.bottom + 4
    const top = below + height > window.innerHeight ? Math.max(rect.top - height - 4, GUTTER) : below
    const left = Math.min(Math.max(rect.left, GUTTER), window.innerWidth - WIDTH - GUTTER)
    setPosition({ top, left })
  }, [open])

  useEffect(() => {
    if (!open) return
    const close = (event: Event) => {
      const target = event.target as Node
      if (panel.current?.contains(target) || trigger.current?.contains(target)) return
      setOpen(false)
    }
    const escape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      setOpen(false)
      trigger.current?.focus()
    }
    // Moving the page would leave the panel floating over the wrong row.
    const dismiss = () => setOpen(false)
    document.addEventListener('mousedown', close)
    document.addEventListener('keydown', escape)
    window.addEventListener('resize', dismiss)
    window.addEventListener('scroll', dismiss, true)
    return () => {
      document.removeEventListener('mousedown', close)
      document.removeEventListener('keydown', escape)
      window.removeEventListener('resize', dismiss)
      window.removeEventListener('scroll', dismiss, true)
    }
  }, [open])

  const first = `${month}-01`
  const start = startOfWeek(first)
  const days = Array.from({ length: 42 }, (_, offset) => addDays(start, offset))

  return (
    <>
      <button
        ref={trigger}
        type="button"
        className="date-trigger"
        disabled={disabled}
        aria-label={`${label}: ${value}`}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => {
          setMonth(value.slice(0, 7))
          setOpen(!open)
        }}
      >
        {value}
      </button>

      {open && (
        <div
          ref={panel}
          className="date-panel"
          role="dialog"
          aria-label={label}
          style={{
            width: WIDTH,
            top: position?.top ?? 0,
            left: position?.left ?? 0,
            visibility: position ? 'visible' : 'hidden',
          }}
        >
          <div className="date-panel-head">
            <button
              type="button"
              className="icon-button"
              aria-label="Previous month"
              onClick={() => setMonth(shiftMonth(month, -1))}
            >
              ‹
            </button>
            <span>{monthLabel(month)}</span>
            <button
              type="button"
              className="icon-button"
              aria-label="Next month"
              onClick={() => setMonth(shiftMonth(month, 1))}
            >
              ›
            </button>
          </div>

          <div className="date-grid">
            {WEEKDAYS.map((weekday, index) => (
              <span key={index} className="date-weekday">
                {weekday}
              </span>
            ))}
            {days.map((date) => {
              const outside = date.slice(0, 7) !== month
              const blocked = min !== undefined && date < min
              const classes = ['date-day']
              if (outside) classes.push('outside')
              if (date === value) classes.push('selected')
              return (
                <button
                  key={date}
                  type="button"
                  className={classes.join(' ')}
                  disabled={blocked}
                  aria-label={date}
                  aria-pressed={date === value}
                  onClick={() => {
                    onChange(date)
                    setOpen(false)
                    trigger.current?.focus()
                  }}
                >
                  {Number(date.slice(8, 10))}
                </button>
              )
            })}
          </div>
        </div>
      )}
    </>
  )
}

/** `YYYY-MM` moved by whole months. */
function shiftMonth(month: string, by: number): string {
  const index = Number(month.slice(0, 4)) * 12 + Number(month.slice(5, 7)) - 1 + by
  const year = Math.floor(index / 12)
  return `${String(year).padStart(4, '0')}-${String((index % 12) + 1).padStart(2, '0')}`
}

/** "September 2026". Noon UTC, so the month cannot land one off. */
function monthLabel(month: string): string {
  return new Date(`${month}-01T12:00:00Z`).toLocaleDateString('en', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  })
}
