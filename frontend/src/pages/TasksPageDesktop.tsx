import { confirmAnyDiscard, useDiscardGuard, useIsDirty } from "@/lib/useDiscardGuard"
import { useEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent } from "react"
import { useLocation } from "react-router-dom"
import { ChevronDown, ChevronRight, X } from "lucide-react"
import { useOnboardedUser, type OnboardedUser } from "@/contexts/authContext"
import Dropdown from "@/components/ui/Dropdown"
import Button from "@/components/ui/Button"
import EmptyState from "@/components/ui/EmptyState"
import FormFooter from "@/components/ui/FormFooter"
import Notice from "@/components/ui/Notice"
import Sheet from "@/components/ui/Sheet"
import Skeleton from "@/components/ui/Skeleton"
import AreaInput from "@/components/tasks/AreaInput"
import HelpTip from "@/components/tasks/HelpTip"
import { BUCKET_OPTIONS, TASK_BUCKETS, bucketLabel } from "@/lib/taskBuckets"
import {
    addContributor, addNote, createTask, deleteNote, fetchNotes, leaveTask, removeContributor, reviewTask, unreviewTask, updateTask,
    PRIORITY_LABEL, STATUS_LABEL,
    type CreateTaskInput, type Person, type Task, type TaskNote, type TaskPriority, type UpdateTaskInput,
} from "@/lib/tasksApi"
import {
    DANGER_RED, PRIORITY_COLOR, AVATAR_INK, failMessage, CRITICAL_BADGE_STYLE, priorityChoices,
    tint, tintColor, avatarBg, initialOf, formatRelativeTime, formatPosted, isOverdue, rowDue, assigneeOptions,
    compareTasks, compareDone, matchesFilter, areaSuggestions, TASK_SORT_OPTIONS, TASK_FIELD_HELP,
    type SettableStatus, type WhoFilter, type Quick, type TaskSort, type TasksPageState,
} from "@/lib/taskFormat"
import { useTaskBoard } from "@/lib/useTaskBoard"
import { cardClass, fieldLabelClass, focusRing, helperClass, inputClass, typeH1, typeH2 } from "@/lib/uiClasses"

interface SubteamGroup {
    bucket: string
    label: string
    countLabel: string
    areas: { key: string; area: string; tasks: Task[] }[]
}

/**
 * Task board. Left rail filters by subteam (bucket); the main list groups
 * visible tasks by subteam, then by area (project) within it.
 *
 * Visual structure follows the "Task board" design mockup
 * (TaskBoard.dc.html) closely -- see SPEC.md for the handful of deliberate
 * deviations from it, the two big ones being:
 *
 *  - Area nesting: the mockup flattens every task in a subteam into one
 *    list. Areas are project names, not busywork, so we keep them as
 *    sub-groups inside each subteam instead of collapsing them away.
 *  - Permissions: the mockup's prototype only knows `role === "lead"`. The
 *    real backend is stricter (assignee changes always require
 *    `tasks.assign`; review 403s the *finisher*, not the owner; contributor
 *    adds 400 on an unassigned/done task) -- see the permission gates
 *    threaded through the row/detail below, and the dropped `takeOver`/
 *    member "Release" affordances the mockup has that would just 403.
 */
