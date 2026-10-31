import { useEffect, useId, useMemo, useRef, useState, type CSSProperties, type FormEvent, type ReactNode } from "react"
import { useLocation } from "react-router-dom"
import { ChevronDown, MessageSquare, Plus, Trash2, X } from "lucide-react"
import { useOnboardedUser, type OnboardedUser } from "@/contexts/authContext"
import Dropdown from "@/components/ui/Dropdown"
import Button from "@/components/ui/Button"
import EmptyState from "@/components/ui/EmptyState"
import FormFooter from "@/components/ui/FormFooter"
import Notice from "@/components/ui/Notice"
import Sheet from "@/components/ui/Sheet"
import { confirmAnyDiscard, useDiscardGuard, useIsDirty } from "@/lib/useDiscardGuard"
import Skeleton from "@/components/ui/Skeleton"
import Toggle from "@/components/ui/Toggle"
import AreaInput from "@/components/tasks/AreaInput"
import HelpTip from "@/components/tasks/HelpTip"
import { BUCKET_OPTIONS, TASK_BUCKETS, bucketLabel } from "@/lib/taskBuckets"
import {
    addContributor, addNote, createTask, deleteNote, fetchNotes, leaveTask, removeContributor, reviewTask, unreviewTask, updateTask,
    PRIORITY_LABEL, STATUS_LABEL,
    type CreateTaskInput, type Person, type Task, type TaskNote, type TaskPriority, type UpdateTaskInput,
} from "@/lib/tasksApi"
import {
    DANGER_RED, PRIORITY_COLOR, AVATAR_INK, failMessage, TASK_SORT_OPTIONS, CRITICAL_BADGE_STYLE, priorityChoices,
    tint, tintColor, avatarBg, initialOf, formatRelativeTime, formatPosted, rowDue, assigneeOptions, compareTasks, compareDone,
    matchesFilter, type SettableStatus, type TaskFilter, type TaskSort, type TasksPageState, type WhoFilter,
    areaSuggestions, TASK_FIELD_HELP,
} from "@/lib/taskFormat"
import { useTaskBoard, type TaskBoard } from "@/lib/useTaskBoard"
import { fieldLabelClass, focusRing, helperClass, inputClass, menuRowClass, typeH1, typeH2 } from "@/lib/uiClasses"

const DROPDOWN_TRIGGER_CLASS = "rounded-lg border theme-outline theme-bg theme-text px-3 min-h-11 text-sm font-semibold"
const CONTRIBUTOR_DROPDOWN_TRIGGER_CLASS = "rounded-lg border theme-outline theme-bg theme-subtext-color px-3 min-h-11 text-xs font-semibold"

/** Same idea as `taskFormat`'s `tint` (a `--theme-*` token blended with
 *  `color-mix`), but toward black instead of transparent -- the mock uses
 *  this for "recessed" surfaces (the status picker tray, the notes drawer)
 *  sitting a shade darker than the page background. Not part of the shared
 *  `taskFormat` surface since only this page's recessed panels need it;
 *  still fully token-based. */
function tintDark(token: string, pct: number): string {
    return `color-mix(in oklch, var(${token}) ${pct}%, black)`
}

type Scope = "all" | "unclaimed" | "review"
type ReviewTabKey = "review" | "done"

/** One collapsible area section of the list. `key` folds the bucket in so
 *  the same area name under two subteams collapses independently. */
interface AreaGroup { key: string; area: string; tasks: Task[] }
interface SubteamGroup { bucket: string; label: string; count: number; areas: AreaGroup[] }

/** Areas group case-insensitively (older rows may differ only in case) --
 *  same rule as the desktop board's area grouping. */
function areaKey(task: Task): string {
    return `${task.bucket}:${task.area.toLowerCase()}`
}

/** Splits an already-sorted list into area sections, alphabetical by area,
 *  showing the first spelling seen. Rows keep their incoming order. */
function groupByArea(list: Task[]): AreaGroup[] {
    const byArea = new Map<string, AreaGroup>()
    for (const t of list) {
        const key = areaKey(t)
        const group = byArea.get(key)
        if (group) group.tasks.push(t)
        else byArea.set(key, { key, area: t.area, tasks: [t] })
    }
    return Array.from(byArea.values()).sort((a, b) => a.area.localeCompare(b.area))
}

/**
 * Mobile task board. `AppShell` already renders the mobile header and the
 * 5-tab bottom bar (see CONTRACT.md "Design -> real app mapping"), so this
 * page is board content only: scope tiles, a subteam chip rail, filters, the
 * task list (grouped into collapsible area sections, with done tasks in a
 * collapsed "Done" section at the very bottom), and a FAB that opens the
 * new-task sheet.
 *
 * All state/permission logic comes from `useTaskBoard()` + `taskFormat`,
 * shared verbatim with the desktop board so the two pages can't drift on
 * *behavior* -- only layout differs. Deliberate differences from the design
 * mock (`TaskBoardMobile.dc.html`), all because the web board's behavior is
 * the real spec (CONTRACT.md point 3):
 *
 *  - The status badge's 3-up picker and primary action button are disabled
 *    for a `done` task (the mock's picker only ever offers todo/doing/review
 *    anyway; a done task uses the dedicated "Reopen" primary button instead).
 *  - The card's inline status picker, contributors block and primary button
 *    all gate on the same permission rules `TaskRow`/`ContributorsSection`
 *    use on desktop (`canEditTask`, the finisher-can't-self-review 403, the
 *    unassigned/done contributor-add 400) -- the mock's prototype only knows
 *    `isPrivileged`.
 *  - Priority uses the shared `PRIORITY_COLOR` accents (desktop's palette)
 *    rather than the mock's theme-token-tier coloring, so priority reads the
 *    same on both boards.
 *  - The mock's card has no overflow ("...") control at all; CONTRACT.md
 *    requires one (Edit / Send back to To do / Delete), so it's added here
 *    as a small icon button next to the status badge, opening a bottom sheet
 *    in the same visual language as the New/Edit task sheets.
 *  - No status dropdown: the Tasks / Unclaimed / Review & done tiles (and
 *    the Awaiting review / Completed tabs) already cover it. Under Tasks,
 *    done work sits in a collapsed "Done" section at the bottom.
 */
