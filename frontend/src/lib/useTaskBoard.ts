import { useCallback, useEffect, useRef, useState } from "react"
import { useOnboardedUser } from "@/contexts/authContext"
import { can, getPerm } from "@/lib/permissions"
import { isTaskBucket, type TaskBucket } from "@/lib/taskBuckets"
import {
    claimTask, deleteTask, fetchPeople, fetchTasks,
    type Person, type Task,
} from "@/lib/tasksApi"
import { startOfTodayMs } from "@/lib/taskFormat"

// ── Unread notes: count-based, localStorage-backed ──────────────────────
// The backend has no read-tracking and `Task` only carries `note_count` (no
// per-note timestamps), so "unread" is tracked as a delta against the count
// last seen, not against individual notes. Wrapped in try/catch throughout:
// Safari private mode throws on both read and write.
const NOTES_SEEN_KEY = "tasks.notes-seen"

function loadSeenMap(): Record<string, number> {
    try {
        const raw = localStorage.getItem(NOTES_SEEN_KEY)
        if (!raw) return {}
        const parsed: unknown = JSON.parse(raw)
        return parsed && typeof parsed === "object" ? parsed as Record<string, number> : {}
    } catch {
        return {}
    }
}

function saveSeenMap(map: Record<string, number>) {
    try {
        localStorage.setItem(NOTES_SEEN_KEY, JSON.stringify(map))
    } catch {
        // Safari private mode, storage disabled, quota, etc. -- unread state
        // just won't persist across reloads, which is fine.
    }
}

export interface TaskBoard {
    tasks: Task[]
    people: Person[]
    loading: boolean
    loadError: string | null
    actionError: string | null
    setActionError: (message: string | null) => void

    /** Viewer facts, resolved once from `useOnboardedUser()`. */
    canAssign: boolean
    mySubteam: TaskBucket | null
    canEditTask: (task: Task) => boolean
    /** Edit rights, plus the task's assignee and contributors (status only). */
    canChangeStatus: (task: Task) => boolean

    /** ms at local midnight today — pass to isOverdue/rowDue/matchesFilter. */
    todayMs: number
    /** Notes on `task` posted since this device last looked at it. */
    unread: (task: Task) => number

    /** Runs a mutation, applies the returned Task, routes failure to actionError. */
    runAction: (fn: () => Promise<Task>) => Promise<void>
    /** claim + the 409 "someone beat you to it" silent-refresh path. */
    handleClaim: (taskId: string) => Promise<void>
    /** window.confirm, then DELETE, then drop the row. */
    handleDelete: (task: Task) => Promise<void>
    applyTask: (task: Task) => void
    bumpNoteCount: (taskId: string, delta: number) => void

    /** Schedules the 900ms read-stamp when `task` has unread notes. Call when a
     *  row's notes become visible. Cancels any pending stamp first. */
    markNotesRead: (task: Task) => void
    /** Cancels a pending stamp without scheduling one (notes closed). */
    cancelMarkNotesRead: () => void

    refreshTasksSilently: () => Promise<void>
}

