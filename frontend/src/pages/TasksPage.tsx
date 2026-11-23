import { useEffect, useMemo, useRef, useState, type ReactNode } from "react"
import { useLocation } from "react-router-dom"
import { ChevronDown, ChevronRight, Plus, Search, SlidersHorizontal, X } from "lucide-react"
import Button from "@/components/ui/Button"
import Checkbox from "@/components/ui/Checkbox"
import Dropdown from "@/components/ui/Dropdown"
import EmptyState from "@/components/ui/EmptyState"
import Notice from "@/components/ui/Notice"
import Sheet from "@/components/ui/Sheet"
import Skeleton from "@/components/ui/Skeleton"
import TaskCard from "@/components/tasks/TaskCard"
import TaskDetail from "@/components/tasks/TaskDetail"
import TaskFormSheet from "@/components/tasks/TaskFormSheet"
import { useOnboardedUser } from "@/contexts/authContext"
import { usePageHeader } from "@/contexts/pageHeaderContext"
import { BUCKET_OPTIONS } from "@/lib/taskBuckets"
import { STATUS_LABEL, type Task, type TaskStatus } from "@/lib/tasksApi"
import { TASK_SORT_OPTIONS, compareDone, compareTasks, isOverdue, type TaskSort, type TasksPageState } from "@/lib/taskFormat"
import { useIsMobile } from "@/lib/useIsMobile"
import { useTaskBoard } from "@/lib/useTaskBoard"
import { focusRing } from "@/lib/uiClasses"

type View = "mine" | "open" | "all"
const VIEWS: { key: View; label: string }[] = [
    { key: "mine", label: "Mine" },
    { key: "open", label: "Unclaimed" },
    { key: "all", label: "All" },
]
const CONTROL = "rounded-lg border theme-outline theme-bg theme-text px-3 min-h-11 md:min-h-10 text-sm"
// Columns run in the order work moves; stacked sections lead with what you're doing now.
const COLUMN_ORDER: TaskStatus[] = ["todo", "doing", "review", "done"]
const STACKED_ORDER: TaskStatus[] = ["doing", "review", "todo", "done"]
// The details sit beside the board from this width; narrower, they open over it.
const SIDE_PANEL_MIN = 1280
const SIDE_PANEL_WIDTH = 420
// Columns need about 220px each (three, plus the folded Done); below that the
// groups stack, with their cards in a grid.
const COLUMNS_MIN = 860
// The sidebar and page gutters around the board.
const CHROME = 244

function useWindowWidth(): number {
    const [width, setWidth] = useState(() => window.innerWidth)
    useEffect(() => {
        const onResize = () => setWidth(window.innerWidth)
        window.addEventListener("resize", onResize)
        return () => window.removeEventListener("resize", onResize)
    }, [])
    return width
}

/**
 * The task board: one layout for every screen. Tasks are grouped by status,
 * as columns on web and stacked sections on phones, under four controls:
 * Mine / Unclaimed / All, subteam, search, and a Filter row for the rest
 * (person, overdue only, sort). A card opens its details: a side panel on a
 * wide screen, a sheet otherwise.
 */