export default function TasksPageMobile() {
    const user = useOnboardedUser()
    const board = useTaskBoard()
    const { tasks, people, loading, loadError, actionError, setActionError } = board

    // Router state (e.g. from the dashboard card) pre-sets the filters, same
    // as the desktop board; otherwise land in the viewer's own subteam.
    const initialState = useLocation().state as TasksPageState | null
    const targetTaskId = initialState?.taskId ?? null

    const [scope, setScope] = useState<Scope>("all")
    const [bucketFilter, setBucketFilter] = useState<string>(initialState?.bucket ?? board.mySubteam ?? "all")
    const [whoFilter, setWhoFilter] = useState<WhoFilter>(initialState?.who ?? "everyone")
    const [reviewTab, setReviewTab] = useState<ReviewTabKey>("review")
    const [sort, setSort] = useState<TaskSort>("priority")

    // Area sections start expanded (a set of *collapsed* keys); the Done
    // section starts collapsed.
    const [collapsedAreas, setCollapsedAreas] = useState<Set<string>>(() => new Set())
    const [doneOpen, setDoneOpen] = useState(false)
    // The task opened from router state, outlined briefly after scrolling to it.
    const [highlightId, setHighlightId] = useState<string | null>(null)

    // Only one status picker, one notes drawer and one "..." sheet open at a
    // time, board-wide -- mirrors the desktop board's single expandedId/
    // menuOpenId/statusMenuOpenId (CONTRACT.md "Task card").
    const [pickerOpenId, setPickerOpenId] = useState<string | null>(null)
    const [notesOpenId, setNotesOpenId] = useState<string | null>(null)
    const [menuOpenId, setMenuOpenId] = useState<string | null>(null)
    const [newTaskOpen, setNewTaskOpen] = useState(false)
    const [editingTask, setEditingTask] = useState<Task | null>(null)

    const live = useMemo(() => tasks.filter(t => t.status !== "done"), [tasks])
    const done = useMemo(() => tasks.filter(t => t.status === "done"), [tasks])

    // Tile and tab counts follow the selected subteam (the whole board under
    // "All tasks"), unfiltered by who -- inside a subteam, "Unclaimed 3"
    // means three of that subteam's tasks, same as the web header chips.
    const inBucket = (t: Task) => bucketFilter === "all" || t.bucket === bucketFilter
    const scopedLive = live.filter(inBucket)
    const scopedDoneCount = done.filter(inBucket).length
    const unclaimedLiveCount = scopedLive.filter(t => !t.assignee_id).length
    const reviewLiveCount = scopedLive.filter(t => t.status === "review").length

    const tiles: { key: Scope; label: string; count: number }[] = [
        { key: "all", label: "Tasks", count: scopedLive.length },
        { key: "unclaimed", label: "Unclaimed", count: unclaimedLiveCount },
        { key: "review", label: "Review & done", count: reviewLiveCount },
    ]
    const showReviewTabs = scope === "review"
    const reviewTabs: { key: ReviewTabKey; label: string; count: number }[] = [
        { key: "review", label: "Awaiting review", count: reviewLiveCount },
        { key: "done", label: "Completed", count: scopedDoneCount },
    ]
    const showingCompleted = scope === "review" && reviewTab === "done"

    // Subteam chip counts read the live pool only -- *not* narrowed by the
    // Unclaimed/Review scope, matching the design mock's own chip-count
    // computation. Switching to a bucket while scoped to "Unclaimed" is meant
    // to show "how many total tasks does CAD have", not "how many of CAD's
    // tasks are currently unclaimed" -- that number is what the list shows.
    const chips = [{ value: "all", label: "All tasks" }, ...BUCKET_OPTIONS].map(b => ({
        ...b,
        count: b.value === "all" ? live.length : live.filter(t => t.bucket === b.value).length,
    }))

    const visibleTasks = useMemo(() => {
        let list = showingCompleted ? done : live
        if (scope === "unclaimed") list = list.filter(t => !t.assignee_id)
        if (scope === "review" && !showingCompleted) list = list.filter(t => t.status === "review")
        const filter: TaskFilter = { bucket: bucketFilter, status: "all", who: whoFilter, quick: null }
        return list.filter(t => matchesFilter(t, filter, user.id, board.todayMs)).sort(showingCompleted ? compareDone : compareTasks(sort))
    }, [live, done, scope, showingCompleted, bucketFilter, whoFilter, sort, user.id, board.todayMs])

    // A single subteam groups straight into area sections; "All tasks" adds
    // a subteam header above each subteam's own area sections.
    const showSubteamHeaders = bucketFilter === "all"
    const groups = useMemo<SubteamGroup[]>(() => {
        if (bucketFilter !== "all") {
            return [{ bucket: bucketFilter, label: bucketLabel(bucketFilter), count: visibleTasks.length, areas: groupByArea(visibleTasks) }]
        }
        const result: SubteamGroup[] = []
        for (const bucket of TASK_BUCKETS) {
            const bucketTasks = visibleTasks.filter(t => t.bucket === bucket)
            if (bucketTasks.length === 0) continue
            result.push({ bucket, label: bucketLabel(bucket), count: bucketTasks.length, areas: groupByArea(bucketTasks) })
        }
        return result
    }, [bucketFilter, visibleTasks])

    // The bottom Done section belongs to the Tasks tile only -- Unclaimed is
    // about live work, and Review & done has its own Completed tab.
    const showDone = scope === "all"
    const doneTasks = useMemo(() => {
        const filter: TaskFilter = { bucket: bucketFilter, status: "all", who: whoFilter, quick: null }
        return done.filter(t => matchesFilter(t, filter, user.id, board.todayMs)).sort(compareDone)
    }, [done, bucketFilter, whoFilter, user.id, board.todayMs])

    function toggleArea(key: string) {
        setCollapsedAreas(prev => {
            const next = new Set(prev)
            if (next.has(key)) next.delete(key)
            else next.add(key)
            return next
        })
    }

    // Opening a specific task (router state `taskId`): once tasks have
    // loaded, loosen whatever filter would hide it, expand its section and
    // highlight it. The ref keeps this to the first load only -- later
    // filter changes are the user's own.
    const targetHandledRef = useRef(false)
    useEffect(() => {
        if (targetHandledRef.current || !targetTaskId || loading) return
        targetHandledRef.current = true
        const task = tasks.find(t => t.id === targetTaskId)
        if (!task) return
        setScope("all")
        if (bucketFilter !== "all" && task.bucket !== bucketFilter) setBucketFilter(task.bucket)
        if (!matchesFilter(task, { bucket: "all", status: "all", who: whoFilter, quick: null }, user.id, board.todayMs)) setWhoFilter("everyone")
        if (task.status === "done") {
            setDoneOpen(true)
        } else {
            setCollapsedAreas(prev => {
                if (!prev.has(areaKey(task))) return prev
                const next = new Set(prev)
                next.delete(areaKey(task))
                return next
            })
        }
        setHighlightId(task.id)
    }, [loading, tasks, targetTaskId, bucketFilter, whoFilter, user.id, board.todayMs])

    // Scroll the highlighted card into view once it has rendered, then let
    // the highlight fade (the card's transition handles the fade itself).
    useEffect(() => {
        if (!highlightId) return
        const frame = requestAnimationFrame(() => {
            document.querySelector(`[data-task-id="${CSS.escape(highlightId)}"]`)?.scrollIntoView({ block: "center" })
        })
        const timer = setTimeout(() => setHighlightId(null), 2000)
        return () => {
            cancelAnimationFrame(frame)
            clearTimeout(timer)
        }
    }, [highlightId])

    // Keep the active subteam chip visible -- on mount it's usually the
    // viewer's own subteam, which can sit well off the right edge of the
    // rail. Scrolls the rail only (never the page); instant the first time.
    const chipRailRef = useRef<HTMLDivElement>(null)
    const chipRailScrolledRef = useRef(false)
    useEffect(() => {
        const rail = chipRailRef.current
        const chip = rail?.querySelector<HTMLElement>("[data-active=\"true\"]")
        if (!rail || !chip) return
        // offsetLeft includes the rail's 16px left padding; subtracting it
        // lines the chip up with the scroll-snap padding.
        rail.scrollTo({ left: chip.offsetLeft - 16, behavior: chipRailScrolledRef.current ? "smooth" : "auto" })
        chipRailScrolledRef.current = true
    }, [loading, bucketFilter])

    const whoOptions = [
        { value: "everyone", label: "Everyone" },
        { value: "me", label: "My tasks" },
        { value: "unclaimed", label: "Unassigned" },
        ...people.map(p => ({ value: p.id, label: p.display_name })),
    ]

    const listLabel = scope === "unclaimed"
        ? "Unclaimed"
        : scope === "review"
            ? (showingCompleted ? "Completed" : "Awaiting review")
            : (bucketFilter === "all" ? "All tasks" : bucketLabel(bucketFilter))
    const shownCount = `${visibleTasks.length} ${visibleTasks.length === 1 ? "task" : "tasks"}`

    // New-task sheet's subteam default: the active chip beats the viewer's
    // own subteam beats a plain "general" fallback (CONTRACT.md "New task
    // sheet").
    const defaultBucket = bucketFilter !== "all" ? bucketFilter : (board.mySubteam ?? "general")

    const menuTask = menuOpenId ? tasks.find(t => t.id === menuOpenId) ?? null : null

    function renderCard(task: Task) {
        return (
            <TaskCard
                key={task.id}
                task={task}
                board={board}
                user={user}
                people={people}
                todayMs={board.todayMs}
                highlighted={highlightId === task.id}
                pickerOpen={pickerOpenId === task.id}
                notesOpen={notesOpenId === task.id}
                onTogglePicker={() => setPickerOpenId(id => (id === task.id ? null : task.id))}
                onToggleNotes={() => void confirmAnyDiscard().then(ok => { if (ok) setNotesOpenId(id => (id === task.id ? null : task.id)) })}
                onToggleMenu={() => setMenuOpenId(id => (id === task.id ? null : task.id))}
            />
        )
    }

    if (loading) {
        return (
            <div role="status" aria-label="Loading tasks" className="flex flex-col gap-3 px-4 pt-4">
                <Skeleton className="h-8 w-40" />
                <div className="flex gap-2">
                    {[0, 1, 2].map(i => <Skeleton key={i} className="h-14 flex-1 rounded-xl" />)}
                </div>
                {[0, 1, 2, 3].map(i => <Skeleton key={i} className="h-32 w-full rounded-xl" />)}
            </div>
        )
    }

    return (
        <div className="flex flex-col">
            <div className="px-4 pt-4">
                <h1 className={`${typeH1} theme-h1-color`}>Task board</h1>
                <div className="flex gap-2 mt-3">
                    {tiles.map(tile => {
                        const active = scope === tile.key
                        return (
                            <button key={tile.key} type="button" onClick={() => setScope(tile.key)} className={`flex-1 min-w-0 text-left px-3 py-2 rounded-xl border cursor-pointer ${focusRing}`} style={tileStyle(active)}>
                                <div className="text-lg font-bold" style={{ color: active ? "var(--theme-text-contrast)" : "var(--theme-h1-color)" }}>{tile.count}</div>
                                <div className="text-xs uppercase tracking-wider" style={{ color: active ? "var(--theme-text-contrast)" : "var(--theme-subtext-color)" }}>{tile.label}</div>
                            </button>
                        )
                    })}
                </div>

                {loadError && <div className="mt-3"><ErrorBanner message={loadError} /></div>}
                {actionError && <div className="mt-3"><ErrorBanner message={actionError} onDismiss={() => setActionError(null)} /></div>}
            </div>

            {/* Firefox honors scrollbarWidth inline; Chrome/Safari need the
                ::-webkit-scrollbar rule below, which can't be expressed as a
                React style object -- a scoped <style> tag (same pattern
                AppShell.tsx uses for its spin keyframes) keeps it self
                contained in this one file. `relative` makes the rail the
                chips' offsetParent for the scroll-into-view above. */}
            <div ref={chipRailRef} className="tasks-mobile-chip-rail relative flex gap-2 overflow-x-auto px-4 pt-4 pb-0.5" style={{ scrollbarWidth: "none", scrollPaddingInline: 16, scrollSnapType: "x mandatory" }}>
                {chips.map(chip => {
                    const active = bucketFilter === chip.value
                    return (
                        <button key={chip.value} type="button" data-active={active} onClick={() => setBucketFilter(chip.value)} className={`flex-none snap-start flex items-center gap-2 min-h-11 px-4 rounded-full border text-sm font-semibold whitespace-nowrap cursor-pointer ${focusRing}`} style={chipStyle(active)}>
                            <span>{chip.label}</span>
                            <span className="text-xs font-bold opacity-70">{chip.count}</span>
                        </button>
                    )
                })}
            </div>
            <style>{".tasks-mobile-chip-rail::-webkit-scrollbar { display: none }"}</style>

            <div className="flex items-center gap-2 px-4 pt-3 pb-1">
                <div className="flex-1 min-w-0">
                    <Dropdown value={whoFilter} onChange={v => setWhoFilter(v as WhoFilter)} options={whoOptions} triggerClassName={DROPDOWN_TRIGGER_CLASS} searchable label="Filter by person" />
                </div>
                <div className="flex-1 min-w-0">
                    <Dropdown value={sort} onChange={v => setSort(v as TaskSort)} options={TASK_SORT_OPTIONS} triggerClassName={DROPDOWN_TRIGGER_CLASS} menuAlign="right" label="Sort tasks" />
                </div>
            </div>

            {showReviewTabs && (
                <div className="flex gap-1 mx-4 mt-3 p-1 rounded-xl border" style={{ borderColor: tint("--theme-border", 70), background: "var(--theme-button-bg)" }}>
                    {reviewTabs.map(tab => {
                        const active = reviewTab === tab.key
                        return (
                            <button key={tab.key} type="button" onClick={() => setReviewTab(tab.key)} className={`flex-1 min-w-0 min-h-11 rounded-lg border-0 text-xs font-bold cursor-pointer ${focusRing}`} style={reviewTabStyle(active)}>
                                {tab.label} · {tab.count}
                            </button>
                        )
                    })}
                </div>
            )}

            <div className="flex flex-col gap-3 px-4 pt-4" style={{ paddingBottom: "calc(132px + env(safe-area-inset-bottom))" }}>
                <div className="flex items-baseline justify-between gap-3">
                    <div className={`${typeH2} theme-subtext-color`}>{listLabel}</div>
                    <div className="text-xs theme-subtext-color">{shownCount}</div>
                </div>

                {groups.map(group => (
                    <div key={group.bucket} className="flex flex-col gap-3">
                        {showSubteamHeaders && (
                            <div className="flex items-baseline justify-between gap-3 pt-3 border-t text-base font-bold theme-h1-color" style={{ borderColor: tint("--theme-border", 45) }}>
                                <span>{group.label}</span>
                                <span className="text-xs font-semibold theme-subtext-color">{group.count}</span>
                            </div>
                        )}
                        {group.areas.map(area => {
                            const open = !collapsedAreas.has(area.key)
                            return (
                                <div key={area.key} className="flex flex-col gap-3">
                                    <SectionToggle title={area.area || "No area"} count={area.tasks.length} open={open} onToggle={() => toggleArea(area.key)} />
                                    {open && area.tasks.map(renderCard)}
                                </div>
                            )
                        })}
                    </div>
                ))}

                {visibleTasks.length === 0 && (
                    <div className="rounded-xl border border-dashed theme-border">
                        <EmptyState variant="screen" title="Nothing here yet">
                            Try a different subteam or filter.
                        </EmptyState>
                    </div>
                )}

                {showDone && doneTasks.length > 0 && (
                    <div className="flex flex-col gap-3 mt-2 pt-4 border-t" style={{ borderColor: tint("--theme-border", 45) }}>
                        <SectionToggle title={`Done (${doneTasks.length})`} open={doneOpen} onToggle={() => setDoneOpen(o => !o)} />
                        {doneOpen && doneTasks.map(renderCard)}
                    </div>
                )}
            </div>

            <Button variant="fab" aria-label="New task" onClick={() => setNewTaskOpen(true)}>
                <Plus size={21} />
            </Button>

            {newTaskOpen && (
                <TaskFormSheet mode="create" board={board} people={people} defaultBucket={defaultBucket} onClose={() => setNewTaskOpen(false)} />
            )}
            {editingTask && (
                <TaskFormSheet mode="edit" task={editingTask} board={board} people={people} defaultBucket={editingTask.bucket} onClose={() => setEditingTask(null)} />
            )}
            {menuTask && (
                <TaskActionSheet task={menuTask} board={board} onClose={() => setMenuOpenId(null)} onEdit={() => setEditingTask(menuTask)} />
            )}
        </div>
    )
}

