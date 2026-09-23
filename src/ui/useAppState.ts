import { useCallback, useEffect, useRef, useState } from 'react'
import type { Edit } from '../core/edits'
import type { GenerateRequest } from '../core/generate'
import type { AppState, State } from '../core/types'
import {
  RequestError,
  StaleStateError,
  discardDraft,
  fetchDraft,
  fetchState,
  generateItems,
  importRoadmap,
  publishDraft,
  reschedule,
  restoreVersion,
  sendEdits,
  setItemDates,
  setItemHours,
  setItemState,
  startDraft,
} from './api'

/** Which world is on screen: the live roadmap, or the draft of its plan. */
export type Mode = 'live' | 'draft'

export type Store = {
  state: AppState | null
  mode: Mode
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
  /**
   * Changes the roadmap's content. `id` names the item being changed, so its row
   * can show it. Resolves true when the server accepted the whole list.
   */
  edit: (edits: Edit[], id?: string) => Promise<boolean>
  /** Replaces the roadmap with a file's, from the revision its preview was made at. */
  importFile: (roadmap: unknown, revision: number) => Promise<boolean>
  /** Brings a version of the plan back, from the revision its preview was made at. */
  restore: (id: number, revision: number) => Promise<boolean>
  /** Adds what a generator makes, from the revision its preview was made at. */
  generate: (generator: GenerateRequest, revision: number) => Promise<boolean>
  /** Starts a draft, or opens the one in progress, and shows it. */
  openDraft: () => Promise<boolean>
  /** Goes back to the live roadmap, leaving the draft as it is. */
  leaveDraft: () => Promise<void>
  /** Drops the draft and goes back to the live roadmap. */
  discard: () => Promise<boolean>
  /** Makes the draft the plan, from the revisions its preview was made at. */
  publish: (revision: number, draftRevision: number) => Promise<boolean>
}

/** Remembered per browser, so a reload in the middle of a draft stays in it. */
const MODE_KEY = 'planify.mode'

const PROGRESS_IS_LIVE =
  'Progress is recorded on the live roadmap. Go back to it to tick items off or log hours.'
const LIVE_ONLY = 'This acts on the live roadmap. Publish or leave the draft first.'

/**
 * The single copy of the world in the browser. No optimistic update on purpose:
 * the server answers a state change with the recalculated roadmap, and guessing
 * that result locally would mean reimplementing the engine in the client.
 *
 * In a draft, the world on screen is the draft's, and every change to the plan
 * — edits, dates, generators — goes to the draft. Progress, imports, restores and
 * reschedules act on the live roadmap only, and are refused until it is back.
 */