export default function TasksPage() {
    usePageHeader("Tasks")
    const user = useOnboardedUser()
    const board = useTaskBoard()
    const { tasks, people, loading, loadError, actionError, setActionError } = board
    const isMobile = useIsMobile()
    const windowWidth = useWindowWidth()
    const wide = windowWidth >= SIDE_PANEL_MIN

    // Links can open a task (`taskId`) or a view: the dashboard's "Your tasks" sends who "me".
    const linked = useLocation().state as TasksPageState | null
    const [view, setView] = useState<View>(linked?.who && linked.who !== "me" ? "all" : "mine")
    const [bucket, setBucket] = useState(linked?.bucket ?? "all")
    const [query, setQuery] = useState("")
    const [filtersOpen, setFiltersOpen] = useState(false)
    const [person, setPerson] = useState("")
    const [overdueOnly, setOverdueOnly] = useState(false)
    const [sort, setSort] = useState<TaskSort>("priority")
    const [doneOpen, setDoneOpen] = useState(false)
    const [openId, setOpenId] = useState<string | null>(null)
    const [editing, setEditing] = useState<Task | null>(null)
    const [creating, setCreating] = useState(false)
    const [highlightId, setHighlightId] = useState<string | null>(null)

    const openTask = openId ? tasks.find(t => t.id === openId) ?? null : null
    const writable = !board.readOnly && !board.offline

    function open(task: Task | null) {
        setOpenId(task?.id ?? null)
        if (task) board.markNotesRead(task)
        else board.cancelMarkNotesRead()
    }

    // A linked task opens once the board has loaded, in the All view so no filter hides it.
    const linkHandled = useRef(false)
    useEffect(() => {
        if (linkHandled.current || loading || !linked?.taskId) return
        linkHandled.current = true
        const task = tasks.find(t => t.id === linked.taskId)
        if (!task) return
        setView("all")
        setBucket("all")
        if (task.status === "done") setDoneOpen(true)
        open(task)
        setHighlightId(task.id)
        requestAnimationFrame(() => document.querySelector(`[data-task-id="${task.id}"]`)?.scrollIntoView({ block: "center", behavior: "smooth" }))
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once, on first load
    }, [loading, tasks])
    // Mine is the default, but someone with nothing of their own lands on All once
    // the board loads (unless they've already picked a view).
    const viewPicked = useRef(false)
    const pickView = (v: View) => { viewPicked.current = true; setView(v) }
    useEffect(() => {
        if (loading || viewPicked.current || linked?.who) return
        viewPicked.current = true
        if (!tasks.some(t => t.status !== "done" && (t.assignee_id === user.id || t.contributors.some(c => c.id === user.id)))) setView("all")
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once, on first load
    }, [loading])
    useEffect(() => {
        if (!highlightId) return
        const timer = setTimeout(() => setHighlightId(null), 2000)
        return () => clearTimeout(timer)
    }, [highlightId])

    const isMine = (t: Task) => t.assignee_id === user.id || t.contributors.some(c => c.id === user.id)
    const live = tasks.filter(t => t.status !== "done")
    const viewCounts: Record<View, number> = {
        mine: live.filter(isMine).length,
        open: live.filter(t => !t.assignee_id).length,
        all: live.length,
    }
    const bucketsInUse = useMemo(() => new Set(tasks.map(t => t.bucket)), [tasks])

    const visible = useMemo(() => {
        const q = query.trim().toLowerCase()
        return tasks.filter(t => {
            if (view === "mine" && !isMine(t)) return false
            if (view === "open" && (t.assignee_id || t.status === "done")) return false
            if (bucket !== "all" && t.bucket !== bucket) return false
            if (person && t.assignee_id !== person && !t.contributors.some(c => c.id === person)) return false
            if (overdueOnly && !isOverdue(t, board.todayMs)) return false
            if (q && !t.title.toLowerCase().includes(q) && !t.area.toLowerCase().includes(q)) return false
            return true
        })
    // eslint-disable-next-line react-hooks/exhaustive-deps -- isMine reads user.id, listed
    }, [tasks, view, bucket, person, overdueOnly, query, board.todayMs, user.id])

    const columns = useMemo(() => {
        const by: Record<TaskStatus, Task[]> = { todo: [], doing: [], review: [], done: [] }
        for (const t of visible) by[t.status].push(t)
        for (const s of ["todo", "doing", "review"] as const) by[s].sort(compareTasks(sort))
        by.done.sort(compareDone)
        return by
    }, [visible, sort])

    const boardWidth = windowWidth - CHROME - (wide && openTask ? SIDE_PANEL_WIDTH : 0)
    const asColumns = !isMobile && boardWidth >= COLUMNS_MIN

    const activeFilters = (person ? 1 : 0) + (overdueOnly ? 1 : 0) + (sort !== "priority" ? 1 : 0)
    const nothingShown = visible.length === 0
    const defaultBucket = bucket !== "all" ? bucket : (board.mySubteam ?? "general")

    const card = (t: Task) => (
        <TaskCard key={t.id} task={t} board={board} currentUserId={user.id}
            selected={openId === t.id} highlighted={highlightId === t.id}
            onOpen={() => open(openId === t.id ? null : t)} />
    )

    const detail = openTask && (
        <TaskDetail task={openTask} board={board} user={user} people={people} onEdit={() => setEditing(openTask)} />
    )

    return (
        <div className="px-4 md:px-6 py-4 md:py-6 pb-28 flex flex-col gap-4">
            {/* ── Controls ─────────────────────────────────────────── */}
            <div className="flex flex-wrap items-center gap-2 md:gap-3">
                <div role="radiogroup" aria-label="Show" className="flex gap-1 p-1 rounded-xl border theme-border w-full md:w-auto" style={{ background: "var(--theme-button-bg)" }}>
                    {VIEWS.map(v => {
                        const active = view === v.key
                        return (
                            <button key={v.key} type="button" role="radio" aria-checked={active} onClick={() => pickView(v.key)}
                                className={`flex-1 md:flex-none min-h-9 px-4 rounded-lg text-sm font-semibold whitespace-nowrap ${focusRing}`}
                                style={{
                                    background: active ? "var(--theme-bg)" : "transparent",
                                    color: active ? "var(--theme-text-contrast)" : "var(--theme-subtext-color)",
                                    boxShadow: active ? "0 0 0 1px var(--theme-border)" : "none",
                                }}>
                                {v.label} <span className="font-normal opacity-80">{viewCounts[v.key]}</span>
                            </button>
                        )
                    })}
                </div>

                {!isMobile && (
                    <div className="w-44">
                        <Dropdown value={bucket} onChange={setBucket} label="Subteam" triggerClassName={`${CONTROL} w-full`}
                            options={[{ value: "all", label: "All subteams" }, ...BUCKET_OPTIONS.filter(b => bucketsInUse.has(b.value))]} />
                    </div>
                )}

                <label className={`${CONTROL} flex-1 min-w-40 md:max-w-xs flex items-center gap-2 focus-within:ring-2 focus-within:ring-[var(--theme-text-contrast)]`}>
                    <Search size={16} className="shrink-0 theme-subtext-color" aria-hidden="true" />
                    <input type="search" value={query} onChange={e => setQuery(e.target.value)} placeholder="Search tasks" aria-label="Search tasks"
                        className="flex-1 min-w-0 bg-transparent outline-none text-base md:text-sm placeholder:text-[var(--theme-subtext-color)]" />
                </label>

                <button type="button" onClick={() => setFiltersOpen(v => !v)} aria-expanded={filtersOpen}
                    className={`${CONTROL} flex items-center gap-2 shrink-0 ${focusRing}`}
                    style={activeFilters > 0 ? { borderColor: "var(--theme-text-contrast)", color: "var(--theme-text-contrast)" } : undefined}>
                    <SlidersHorizontal size={16} aria-hidden="true" />
                    <span className="hidden sm:inline">Filter</span>
                    {activeFilters > 0 && <span className="text-xs font-bold">{activeFilters}</span>}
                </button>
            </div>

            {/* Phones: subteams as a chip row. */}
            {isMobile && (
                <div className="flex gap-2 overflow-x-auto -mx-4 px-4 pb-0.5" style={{ scrollbarWidth: "none" }}>
                    {[{ value: "all", label: "All subteams" }, ...BUCKET_OPTIONS.filter(b => bucketsInUse.has(b.value))].map(b => {
                        const active = bucket === b.value
                        return (
                            <button key={b.value} type="button" onClick={() => setBucket(b.value)} aria-pressed={active}
                                className={`shrink-0 min-h-9 px-3.5 rounded-full border text-sm whitespace-nowrap ${focusRing}`}
                                style={{
                                    borderColor: active ? "var(--theme-text-contrast)" : "var(--theme-border)",
                                    color: active ? "var(--theme-text-contrast)" : "var(--theme-text)",
                                    background: active ? "var(--ag-grid-selected-bg)" : "transparent",
                                    fontWeight: active ? 600 : 400,
                                }}>
                                {b.label}
                            </button>
                        )
                    })}
                </div>
            )}

            {filtersOpen && (
                <div className="flex flex-wrap items-center gap-3 p-3 rounded-xl border theme-border theme-bg">
                    <div className="w-full sm:w-52">
                        <Dropdown value={person} onChange={setPerson} label="Person" searchable triggerClassName={`${CONTROL} w-full`}
                            options={[{ value: "", label: "Anyone" }, ...people.map(p => ({ value: p.id, label: p.display_name }))]} />
                    </div>
                    <div className="w-full sm:w-44">
                        <Dropdown value={sort} onChange={v => setSort(v as TaskSort)} label="Sort" triggerClassName={`${CONTROL} w-full`} options={TASK_SORT_OPTIONS} />
                    </div>
                    <label className="flex items-center gap-2 text-sm theme-text cursor-pointer min-h-11">
                        <Checkbox checked={overdueOnly} onChange={() => setOverdueOnly(v => !v)} />
                        Overdue only
                    </label>
                    {activeFilters > 0 && (
                        <Button variant="text" className="ml-auto" onClick={() => { setPerson(""); setOverdueOnly(false); setSort("priority") }}>Clear</Button>
                    )}
                </div>
            )}

            {loadError && <Notice>{loadError}</Notice>}
            {actionError && <Notice onDismiss={() => setActionError(null)}>{actionError}</Notice>}

            {/* ── Board ────────────────────────────────────────────── */}
            {loading ? (
                <div role="status" aria-label="Loading tasks" className="grid gap-3 md:grid-cols-3">
                    {[0, 1, 2].map(i => <div key={i} className="flex flex-col gap-3"><Skeleton className="h-5 w-24" /><Skeleton className="h-24 w-full rounded-xl" /><Skeleton className="h-24 w-full rounded-xl" /></div>)}
                </div>
            ) : nothingShown ? (
                <div className="rounded-xl border border-dashed theme-border theme-bg">
                    <EmptyState variant="screen" title={view === "mine" && !query && !activeFilters ? "Nothing on your plate" : "No tasks match"}/>
                </div>
            ) : (
                <div className="flex items-start gap-5">
                    <div className={asColumns ? "flex-1 min-w-0 grid gap-4 items-start" : "flex-1 min-w-0 flex flex-col gap-5"}
                        style={asColumns ? { gridTemplateColumns: `repeat(3, minmax(0, 1fr)) ${doneOpen ? "minmax(0, 1fr)" : "88px"}` } : undefined}>
                        {(asColumns ? COLUMN_ORDER : STACKED_ORDER).map(status => status === "done" ? (
                            <DoneColumn key="done" tasks={columns.done} open={doneOpen} onToggle={() => setDoneOpen(v => !v)} narrow={asColumns && !doneOpen} stacked={!asColumns} card={card} />
                        ) : (
                            <section key={status} aria-label={STATUS_LABEL[status]} className="flex flex-col gap-2 min-w-0">
                                <ColumnHeader label={STATUS_LABEL[status]} count={columns[status].length} />
                                {columns[status].length === 0
                                    ? <p className="text-xs theme-subtext-color px-1 py-3 rounded-xl border border-dashed theme-border text-center">None</p>
                                    : <Cards stacked={!asColumns}>{columns[status].map(card)}</Cards>}
                            </section>
                        ))}
                    </div>

                    {/* Wide screens: details beside the board. */}
                    {wide && openTask && (
                        <aside aria-label="Task details" className="w-[400px] shrink-0 sticky top-4 self-start rounded-xl border theme-border theme-bg flex flex-col"
                            style={{ maxHeight: "calc(var(--app-vh, 100dvh) - 7rem)" }}>
                            <div className="flex items-start gap-2 px-5 pt-4 pb-3 border-b theme-border">
                                <h2 className="flex-1 min-w-0 text-lg font-bold leading-snug theme-h1-color break-words">{openTask.title}</h2>
                                <Button variant="icon" aria-label="Close task details" onClick={() => open(null)}><X size={18} /></Button>
                            </div>
                            <div className="flex-1 min-h-0 overflow-y-auto theme-scrollbar px-5 py-4">{detail}</div>
                        </aside>
                    )}
                </div>
            )}

            {/* Narrower screens: details over the board. */}
            {!wide && openTask && (
                <Sheet title={openTask.title} onClose={() => open(null)}>{detail}</Sheet>
            )}

            {/* Hidden while the side panel is open, where it would sit over the panel's buttons. */}
            {writable && !(wide && openTask) && (
                <Button variant="fab" aria-label="New task" onClick={() => setCreating(true)}>
                    <Plus size={21} />
                </Button>
            )}
            {creating && <TaskFormSheet mode="create" board={board} people={people} defaultBucket={defaultBucket} onClose={() => setCreating(false)} />}
            {editing && <TaskFormSheet mode="edit" task={editing} board={board} people={people} defaultBucket={editing.bucket} onClose={() => setEditing(null)} />}
        </div>
    )
}