/** Collapsible section header: an area (title + count) or the Done section
 *  (count already in the title). Chevron points down when open. */
function SectionToggle({ title, count, open, onToggle }: { title: string; count?: number; open: boolean; onToggle: () => void }) {
    return (
        <button
            type="button"
            onClick={onToggle}
            aria-expanded={open}
            className={`w-full min-h-11 flex items-center justify-between gap-3 px-3 rounded-xl border text-sm font-bold text-left theme-text cursor-pointer ${focusRing}`}
            style={{ borderColor: tint("--theme-border", 55), background: tint("--theme-border", 20) }}
        >
            <span className="min-w-0 truncate">{title}</span>
            <span className="flex-none flex items-center gap-2 theme-subtext-color">
                {count !== undefined && <span className="text-xs font-semibold">{count}</span>}
                <ChevronDown size={16} style={{ transition: "transform 150ms", transform: open ? "none" : "rotate(-90deg)" }} />
            </span>
        </button>
    )
}

function ErrorBanner({ message, onDismiss }: { message: string; onDismiss?: () => void }) {
    return (
        <Notice>
            <div className="flex items-center justify-between gap-2">
                <span>{message}</span>
                {onDismiss && (
                    <Button variant="icon" aria-label="Dismiss" className="shrink-0 -my-3 -mr-3" onClick={onDismiss}>
                        <X size={14} />
                    </Button>
                )}
            </div>
        </Notice>
    )
}