export default function TasksPageDesktop() {
    const user = useOnboardedUser()
    const board = useTaskBoard()
    const { tasks, people, loading, loadError, actionError, setActionError, canAssign, mySubteam, canEditTask, canChangeStatus, todayMs, unread } = board

    // Links can pre-set the filters via router state -- e.g. the dashboard's
    // "Your tasks" card opens on every bucket filtered to the viewer, since
    // their tasks aren't necessarily in their own subteam.
    const initialFilters = useLocation().state as TasksPageState | null

    const [bucketFilter, setBucketFilter] = useState<string>(initialFilters?.bucket ?? mySubteam ?? "all")
    const [whoFilter, setWhoFilter] = useState<WhoFilter>(initialFilters?.who ?? "everyone")
    const [sort, setSort] = useState<TaskSort>("priority")
    const [quick, setQuick] = useState<Quick>(null)
    // Areas are treated like buckets inside a subteam, so each one collapses
    // on its own. Keyed `${bucket}:${area}` -- the same area name can live
    // under two subteams. Done tasks get one collapsed drawer at the bottom.
    const [collapsedAreas, setCollapsedAreas] = useState<Set<string>>(() => new Set())
    const [doneOpen, setDoneOpen] = useState(false)
    const [showEmpties, setShowEmpties] = useState(false)
    const [composing, setComposing] = useState(false)
    const [editingTask, setEditingTask] = useState<Task | null>(null)

    // Only one row expanded, one overflow menu and one status picker open at
    // a time, board-wide -- mirrors the mockup's single `expanded`/`menu`/
    // `statusMenu` ids.
    const [expandedId, setExpandedId] = useState<string | null>(null)
    const [menuOpenId, setMenuOpenId] = useState<string | null>(null)
    const [statusMenuOpenId, setStatusMenuOpenId] = useState<string | null>(null)
    const [drafts, setDrafts] = useState<Record<string, string>>({})

    // `taskId` in router state (the dashboard's task links) opens that row
    // once the board has loaded, scrolls to it and briefly highlights it.
    const focusTaskId = initialFilters?.taskId ?? null
    const focusHandled = useRef(false)
    const [highlightId, setHighlightId] = useState<string | null>(null)
    useEffect(() => {
        if (focusHandled.current || !focusTaskId || loading) return
        focusHandled.current = true
        const task = tasks.find(t => t.id === focusTaskId)
        if (!task) return
        if (task.status === "done") setDoneOpen(true)
        setCollapsedAreas(prev => {
            const next = new Set(prev)
            next.delete(`${task.bucket}:${task.area.toLowerCase()}`)
            return next
        })
        applyExpand(task, task.id)
        setHighlightId(task.id)
        requestAnimationFrame(() => {
            document.querySelector(`[data-task-id="${task.id}"]`)?.scrollIntoView({ block: "center", behavior: "smooth" })
        })
    // eslint-disable-next-line react-hooks/exhaustive-deps -- one-shot on first load
    }, [loading, tasks, focusTaskId])
    useEffect(() => {
        if (!highlightId) return
        const timer = setTimeout(() => setHighlightId(null), 2000)
        return () => clearTimeout(timer)
    }, [highlightId])

    // Click anywhere outside an open row popover (status picker / overflow
    // menu) closes it. Their trigger + popover share a `data-task-popover`
    // wrapper, so a click on the trigger itself is never treated as
    // "outside" -- that would otherwise race the toggle's own click handler.
    useEffect(() => {
        function onDocMouseDown(e: MouseEvent) {
            const target = e.target as HTMLElement
            if (target.closest("[data-task-popover]")) return
            setMenuOpenId(null)
            setStatusMenuOpenId(null)
        }
        document.addEventListener("mousedown", onDocMouseDown)
        return () => document.removeEventListener("mousedown", onDocMouseDown)
    }, [])

    /** Expand/collapse a row (the whole row, or its notes chip, clicking it).
     *  Opening a row with unread notes schedules the 900ms read-stamp from
     *  SPEC "Unread notes"; collapsing (or expanding elsewhere) first cancels
     *  any pending stamp so a fast open/close can't strand it. */
    function toggleExpand(task: Task) {
        const opening = expandedId !== task.id
        applyExpand(task, opening ? task.id : null)
    }

    /** Force a row open without toggling it closed if it's already open --
     *  used by the overflow menu's "Add a note", which always opens. */
    function openForNote(task: Task) {
        if (expandedId === task.id) { setMenuOpenId(null); return }
        applyExpand(task, task.id)
    }

    function applyExpand(task: Task, nextId: string | null) {
        setMenuOpenId(null)
        setStatusMenuOpenId(null)
        setExpandedId(nextId)
        if (nextId === task.id) {
            board.markNotesRead(task)
        } else {
            board.cancelMarkNotesRead()
        }
    }

    // Rail counts read the whole board. The header's quick-filter chips read
    // the selected subteam (or the whole board under "All tasks"), so inside
    // a subteam "Unclaimed 3" means three of *that* subteam's tasks -- still
    // independent of the who/quick filters, as an at-a-glance overview.
    const bucketCounts = useMemo(() => {
        const counts: Record<string, number> = Object.fromEntries(TASK_BUCKETS.map(b => [b, 0]))
        for (const t of tasks) if (t.bucket in counts) counts[t.bucket]++
        return counts
    }, [tasks])
    const allCount = tasks.length
    const hiddenCount = TASK_BUCKETS.filter(b => !bucketCounts[b]).length
    const scopedTasks = bucketFilter === "all" ? tasks : tasks.filter(t => t.bucket === bucketFilter)
    const scopedLive = scopedTasks.filter(t => t.status !== "done")
    const unclaimedCount = scopedLive.filter(t => !t.assignee_id).length
    const overdueCount = scopedLive.filter(t => isOverdue(t, todayMs)).length
    const reviewCount = scopedLive.filter(t => t.status === "review").length
    const todoCount = scopedLive.filter(t => t.status === "todo").length
    const doingCount = scopedLive.filter(t => t.status === "doing").length
    const totalLabel = `${scopedTasks.length} ${scopedTasks.length === 1 ? "task" : "tasks"}`

    const visibleTasks = useMemo(
        () => tasks.filter(t => matchesFilter(t, { bucket: bucketFilter, status: "all", who: whoFilter, quick }, user.id, todayMs)),
        [tasks, bucketFilter, whoFilter, quick, user.id, todayMs],
    )
    const doneTasks = useMemo(() => visibleTasks.filter(t => t.status === "done").sort(compareDone), [visibleTasks])

    const groups = useMemo<SubteamGroup[]>(() => {
        const result: SubteamGroup[] = []
        for (const bucket of TASK_BUCKETS) {
            const bucketTasks = visibleTasks.filter(t => t.bucket === bucket && t.status !== "done")
            if (bucketTasks.length === 0) continue
            // Group case-insensitively (the backend normalizes new writes, but
            // older rows may differ only in case); show the first spelling seen.
            const byArea = new Map<string, { key: string; area: string; tasks: Task[] }>()
            for (const t of bucketTasks) {
                const key = `${bucket}:${t.area.toLowerCase()}`
                const group = byArea.get(key)
                if (group) group.tasks.push(t)
                else byArea.set(key, { key, area: t.area, tasks: [t] })
            }
            const areas = Array.from(byArea.values())
                .sort((a, b) => a.area.localeCompare(b.area))
                .map(g => ({ ...g, tasks: g.tasks.sort(compareTasks(sort)) }))
            result.push({
                bucket,
                label: bucketLabel(bucket),
                countLabel: bucketTasks.length === 1 ? "1 task" : `${bucketTasks.length} tasks`,
                areas,
            })
        }
        return result
    }, [visibleTasks, sort])
    const isEmpty = groups.length === 0 && doneTasks.length === 0

    function toggleArea(key: string) {
        setCollapsedAreas(prev => {
            const next = new Set(prev)
            if (next.has(key)) next.delete(key)
            else next.add(key)
            return next
        })
    }

    function toggleQuick(q: Exclude<Quick, null>) {
        setQuick(cur => cur === q ? null : q)
    }

    const whoOptions = [
        { value: "everyone", label: "Everyone" },
        { value: "me", label: "My tasks" },
        { value: "unclaimed", label: "Unassigned" },
        ...people.map(p => ({ value: p.id, label: p.display_name })),
    ]

    const dropdownTriggerClassName = "rounded-lg border theme-outline theme-bg theme-text px-3 min-h-11 md:min-h-10 text-sm"
    const defaultBucket = bucketFilter !== "all" ? bucketFilter : (mySubteam ?? "general")

    function renderRow(task: Task, isFirst: boolean) {
        return (
            <TaskRow
                key={task.id}
                highlighted={highlightId === task.id}
                task={task}
                isFirst={isFirst}
                canEdit={canEditTask(task)}
                canChangeStatus={canChangeStatus(task)}
                canAssign={canAssign}
                people={people}
                currentUser={user}
                todayMs={todayMs}
                unread={unread(task)}
                expanded={expandedId === task.id}
                menuOpen={menuOpenId === task.id}
                statusMenuOpen={statusMenuOpenId === task.id}
                draft={drafts[task.id] ?? ""}
                dropdownTriggerClassName={dropdownTriggerClassName}
                onDraftChange={v => setDrafts(prev => ({ ...prev, [task.id]: v }))}
                onToggleRow={() => toggleExpand(task)}
                onOpenForNote={() => openForNote(task)}
                onToggleMenu={() => setMenuOpenId(id => id === task.id ? null : task.id)}
                onToggleStatusMenu={() => setStatusMenuOpenId(id => (id === task.id ? null : task.id))}
                onSetStatus={status => void board.runAction(() => updateTask(task.id, { status }))}
                onClaim={() => void board.handleClaim(task.id)}
                onOwnerChange={personId => void board.runAction(() => updateTask(task.id, { assignee_id: personId || null }))}
                onAddSelf={() => void board.runAction(() => addContributor(task.id))}
                onAddOther={personId => void board.runAction(() => addContributor(task.id, personId))}
                onRemoveContributor={personId => void board.runAction(() => removeContributor(task.id, personId))}
                onLeave={() => void board.runAction(() => leaveTask(task.id))}
                onMarkReviewed={() => void board.runAction(() => reviewTask(task.id))}
                onUnreview={() => void board.runAction(() => unreviewTask(task.id))}
                onEdit={() => setEditingTask(task)}
                onDelete={() => void board.handleDelete(task)}
                onNoteCountChange={board.bumpNoteCount}
            />
        )
    }

    if (loading) {
        return (
            <div className="px-4 md:px-6 py-6">
                <div role="status" aria-label="Loading tasks" className="mx-auto w-full max-w-[1180px] flex flex-col gap-3">
                    <Skeleton className="h-8 w-40" />
                    <Skeleton className="h-5 w-72 max-w-full" />
                    <div className="flex flex-col gap-3 pt-4">
                        {Array.from({ length: 6 }, (_, i) => <Skeleton key={i} className="h-14 w-full rounded-xl" />)}
                    </div>
                </div>
            </div>
        )
    }

    return (
        <div className="px-4 md:px-6 py-6">
            {/* One solid, blurred panel holds the whole board so it reads
                against the page's map background ("Task board visibility"
                design, option 1a). */}
            <div
                className="mx-auto w-full max-w-[1180px] flex flex-col gap-5 rounded-2xl border theme-border p-6"
                style={{
                    background: "color-mix(in oklch, var(--theme-bg) 94%, transparent)",
                    backdropFilter: "blur(10px)", WebkitBackdropFilter: "blur(10px)",
                }}
            >

                <div className="flex flex-wrap items-end justify-between gap-5">
                    <div>
                        <h1 className={`${typeH1} theme-h1-color`}>Task board</h1>
                        <div className="mt-2 flex flex-wrap items-center gap-2 text-xs theme-subtext-color">
                            <span className="whitespace-nowrap mr-0.5">{totalLabel}</span>
                            {/* Dots are data-identity colours for the status buckets (no matching theme role); Overdue uses the danger role. */}
                            <QuickChip label="Unclaimed" dot="#f5d547" count={unclaimedCount} active={quick === "unclaimed"} onClick={() => toggleQuick("unclaimed")} />
                            <QuickChip label="Overdue" dot={DANGER_RED} count={overdueCount} active={quick === "overdue"} onClick={() => toggleQuick("overdue")} />
                            <QuickChip label={STATUS_LABEL.todo} dot="#93c5fd" count={todoCount} active={quick === "todo"} onClick={() => toggleQuick("todo")} />
                            <QuickChip label={STATUS_LABEL.doing} dot="#c4b5fd" count={doingCount} active={quick === "doing"} onClick={() => toggleQuick("doing")} />
                            <QuickChip label="Needs review" dot="#9ad4c4" count={reviewCount} active={quick === "review"} onClick={() => toggleQuick("review")} />
                        </div>
                    </div>
                    <div className="flex flex-wrap items-center gap-3">
                        <div className="w-40">
                            <Dropdown value={whoFilter} onChange={v => setWhoFilter(v as WhoFilter)} options={whoOptions} triggerClassName={dropdownTriggerClassName} searchable label="Filter by person" />
                        </div>
                        <div className="w-40">
                            <Dropdown value={sort} onChange={v => setSort(v as TaskSort)} options={TASK_SORT_OPTIONS} triggerClassName={dropdownTriggerClassName} menuAlign="right" label="Sort tasks" />
                        </div>
                        <Button variant={composing ? "outlined" : "filled"} className="shrink-0" onClick={() => void confirmAnyDiscard().then(ok => { if (ok) setComposing(v => !v) })}>
                            {composing ? "Close" : "New task"}
                        </Button>
                    </div>
                </div>

                {loadError && <ErrorBanner message={loadError} />}
                {actionError && <ErrorBanner message={actionError} onDismiss={() => setActionError(null)} />}

                {composing && (
                    <ComposeForm
                        tasks={tasks}
                        canAssign={canAssign}
                        people={people}
                        defaultBucket={defaultBucket}
                        onCreated={task => { board.applyTask(task); setComposing(false) }}
                        onClose={() => setComposing(false)}
                        onError={setActionError}
                    />
                )}

                <div className="flex flex-wrap items-start gap-6">

                    {/* The panel already separates the board from the map, so the
                        rail drops its own card for a plain divider. */}
                    <aside className="box-border flex flex-col gap-0.5 border-r theme-border pr-5" style={{ flex: "1 1 190px", maxWidth: 240, minWidth: 180 }}>
                        <div className={`${typeH2} theme-subtext-color px-2 pt-1 pb-2`}>Subteam</div>
                        <RailRow active={bucketFilter === "all"} label="All tasks" count={allCount} onClick={() => setBucketFilter("all")} />
                        {BUCKET_OPTIONS.filter(b => showEmpties || (bucketCounts[b.value] ?? 0) > 0).map(b => (
                            <RailRow key={b.value} active={bucketFilter === b.value} label={b.label} count={bucketCounts[b.value] ?? 0} onClick={() => setBucketFilter(b.value)} />
                        ))}
                        <button
                            type="button"
                            onClick={() => setShowEmpties(v => !v)}
                            className={`w-full mt-2 pt-3 px-2 border-t theme-border text-left text-xs theme-text-contrast cursor-pointer ${focusRing}`}
                        >
                            {showEmpties ? "Hide empty subteams" : `Show ${hiddenCount} empty subteams`}
                        </button>
                    </aside>

                    <div className="flex flex-col gap-5 min-w-0" style={{ flex: "999 1 440px" }}>
                        {groups.map(group => (
                            <section key={group.bucket}>
                                <div className="flex items-center gap-3 px-0.5 pb-2">
                                    <span className={`${typeH2} theme-h1-color`}>{group.label}</span>
                                    <span className="text-xs theme-subtext-color">{group.countLabel}</span>
                                    <span className="flex-1 h-px bg-[var(--theme-border)]" />
                                </div>
                                <div className="flex flex-col gap-3">
                                    {group.areas.map(areaGroup => {
                                        const collapsed = collapsedAreas.has(areaGroup.key)
                                        return (
                                            <div key={areaGroup.key}>
                                                <SectionToggle
                                                    label={areaGroup.area}
                                                    count={areaGroup.tasks.length}
                                                    open={!collapsed}
                                                    onClick={() => toggleArea(areaGroup.key)}
                                                />
                                                {!collapsed && (
                                                    <div className="rounded-xl border theme-border" style={{ background: "var(--theme-button-bg)" }}>
                                                        {areaGroup.tasks.map((task, i) => renderRow(task, i === 0))}
                                                    </div>
                                                )}
                                            </div>
                                        )
                                    })}
                                </div>
                            </section>
                        ))}

                        {doneTasks.length > 0 && (
                            <section className="mt-2">
                                <SectionToggle label="Done" count={doneTasks.length} open={doneOpen} onClick={() => setDoneOpen(v => !v)} strong />
                                {doneOpen && (
                                    <div className="rounded-xl border theme-border" style={{ background: "var(--theme-button-bg)" }}>
                                        {doneTasks.map((task, i) => renderRow(task, i === 0))}
                                    </div>
                                )}
                            </section>
                        )}

                        {isEmpty && (
                            <div className="rounded-xl border border-dashed theme-border">
                                <EmptyState variant="screen" title="Nothing matches these filters">
                                    Try switching Who back to Everyone, or clear the quick filter.
                                </EmptyState>
                            </div>
                        )}
                    </div>
                </div>
            </div>

            {editingTask && (
                <EditTaskModal
                    task={editingTask}
                    tasks={tasks}
                    canAssign={canAssign}
                    people={people}
                    onClose={() => setEditingTask(null)}
                    onSaved={task => { board.applyTask(task); setEditingTask(null) }}
                    onError={setActionError}
                />
            )}
        </div>
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

function RailRow({ active, label, count, onClick }: { active: boolean; label: string; count: number; onClick: () => void }) {
    return (
        <button
            type="button"
            onClick={onClick}
            className={`flex items-center justify-between gap-2 w-full h-9 px-2 rounded-lg text-sm text-left cursor-pointer ${active ? "font-bold" : "font-medium"} ${focusRing}`}
            style={{
                background: active ? "var(--ag-grid-selected-bg)" : "transparent",
                color: active ? "var(--theme-text-contrast)" : "var(--theme-text)",
            }}
        >
            <span>{label}</span>
            <span className="text-xs" style={{ color: active ? "var(--theme-text-contrast)" : tint("--theme-subtext-color", 70) }}>{count}</span>
        </button>
    )
}

/** Collapsible header for an area (or the bottom "Done" drawer) -- areas are
 *  treated like buckets inside a subteam, so each one folds away on its own. */
function SectionToggle({ label, count, open, onClick, strong }: { label: string; count: number; open: boolean; onClick: () => void; strong?: boolean }) {
    const Chevron = open ? ChevronDown : ChevronRight
    return (
        <button
            type="button"
            onClick={onClick}
            aria-expanded={open}
            className={`flex items-center gap-1.5 px-0.5 text-xs uppercase tracking-widest cursor-pointer hover:text-(--theme-h1-color) ${focusRing} ${strong ? "w-full pb-2 font-bold theme-h1-color" : "pb-1.5 font-medium theme-subtext-color"}`}
        >
            <Chevron size={14} />
            <span>{label}</span>
            <span className={`tracking-normal font-medium theme-subtext-color ${strong ? "" : "opacity-75"}`}>{count}</span>
            {strong && <span className="flex-1 h-px bg-[var(--theme-border)]" />}
        </button>
    )
}

function QuickChip({ label, dot, count, active, onClick }: { label: string; dot: string; count: number; active: boolean; onClick: () => void }) {
    const empty = count === 0
    const dotColor = empty && !active ? tint("--theme-border", 80) : dot
    return (
        <button
            type="button"
            onClick={onClick}
            disabled={empty}
            className={`flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-semibold whitespace-nowrap cursor-pointer disabled:cursor-not-allowed ${empty && !active ? "opacity-40" : ""} ${focusRing}`}
            style={{
                borderColor: active ? dot : "var(--theme-border)",
                background: active ? tintColor(dot, 16) : "transparent",
                color: active ? "var(--theme-h1-color)" : "var(--theme-subtext-color)",
            }}
        >
            <span className="w-1.5 h-1.5 rounded-full" style={{ background: dotColor }} />
            <span>{label}</span>
            <span className="tabular-nums">{count}</span>
        </button>
    )
}

interface ComposeFormProps {
    tasks: Task[]
    canAssign: boolean
    people: Person[]
    defaultBucket: string
    onCreated: (task: Task) => void
    onClose: () => void
    onError: (message: string) => void
}

function ComposeForm({ tasks, canAssign, people, defaultBucket, onCreated, onClose, onError }: ComposeFormProps) {
    const [title, setTitle] = useState("")
    const [area, setArea] = useState("")
    const [bucket, setBucket] = useState(defaultBucket)
    const [priority, setPriority] = useState<TaskPriority>("med")
    const [dueDate, setDueDate] = useState("")
    const [assigneeId, setAssigneeId] = useState("")
    const [submitting, setSubmitting] = useState(false)
    // Dirty = any field differs from the blank form it opened as.
    const confirmDiscard = useDiscardGuard(useIsDirty({ title, area, bucket, priority, dueDate, assigneeId }))

    async function handleSubmit(e: FormEvent) {
        e.preventDefault()
        if (!title.trim() || submitting) return
        setSubmitting(true)
        try {
            const input: CreateTaskInput = {
                title: title.trim(),
                bucket,
                area: area.trim() || undefined,
                priority,
                due_date: dueDate || null,
            }
            if (canAssign && assigneeId) input.assignee_id = assigneeId
            onCreated(await createTask(input))
        } catch (err) {
            onError(failMessage(err, "Couldn't create the task."))
        } finally {
            setSubmitting(false)
        }
    }

    function onFormKeyDown(e: KeyboardEvent<HTMLFormElement>) {
        if (e.key === "Escape") void confirmDiscard().then(ok => { if (ok) onClose() })
    }

    const canSubmit = title.trim().length > 0 && !submitting
    const labelClass = `${fieldLabelClass} flex items-center gap-1.5`

    return (
        <div className={cardClass} style={{ background: "var(--theme-button-bg)" }}>
            <form onSubmit={e => void handleSubmit(e)} onKeyDown={onFormKeyDown} className="contents">
                <div className="grid gap-3" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))" }}>
                    <div className="flex flex-col gap-1.5 col-span-2 min-w-0">
                        <span className={labelClass}>Task <HelpTip text={TASK_FIELD_HELP.title} /></span>
                        <input
                            value={title}
                            onChange={e => setTitle(e.target.value)}
                            autoFocus
                            placeholder="e.g. Re-tension the intake belts"
                            className={`${inputClass} w-full`}
                        />
                    </div>
                    <div className="flex flex-col gap-1.5 min-w-0">
                        <span className={labelClass}>Area <HelpTip text={TASK_FIELD_HELP.area} /></span>
                        <AreaInput
                            value={area}
                            onChange={setArea}
                            suggestions={areaSuggestions(tasks, bucket)}
                            placeholder="General"
                            className={`${inputClass} w-full`}
                        />
                    </div>
                    <div className="flex flex-col gap-1.5 min-w-0">
                        <span className={labelClass}>Subteam <HelpTip text={TASK_FIELD_HELP.bucket} /></span>
                        <Dropdown value={bucket} onChange={setBucket} options={BUCKET_OPTIONS} triggerClassName={inputClass} label="Subteam" />
                    </div>
                    {canAssign && (
                        <div className="flex flex-col gap-1.5 min-w-0">
                            <span className={labelClass}>Assign to <HelpTip text={TASK_FIELD_HELP.assignee} /></span>
                            <Dropdown value={assigneeId} onChange={setAssigneeId} options={assigneeOptions(people)} triggerClassName={inputClass} searchable label="Assign to" />
                        </div>
                    )}
                    <div className="flex flex-col gap-1.5 min-w-0">
                        <span className={labelClass}>Priority <HelpTip text={TASK_FIELD_HELP.priority} /></span>
                        <Dropdown value={priority} onChange={v => setPriority(v as TaskPriority)} options={priorityChoices(canAssign).map(p => ({ value: p, label: PRIORITY_LABEL[p] }))} triggerClassName={inputClass} label="Priority" />
                    </div>
                    <div className="flex flex-col gap-1.5 min-w-0">
                        <span className={labelClass}>Due <HelpTip text={TASK_FIELD_HELP.due} /></span>
                        <input
                            type="date"
                            value={dueDate}
                            onChange={e => setDueDate(e.target.value)}
                            className={`${inputClass} w-full`}
                        />
                    </div>
                </div>
                <FormFooter className="-mx-5 -mb-5 rounded-b-xl">
                    <span className={`${helperClass} mr-auto`}>
                        {canAssign ? "↵ to add · Esc to close" : "New tasks start unclaimed — claim it after adding. ↵ to add"}
                    </span>
                    <Button type="submit" size="footer" disabled={!canSubmit}>
                        {submitting ? "Adding…" : "Add task"}
                    </Button>
                </FormFooter>
            </form>
        </div>
    )
}

