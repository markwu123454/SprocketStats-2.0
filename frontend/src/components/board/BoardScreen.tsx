import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { LogOut, Mail, ScanLine, WifiOff } from "lucide-react"
import BoardCard, { BoardAvatar } from "@/components/board/BoardCard"
import BoardIdentifyDialog from "@/components/board/BoardIdentifyDialog"
import BoardScanDialog from "@/components/board/BoardScanDialog"
import BoardTaskDialog from "@/components/board/BoardTaskDialog"
import Button from "@/components/ui/Button"
import { boardActions, isOnTask, type BoardAction } from "@/lib/boardActions"
import {
    boardErrorMessage, claimOnBoard, fetchBoardTasks, isBoardGone, isSignedOut, joinOnBoard, leaveOnBoard, logoutBoard,
    moveOnBoard, noteOnBoard, reviewOnBoard, setBoardBusy, type Acting, type BoardInfo,
} from "@/lib/boardApi"
import { confirmDialog } from "@/lib/confirmDialog"
import { BUCKET_OPTIONS } from "@/lib/taskBuckets"
import type { Task, TaskNote, TaskStatus } from "@/lib/tasksApi"
import { compareDone, compareTasks, isOverdue, startOfTodayMs, tint } from "@/lib/taskFormat"
import { useAutoScroll } from "@/lib/useAutoScroll"
import type { Facing } from "@/lib/useCodeCamera"
import { useServerClock } from "@/lib/useServerClock"
import { focusRing, typeBadge, typeH1, typeTitle } from "@/lib/uiClasses"

const POLL_MS = 10_000
// Someone acting on the board is signed out after this long without a touch,
// so the next person can't change tasks as them.
const ACT_IDLE_MS = 45_000
// An open task (with nobody acting) closes after this long, back to the board.
const OPEN_IDLE_MS = 60_000
// The sign-out countdown shows for the last stretch.
const WARN_MS = 15_000
const TOAST_MS = 4_000
const BUCKET_KEY = "sprocket-board-bucket"

const COLUMNS: { status: TaskStatus; label: string }[] = [
    { status: "todo", label: "To do" },
    { status: "doing", label: "In progress" },
    { status: "review", label: "Needs review" },
    { status: "done", label: "Done this week" },
]

const DONE_TOAST: Record<BoardAction, string> = {
    claim: "Claimed",
    join: "You joined",
    leave: "You left",
    todo: "Moved to To do",
    doing: "Moved to In progress",
    review: "Sent for review",
    approve: "Marked reviewed",
}

const RUN: Record<BoardAction, (act: Acting, id: string) => Promise<Task>> = {
    claim: claimOnBoard,
    join: joinOnBoard,
    leave: leaveOnBoard,
    todo: (act, id) => moveOnBoard(act, id, "todo"),
    doing: (act, id) => moveOnBoard(act, id, "doing"),
    review: (act, id) => moveOnBoard(act, id, "review"),
    approve: reviewOnBoard,
}

interface Toast {
    id: number
    text: string
    tone: "ok" | "error"
}

// Remembered per board, so setting a board up again starts on its lead's subteam.
function loadBucket(info: BoardInfo): string {
    try {
        const saved = localStorage.getItem(`${BUCKET_KEY}:${info.kiosk_id}`)
        if (saved === "all" || BUCKET_OPTIONS.some(o => o.value === saved)) return saved as string
    } catch {
        // Storage blocked: start on the board's own subteam.
    }
    return info.bucket ?? "all"
}

function saveBucket(info: BoardInfo, bucket: string) {
    try {
        localStorage.setItem(`${BUCKET_KEY}:${info.kiosk_id}`, bucket)
    } catch {
        // Storage blocked: the choice lasts until the page reloads.
    }
}

/**
 * The task board as it sits on the TV: the subteam's tasks in four columns,
 * with progress and the time across the top. Tapping a task opens it;
 * changing it needs someone to sign in first, with their code or (for
 * self-service) their email. The camera is off unless a student taps
 * "Sign in with code" (BoardScanDialog), and goes off again once they're in.
 */
