import { useCallback, useEffect, useRef, useState } from 'react'
import type { AppState, State } from '../core/types'
import { fetchState, reschedule, setItemDates, setItemHours, setItemState } from './api'

export type Store = {
  state: AppState | null
  error: string | null
  /** The item currently being written, so one row can show it without freezing the rest. */
  pendingId: string | null
  changeState: (id: string, next: State) => Promise<void>
  /** Moves an item's baseline. Resolves true when the server accepted it. */
  changeDates: (id: string, start: string, end: string) => Promise<boolean>
  /** Declares hours spent on an item. Resolves true when the server accepted it. */
  changeHours: (id: string, hours: number) => Promise<boolean>
  /** True while a reschedule is being written. */
  rescheduling: boolean
  /** Restarts the plan on a date. Resolves true when the server accepted it. */
  reschedulePlan: (restartDate: string) => Promise<boolean>
}

/**
 * The single copy of the world in the browser. No optimistic update on purpose:
 * the server answers a state change with the recalculated roadmap, and guessing
 * that result locally would mean reimplementing the engine in the client.
 */
export function useAppState(): Store {
  const [state, setState] = useState<AppState | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [pendingId, setPendingId] = useState<string | null>(null)
  const [rescheduling, setRescheduling] = useState(false)

  // The writers below are created once, so they read the revision they were
  // made from here rather than from the state they closed over.
  const revision = useRef(0)
  useEffect(() => {
    if (state) revision.current = state.revision
  }, [state])

  useEffect(() => {
    let cancelled = false
    fetchState()
      .then((loaded) => {
        if (!cancelled) setState(loaded)
      })
      .catch((cause: unknown) => {
        if (!cancelled) setError(messageOf(cause))
      })
    return () => {
      cancelled = true
    }
  }, [])

  const changeState = useCallback(async (id: string, next: State) => {
    setPendingId(id)
    setError(null)
    try {
      setState(await setItemState(id, next, revision.current))
    } catch (cause: unknown) {
      setError(messageOf(cause))
    } finally {
      setPendingId(null)
    }
  }, [])

  const changeDates = useCallback(async (id: string, start: string, end: string) => {
    setPendingId(id)
    setError(null)
    try {
      setState(await setItemDates(id, start, end, revision.current))
      return true
    } catch (cause: unknown) {
      setError(messageOf(cause))
      return false
    } finally {
      setPendingId(null)
    }
  }, [])

  const changeHours = useCallback(async (id: string, hours: number) => {
    setPendingId(id)
    setError(null)
    try {
      setState(await setItemHours(id, hours, revision.current))
      return true
    } catch (cause: unknown) {
      setError(messageOf(cause))
      return false
    } finally {
      setPendingId(null)
    }
  }, [])

  const reschedulePlan = useCallback(async (restartDate: string) => {
    setRescheduling(true)
    setError(null)
    try {
      setState(await reschedule(restartDate, revision.current))
      return true
    } catch (cause: unknown) {
      setError(messageOf(cause))
      return false
    } finally {
      setRescheduling(false)
    }
  }, [])

  return {
    state,
    error,
    pendingId,
    changeState,
    changeDates,
    changeHours,
    rescheduling,
    reschedulePlan,
  }
}

function messageOf(cause: unknown): string {
  return cause instanceof Error ? cause.message : 'Unknown error'
}