interface MenuAction {
    label: string
    onClick: () => void
    danger?: boolean
}

const detailLabelClass = `${typeH2} theme-subtext-color`

interface TaskRowProps {
    task: Task
    isFirst: boolean
    /** Briefly ringed after being opened from a dashboard link. */
    highlighted: boolean
    canEdit: boolean
    canChangeStatus: boolean
    canAssign: boolean
    people: Person[]
    currentUser: OnboardedUser
    todayMs: number
    unread: number
    expanded: boolean
    menuOpen: boolean
    statusMenuOpen: boolean
    draft: string
    dropdownTriggerClassName: string
    onDraftChange: (value: string) => void
    onToggleRow: () => void
    onOpenForNote: () => void
    onToggleMenu: () => void
    onToggleStatusMenu: () => void
    onSetStatus: (status: SettableStatus) => void
    onClaim: () => void
    onOwnerChange: (personId: string) => void
    onAddSelf: () => void
    onAddOther: (personId: string) => void
    onRemoveContributor: (personId: string) => void
    onLeave: () => void
    onMarkReviewed: () => void
    onUnreview: () => void
    onEdit: () => void
    onDelete: () => void
    onNoteCountChange: (taskId: string, delta: number) => void
}

function TaskRow({
    task, isFirst, highlighted, canEdit, canChangeStatus, canAssign, people, currentUser, todayMs, unread, expanded, menuOpen, statusMenuOpen, draft,
    dropdownTriggerClassName, onDraftChange, onToggleRow, onOpenForNote, onToggleMenu, onToggleStatusMenu, onSetStatus,
    onClaim, onOwnerChange, onAddSelf, onAddOther, onRemoveContributor, onLeave, onMarkReviewed, onUnreview, onEdit, onDelete,
    onNoteCountChange,
}: TaskRowProps) {
    const done = task.status === "done"
    const review = task.status === "review"
    const due = rowDue(task, todayMs)
    const priorityColor = done ? tint("--theme-border", 70) : PRIORITY_COLOR[task.priority]
    const critical = task.priority === "critical" && !done
    const isFinisher = task.finished_by === currentUser.id
    const disabledTitle = "Only the creator, a lead, or someone on this task can update its status"

    const avatarPeople = task.assignee_id
        ? [{ id: task.assignee_id, name: task.assignee_name ?? "Assigned" }, ...task.contributors.map(c => ({ id: c.id, name: c.display_name }))]
        : []

    const chipUnread = unread > 0
    const noteColor = chipUnread ? "var(--theme-text-contrast)" : (task.note_count > 0 ? "var(--theme-text)" : "var(--theme-subtext-color)")

    // Anyone may send a review task back to doing; other moves need status rights.
    const canToggleCheck = canChangeStatus || review

    const menuItems: MenuAction[] = []
    if (canEdit) menuItems.push({ label: "Edit task", onClick: onEdit })
    menuItems.push({ label: "Add a note", onClick: onOpenForNote })
    if (canChangeStatus && (task.status === "todo" || task.status === "doing")) menuItems.push({ label: "Mark ready for review", onClick: () => onSetStatus("review") })
    if (canChangeStatus && (task.status === "doing" || task.status === "review")) menuItems.push({ label: "Send back to To do", onClick: () => onSetStatus("todo") })
    if (canAssign && done) menuItems.push({ label: "Send back for review", onClick: onUnreview })
    if (canEdit) menuItems.push({ label: "Delete task", onClick: onDelete, danger: true })

    return (
        <div
            data-task-id={task.id}
            style={{
                borderTop: isFirst ? "none" : "1px solid var(--ag-grid-row-border)",
                boxShadow: highlighted ? "inset 0 0 0 2px var(--theme-text-contrast)" : "none",
                transition: "box-shadow 0.6s ease",
            }}
        >
            <div
                onClick={onToggleRow}
                className="hover:bg-(--ag-grid-hover-bg)"
                style={{
                    display: "flex", flexWrap: "wrap", alignItems: "center", gap: "8px 12px",
                    minHeight: 54, padding: "6px 12px 6px 0", cursor: "pointer",
                    background: expanded ? "var(--ag-grid-hover-bg)" : (critical ? tintColor(DANGER_RED, 10) : "transparent"),
                }}
            >
                <span className="rounded-r-full" style={{ width: critical ? 5 : 3, alignSelf: "stretch", flex: "none", background: priorityColor }} />

                <button
                    type="button"
                    onClick={e => { e.stopPropagation(); if (done || !canToggleCheck) return; onSetStatus(review ? "doing" : "review") }}
                    disabled={done || !canToggleCheck}
                    title={canToggleCheck ? undefined : disabledTitle}
                    className={`disabled:cursor-not-allowed text-xs font-bold ${focusRing}`}
                    style={{
                        width: 17, height: 17, flex: "none", borderRadius: 5, display: "grid", placeItems: "center",
                        padding: 0,
                        color: done ? "var(--theme-bg)" : "var(--theme-text-contrast)",
                        border: `1.5px solid ${done || review ? "var(--theme-text-contrast)" : "var(--theme-outline)"}`,
                        background: done ? "var(--theme-text-contrast)" : (review ? "var(--ag-grid-selected-bg)" : "transparent"),
                        opacity: canToggleCheck ? 1 : 0.6,
                        cursor: canToggleCheck && !done ? "pointer" : "default",
                    }}
                >
                    {done || review ? "✓" : ""}
                </button>

                <span style={{ flex: "1 1 200px", minWidth: 130, display: "flex", flexWrap: "wrap", alignItems: "baseline", gap: "2px 10px" }}>
                    <span className="text-sm font-semibold" style={{
                        flex: "1 1 auto", minWidth: 90, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
                        color: done ? "var(--theme-subtext-color)" : "var(--theme-h1-color)", textDecoration: done ? "line-through" : "none",
                    }}>
                        {task.title}
                    </span>
                    <span className="text-xs" style={{ flex: "none", whiteSpace: "nowrap", color: "var(--theme-subtext-color)" }}>
                        <span style={{ color: due.color }}>{due.text}</span> · {formatPosted(task.created_at)}
                    </span>
                    {critical ? (
                        <span style={{ ...CRITICAL_BADGE_STYLE, flex: "none", alignSelf: "center" }}>☠ {PRIORITY_LABEL.critical}</span>
                    ) : (
                        <span className="text-xs uppercase tracking-widest whitespace-nowrap shrink-0 theme-subtext-color opacity-75">
                            {PRIORITY_LABEL[task.priority]}
                        </span>
                    )}
                </span>

                <span style={{ display: "flex", alignItems: "center", gap: 10, flex: "none", marginLeft: "auto" }}>
                    <button
                        type="button"
                        onClick={e => { e.stopPropagation(); onOpenForNote() }}
                        aria-label="Notes"
                        className={`hover:border-(--theme-text-contrast) text-xs font-semibold ${focusRing}`}
                        style={{
                            font: "inherit",
                            display: "flex", alignItems: "center", gap: 4, height: 28, padding: "0 8px", borderRadius: 999,
                            cursor: "pointer",
                            border: `1px solid ${chipUnread ? "var(--theme-text-contrast)" : "var(--theme-outline)"}`,
                            background: chipUnread ? "var(--ag-grid-selected-bg)" : "transparent",
                            color: noteColor,
                        }}
                    >
                        <span className="text-xs">✎</span>
                        {task.note_count > 0 && <span>{task.note_count}</span>}
                    </button>

                    <span style={{ display: "flex", alignItems: "center" }}>
                        {avatarPeople.map(p => (
                            <span
                                key={p.id}
                                title={p.name}
                                className="text-xs font-bold"
                                style={{
                                    width: 24, height: 24, borderRadius: "50%", display: "grid", placeItems: "center",
                                    marginLeft: -6,
                                    border: "1.5px solid var(--theme-bg)", background: avatarBg(p.name), color: AVATAR_INK,
                                }}
                            >
                                {initialOf(p.name)}
                            </span>
                        ))}
                        {!task.assignee_id && (
                            <button
                                type="button"
                                onClick={e => { e.stopPropagation(); onClaim() }}
                                className={`hover:bg-(--ag-grid-selected-bg) text-xs font-semibold ${focusRing}`}
                                style={{
                                    font: "inherit", background: "transparent",
                                    height: 28, padding: "0 12px", borderRadius: 999, border: "1px dashed var(--theme-text-contrast)",
                                    display: "grid", placeItems: "center", color: "var(--theme-text-contrast)", cursor: "pointer",
                                }}
                            >
                                Claim
                            </button>
                        )}
                    </span>

                    {!done && !review && (
                        <span style={{ position: "relative", display: "flex" }} data-task-popover>
                            <button
                                type="button"
                                onClick={e => { e.stopPropagation(); if (canChangeStatus) onToggleStatusMenu() }}
                                disabled={!canChangeStatus}
                                title={canChangeStatus ? undefined : disabledTitle}
                                className={`hover:border-(--theme-text-contrast) disabled:cursor-not-allowed text-xs font-semibold rounded-lg ${focusRing}`}
                                style={{
                                    minWidth: 118, height: 28, boxSizing: "border-box", padding: "0 8px",
                                    display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8,
                                    border: "1px solid var(--theme-border)", background: "var(--theme-bg)", color: "var(--theme-text)",
                                    opacity: canChangeStatus ? 1 : 0.6,
                                }}
                            >
                                <span>{STATUS_LABEL[task.status]}</span>
                                <ChevronDown size={14} className="opacity-70" aria-hidden="true" />
                            </button>
                            {statusMenuOpen && canChangeStatus && (
                                <span className="absolute top-8 right-0 z-40 flex flex-col min-w-40 rounded-xl border theme-border theme-bg p-1 shadow-lg">
                                    {(["todo", "doing", "review"] as const).map(k => (
                                        <button
                                            key={k}
                                            type="button"
                                            onClick={e => { e.stopPropagation(); if (k !== task.status) onSetStatus(k); onToggleStatusMenu() }}
                                            className={`hover:bg-(--ag-grid-hover-bg) text-sm rounded-lg ${focusRing}`}
                                            style={{
                                                font: "inherit", border: "none", background: "transparent", width: "100%", textAlign: "left",
                                                display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8,
                                                padding: "8px 12px", cursor: "pointer", whiteSpace: "nowrap",
                                                fontWeight: k === task.status ? 700 : 500,
                                                color: k === task.status ? "var(--theme-text-contrast)" : "var(--theme-text)",
                                            }}
                                        >
                                            <span>{STATUS_LABEL[k]}</span>
                                            <span className="text-xs">{k === task.status ? "✓" : ""}</span>
                                        </button>
                                    ))}
                                </span>
                            )}
                        </span>
                    )}

                    {review && (
                        <span style={{ display: "flex", alignItems: "center", gap: 6, flex: "none" }}>
                            <button
                                type="button"
                                onClick={e => { e.stopPropagation(); onSetStatus("doing") }}
                                className={`hover:border-(--theme-text-contrast) text-xs font-semibold rounded-lg ${focusRing}`}
                                style={{
                                    height: 28, boxSizing: "border-box", padding: "0 12px",
                                    display: "grid", placeItems: "center", whiteSpace: "nowrap", border: "1px solid var(--theme-border)",
                                    color: "var(--theme-text)",
                                }}
                            >
                                Reopen
                            </button>
                            {(!isFinisher || canAssign) && (
                                <button
                                    type="button"
                                    onClick={e => { e.stopPropagation(); onMarkReviewed() }}
                                    title={isFinisher && canAssign ? "You finished this task — mark it reviewed anyway" : undefined}
                                    className={`hover:brightness-110 text-xs font-bold rounded-lg ${focusRing}`}
                                    style={{
                                        height: 28, boxSizing: "border-box", padding: "0 12px",
                                        display: "grid", placeItems: "center", whiteSpace: "nowrap", background: "var(--theme-text-contrast)", color: "var(--theme-bg)",
                                    }}
                                >
                                    Mark reviewed
                                </button>
                            )}
                            {isFinisher && !canAssign && (
                                <span
                                    title="Someone else on the team needs to review this"
                                    className="text-xs font-semibold rounded-lg"
                                    style={{
                                        height: 28, boxSizing: "border-box", padding: "0 8px",
                                        display: "flex", alignItems: "center", gap: 6, whiteSpace: "nowrap",
                                        border: `1px dashed ${tint("--theme-text-contrast", 55)}`, color: "var(--theme-text-contrast)",
                                    }}
                                >
                                    <span style={{ width: 6, height: 6, borderRadius: "50%", background: "var(--theme-text-contrast)" }} />
                                    <span>Needs a second pair of eyes</span>
                                </span>
                            )}
                        </span>
                    )}

                    {done && (
                        <span className="text-xs font-semibold rounded-lg" style={{
                            minWidth: 118, height: 28, boxSizing: "border-box", padding: "0 8px",
                            display: "flex", alignItems: "center", gap: 6, background: "var(--ag-grid-selected-bg)", color: "var(--theme-text-contrast)",
                        }}>
                            <span>✓</span><span>Done</span>
                        </span>
                    )}

                    <span style={{ position: "relative", display: "flex", alignItems: "center" }} data-task-popover>
                        <button
                            type="button"
                            onClick={e => { e.stopPropagation(); onToggleMenu() }}
                            aria-label="More actions"
                            className={`hover:bg-(--ag-grid-hover-bg) hover:text-(--theme-h1-color) text-sm rounded-lg ${focusRing}`}
                            style={{
                                width: 28, height: 28, display: "grid", placeItems: "center",
                                color: "var(--theme-subtext-color)", background: menuOpen ? "var(--ag-grid-hover-bg)" : "transparent",
                            }}
                        >
                            ⋯
                        </button>
                        {menuOpen && (
                            <span className="absolute top-8 right-0 z-40 flex flex-col min-w-44 rounded-xl border theme-border theme-bg p-1 shadow-lg">
                                {menuItems.map((item, i) => (
                                    <button
                                        key={item.label}
                                        type="button"
                                        onClick={e => { e.stopPropagation(); item.onClick(); onToggleMenu() }}
                                        className={`${item.danger ? "hover:bg-[color-mix(in_oklch,var(--theme-danger)_12%,transparent)]" : "hover:bg-(--ag-grid-hover-bg)"} text-sm rounded-lg ${focusRing}`}
                                        style={{
                                            font: "inherit", border: "none", background: "transparent", width: "100%", textAlign: "left",
                                            padding: item.danger && i > 0 ? "12px 12px 8px" : "8px 12px",
                                            cursor: "pointer", whiteSpace: "nowrap",
                                            borderTop: item.danger && i > 0 ? "1px solid var(--theme-border)" : "none",
                                            marginTop: item.danger && i > 0 ? 4 : 0,
                                            color: item.danger ? DANGER_RED : "var(--theme-text)",
                                        }}
                                    >
                                        {item.label}
                                    </button>
                                ))}
                            </span>
                        )}
                    </span>
                </span>
            </div>

            {expanded && (
                <div style={{ padding: "4px 16px 18px 31px", display: "flex", flexWrap: "wrap", gap: "8px 24px", alignItems: "flex-start", borderTop: "1px dashed var(--theme-border)" }}>
                    <div style={{ flex: "1 1 220px", maxWidth: 280, display: "flex", flexDirection: "column", gap: 16, paddingTop: 14 }}>
                        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                            <span className={detailLabelClass}>Owner</span>
                            {canAssign ? (
                                <Dropdown value={task.assignee_id ?? ""} onChange={onOwnerChange} options={assigneeOptions(people)} triggerClassName={dropdownTriggerClassName} searchable />
                            ) : (
                                <div style={{ display: "flex", alignItems: "center", gap: 9, minHeight: 38, flexWrap: "wrap" }}>
                                    {task.assignee_id && (
                                        <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
                                            <span style={{
                                                width: 24, height: 24, borderRadius: "50%", display: "grid", placeItems: "center",
                                                color: AVATAR_INK, background: avatarBg(task.assignee_name ?? "?"),
                                            }} className="text-xs font-bold">
                                                {initialOf(task.assignee_name)}
                                            </span>
                                            <span className="text-sm theme-text">{task.assignee_name}</span>
                                        </span>
                                    )}
                                    {!task.assignee_id && (
                                        <Button onClick={e => { e.stopPropagation(); onClaim() }}>
                                            Claim task
                                        </Button>
                                    )}
                                    {/* Releasing goes through the leave route, which hands the task to
                                        the earliest contributor or leaves it unassigned. */}
                                    {task.assignee_id === currentUser.id && task.status !== "done" && (
                                        <button
                                            type="button"
                                            onClick={e => { e.stopPropagation(); onLeave() }}
                                            className={`hover:text-(--theme-danger) text-xs theme-subtext-color ${focusRing}`}
                                            style={{ font: "inherit", border: "none", background: "transparent", padding: 0, cursor: "pointer" }}
                                        >
                                            Release
                                        </button>
                                    )}
                                    {task.assignee_id && task.assignee_id !== currentUser.id && (
                                        <span className="text-xs theme-subtext-color opacity-80">Only leads can reassign</span>
                                    )}
                                </div>
                            )}
                        </div>

                        <ContributorsSection
                            task={task}
                            canAssign={canAssign}
                            currentUserId={currentUser.id}
                            people={people}
                            dropdownTriggerClassName={dropdownTriggerClassName}
                            onAddSelf={onAddSelf}
                            onAddOther={onAddOther}
                            onRemoveContributor={onRemoveContributor}
                            onLeave={onLeave}
                        />
                    </div>

                    <NotesThread
                        taskId={task.id}
                        currentUserId={currentUser.id}
                        currentUserGivenName={currentUser.display_name}
                        canAssign={canAssign}
                        unreadCount={unread}
                        draft={draft}
                        onDraftChange={onDraftChange}
                        onNoteCountChange={onNoteCountChange}
                    />
                </div>
            )}
        </div>
    )
}