export default function BoardScreen({ info, facing, onFlip, onGone }: {
    info: BoardInfo
    facing: Facing
    onFlip: () => void
    /** The board was deauthorized: back to setup. */
    onGone: () => void
}) {
    const clock = useServerClock()
    const [tasks, setTasks] = useState<Task[] | null>(null)
    const [stale, setStale] = useState(false)
    const [bucket, setBucket] = useState(() => loadBucket(info))
    const [acting, setActing] = useState<Acting | null>(null)
    const [openId, setOpenId] = useState<string | null>(null)
    const [identifying, setIdentifying] = useState(false)
    const [scanning, setScanning] = useState(false)
    const [toast, setToast] = useState<Toast | null>(null)
    const [lastActivity, setLastActivity] = useState(() => Date.now())
    const [now, setNow] = useState(() => Date.now())

    const showToast = useCallback((text: string, tone: Toast["tone"] = "ok") => setToast({ id: Date.now(), text, tone }), [])
    useEffect(() => {
        if (!toast) return
        const id = window.setTimeout(() => setToast(null), TOAST_MS)
        return () => window.clearTimeout(id)
    }, [toast])

    const signOut = useCallback(() => {
        setActing(null)
        setOpenId(null)
        setIdentifying(false)
        setScanning(false)
    }, [])

    /** Routes a failed request: the board is gone, the member's turn lapsed, or just say what went wrong. */
    const handleError = useCallback((err: unknown) => {
        if (isBoardGone(err)) {
            onGone()
            return
        }
        if (isSignedOut(err)) setActing(null)
        showToast(boardErrorMessage(err), "error")
    }, [onGone, showToast])

    // ── Tasks: polled, and patched with whatever a change returns ──────────
    const refresh = useCallback(async () => {
        try {
            setTasks(await fetchBoardTasks())
            setStale(false)
        } catch (err) {
            if (isBoardGone(err)) onGone()
            else setStale(true)
        }
    }, [onGone])
    useEffect(() => {
        void refresh()
        const id = window.setInterval(() => void refresh(), POLL_MS)
        return () => window.clearInterval(id)
    }, [refresh])

    const applyTask = useCallback((task: Task) => {
        setTasks(prev => prev?.map(t => (t.id === task.id ? task : t)) ?? prev)
    }, [])

    // ── Who's acting, and signing them out when they walk away ─────────────
    useEffect(() => {
        const mark = () => setLastActivity(Date.now())
        window.addEventListener("pointerdown", mark)
        window.addEventListener("keydown", mark)
        return () => {
            window.removeEventListener("pointerdown", mark)
            window.removeEventListener("keydown", mark)
        }
    }, [])

    const busy = acting !== null || openId !== null || identifying || scanning
    useEffect(() => {
        setBoardBusy(busy)
        return () => setBoardBusy(false)
    }, [busy])

    useEffect(() => {
        if (!busy) return
        const id = window.setInterval(() => setNow(Date.now()), 1000)
        return () => window.clearInterval(id)
    }, [busy])

    const idleFor = now - lastActivity
    useEffect(() => {
        if (acting && idleFor >= ACT_IDLE_MS) {
            showToast(`${acting.first_name} was signed out`)
            signOut()
        } else if (!acting && (openId || identifying) && idleFor >= OPEN_IDLE_MS) {
            signOut()
        }
    }, [acting, openId, identifying, idleFor, showToast, signOut])

    const startActing = useCallback((next: Acting) => {
        const t = Date.now()
        setLastActivity(t)
        setNow(t)
        setActing(next)
        setIdentifying(false)
        setScanning(false)
        showToast(`Hi ${next.first_name}. Tap a task to change it.`)
    }, [showToast])


    // ── Changes ────────────────────────────────────────────────────────────
    const run = useCallback(async (action: BoardAction, task: Task) => {
        if (!acting) return
        try {
            applyTask(await RUN[action](acting, task.id))
            showToast(DONE_TOAST[action])
        } catch (err) {
            handleError(err)
            void refresh()
        }
    }, [acting, applyTask, handleError, refresh, showToast])

    const addNote = useCallback(async (task: Task, body: string): Promise<TaskNote | null> => {
        if (!acting) return null
        try {
            const note = await noteOnBoard(acting, task.id, body)
            setTasks(prev => prev?.map(t => (t.id === task.id ? { ...t, note_count: t.note_count + 1 } : t)) ?? prev)
            return note
        } catch (err) {
            handleError(err)
            return null
        }
    }, [acting, handleError])

    // ── Turning the board off: anyone, after a confirm ─────────────────────
    const requestExit = useCallback(async () => {
        const ok = await confirmDialog({
            title: "Turn off this board?",
            body: "It goes back to the setup screen, and a lead, captain or mentor has to show their code to set it up again.",
            confirmLabel: "Turn off",
            danger: true,
        })
        if (!ok) return
        try {
            await logoutBoard()
            onGone()
        } catch (err) {
            handleError(err)
        }
    }, [handleError, onGone])

    // ── What's on screen ───────────────────────────────────────────────────
    const todayMs = startOfTodayMs()
    const groups = useMemo(() => {
        const by: Record<TaskStatus, Task[]> = { todo: [], doing: [], review: [], done: [] }
        for (const t of tasks ?? []) {
            if (bucket === "all" || t.bucket === bucket) by[t.status].push(t)
        }
        const byPriority = compareTasks("priority")
        by.todo.sort(byPriority)
        by.doing.sort(byPriority)
        by.review.sort(byPriority)
        by.done.sort(compareDone)
        return by
    }, [tasks, bucket])
    const doneCount = groups.done.length
    const openCount = groups.todo.length + groups.doing.length + groups.review.length
    const overdueCount = [...groups.todo, ...groups.doing, ...groups.review].filter(t => isOverdue(t, todayMs)).length
    const openTask = openId ? tasks?.find(t => t.id === openId) ?? null : null

    return (
        <div className="flex-1 min-h-0 flex flex-col gap-3 p-3 overflow-hidden theme-bg-page bg-cover bg-center">
            <header className="shrink-0 flex gap-3">
                <div className="flex-1 min-w-0 rounded-xl border theme-border theme-bg px-5 py-3 flex items-center gap-6">
                    <div className="min-w-0 shrink-0">
                        <div className="flex items-center gap-1">
                            <p className={`${typeBadge} theme-subtext-color`}>Task board · Set up by {info.authorized_by_name}</p>
                            <button
                                type="button"
                                onClick={() => void requestExit()}
                                className={`${typeBadge} theme-subtext-color flex items-center gap-1 px-1.5 py-1 -my-1 rounded hover:opacity-80 ${focusRing}`}
                            >
                                <span aria-hidden="true">·</span> <LogOut className="size-3" aria-hidden="true"/> Exit
                            </button>
                        </div>
                        <select
                            value={bucket}
                            onChange={e => {
                                setBucket(e.target.value)
                                saveBucket(info, e.target.value)
                            }}
                            aria-label="Subteam shown"
                            className={`${typeH1} theme-h1-color theme-bg -ml-1 pr-1 rounded-lg cursor-pointer ${focusRing}`}
                        >
                            <option value="all">All subteams</option>
                            {BUCKET_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                        </select>
                    </div>
                    <Progress done={doneCount} open={openCount} overdue={overdueCount}/>
                    <Clock/>
                </div>
            </header>

            {stale && (
                <div role="status" className="shrink-0 rounded-xl border theme-border-danger theme-danger px-4 py-2 flex items-center gap-2 text-sm"
                    style={{ background: "color-mix(in oklch, var(--theme-danger) 10%, var(--theme-bg))" }}>
                    <WifiOff className="size-4 shrink-0" aria-hidden="true"/>
                    Can't reach SprocketStats. Showing the last tasks it loaded; trying again.
                </div>
            )}

            <main className="flex-1 min-h-0 grid grid-cols-4 gap-3">
                {COLUMNS.map(col => (
                    <Column
                        key={col.status}
                        label={col.label}
                        tasks={groups[col.status]}
                        loading={tasks === null}
                        autoScroll={!busy}
                        todayMs={todayMs}
                        showBucket={bucket === "all"}
                        actingId={acting?.user_id ?? null}
                        onOpen={setOpenId}
                    />
                ))}
            </main>

            <footer className="shrink-0 rounded-xl border theme-border theme-bg px-5 py-3 flex items-center gap-4 min-h-16">
                {acting ? (
                    <>
                        <BoardAvatar name={acting.name} picture={acting.picture} size={2.25}/>
                        <div className="min-w-0 flex-1">
                            <p className={`${typeTitle} theme-h1-color truncate`}>Acting as {acting.name}</p>
                            {ACT_IDLE_MS - idleFor <= WARN_MS && (
                                <p className="text-sm theme-subtext-color">
                                    Signing out in {Math.max(0, Math.ceil((ACT_IDLE_MS - idleFor) / 1000))} s
                                </p>
                            )}
                        </div>
                        <Button size="hero" onClick={signOut}>Done</Button>
                    </>
                ) : (
                    <>
                        <p className="text-base theme-text flex-1 min-w-0">Sign in as a member to edit tasks.</p>
                        <Button size="hero" onClick={() => setScanning(true)}>
                            <ScanLine className="size-5" aria-hidden="true"/>
                            Sign in with code
                        </Button>
                        <Button size="hero" variant="outlined" onClick={() => setIdentifying(true)}>
                            <Mail className="size-5" aria-hidden="true"/>
                            Enter your email
                        </Button>
                    </>
                )}
            </footer>

            {toast && (
                <div className="fixed inset-x-0 top-4 z-[100] flex justify-center px-4 pointer-events-none">
                    <div
                        key={toast.id}
                        role="status"
                        className={`sds-dialog-enter rounded-xl border px-5 py-3 text-base font-semibold shadow-lg theme-bg ${toast.tone === "error" ? "theme-border-danger theme-danger" : "theme-border theme-h1-color"}`}
                    >
                        {toast.text}
                    </div>
                </div>
            )}

            {openTask && (
                <BoardTaskDialog
                    key={openTask.id}
                    task={openTask}
                    acting={acting}
                    actions={boardActions(openTask, acting)}
                    todayMs={todayMs}
                    onRun={action => run(action, openTask)}
                    onAddNote={body => addNote(openTask, body)}
                    onScan={() => setScanning(true)}
                    onIdentify={() => setIdentifying(true)}
                    onClose={() => setOpenId(null)}
                />
            )}
            {identifying && <BoardIdentifyDialog onActing={startActing} onClose={() => setIdentifying(false)}/>}
            {scanning && (
                <BoardScanDialog
                    clock={clock}
                    facing={facing}
                    onFlip={onFlip}
                    onActing={startActing}
                    onGone={onGone}
                    onClose={() => setScanning(false)}
                />
            )}
        </div>
    )
}

function Column({ label, tasks, loading, autoScroll, todayMs, showBucket, actingId, onOpen }: {
    label: string
    tasks: Task[]
    loading: boolean
    autoScroll: boolean
    todayMs: number
    showBucket: boolean
    actingId: string | null
    onOpen: (id: string) => void
}) {
    const listRef = useRef<HTMLDivElement>(null)
    useAutoScroll(listRef, autoScroll)
    return (
        <section className="min-h-0 rounded-xl border theme-border theme-bg flex flex-col" aria-label={label}>
            <div className="shrink-0 px-4 pt-3 pb-2 flex items-baseline justify-between gap-2">
                <h2 className={`${typeTitle} theme-h1-color`}>{label}</h2>
                <span className={`${typeTitle} theme-subtext-color tabular-nums`}>{loading ? "" : tasks.length}</span>
            </div>
            <div ref={listRef} className="flex-1 min-h-0 overflow-y-auto theme-scrollbar px-3 pb-3 flex flex-col gap-2.5">
                {loading
                    ? [0, 1, 2].map(i => <div key={i} className="h-24 shrink-0 rounded-xl animate-pulse" style={{ background: tint("--theme-border", 45) }}/>)
                    : tasks.length === 0
                        ? <p className="px-1 py-2 text-sm theme-subtext-color">Nothing here.</p>
                        : tasks.map(t => (
                            <BoardCard
                                key={t.id}
                                task={t}
                                todayMs={todayMs}
                                showBucket={showBucket}
                                mine={actingId !== null && isOnTask(t, actingId)}
                                onOpen={() => onOpen(t.id)}
                            />
                        ))}
            </div>
        </section>
    )
}

function Progress({ done, open, overdue }: { done: number; open: number; overdue: number }) {
    const total = done + open
    const pct = total === 0 ? 0 : Math.round((done / total) * 100)
    return (
        <div className="flex-1 min-w-0 flex flex-col gap-1.5">
            <div className="flex items-baseline justify-between gap-3 text-sm theme-subtext-color">
                <span><span className={`${typeTitle} theme-h1-color tabular-nums`}>{done}</span> done this week</span>
                <span className="flex items-baseline gap-4">
                    {overdue > 0 && <span className="theme-danger font-semibold tabular-nums">{overdue} overdue</span>}
                    <span><span className={`${typeTitle} theme-h1-color tabular-nums`}>{open}</span> open</span>
                </span>
            </div>
            <div
                role="progressbar"
                aria-label="Tasks done this week"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={pct}
                className="h-3 rounded-full overflow-hidden"
                style={{ background: tint("--theme-border", 70) }}
            >
                <div className="h-full rounded-full transition-[width] duration-500" style={{ width: `${pct}%`, background: "var(--theme-text-contrast)" }}/>
            </div>
        </div>
    )
}

function Clock() {
    const [date, setDate] = useState(() => new Date())
    useEffect(() => {
        const id = window.setInterval(() => setDate(new Date()), 1000)
        return () => window.clearInterval(id)
    }, [])
    return (
        <div className="shrink-0 text-right">
            <p className={`${typeH1} theme-h1-color tabular-nums`}>
                {date.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}
            </p>
            <p className="text-sm theme-subtext-color">
                {date.toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric" })}
            </p>
        </div>
    )
}