function reviewTabStyle(active: boolean): CSSProperties {
    return {
        background: active ? tint("--theme-text-contrast", 18) : "transparent",
        color: active ? "var(--theme-text-contrast)" : "var(--theme-subtext-color)",
    }
}
function tileStyle(active: boolean): CSSProperties {
    return {
        borderColor: active ? "var(--theme-text-contrast)" : tint("--theme-border", 70),
        background: active ? tint("--theme-text-contrast", 14) : "var(--theme-button-bg)",
    }
}
function chipStyle(active: boolean): CSSProperties {
    return {
        borderColor: active ? "var(--theme-text-contrast)" : tint("--theme-border", 75),
        background: active ? tint("--theme-text-contrast", 16) : "var(--theme-button-bg)",
        color: active ? "var(--theme-text-contrast)" : "var(--theme-text)",
    }
}

// ── Task card ────────────────────────────────────────────────────────────

interface TaskCardProps {
    task: Task
    board: TaskBoard
    user: OnboardedUser
    people: Person[]
    todayMs: number
    /** Briefly outlined after being opened from the dashboard. */
    highlighted: boolean
    pickerOpen: boolean
    notesOpen: boolean
    onTogglePicker: () => void
    onToggleNotes: () => void
    onToggleMenu: () => void
}

const PICKER_CHOICES: SettableStatus[] = ["todo", "doing", "review"]