interface ContributorsSectionProps {
    task: Task
    canAssign: boolean
    currentUserId: string
    people: Person[]
    dropdownTriggerClassName: string
    onAddSelf: () => void
    onAddOther: (personId: string) => void
    onRemoveContributor: (personId: string) => void
    onLeave: () => void
}

/** Its own component (rather than inline in TaskRow) so `addingContributor`
 *  resets every time the row's detail panel mounts, instead of surviving a
 *  collapse/re-expand as a stale "picker open" flag. */
function ContributorsSection({ task, canAssign, currentUserId, people, dropdownTriggerClassName, onAddSelf, onAddOther, onRemoveContributor, onLeave }: ContributorsSectionProps) {
    const [addingContributor, setAddingContributor] = useState(false)

    const isAssignee = task.assignee_id === currentUserId
    const isContributor = task.contributors.some(c => c.id === currentUserId)
    const excludeIds = new Set([task.assignee_id, ...task.contributors.map(c => c.id)])
    const addOtherOptions = people.filter(p => !excludeIds.has(p.id)).map(p => ({ value: p.id, label: p.display_name }))

    // Adding a contributor 400s when the task is unassigned or done (see
    // SPEC "Permissions") -- hide the affordance rather than ship a button
    // that's guaranteed to fail.
    const contributorsAllowed = !!task.assignee_id && task.status !== "done"
    const showAddContributor = contributorsAllowed && (canAssign ? addOtherOptions.length > 0 : (!isAssignee && !isContributor))

    return (
        <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
            <span className={detailLabelClass}>Contributors</span>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6, alignItems: "center" }}>
                {task.contributors.map(c => {
                    const removable = canAssign || c.id === currentUserId
                    return (
                        <span
                            key={c.id}
                            style={{
                                display: "flex", alignItems: "center", gap: 6, height: 28,
                                padding: removable ? "0 8px 0 12px" : "0 12px", borderRadius: 999,
                                border: "1px solid var(--theme-border)", color: "var(--theme-text)",
                            }}
                            className="text-xs"
                        >
                            <span>{c.display_name}</span>
                            {removable && (
                                <button
                                    type="button"
                                    onClick={e => { e.stopPropagation(); if (canAssign) onRemoveContributor(c.id); else onLeave() }}
                                    aria-label={`Remove ${c.display_name}`}
                                    className={`hover:text-(--theme-danger) text-xs theme-subtext-color ${focusRing}`}
                                    style={{ font: "inherit", border: "none", background: "transparent", padding: 0, cursor: "pointer" }}
                                >
                                    ✕
                                </button>
                            )}
                        </span>
                    )
                })}
                {showAddContributor && (
                    addingContributor ? (
                        /* `defaultOpen`: this picker only exists because the
                           user just clicked "+ Add", so it opens straight into
                           the roster instead of making them click it a second
                           time. Dismissing it without choosing anyone puts the
                           "+ Add" pill back, rather than stranding a closed
                           picker that would need that second click anyway. */
                        <div className="w-44" onClick={e => e.stopPropagation()}>
                            <Dropdown
                                value=""
                                onChange={v => { onAddOther(v); setAddingContributor(false) }}
                                options={addOtherOptions}
                                placeholder="Add…"
                                triggerClassName={dropdownTriggerClassName}
                                searchable
                                label="Add contributor"
                                defaultOpen
                                onOpenChange={isOpen => { if (!isOpen) setAddingContributor(false) }}
                            />
                        </div>
                    ) : (
                        <button
                            type="button"
                            onClick={e => { e.stopPropagation(); if (canAssign) setAddingContributor(true); else onAddSelf() }}
                            className={`hover:border-(--theme-text-contrast) hover:text-(--theme-text-contrast) text-xs ${focusRing}`}
                            style={{
                                font: "inherit", background: "transparent",
                                height: 28, padding: "0 12px", borderRadius: 999, border: "1px dashed var(--theme-outline)",
                                cursor: "pointer", display: "grid", placeItems: "center", color: "var(--theme-subtext-color)",
                            }}
                        >
                            {canAssign ? "+ Add" : "+ Join"}
                        </button>
                    )
                )}
            </div>
        </div>
    )
}