export function useAppState(): Store {
  const [state, setState] = useState<AppState | null>(null)
  const [mode, setMode] = useState<Mode>('live')
  const [error, setError] = useState<string | null>(null)
  const [pendingId, setPendingId] = useState<string | null>(null)
  const [rescheduling, setRescheduling] = useState(false)

  // The writers below are created once, so they read the revision they were
  // made from, and the world they write to, here rather than from what they
  // closed over.
  const revision = useRef(0)
  const drafting = useRef(false)
  useEffect(() => {
    if (state) revision.current = state.revision
  }, [state])

  /** The only way the mode changes: with the world that goes with it. */
  const show = useCallback((next: AppState, nextMode: Mode) => {
    // The refs follow at once, so no write in between can read the old world.
    drafting.current = nextMode === 'draft'
    revision.current = next.revision
    writeMode(nextMode)
    setMode(nextMode)
    setState(next)
  }, [])

  /** The draft ended on another device: back to the live world, saying why. */
  const draftEnded = useCallback(async () => {
    show(await fetchState(), 'live')
    setError('The draft was published or discarded on another device.')
  }, [show])

  useEffect(() => {
    let cancelled = false
    const load = async () => {
      const draft = readMode() === 'draft' ? await fetchDraft() : null
      if (cancelled) return
      if (draft) show(draft, 'draft')
      else {
        const live = await fetchState()
        if (!cancelled) show(live, 'live')
      }
    }
    load().catch((cause: unknown) => {
      if (!cancelled) setError(messageOf(cause))
    })
    return () => {
      cancelled = true
    }
  }, [show])

  // Coming back to the tab is when another device's changes are most likely to
  // be waiting. A refresh only ever moves the copy forward: one that started
  // before a write and landed after it must not put the older world back. A
  // failed refresh keeps what is on screen; the next write or return retries.
  useEffect(() => {
    let inFlight = false
    const refresh = () => {
      if (document.visibilityState !== 'visible' || inFlight) return
      inFlight = true
      const inDraft = drafting.current
      ;(inDraft ? fetchDraft() : fetchState())
        .then((loaded) => {
          if (drafting.current !== inDraft) return
          if (loaded === null) return draftEnded()
          setState((current) =>
            current === null ||
            loaded.revision > current.revision ||
            (loaded.revision === current.revision &&
              (loaded.today !== current.today ||
                // A draft started or ended elsewhere moves no live revision.
                JSON.stringify(loaded.draft) !== JSON.stringify(current.draft)))
              ? loaded
              : current,
          )
        })
        .catch(() => {})
        .finally(() => {
          inFlight = false
        })
    }
    document.addEventListener('visibilitychange', refresh)
    window.addEventListener('focus', refresh)
    return () => {
      document.removeEventListener('visibilitychange', refresh)
      window.removeEventListener('focus', refresh)
    }
  }, [draftEnded])

  // A write refused as stale arrives with the current world: take it, so the
  // next attempt is made from the right revision without a reload. A write to a
  // draft that no longer exists goes back to the live world.
  const fail = useCallback(
    (cause: unknown) => {
      if (cause instanceof StaleStateError) setState(cause.state)
      if (cause instanceof RequestError && cause.status === 404 && drafting.current) {
        // A 404 may also be an item another device deleted: ask whether the draft is gone.
        fetchDraft()
          .then((draft) => (draft === null ? draftEnded() : setError(messageOf(cause))))
          .catch(() => setError(messageOf(cause)))
        return
      }
      setError(messageOf(cause))
    },
    [draftEnded],
  )

  /** Refuses a live-only action while in a draft. True when it may go ahead. */
  const liveOnly = useCallback((message: string) => {
    if (!drafting.current) return true
    setError(message)
    return false
  }, [])

  const changeState = useCallback(
    async (id: string, next: State) => {
      if (!liveOnly(PROGRESS_IS_LIVE)) return
      setPendingId(id)
      setError(null)
      try {
        setState(await setItemState(id, next, revision.current))
      } catch (cause: unknown) {
        fail(cause)
      } finally {
        setPendingId(null)
      }
    },
    [fail, liveOnly],
  )

  const changeDates = useCallback(
    async (id: string, start: string, end: string) => {
      setPendingId(id)
      setError(null)
      try {
        setState(await setItemDates(id, start, end, revision.current, drafting.current))
        return true
      } catch (cause: unknown) {
        fail(cause)
        return false
      } finally {
        setPendingId(null)
      }
    },
    [fail],
  )

  const changeHours = useCallback(
    async (id: string, hours: number) => {
      if (!liveOnly(PROGRESS_IS_LIVE)) return false
      setPendingId(id)
      setError(null)
      try {
        setState(await setItemHours(id, hours, revision.current))
        return true
      } catch (cause: unknown) {
        fail(cause)
        return false
      } finally {
        setPendingId(null)
      }
    },
    [fail, liveOnly],
  )

  const reschedulePlan = useCallback(
    async (restartDate: string) => {
      if (!liveOnly(LIVE_ONLY)) return false
      setRescheduling(true)
      setError(null)
      try {
        setState(await reschedule(restartDate, revision.current))
        return true
      } catch (cause: unknown) {
        fail(cause)
        return false
      } finally {
        setRescheduling(false)
      }
    },
    [fail, liveOnly],
  )

  const edit = useCallback(
    async (edits: Edit[], id?: string) => {
      setPendingId(id ?? null)
      setError(null)
      try {
        setState(await sendEdits(edits, revision.current, drafting.current))
        return true
      } catch (cause: unknown) {
        fail(cause)
        return false
      } finally {
        setPendingId(null)
      }
    },
    [fail],
  )

  const importFile = useCallback(
    async (roadmap: unknown, revision: number) => {
      if (!liveOnly(LIVE_ONLY)) return false
      setError(null)
      try {
        setState(await importRoadmap(roadmap, revision))
        return true
      } catch (cause: unknown) {
        fail(cause)
        return false
      }
    },
    [fail, liveOnly],
  )

  const restore = useCallback(
    async (id: number, revision: number) => {
      if (!liveOnly(LIVE_ONLY)) return false
      setError(null)
      try {
        setState(await restoreVersion(id, revision))
        return true
      } catch (cause: unknown) {
        fail(cause)
        return false
      }
    },
    [fail, liveOnly],
  )

  const generate = useCallback(
    async (generator: GenerateRequest, revision: number) => {
      setError(null)
      try {
        setState(await generateItems(generator, revision, drafting.current))
        return true
      } catch (cause: unknown) {
        fail(cause)
        return false
      }
    },
    [fail],
  )

  const openDraft = useCallback(async () => {
    setError(null)
    try {
      show(await startDraft(), 'draft')
      return true
    } catch (cause: unknown) {
      setError(messageOf(cause))
      return false
    }
  }, [show])

  const leaveDraft = useCallback(async () => {
    setError(null)
    try {
      show(await fetchState(), 'live')
    } catch (cause: unknown) {
      setError(messageOf(cause))
    }
  }, [show])

  const discard = useCallback(async () => {
    setError(null)
    try {
      show(await discardDraft(), 'live')
      return true
    } catch (cause: unknown) {
      setError(messageOf(cause))
      return false
    }
  }, [show])

  const publish = useCallback(
    async (revision: number, draftRevision: number) => {
      setError(null)
      try {
        show(await publishDraft(revision, draftRevision), 'live')
        return true
      } catch (cause: unknown) {
        fail(cause)
        return false
      }
    },
    [fail, show],
  )

  return {
    state,
    mode,
    error,
    pendingId,
    changeState,
    changeDates,
    changeHours,
    rescheduling,
    reschedulePlan,
    edit,
    importFile,
    restore,
    generate,
    openDraft,
    leaveDraft,
    discard,
    publish,
  }
}

function readMode(): Mode {
  try {
    return localStorage.getItem(MODE_KEY) === 'draft' ? 'draft' : 'live'
  } catch {
    return 'live'
  }
}

function writeMode(mode: Mode): void {
  try {
    localStorage.setItem(MODE_KEY, mode)
  } catch {
    // Private windows may refuse; the draft is still on the server.
  }
}

function messageOf(cause: unknown): string {
  return cause instanceof Error ? cause.message : 'Unknown error'
}