function TaskCard({ task, board, user, people, todayMs, highlighted, pickerOpen, notesOpen, onTogglePicker, onToggleNotes, onToggleMenu }: TaskCardProps) {
    const canEdit = board.canEditTask(task)
    const canChangeStatus = board.canChangeStatus(task)
    const done = task.status === "done"
    const critical = task.priority === "critical" && !done
    const review = task.status === "review"
    const due = rowDue(task, todayMs)
    const unreadCount = board.unread(task)
    const isFinisher = task.finished_by === user.id
    const isAssignee = task.assignee_id === user.id
    const isContributor = task.contributors.some(c => c.id === user.id)

    // Adding a contributor 400s when the task is unassigned or done (see
    // tasksApi's `addContributor` doc comment) -- hide the whole block
    // rather than ship controls guaranteed to fail, the same rule
    // `ContributorsSection` uses on desktop.
    const contributorsAllowed = !!task.assignee_id && !done

    const excludeIds = new Set([task.assignee_id, ...task.contributors.map(c => c.id)])
    const addOtherOptions = people.filter(p => !excludeIds.has(p.id)).map(p => ({ value: p.id, label: p.display_name }))

    // Status can only be changed from the card for todo/doing/review; a done
    // task reaches its status through "Reopen" (unreviewTask) instead, same
    // as the desktop row disabling its badge when `done`.
    // Anyone may send a review task back to doing, so everyone gets the
    // picker on a review task -- just without the options they can't use.
    const canTogglePicker = (canChangeStatus || review) && !done
    const pickerChoices = canChangeStatus ? PICKER_CHOICES : PICKER_CHOICES.filter(c => c === "doing" || c === task.status)

    function pick(status: SettableStatus) {
        onTogglePicker()
        void board.runAction(() => updateTask(task.id, { status }))
    }

    let primary: ReactNode = null
    if (!task.assignee_id) {
        primary = <Button className="w-full" onClick={() => void board.handleClaim(task.id)}>Claim task</Button>
    } else if (review) {
        // The backend 403s the finisher marking their own task reviewed
        // unless they also hold tasks.assign -- CONTRACT.md "Task card".
        if (!isFinisher || board.canAssign) {
            primary = <Button variant="outlined" className="w-full" onClick={() => void board.runAction(() => reviewTask(task.id))}>Mark reviewed</Button>
        } else {
            primary = (
                <span className="w-full min-h-11 rounded-lg border border-dashed flex items-center justify-center gap-2 text-xs font-semibold" style={{ borderColor: tint("--theme-text-contrast", 55), color: "var(--theme-text-contrast)" }}>
                    <span className="w-1.5 h-1.5 rounded-full" style={{ background: "var(--theme-text-contrast)" }} />
                    <span>Needs a second pair of eyes</span>
                </span>
            )
        }
    } else if (done) {
        if (board.canAssign) primary = <Button variant="outlined" className="w-full" onClick={() => void board.runAction(() => unreviewTask(task.id))}>Reopen</Button>
    } else if (canChangeStatus) {
        primary = <Button variant="outlined" className="w-full" onClick={() => void board.runAction(() => updateTask(task.id, { status: "review" }))}>Submit for review</Button>
    }

    return (
        <div data-task-id={task.id} className="flex flex-col gap-3 p-4 rounded-xl" style={cardStyle(highlighted, critical)}>
            <div className="flex items-start gap-3">
                <span className="flex-1 min-w-0 text-left min-h-11 flex items-center text-base font-semibold leading-snug theme-h1-color">{task.title}</span>
                {canTogglePicker ? (
                    <button type="button" onClick={onTogglePicker} aria-label="Change status" className={`rounded-full ${focusRing}`} style={statusToggleBtnStyle}>
                        <span className={badgeClass} style={badgeStyle(task.status)}>
                            {STATUS_LABEL[task.status]}
                            <ChevronDown size={14} />
                        </span>
                    </button>
                ) : (
                    <span className={`${badgeClass} shrink-0`} style={badgeStyle(task.status)}>{STATUS_LABEL[task.status]}</span>
                )}
                {canEdit && (
                    <button type="button" onClick={onToggleMenu} aria-label="More actions" className={`text-lg theme-subtext-color rounded-lg ${focusRing}`} style={moreBtnStyle}>⋯</button>
                )}
            </div>

            {pickerOpen && canTogglePicker && (
                <div className="grid grid-cols-3 gap-1 p-1 rounded-xl border" style={pickerGridStyle}>
                    {pickerChoices.map(choice => (
                        <button key={choice} type="button" onClick={() => pick(choice)} className={`min-w-0 min-h-11 px-1 rounded-lg border-0 text-xs font-bold leading-tight cursor-pointer ${focusRing}`} style={pickerOptionStyle(choice === task.status)}>
                            {STATUS_LABEL[choice]}
                        </button>
                    ))}
                </div>
            )}

            <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xs theme-subtext-color">
                <button type="button" onClick={onToggleNotes} aria-label="Notes" className={`rounded-full ${focusRing}`} style={notesToggleBtnStyle}>
                    <span className="flex items-center gap-1 px-2 py-1 rounded-full border text-xs font-semibold cursor-pointer" style={notesChipStyle(notesOpen, unreadCount > 0, task.note_count > 0)}>
                        <MessageSquare size={14} />
                        {task.note_count > 0 && <span>{task.note_count}</span>}
                    </span>
                </button>
                {critical
                    ? <span style={CRITICAL_BADGE_STYLE}>☠ {PRIORITY_LABEL.critical}</span>
                    : <span className="flex items-center gap-1 px-2 py-1 rounded-full border max-w-full truncate font-bold" style={priorityPillStyle(task.priority)}>{PRIORITY_LABEL[task.priority]} priority</span>}
                <span className="px-2 py-1 rounded-full border max-w-full truncate" style={{ borderColor: tint("--theme-border", 80) }}>{bucketLabel(task.bucket)} · {task.area}</span>
                <span><span style={{ color: due.color }}>{due.text}</span> · {formatPosted(task.created_at)}</span>
                <span>{ownerLine(task)}</span>
            </div>

            {contributorsAllowed && (
                <div className="flex flex-col gap-2 pt-0.5 border-t" style={{ borderColor: tint("--theme-border", 45) }}>
                    {task.contributors.length > 0 && (
                        <div className="flex flex-wrap items-center gap-1.5">
                            <span className={`${typeH2} theme-subtext-color`}>With</span>
                            {task.contributors.map(c => {
                                const removable = board.canAssign || c.id === user.id
                                return (
                                    <span key={c.id} className="flex items-center gap-1 py-1 rounded-full text-xs font-semibold theme-text" style={contributorPillStyle(removable)}>
                                        {c.display_name}
                                        {removable && (
                                            <button
                                                type="button"
                                                aria-label={`Remove ${c.display_name}`}
                                                onClick={() => void board.runAction(() => (board.canAssign ? removeContributor(task.id, c.id) : leaveTask(task.id)))}
                                                className={`text-xs theme-subtext-color ${focusRing}`}
                                                style={removeBtnStyle}
                                            >
                                                ✕
                                            </button>
                                        )}
                                    </span>
                                )
                            })}
                        </div>
                    )}
                    <div className="flex flex-col gap-2">
                        {/* One control, never both -- the same either/or the web
                            board draws ("+ Add" for the authority set, "+ Join"
                            for everyone else). A lead picking anyone from the
                            dropdown can already add themselves through it, so a
                            second, redundant Join button would just be clutter. */}
                        {board.canAssign ? addOtherOptions.length > 0 && (
                            <div className="w-full flex flex-col justify-center min-h-11">
                                <Dropdown
                                    value=""
                                    onChange={v => { if (v) void board.runAction(() => addContributor(task.id, v)) }}
                                    options={addOtherOptions}
                                    placeholder="+ Add contributor"
                                    triggerClassName={CONTRIBUTOR_DROPDOWN_TRIGGER_CLASS}
                                    searchable
                                    label="Add contributor"
                                />
                            </div>
                        ) : !isAssignee && !isContributor && (
                            <Button variant="outlined" className="w-full" onClick={() => void board.runAction(() => addContributor(task.id))}>
                                + Join as {user.display_name}
                            </Button>
                        )}
                        {isAssignee && (
                            <Button variant="outlined" className="w-full" onClick={() => void board.runAction(() => leaveTask(task.id))}>
                                Release task
                            </Button>
                        )}
                    </div>
                </div>
            )}

            {primary}

            {notesOpen && <NotesDrawer task={task} board={board} user={user} />}
        </div>
    )
}