interface NotesThreadProps {
    taskId: string
    currentUserId: string
    currentUserGivenName: string
    canAssign: boolean
    unreadCount: number
    draft: string
    onDraftChange: (value: string) => void
    onNoteCountChange: (taskId: string, delta: number) => void
}

/** The expanded row's right column -- fetches lazily on mount (i.e. every
 *  time a row expands, since only one row is ever expanded at a time). */
function NotesThread({ taskId, currentUserId, currentUserGivenName, canAssign, unreadCount, draft, onDraftChange, onNoteCountChange }: NotesThreadProps) {
    const [notes, setNotes] = useState<TaskNote[] | null>(null)
    const [error, setError] = useState<string | null>(null)
    const [posting, setPosting] = useState(false)

    useEffect(() => {
        let cancelled = false
        setNotes(null)
        fetchNotes(taskId)
            .then(data => { if (!cancelled) setNotes(data) })
            .catch(err => { if (!cancelled) setError(failMessage(err, "Couldn't load the notes.")) })
        return () => { cancelled = true }
    }, [taskId])

    async function handlePost() {
        const body = draft.trim()
        if (!body || posting) return
        setPosting(true)
        setError(null)
        try {
            const note = await addNote(taskId, body)
            setNotes(prev => [...(prev ?? []), note])
            onDraftChange("")
            onNoteCountChange(taskId, 1)
        } catch (err) {
            setError(failMessage(err, "Couldn't post the note."))
        } finally {
            setPosting(false)
        }
    }

    async function handleDelete(note: TaskNote) {
        setError(null)
        try {
            await deleteNote(taskId, note.id)
            setNotes(prev => (prev ?? []).filter(n => n.id !== note.id))
            onNoteCountChange(taskId, -1)
        } catch (err) {
            setError(failMessage(err, "Couldn't delete the note."))
        }
    }

    function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
        if ((e.metaKey || e.ctrlKey) && e.key === "Enter") { e.preventDefault(); void handlePost() }
    }

    const canPost = draft.trim().length > 0 && !posting
    const count = notes?.length ?? 0
    // Notes come back oldest-first, so the *last* `unreadCount` of them are
    // the unread ones (SPEC "Unread notes").
    const firstUnreadIndex = count - unreadCount

    return (
        <div style={{ flex: "999 1 300px", minWidth: 0, display: "flex", flexDirection: "column", gap: 10, paddingTop: 14 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span className={detailLabelClass}>Notes</span>
                <span className="text-xs theme-subtext-color opacity-70">
                    {count > 0 ? (unreadCount > 0 ? `${count} · ${unreadCount} new` : String(count)) : ""}
                </span>
            </div>

            {error && <ErrorBanner message={error} onDismiss={() => setError(null)} />}

            {notes === null ? (
                <div role="status" aria-label="Loading notes" className="flex flex-col gap-2">
                    <Skeleton className="h-10 w-full" />
                    <Skeleton className="h-10 w-full" />
                </div>
            ) : notes.length === 0 ? (
                <EmptyState>No notes yet — leave context for whoever picks this up.</EmptyState>
            ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                    {notes.map((note, i) => {
                        const isUnread = i >= firstUnreadIndex
                        const mine = note.author_id === currentUserId
                        const canDelete = mine || canAssign
                        return (
                            <div key={note.id} style={{ display: "flex", gap: 10, padding: "9px 8px 9px 0", borderTop: i === 0 ? "none" : "1px solid var(--ag-grid-row-border)" }}>
                                <span style={{
                                    width: 24, height: 24, flex: "none", borderRadius: "50%", display: "grid", placeItems: "center",
                                    color: AVATAR_INK, background: avatarBg(note.author_name ?? "?"),
                                }} className="text-xs font-bold">
                                    {initialOf(note.author_name)}
                                </span>
                                <div style={{ minWidth: 0, flex: 1, display: "flex", flexDirection: "column", gap: 3 }}>
                                    <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "4px 7px" }}>
                                        <span className="text-xs font-bold theme-h1-color">{note.author_name ?? "Someone"}</span>
                                        <span className="text-xs theme-subtext-color">{formatRelativeTime(note.created_at)}</span>
                                        {isUnread && <span style={{ width: 6, height: 6, borderRadius: "50%", background: "var(--theme-text-contrast)" }} />}
                                    </div>
                                    <span className="text-sm theme-text" style={{ lineHeight: 1.5, overflowWrap: "anywhere" }}>{note.body}</span>
                                </div>
                                {canDelete && (
                                    <button
                                        type="button"
                                        onClick={() => void handleDelete(note)}
                                        aria-label="Delete note"
                                        className={`hover:bg-[color-mix(in_oklch,var(--theme-danger)_12%,transparent)] hover:text-(--theme-danger) text-xs rounded-lg ${focusRing}`}
                                        style={{
                                            font: "inherit", border: "none", background: "transparent", padding: 0,
                                            width: 28, height: 28, flex: "none", display: "grid", placeItems: "center", cursor: "pointer", color: "var(--theme-subtext-color)",
                                        }}
                                    >
                                        ✕
                                    </button>
                                )}
                            </div>
                        )
                    })}
                </div>
            )}

            <div style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
                <span style={{
                    width: 24, height: 24, flex: "none", borderRadius: "50%", display: "grid", placeItems: "center",
                    color: "var(--theme-bg)", background: "var(--theme-text-contrast)",
                }} className="text-xs font-bold">
                    {initialOf(currentUserGivenName)}
                </span>
                <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 8 }}>
                    <textarea
                        value={draft}
                        onChange={e => onDraftChange(e.target.value)}
                        onKeyDown={onKeyDown}
                        placeholder="Add a note… ⌘↵ to post"
                        rows={2}
                        maxLength={2000}
                        aria-label="Add a note"
                        className={`${inputClass} w-full resize-y`}
                    />
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 10 }}>
                        <span className="text-xs theme-subtext-color">{canPost ? "⌘↵ to post" : ""}</span>
                        <Button onClick={() => void handlePost()} disabled={!canPost}>
                            {posting ? "Posting…" : "Post note"}
                        </Button>
                    </div>
                </div>
            </div>
        </div>
    )
}