export function useTaskBoard(): TaskBoard {
    const user = useOnboardedUser()
    const canAssign = can(user.permissions, "tasks.assign")

    const rawSubteam = getPerm(user.permissions, "subteam")
    const mySubteam = typeof rawSubteam === "string" && isTaskBucket(rawSubteam) ? rawSubteam : null

    const [tasks, setTasks] = useState<Task[]>([])
    const [people, setPeople] = useState<Person[]>([])
    const [loading, setLoading] = useState(true)
    const [loadError, setLoadError] = useState<string | null>(null)
    const [actionError, setActionError] = useState<string | null>(null)

    const [seen, setSeen] = useState<Record<string, number>>(() => loadSeenMap())
    const markReadTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
    // Mirrors `tasks` for the mark-read timer below, which fires 900ms after
    // it's scheduled and needs the *current* note_count at that moment, not
    // whatever it was when the timer was set -- see the timer's own comment.
    const tasksRef = useRef<Task[]>(tasks)
    useEffect(() => { tasksRef.current = tasks }, [tasks])

    // Guards against a background poll's response landing after the page has
    // been navigated away from -- fetchTasks() is in flight across an
    // unmount, resolves late, and would otherwise still call setTasks.
    const mountedRef = useRef(true)
    useEffect(() => () => { mountedRef.current = false }, [])

    useEffect(() => () => { if (markReadTimer.current) clearTimeout(markReadTimer.current) }, [])

    // A task with no `seen` entry has never been looked at on this device --
    // treat that as "caught up" rather than "everything is unread", or a
    // fresh browser (or the first load after this feature ships) would
    // render every task with notes as fully unread. Only stamps tasks with
    // NO existing entry; an entry that's already there reflects a real prior
    // visit and is left alone, so notes that land after that visit still
    // count. Shared by the initial load and the silent poll below, since a
    // newly-visible task can arrive via either path.
    const stampSeenForNewTasks = useCallback((newTasks: Task[]) => {
        setSeen(prev => {
            let changed = false
            const next = { ...prev }
            for (const task of newTasks) {
                if (next[task.id] === undefined) {
                    next[task.id] = task.note_count
                    changed = true
                }
            }
            if (!changed) return prev
            saveSeenMap(next)
            return next
        })
    }, [])

    const load = useCallback(async () => {
        setLoading(true)
        setLoadError(null)
        try {
            const [t, p] = await Promise.all([fetchTasks(), fetchPeople()])
            setTasks(t)
            setPeople(p)
            stampSeenForNewTasks(t)
        } catch {
            setLoadError("Failed to load tasks")
        } finally {
            setLoading(false)
        }
    }, [stampSeenForNewTasks])

    useEffect(() => { void load() }, [load])

    // Guards `refreshTasksSilently` against overlapping requests (a poll
    // tick firing while the previous one is still in flight, or racing the
    // immediate refresh on tab-visible / claim-collision paths). A ref, not
    // state, since it's a pure in-flight flag with no rendering implication.
    const pollInFlight = useRef(false)

    // Timestamp of the most recently *applied* mutation result (claim,
    // status change, reassignment, delete, ...) -- bumped by `applyTask`/
    // `removeTask` below, so every mutation path gets it for free. A poll
    // response fetched *before* this moment is stale relative to what's
    // already on screen: without checking it, a slow poll landing just
    // after a mutation would overwrite the board with pre-mutation data,
    // silently reverting the user's own action for up to a full interval.
    const lastMutationAt = useRef(0)

    /** Background refresh: re-fetches tasks only (never people -- the
     *  roster changes far too rarely to poll) and never touches `loading`,
     *  `loadError` or `actionError`. Used by the 30s poll below, the
     *  tab-visible resume, and after a claim collision so the board catches
     *  up with whoever actually got the task. Failures are swallowed
     *  entirely: a transient blip on a background refresh shouldn't replace
     *  a working board with an error, or stomp on an error message the user
     *  hasn't read yet -- the next tick just tries again. */
    const refreshTasksSilently = useCallback(async () => {
        if (pollInFlight.current) return
        pollInFlight.current = true
        const startedAt = Date.now()
        try {
            const t = await fetchTasks()
            if (!mountedRef.current) return
            // A mutation was applied after this fetch was issued, so its
            // result is already the newer, authoritative state on screen --
            // this response is stale and would revert it. `>=` so a
            // same-millisecond tie favors the mutation, not the poll.
            if (lastMutationAt.current >= startedAt) return
            setTasks(t)
            stampSeenForNewTasks(t)
        } catch {
            // Swallowed by design -- see doc comment above.
        } finally {
            pollInFlight.current = false
        }
    }, [stampSeenForNewTasks])

    // Poll every 30s while the tab is visible, so two people are less likely
    // to both go for the same unclaimed task. Pauses entirely while hidden
    // (no point burning requests on a backgrounded tab) and does one
    // immediate refresh on becoming visible again, so a tab left open for an
    // hour doesn't sit on an hour-old board until the next tick.
    useEffect(() => {
        const POLL_MS = 30000
        let intervalId: ReturnType<typeof setInterval> | null = null

        function start() {
            if (intervalId !== null) return
            intervalId = setInterval(() => { void refreshTasksSilently() }, POLL_MS)
        }
        function stop() {
            if (intervalId !== null) { clearInterval(intervalId); intervalId = null }
        }
        function onVisibilityChange() {
            if (document.visibilityState === "hidden") {
                stop()
            } else {
                void refreshTasksSilently()
                start()
            }
        }

        if (document.visibilityState === "visible") start()
        document.addEventListener("visibilitychange", onVisibilityChange)
        return () => {
            stop()
            document.removeEventListener("visibilitychange", onVisibilityChange)
        }
    }, [refreshTasksSilently])

    const applyTask = useCallback((updated: Task) => {
        lastMutationAt.current = Date.now()
        setTasks(prev => {
            const idx = prev.findIndex(t => t.id === updated.id)
            if (idx === -1) return [...prev, updated]
            const next = [...prev]
            next[idx] = updated
            return next
        })
    }, [])

    const removeTask = useCallback((id: string) => {
        lastMutationAt.current = Date.now()
        setTasks(prev => prev.filter(t => t.id !== id))
    }, [])

    // Notes live in their own thread endpoint (see TaskNotes), so their count
    // is nudged locally rather than re-fetching the whole task on every post/delete.
    const bumpNoteCount = useCallback((taskId: string, delta: number) => {
        // Stamped like `applyTask`/`removeTask`: this runs only after `addNote`
        // /`deleteNote` already succeeded server-side, so it's a real mutation
        // and an older in-flight poll must not revert the count behind it.
        lastMutationAt.current = Date.now()
        setTasks(prev => prev.map(t => t.id === taskId ? { ...t, note_count: t.note_count + delta } : t))
        // Keep our own "seen" baseline in step with an edit *we* just made
        // locally (posting or deleting a note in the open thread), so it
        // doesn't register as unread to the very person who made it --
        // without this, posting your own note pushes note_count above the
        // stamped baseline and the chip/header immediately read "unread".
        // Only nudges an existing baseline: a task with no entry yet hasn't
        // been looked at, so there's nothing to keep in step with (the
        // initial-load stamp in `load()` handles that case). A note someone
        // *else* posts only ever reaches this client through a fresh
        // `fetchTasks()`, which doesn't go through this path, so it's
        // unaffected and still correctly reads as unread.
        setSeen(prev => {
            if (prev[taskId] === undefined) return prev
            const next = { ...prev, [taskId]: Math.max(0, prev[taskId] + delta) }
            saveSeenMap(next)
            return next
        })
    }, [])

    function canEditTask(task: Task): boolean {
        return canAssign || task.created_by === user.id
    }

    function canChangeStatus(task: Task): boolean {
        return canEditTask(task) || task.assignee_id === user.id || task.contributors.some(c => c.id === user.id)
    }

    function unread(task: Task): number {
        return Math.max(0, task.note_count - (seen[task.id] ?? 0))
    }

    async function runAction(fn: () => Promise<Task>) {
        setActionError(null)
        try {
            applyTask(await fn())
        } catch (err) {
            setActionError(err instanceof Error ? err.message : "Something went wrong")
        }
    }

    async function handleDelete(task: Task) {
        if (!window.confirm(`Delete "${task.title}"? This can't be undone.`)) return
        setActionError(null)
        try {
            await deleteTask(task.id)
            removeTask(task.id)
        } catch (err) {
            setActionError(err instanceof Error ? err.message : "Failed to delete task")
        }
    }

    /** Claim is a special case of `runAction`: polling narrows the window
     *  where two people go for the same unclaimed task, but can't close it,
     *  so `claimTask` still 409s ("Task is already assigned") when someone
     *  beats you to it. On that failure, silently refresh alongside the
     *  error banner so the row immediately shows who actually got it,
     *  instead of leaving the board looking like the claim should have
     *  worked. Only claim does this -- other actions keep going through the
     *  plain `runAction` with no extra refetch. */
    async function handleClaim(taskId: string) {
        setActionError(null)
        try {
            applyTask(await claimTask(taskId))
        } catch (err) {
            setActionError(err instanceof Error ? err.message : "Something went wrong")
            void refreshTasksSilently()
        }
    }

    /** Schedules the 900ms read-stamp from SPEC "Unread notes" when `task`
     *  has unread notes. Clears any pending timer first, so a fast
     *  open/close (or opening a different row) can't strand it. */
    function markNotesRead(task: Task) {
        if (markReadTimer.current) { clearTimeout(markReadTimer.current); markReadTimer.current = null }
        if (unread(task) > 0) {
            const taskId = task.id
            markReadTimer.current = setTimeout(() => {
                // Read `note_count` fresh off `tasksRef` at fire-time, not a
                // snapshot captured when the timer was scheduled: if the
                // viewer posts (or deletes) a note of their own during the
                // 900ms window, `bumpNoteCount` already nudged `seen` to
                // account for that edit, and stamping a stale snapshot here
                // would clobber it -- e.g. 3 unread out of 10, viewer posts
                // one during the window (seen 7 -> 8, count 10 -> 11, still
                // correctly 3 unread), then this timer firing with a
                // captured "10" would set seen back to 10, making the
                // viewer's own just-posted 11th note read as unread. Using
                // the live count and never moving the baseline backward
                // (`Math.max`) keeps both edits' effects: everything visible
                // at open time is marked read, *and* whatever the viewer
                // added in the meantime is too.
                const current = tasksRef.current.find(t => t.id === taskId)
                const latestCount = current ? current.note_count : task.note_count
                setSeen(prev => {
                    const next = { ...prev, [taskId]: Math.max(prev[taskId] ?? 0, latestCount) }
                    saveSeenMap(next)
                    return next
                })
                markReadTimer.current = null
            }, 900)
        }
    }

    /** Cancels a pending read-stamp without scheduling one (notes closed). */
    function cancelMarkNotesRead() {
        if (markReadTimer.current) { clearTimeout(markReadTimer.current); markReadTimer.current = null }
    }

    const todayMs = startOfTodayMs()

    return {
        tasks, people, loading, loadError, actionError, setActionError,
        canAssign, mySubteam, canEditTask, canChangeStatus,
        todayMs, unread,
        runAction, handleClaim, handleDelete, applyTask, bumpNoteCount,
        markNotesRead, cancelMarkNotesRead,
        refreshTasksSilently,
    }
}