/** Owner line for the meta row: a done task credits whoever finished it (plus
 *  any contributors who helped), otherwise it's just the assignee -- or
 *  "Unassigned" (CONTRACT.md "Task card"). */
function ownerLine(task: Task): string {
    if (task.status === "done") {
        const finisher = task.finished_by_name ?? "someone"
        const withOthers = task.contributors.length > 0 ? ` with ${task.contributors.map(c => c.display_name).join(", ")}` : ""
        return `Finished by ${finisher}${withOthers}`
    }
    return task.assignee_name ?? "Unassigned"
}

function cardStyle(highlighted: boolean, critical: boolean): CSSProperties {
    return {
        // "Perish if not done" gets a red frame and wash so it can't be scrolled past.
        border: critical ? `2px solid ${DANGER_RED}` : `1px solid ${tint("--theme-border", 75)}`,
        background: critical ? `linear-gradient(${tintColor(DANGER_RED, 12)}, ${tintColor(DANGER_RED, 12)}), var(--theme-button-bg)` : "var(--theme-button-bg)",
        // The highlight is an outline plus an inset wash (box-shadow, unlike a
        // background gradient, can transition), so it fades out rather than
        // snapping off when `highlighted` clears.
        outline: `2px solid ${highlighted ? "var(--theme-text-contrast)" : "transparent"}`, outlineOffset: 2,
        boxShadow: highlighted ? "inset 0 0 0 999px var(--ag-grid-selected-bg)" : "inset 0 0 0 999px transparent",
        transition: "outline-color 800ms ease, box-shadow 800ms ease",
    }
}
const statusToggleBtnStyle: CSSProperties = {
    flex: "none", display: "flex", alignItems: "center", minHeight: 44, margin: "-10px 0", padding: 0,
    border: "none", background: "transparent", cursor: "pointer", fontFamily: "inherit",
}
const moreBtnStyle: CSSProperties = {
    flex: "none", width: 44, height: 44, margin: "-10px -6px -10px 0", display: "flex", alignItems: "center", justifyContent: "center",
    border: "none", background: "transparent", cursor: "pointer",
}
// Status badge text colour follows the accent / heading / muted roles.
const badgeClass = "flex items-center gap-1 px-2 py-1 rounded-full border text-xs font-bold uppercase tracking-wider whitespace-nowrap"
function badgeStyle(status: Task["status"]): CSSProperties {
    const accent = status === "todo"
    const isReview = status === "review"
    const c = accent ? "var(--theme-text-contrast)" : isReview ? "var(--theme-h1-color)" : "var(--theme-subtext-color)"
    return { color: c, borderColor: tintColor(c, 45), background: tintColor(c, 10) }
}
const pickerGridStyle: CSSProperties = {
    borderColor: tint("--theme-border", 70), background: tintDark("--theme-bg", 70),
}
function pickerOptionStyle(selected: boolean): CSSProperties {
    return {
        background: selected ? tint("--theme-text-contrast", 18) : "transparent",
        color: selected ? "var(--theme-text-contrast)" : "var(--theme-subtext-color)",
    }
}
const notesToggleBtnStyle: CSSProperties = {
    display: "flex", alignItems: "center", minHeight: 44, margin: "-10px 0", padding: 0,
    border: "none", background: "transparent", cursor: "pointer", fontFamily: "inherit",
}
function notesChipStyle(open: boolean, unread: boolean, hasNotes: boolean): CSSProperties {
    const highlighted = open || unread
    return {
        borderColor: highlighted ? "var(--theme-text-contrast)" : tint("--theme-border", 80),
        background: highlighted ? tint("--theme-text-contrast", 12) : "transparent",
        // Unread color rule matches the desktop row's `noteColor` exactly
        // (CONTRACT.md "Task card": "same rule as web").
        color: unread ? "var(--theme-text-contrast)" : hasNotes ? "var(--theme-text)" : "var(--theme-subtext-color)",
    }
}
function priorityPillStyle(priority: TaskPriority): CSSProperties {
    // High / critical use the danger role; Medium and Low are data-identity accents with no theme role.
    const c = PRIORITY_COLOR[priority]
    return { color: c, borderColor: tintColor(c, 45), background: tintColor(c, 10) }
}
function contributorPillStyle(removable: boolean): CSSProperties {
    return {
        padding: removable ? "4px 20px 4px 12px" : "4px 12px",
        background: tint("--theme-border", 55),
    }
}
const removeBtnStyle: CSSProperties = {
    display: "flex", alignItems: "center", justifyContent: "center", width: 44, height: 44, margin: "-12px -16px -12px -8px",
    border: "none", background: "transparent", lineHeight: 1, cursor: "pointer", padding: 0,
}