interface EditTaskModalProps {
    task: Task
    tasks: Task[]
    canAssign: boolean
    people: Person[]
    onClose: () => void
    onSaved: (task: Task) => void
    onError: (message: string) => void
}

/** Not part of the mockup (its seed-data prototype has no equivalent) --
 *  kept from the previous implementation essentially as-is per SPEC
 *  "Housekeeping" ("restyle rather than rewrite where the design allows"). */
function EditTaskModal({ task, tasks, canAssign, people, onClose, onSaved, onError }: EditTaskModalProps) {
    const [title, setTitle] = useState(task.title)
    const [area, setArea] = useState(task.area)
    const [bucket, setBucket] = useState(task.bucket)
    const [priority, setPriority] = useState<TaskPriority>(task.priority)
    const [dueDate, setDueDate] = useState(task.due_date ?? "")
    const [assigneeId, setAssigneeId] = useState(task.assignee_id ?? "")
    const [saving, setSaving] = useState(false)
    const dirty = useIsDirty({ title, area, bucket, priority, dueDate, assigneeId })
    const confirmDiscard = useDiscardGuard(dirty)

    async function handleSave() {
        if (!title.trim()) return
        setSaving(true)
        try {
            const patch: UpdateTaskInput = {
                title: title.trim(),
                area: area.trim() || undefined,
                bucket,
                priority,
                due_date: dueDate || null,
            }
            if (canAssign) patch.assignee_id = assigneeId || null
            onSaved(await updateTask(task.id, patch))
        } catch (err) {
            onError(failMessage(err, "Couldn't save the task."))
        } finally {
            setSaving(false)
        }
    }

    return (
        <Sheet
            title="Edit task"
            onClose={onClose}
            dirty={dirty}
            footer={
                <FormFooter safeArea>
                    <Button variant="text" size="footer" className="ml-auto" onClick={() => void confirmDiscard().then(ok => { if (ok) onClose() })}>Cancel</Button>
                    <Button size="footer" onClick={() => void handleSave()} disabled={saving || !title.trim()}>
                        {saving ? "Saving…" : "Save"}
                    </Button>
                </FormFooter>
            }
        >
            <div className="flex flex-col gap-4">
                <label className="flex flex-col gap-1.5">
                    <span className={fieldLabelClass}>Title</span>
                    <input value={title} onChange={e => setTitle(e.target.value)} className={`${inputClass} w-full`} />
                </label>
                <div className="grid grid-cols-2 gap-4">
                    <div className="flex flex-col gap-1.5">
                        <span className={fieldLabelClass}>Area</span>
                        <AreaInput value={area} onChange={setArea} suggestions={areaSuggestions(tasks, bucket)} placeholder="General" className={`${inputClass} w-full`} />
                    </div>
                    <label className="flex flex-col gap-1.5">
                        <span className={fieldLabelClass}>Due date</span>
                        <input type="date" value={dueDate} onChange={e => setDueDate(e.target.value)} className={`${inputClass} w-full`} />
                    </label>
                </div>
                <div className="grid grid-cols-2 gap-4">
                    <label className="flex flex-col gap-1.5">
                        <span className={fieldLabelClass}>Subteam</span>
                        <Dropdown value={bucket} onChange={setBucket} options={BUCKET_OPTIONS} triggerClassName={inputClass} label="Subteam" />
                    </label>
                    <label className="flex flex-col gap-1.5">
                        <span className={fieldLabelClass}>Priority</span>
                        <Dropdown
                            value={priority}
                            onChange={v => setPriority(v as TaskPriority)}
                            options={priorityChoices(canAssign, task.priority).map(p => ({ value: p, label: PRIORITY_LABEL[p] }))}
                            triggerClassName={inputClass}
                            label="Priority"
                        />
                    </label>
                </div>
                {canAssign && (
                    <label className="flex flex-col gap-1.5">
                        <span className={fieldLabelClass}>Assign to</span>
                        <Dropdown value={assigneeId} onChange={setAssigneeId} options={assigneeOptions(people)} triggerClassName={inputClass} searchable label="Assign to" />
                    </label>
                )}
            </div>
        </Sheet>
    )
}