function ColumnHeader({ label, count }: { label: string; count: number }) {
    return (
        <h2 className="flex items-baseline justify-between gap-2 px-1 text-xs font-semibold uppercase tracking-widest theme-subtext-color">
            <span>{label}</span>
            <span className="tracking-normal">{count}</span>
        </h2>
    )
}

/** A group's cards: one column of them, or a grid when the groups are stacked. */
function Cards({ stacked, children }: { stacked: boolean; children: ReactNode }) {
    return stacked
        ? <div className="grid gap-2 grid-cols-[repeat(auto-fill,minmax(min(100%,260px),1fr))]">{children}</div>
        : <div className="flex flex-col gap-2">{children}</div>
}

/** Done, folded by default: a count you can open to see the most recently finished. */
function DoneColumn({ tasks, open, onToggle, narrow, stacked, card }: {
    tasks: Task[]; open: boolean; onToggle: () => void; narrow: boolean; stacked: boolean; card: (t: Task) => ReactNode
}) {
    const Chevron = open ? ChevronDown : ChevronRight
    return (
        <section aria-label="Done" className="flex flex-col gap-2 min-w-0">
            {narrow ? (
                <>
                    <ColumnHeader label="Done" count={tasks.length} />
                    <button type="button" onClick={onToggle} aria-expanded={false}
                        className={`rounded-xl border border-dashed theme-border py-4 text-sm font-semibold theme-text-contrast hover:bg-(--ag-grid-hover-bg) ${focusRing}`}>
                        Show
                    </button>
                </>
            ) : (
                <>
                    <button type="button" onClick={onToggle} aria-expanded={open}
                        className={`flex items-center gap-1.5 px-1 text-xs font-semibold uppercase tracking-widest theme-subtext-color hover:text-(--theme-h1-color) ${focusRing}`}>
                        <Chevron size={14} aria-hidden="true" />
                        <span>Done</span>
                        <span className="ml-auto tracking-normal">{tasks.length}</span>
                    </button>
                    {open && (tasks.length === 0
                        ? <p className="text-xs theme-subtext-color px-1 py-3 rounded-xl border border-dashed theme-border text-center">None</p>
                        : <Cards stacked={stacked}>{tasks.map(card)}</Cards>)}
                </>
            )}
        </section>
    )
}