// ── Notes drawer ─────────────────────────────────────────────────────────

function NotesDrawer({ task, board, user }: { task: Task; board: TaskBoard; user: OnboardedUser }) {
    const [notes, setNotes] = useState<TaskNote[] | null>(null)
    const [error, setError] = useState<string | null>(null)
    const [draft, setDraft] = useState("")
    const [posting, setPosting] = useState(false)
    // A typed, unposted note is lost when the drawer closes; the toggle that closes it asks first.
    useDiscardGuard(draft.trim() !== "")

    useEffect(() => {
        let cancelled = false
        setNotes(null)
        fetchNotes(task.id)
            .then(data => { if (!cancelled) setNotes(data) })
            .catch(err => { if (!cancelled) setError(failMessage(err, "Couldn't load the notes.")) })
        return () => { cancelled = true }
    }, [task.id])

    // This drawer only ever mounts while it's the one open notes drawer
    // board-wide, so its own mount/unmount *is* "opened"/"closed" --
    // CONTRACT.md: "Call markNotesRead(task) on open and cancelMarkNotesRead
    // () on close."
    useEffect(() => {
        board.markNotesRead(task)
        return () => board.cancelMarkNotesRead()
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [task.id])

    async function handlePost() {
        const body = draft.trim()
        if (!body || posting) return
        setPosting(true)
        setError(null)
        try {
            const note = await addNote(task.id, body)
            setNotes(prev => [...(prev ?? []), note])
            setDraft("")
            board.bumpNoteCount(task.id, 1)
        } catch (err) {
            setError(failMessage(err, "Couldn't post the note."))
        } finally {
            setPosting(false)
        }
    }

    async function handleDelete(note: TaskNote) {
        setError(null)
        try {
            await deleteNote(task.id, note.id)
            setNotes(prev => (prev ?? []).filter(n => n.id !== note.id))
            board.bumpNoteCount(task.id, -1)
        } catch (err) {
            setError(failMessage(err, "Couldn't delete the note."))
        }
    }

    const canPost = draft.trim().length > 0 && !posting

    return (
        <div className="flex flex-col gap-3 p-3 rounded-xl border" style={notesDrawerStyle}>
            {error && <ErrorBanner message={error} onDismiss={() => setError(null)} />}

            {notes === null ? (
                <div role="status" aria-label="Loading notes" className="flex flex-col gap-2">
                    <Skeleton className="h-10 w-full" />
                    <Skeleton className="h-10 w-full" />
                </div>
            ) : notes.length === 0 ? (
                <EmptyState>No notes yet — leave context for whoever picks this up.</EmptyState>
            ) : (
                notes.map(note => {
                    const canDelete = note.author_id === user.id || board.canAssign
                    return (
                        <div key={note.id} className="flex items-start gap-2">
                            <span className="flex-none flex items-center justify-center w-6 h-6 rounded-full text-xs font-bold" style={noteAvatarStyle(note.author_name)}>{initialOf(note.author_name)}</span>
                            <div className="flex-1 min-w-0">
                                <div className="text-xs theme-subtext-color">
                                    <span className="font-bold theme-text">{note.author_name ?? "Someone"}</span> · {formatRelativeTime(note.created_at)}
                                </div>
                                <div className="text-sm leading-snug theme-text" style={{ overflowWrap: "anywhere" }}>{note.body}</div>
                            </div>
                            {canDelete && (
                                <Button variant="icon" aria-label="Delete note" className="shrink-0 -my-2 -mr-2" onClick={() => void handleDelete(note)}>
                                    <Trash2 size={14} />
                                </Button>
                            )}
                        </div>
                    )
                })
            )}

            <textarea
                placeholder="Add a note…"
                aria-label="Add a note"
                value={draft}
                onChange={e => setDraft(e.target.value)}
                rows={2}
                maxLength={2000}
                className={`${inputClass} w-full resize-none`}
            />
            <Button className="self-end" onClick={() => void handlePost()} disabled={!canPost}>
                {posting ? "Posting…" : "Post"}
            </Button>
        </div>
    )
}

const notesDrawerStyle: CSSProperties = {
    background: tintDark("--theme-bg", 70), borderColor: tint("--theme-border", 50),
}
function noteAvatarStyle(name: string | null): CSSProperties {
    // Avatar swatches are data-identity colours (see taskFormat AVATAR_COLORS).
    return { color: AVATAR_INK, background: avatarBg(name ?? "?") }
}

// ── Bottom sheets ────────────────────────────────────────────────────────

function TaskActionSheet({ task, board, onClose, onEdit }: { task: Task; board: TaskBoard; onClose: () => void; onEdit: () => void }) {
    const canSendBack = task.status === "doing" || task.status === "review"
    return (
        <Sheet title={task.title} kind="menu" onClose={onClose}>
            <div className="flex flex-col">
                <SheetActionButton label="Edit task" onClick={() => { onEdit(); onClose() }} />
                {canSendBack && (
                    <SheetActionButton label="Send back to To do" onClick={() => { onClose(); void board.runAction(() => updateTask(task.id, { status: "todo" })) }} />
                )}
                <div className="mt-2 pt-2 border-t theme-border">
                    <SheetActionButton label="Delete task" danger onClick={() => { onClose(); void board.handleDelete(task) }} />
                </div>
            </div>
        </Sheet>
    )
}

function SheetActionButton({ label, onClick, danger }: { label: string; onClick: () => void; danger?: boolean }) {
    return (
        <button type="button" onClick={onClick} className={`${menuRowClass} font-semibold ${danger ? "theme-danger" : "theme-text"}`}>
            {label}
        </button>
    )
}

// ── New / Edit task sheet ────────────────────────────────────────────────

interface TaskFormSheetProps {
    mode: "create" | "edit"
    task?: Task
    board: TaskBoard
    people: Person[]
    defaultBucket: string
    onClose: () => void
}

function TaskFormSheet({ mode, task, board, people, defaultBucket, onClose }: TaskFormSheetProps) {
    const formId = useId()
    const claimLabelId = useId()
    const [title, setTitle] = useState(task?.title ?? "")
    const [bucket, setBucket] = useState(task?.bucket ?? defaultBucket)
    const [area, setArea] = useState(task?.area ?? "")
    const [dueDate, setDueDate] = useState(task?.due_date ?? "")
    const [priority, setPriority] = useState<TaskPriority>(task?.priority ?? "med")
    const [assigneeId, setAssigneeId] = useState(task?.assignee_id ?? "")
    // "Claim it for myself" defaults on (mock's own default) -- a
    // non-privileged member creating a task is almost always creating it for
    // themselves; leaving it in the unclaimed pool is the exception.
    const [claimSelf, setClaimSelf] = useState(true)
    const [submitting, setSubmitting] = useState(false)
    // Dirty = any field differs from what the sheet opened with (blank for a new task, the task for an edit).
    const dirty = useIsDirty({ title, bucket, area, dueDate, priority, assigneeId, claimSelf })
    useDiscardGuard(dirty)

    const canSubmit = title.trim().length > 0 && !submitting

    async function handleSubmit(e: FormEvent) {
        e.preventDefault()
        if (!canSubmit) return
        setSubmitting(true)
        try {
            if (mode === "create") {
                const input: CreateTaskInput = {
                    title: title.trim(), bucket, area: area.trim() || undefined, priority, due_date: dueDate || null,
                }
                if (board.canAssign && assigneeId) input.assignee_id = assigneeId
                const created = await createTask(input)
                board.applyTask(created)
                onClose()
                // handleClaim (rather than a bare claimTask call) so a claim
                // collision on a just-created task still gets the same 409
                // handling + silent refresh every other claim path gets.
                if (!board.canAssign && claimSelf) void board.handleClaim(created.id)
            } else if (task) {
                const patch: UpdateTaskInput = {
                    title: title.trim(), area: area.trim() || undefined, bucket, priority, due_date: dueDate || null,
                }
                // Mirrors EditTaskModal: only a privileged editor may move
                // the assignment through this form.
                if (board.canAssign) patch.assignee_id = assigneeId || null
                board.applyTask(await updateTask(task.id, patch))
                onClose()
            }
        } catch (err) {
            board.setActionError(failMessage(err, `Couldn't ${mode === "create" ? "create" : "save"} the task.`))
        } finally {
            setSubmitting(false)
        }
    }

    return (
        <Sheet
            title={mode === "create" ? "New task" : "Edit task"}
            onClose={onClose}
            dirty={dirty}
            footer={
                <FormFooter safeArea>
                    <Button type="submit" form={formId} size="footer" className="w-full md:w-auto md:ml-auto" disabled={!canSubmit}>
                        {submitting ? "Saving…" : mode === "create" ? "Create task" : "Save changes"}
                    </Button>
                </FormFooter>
            }
        >
            <form id={formId} onSubmit={e => void handleSubmit(e)} className="flex flex-col gap-4">
                <Field label="Task" help={TASK_FIELD_HELP.title}>
                    <input value={title} onChange={e => setTitle(e.target.value)} placeholder="What needs doing?" aria-label="Task" autoFocus className={`${inputClass} w-full`} />
                </Field>

                <div className="flex gap-3">
                    <div className="flex-1 min-w-0">
                        <Field label="Subteam" help={TASK_FIELD_HELP.bucket}>
                            <Dropdown value={bucket} onChange={setBucket} options={BUCKET_OPTIONS} triggerClassName={inputClass} label="Subteam" />
                        </Field>
                    </div>
                    <div className="flex-1 min-w-0">
                        <Field label="Area" help={TASK_FIELD_HELP.area}>
                            <AreaInput value={area} onChange={setArea} suggestions={areaSuggestions(board.tasks, bucket)} placeholder="General" className={`${inputClass} w-full`} />
                        </Field>
                    </div>
                </div>

                <Field label="Due date" help={TASK_FIELD_HELP.due}>
                    <input type="date" value={dueDate} onChange={e => setDueDate(e.target.value)} aria-label="Due date" className={`${inputClass} w-full`} />
                </Field>

                <Field label="Priority" help={TASK_FIELD_HELP.priority}>
                    {/* "Perish if not done" gets its own full-width row above the
                        three regular segments -- four labels don't fit across a phone. */}
                    {priorityChoices(board.canAssign, task?.priority).includes("critical") && (
                        <button type="button" aria-pressed={priority === "critical"} onClick={() => setPriority("critical")} className={`${prioritySegClass} w-full mb-1.5 uppercase tracking-wider`} style={prioritySegStyle(priority === "critical", true)}>
                            ☠ {PRIORITY_LABEL.critical}
                        </button>
                    )}
                    <div className="flex gap-1.5">
                        {priorityChoices(board.canAssign, task?.priority).filter(p => p !== "critical").map(p => (
                            <button key={p} type="button" aria-pressed={p === priority} onClick={() => setPriority(p)} className={`${prioritySegClass} flex-1`} style={prioritySegStyle(p === priority)}>
                                {PRIORITY_LABEL[p]}
                            </button>
                        ))}
                    </div>
                </Field>

                {board.canAssign && (
                    <Field label="Assign to" help={TASK_FIELD_HELP.assignee}>
                        <Dropdown value={assigneeId} onChange={setAssigneeId} options={assigneeOptions(people)} triggerClassName={inputClass} searchable label="Assign to" />
                    </Field>
                )}

                {mode === "create" && !board.canAssign && (
                    <div className="flex items-center justify-between gap-3 p-3 rounded-xl border" style={{ borderColor: tint("--theme-border", 75), background: "var(--theme-button-bg)" }}>
                        <div>
                            <div id={claimLabelId} className="text-sm font-semibold theme-h1-color">Claim it for myself</div>
                            <div className={helperClass}>Off leaves it in the unclaimed pool</div>
                        </div>
                        <Toggle checked={claimSelf} onChange={setClaimSelf} aria-labelledby={claimLabelId} />
                    </div>
                )}
            </form>
        </Sheet>
    )
}

function Field({ label, help, children }: { label: string; help?: string; children: ReactNode }) {
    return (
        <div className="flex flex-col gap-1.5">
            <span className={`${fieldLabelClass} flex items-center gap-1.5`}>
                {label}
                {help && <HelpTip text={help} />}
            </span>
            {children}
        </div>
    )
}

const prioritySegClass = `min-h-11 rounded-lg border text-sm font-bold cursor-pointer ${focusRing}`
function prioritySegStyle(selected: boolean, critical = false): CSSProperties {
    const accent = critical ? DANGER_RED : "var(--theme-text-contrast)"
    return {
        borderColor: selected ? accent : critical ? tintColor(DANGER_RED, 55) : tint("--theme-border", 75),
        background: selected ? (critical ? DANGER_RED : tint("--theme-text-contrast", 16)) : "var(--theme-button-bg)",
        color: selected ? (critical ? "var(--theme-bg)" : accent) : (critical ? DANGER_RED : "var(--theme-text)"),
    }
}
