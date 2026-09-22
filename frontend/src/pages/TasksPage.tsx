import { useCallback, useEffect, useMemo, useState, type CSSProperties, type FormEvent, type ReactNode } from "react"
import { useLocation } from "react-router-dom"
import { Pencil, Trash2, X } from "lucide-react"
import { useOnboardedUser, type OnboardedUser } from "@/contexts/authContext"
import { can, getPerm } from "@/lib/permissions"
import Dropdown from "@/components/ui/Dropdown"
import { BUCKET_OPTIONS, TASK_BUCKETS, bucketLabel, isTaskBucket } from "@/lib/taskBuckets"
import {
    claimTask, createTask, deleteTask, fetchPeople, fetchTasks, reviewTask, unreviewTask, updateTask,
    PRIORITY_LABEL, STATUS_LABEL,
    type CreateTaskInput, type Person, type Task, type TaskPriority, type TaskStatus, type UpdateTaskInput,
} from "@/lib/tasksApi"

// The one hardcoded color on this page: High priority. The theme has no
// "danger" token (see .design-sync/conventions.md) and the design mockup
// hardcodes the same hex — mirrors the existing exception for "Banned" in
// control/MembersPage.tsx.
const DANGER_RED = "#dc2626"

/** `color-mix(in oklch, var(--token) pct%, transparent)` — the design's own
 *  tint helper, used anywhere a themed color needs partial opacity without
 *  touching the token itself. */
function tint(token: string, pct: number): string {
    return `color-mix(in oklch, var(${token}) ${pct}%, transparent)`
}

const PRIORITY_ORDER: TaskPriority[] = ["low", "med", "high"]

// Cycling is restricted to todo → doing → review (never "done" here) because
// the backend only ever reaches `done` through the review endpoint — a bare
// PATCH is rejected. See TASKS_CONTRACT.md.
const STATUS_ORDER: Exclude<TaskStatus, "done">[] = ["todo", "doing", "review"]

function priorityPillStyle(priority: TaskPriority): CSSProperties {
    const isHigh = priority === "high"
    return {
        borderRadius: 999,
        padding: "5px 9px",
        fontSize: 10,
        fontWeight: 700,
        letterSpacing: "0.12em",
        textTransform: "uppercase",
        border: `1px solid ${isHigh ? `color-mix(in oklch, ${DANGER_RED} 40%, transparent)` : "var(--theme-border)"}`,
        background: isHigh ? `color-mix(in oklch, ${DANGER_RED} 10%, transparent)` : "transparent",
        color: isHigh ? DANGER_RED : priority === "med" ? "var(--theme-text)" : "var(--theme-subtext-color)",
        opacity: priority === "low" ? 0.75 : 1,
    }
}

function statusPillStyle(status: TaskStatus): CSSProperties {
    const accentOn = status === "doing" || status === "review"
    return {
        borderRadius: 999,
        padding: "6px 12px",
        minHeight: 30,
        fontSize: 11,
        fontWeight: 700,
        letterSpacing: "0.1em",
        textTransform: "uppercase",
        border: `1px solid ${accentOn ? "var(--theme-text-contrast)" : "var(--theme-border)"}`,
        background: accentOn ? tint("--theme-text-contrast", 12) : "transparent",
        color: accentOn ? "var(--theme-text-contrast)" : "var(--theme-subtext-color)",
    }
}

const CHECKED_BOX_STYLE: CSSProperties = {
    width: 20, height: 20, borderRadius: 6,
    border: "1px solid var(--theme-text-contrast)",
    background: "var(--theme-text-contrast)",
    color: "var(--theme-bg)",
}
const OPEN_BOX_STYLE: CSSProperties = {
    width: 20, height: 20, borderRadius: 6,
    border: "1px solid var(--theme-border)",
    background: "transparent",
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]

/** `due_date` is a bare "YYYY-MM-DD" — parse as local midnight so it never
 *  reads a day early west of UTC (same fix as `resolveEvent` in lib/events.ts). */
function formatDue(dateStr: string | null): string {
    if (!dateStr) return "No due date"
    const d = new Date(`${dateStr}T00:00`)
    return `Due ${MONTHS[d.getMonth()]} ${d.getDate()}`
}

function nextOf<T>(order: readonly T[], current: T): T {
    const idx = order.indexOf(current)
    return order[(idx + 1) % order.length]
}

function assigneeOptions(people: Person[]) {
    return [{ value: "", label: "Unassigned" }, ...people.map(p => ({ value: p.id, label: p.display_name }))]
}

type WhoFilter = "everyone" | "me" | "unclaimed" | string // string branch = a person id
type StatusFilter = "all" | TaskStatus

/** Router `state` accepted by `/tasks` to pre-set its filters. */
export interface TasksPageState {
    bucket?: string
    who?: WhoFilter
}

/**
 * Task Assignments board. Buckets (left rail) are the 8 subteams + General;
 * the default bucket is the viewer's own subteam (no subteam → "All tasks").
 * Open tasks (todo/doing) are grouped by area and priority-sorted; a task
 * moved to `review` drops out of the open list into "Needs review", and
 * `done` tasks land in "Reviewed". Every mutation goes through the API and
 * the local task list is only ever updated from what the server returns.
 *
 * Visual structure follows the "Task Assignments" design mockup (single
 * bordered row-list per area group, dashed claim buttons, uppercase micro
 * labels); the row-level interaction gating (priority/status pills, the
 * complete checkbox, reassignment) additionally reflects the real PATCH
 * permission gate from TASKS_CONTRACT.md, which the mockup's seed-data
 * prototype doesn't model.
 */
export default function TasksPage() {
    const user = useOnboardedUser()
    const canAssign = can(user.permissions, "tasks.assign")

    const rawSubteam = getPerm(user.permissions, "subteam")
    const mySubteam = typeof rawSubteam === "string" && isTaskBucket(rawSubteam) ? rawSubteam : null

    const [tasks, setTasks] = useState<Task[]>([])
    const [people, setPeople] = useState<Person[]>([])
    const [loading, setLoading] = useState(true)
    const [loadError, setLoadError] = useState<string | null>(null)
    const [actionError, setActionError] = useState<string | null>(null)

    // Links can pre-set the filters via router state -- e.g. the dashboard's
    // "Your tasks" card opens on every bucket filtered to the viewer, since
    // their tasks aren't necessarily in their own subteam.
    const initialFilters = useLocation().state as TasksPageState | null

    const [bucketFilter, setBucketFilter] = useState<string>(initialFilters?.bucket ?? mySubteam ?? "all")
    const [whoFilter, setWhoFilter] = useState<WhoFilter>(initialFilters?.who ?? "everyone")
    const [statusFilter, setStatusFilter] = useState<StatusFilter>("all")
    const [showCreate, setShowCreate] = useState(false)
    const [showDone, setShowDone] = useState(false)
    const [editingTask, setEditingTask] = useState<Task | null>(null)

    const load = useCallback(async () => {
        setLoading(true)
        setLoadError(null)
        try {
            const [t, p] = await Promise.all([fetchTasks(), fetchPeople()])
            setTasks(t)
            setPeople(p)
        } catch {
            setLoadError("Failed to load tasks")
        } finally {
            setLoading(false)
        }
    }, [])

    useEffect(() => { void load() }, [load])

    const applyTask = useCallback((updated: Task) => {
        setTasks(prev => {
            const idx = prev.findIndex(t => t.id === updated.id)
            if (idx === -1) return [...prev, updated]
            const next = [...prev]
            next[idx] = updated
            return next
        })
    }, [])

    const removeTask = useCallback((id: string) => {
        setTasks(prev => prev.filter(t => t.id !== id))
    }, [])

    function canEditTask(task: Task): boolean {
        return canAssign || task.created_by === user.id
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

    // Rail counts and the header summary read the whole board, independent
    // of the active bucket/who/status filters — an at-a-glance overview,
    // matching the design's own (unfiltered) computation.
    const bucketCounts = useMemo(() => {
        const counts: Record<string, number> = Object.fromEntries(TASK_BUCKETS.map(b => [b, 0]))
        for (const t of tasks) if (t.bucket in counts) counts[t.bucket]++
        return counts
    }, [tasks])
    const allCount = tasks.length
    const unclaimedCount = tasks.filter(t => !t.assignee_id && t.status !== "done").length
    const awaitingCount = tasks.filter(t => t.status === "review").length
    const summary = `${allCount} tasks · ${unclaimedCount} unclaimed · ${awaitingCount} awaiting review`
    const unclaimedNote = unclaimedCount === 0
        ? "Everything has a name on it. Nice."
        : `${unclaimedCount} open ${unclaimedCount === 1 ? "task is" : "tasks are"} waiting for someone to claim them.`

    const filteredTasks = (bucketFilter === "all" ? tasks : tasks.filter(t => t.bucket === bucketFilter)).filter(t => {
        if (statusFilter !== "all" && t.status !== statusFilter) return false
        if (whoFilter === "everyone") return true
        if (whoFilter === "unclaimed") return !t.assignee_id
        if (whoFilter === "me") return t.assignee_id === user.id
        return t.assignee_id === whoFilter
    })

    const openTasks = filteredTasks.filter(t => t.status === "todo" || t.status === "doing")
    const needsReview = [...filteredTasks.filter(t => t.status === "review")]
        .sort((a, b) => b.updated_at.localeCompare(a.updated_at))
    const reviewed = [...filteredTasks.filter(t => t.status === "done")]
        .sort((a, b) => b.updated_at.localeCompare(a.updated_at))
    const isEmpty = openTasks.length === 0 && needsReview.length === 0 && reviewed.length === 0

    const areas = Array.from(new Set(openTasks.map(t => t.area))).sort((a, b) => a.localeCompare(b))
    const priorityRank: Record<TaskPriority, number> = { high: 0, med: 1, low: 2 }
    function rowsForArea(area: string): Task[] {
        return openTasks
            .filter(t => t.area === area)
            .sort((a, b) => priorityRank[a.priority] - priorityRank[b.priority] || a.title.localeCompare(b.title))
    }

    // Auto-reveal the completed section when the Status filter itself asks
    // for review/done tasks — matches the mockup's "reviewing" behavior.
    const reviewing = statusFilter === "review" || statusFilter === "done"
    const completedVisible = showDone || reviewing

    const whoOptions = [
        { value: "everyone", label: "Everyone" },
        { value: "unclaimed", label: "Unclaimed" },
        { value: "me", label: "Me" },
        ...people.map(p => ({ value: p.id, label: p.display_name })),
    ]
    const statusOptions = [
        { value: "all", label: "Any status" },
        { value: "todo", label: STATUS_LABEL.todo },
        { value: "doing", label: STATUS_LABEL.doing },
        { value: "review", label: STATUS_LABEL.review },
        { value: "done", label: STATUS_LABEL.done },
    ]

    if (loading) {
        return (
            <div className="px-4 py-6">
                <p className="text-sm theme-subtext-color">Loading tasks…</p>
            </div>
        )
    }

    return (
        <div className="px-4 py-6">
            <div className="flex flex-col gap-5" style={{ maxWidth: 1180, margin: "0 auto" }}>

                <div className="flex flex-wrap items-end justify-between gap-4">
                    <div className="flex flex-col gap-1">
                        <h1 className="text-2xl font-bold theme-h1-color m-0">Task board</h1>
                        <p className="text-[13px] theme-subtext-color m-0">{summary}</p>
                    </div>
                    <div className="flex flex-wrap items-center gap-2.5">
                        <MicroFilter label="Who" width={150}>
                            <Dropdown value={whoFilter} onChange={v => setWhoFilter(v as WhoFilter)} options={whoOptions} triggerClassName="px-3 py-2 text-[13px] theme-text" />
                        </MicroFilter>
                        <MicroFilter label="Status" width={140}>
                            <Dropdown value={statusFilter} onChange={v => setStatusFilter(v as StatusFilter)} options={statusOptions} triggerClassName="px-3 py-2 text-[13px] theme-text" menuAlign="right" />
                        </MicroFilter>
                        <button
                            onClick={() => setShowCreate(v => !v)}
                            className="rounded-lg text-[13px] font-semibold px-4 py-2.5 whitespace-nowrap transition-colors hover:bg-(--theme-button-hover) theme-text-contrast"
                            style={{ border: "1px solid var(--theme-border)", background: "var(--theme-button-bg)" }}
                        >
                            {showCreate ? "Close" : "New task"}
                        </button>
                    </div>
                </div>

                {loadError && <ErrorBanner message={loadError} />}
                {actionError && <ErrorBanner message={actionError} onDismiss={() => setActionError(null)} />}

                {showCreate && (
                    <CreateTaskForm
                        canAssign={canAssign}
                        people={people}
                        defaultBucket={bucketFilter !== "all" ? bucketFilter : (mySubteam ?? "general")}
                        onCreated={task => { applyTask(task); setShowCreate(false) }}
                        onError={setActionError}
                    />
                )}

                <div className="flex flex-wrap items-start gap-5">
                    <aside
                        className="flex flex-col gap-2 rounded-xl border theme-border"
                        style={{
                            flex: "1 1 200px",
                            maxWidth: 260,
                            minWidth: 190,
                            padding: 14,
                            // Recessed rail: a step darker than `--theme-bg` so the bucket
                            // list reads as its own panel rather than floating on the season
                            // background image. Mixed toward black rather than a theme token
                            // because `--theme-border` is *lighter* than the surface in the
                            // dark seasons (2025/2027) and darker in the light one (2026) --
                            // mixing toward it would lighten two themes out of three.
                            background: "color-mix(in oklch, var(--theme-bg) 88%, #000)",
                        }}
                    >
                        <span className="text-[11px] font-bold uppercase theme-subtext-color" style={{ letterSpacing: "0.14em" }}>Subteam</span>
                        <div className="flex flex-wrap gap-1.5">
                            <BucketButton active={bucketFilter === "all"} label="All tasks" count={allCount} onClick={() => setBucketFilter("all")} />
                            {BUCKET_OPTIONS.map(b => (
                                <BucketButton
                                    key={b.value}
                                    active={bucketFilter === b.value}
                                    label={b.label}
                                    count={bucketCounts[b.value] ?? 0}
                                    onClick={() => setBucketFilter(b.value)}
                                />
                            ))}
                        </div>
                        <div className="flex flex-col gap-2 border-t theme-border" style={{ marginTop: 6, paddingTop: 12 }}>
                            <span className="text-[11px] font-bold uppercase theme-subtext-color" style={{ letterSpacing: "0.14em" }}>Unclaimed</span>
                            <p className="text-sm theme-text m-0 leading-relaxed">{unclaimedNote}</p>
                        </div>
                    </aside>

                    <div className="flex flex-col gap-[22px] min-w-0" style={{ flex: "999 1 340px" }}>
                        {areas.map(area => {
                            const rows = rowsForArea(area)
                            return (
                                <section key={area}>
                                    <div className="flex items-baseline gap-2.5 mb-2">
                                        <h2 className="text-[11px] font-bold uppercase theme-subtext-color m-0" style={{ letterSpacing: "0.14em" }}>{area}</h2>
                                        <span className="text-[11px] theme-subtext-color opacity-70 tabular-nums">
                                            {rows.length} {rows.length === 1 ? "task" : "tasks"}
                                        </span>
                                    </div>
                                    <div className="rounded-xl border theme-border theme-bg">
                                        {rows.map((task, i) => (
                                            <TaskRow
                                                key={task.id}
                                                task={task}
                                                showBorder={i < rows.length - 1}
                                                canEdit={canEditTask(task)}
                                                canAssign={canAssign}
                                                people={people}
                                                currentUser={user}
                                                onCyclePriority={() => void runAction(() => updateTask(task.id, { priority: nextOf(PRIORITY_ORDER, task.priority) }))}
                                                onCycleStatus={() => void runAction(() => updateTask(task.id, { status: nextOf(STATUS_ORDER, task.status as Exclude<TaskStatus, "done">) }))}
                                                onComplete={() => void runAction(() => updateTask(task.id, { status: "review" }))}
                                                onClaim={() => void runAction(() => claimTask(task.id))}
                                                onReassign={personId => void runAction(() => updateTask(task.id, { assignee_id: personId || null }))}
                                                onEdit={() => setEditingTask(task)}
                                                onDelete={() => void handleDelete(task)}
                                            />
                                        ))}
                                    </div>
                                </section>
                            )
                        })}

                        {(needsReview.length > 0 || reviewed.length > 0) && (
                            <section className="flex flex-col gap-3">
                                <button
                                    onClick={() => setShowDone(v => !v)}
                                    className="flex items-center gap-2 theme-subtext-color bg-transparent border-0 p-0 cursor-pointer"
                                    style={{ paddingBottom: 8 }}
                                >
                                    <span className="text-[11px] font-bold uppercase" style={{ letterSpacing: "0.14em" }}>Completed</span>
                                    <span className="text-[11px] opacity-70 tabular-nums">
                                        {needsReview.length + reviewed.length} · {needsReview.length} awaiting review
                                    </span>
                                    <span className="text-[11px] font-semibold theme-text-contrast">{completedVisible ? "Hide" : "Review"}</span>
                                </button>

                                {completedVisible && (
                                    <div className="flex flex-col gap-4">
                                        {needsReview.length > 0 && (
                                            <div className="flex flex-col gap-2">
                                                <span className="text-[11px] font-bold uppercase theme-text-contrast" style={{ letterSpacing: "0.12em" }}>
                                                    Needs review · {needsReview.length}
                                                </span>
                                                <div className="rounded-xl border theme-border theme-bg">
                                                    {needsReview.map((task, i) => (
                                                        <CompletedRow
                                                            key={task.id}
                                                            variant="review"
                                                            task={task}
                                                            showBorder={i < needsReview.length - 1}
                                                            canEdit={canEditTask(task)}
                                                            currentUserId={user.id}
                                                            onReopen={() => void runAction(() => updateTask(task.id, { status: "todo" }))}
                                                            onMarkReviewed={() => void runAction(() => reviewTask(task.id))}
                                                            onEdit={() => setEditingTask(task)}
                                                            onDelete={() => void handleDelete(task)}
                                                        />
                                                    ))}
                                                </div>
                                            </div>
                                        )}
                                        {reviewed.length > 0 && (
                                            <div className="flex flex-col gap-2">
                                                <span className="text-[11px] font-bold uppercase theme-subtext-color" style={{ letterSpacing: "0.12em" }}>
                                                    Reviewed · {reviewed.length}
                                                </span>
                                                <div className="rounded-xl border theme-border theme-bg">
                                                    {reviewed.map((task, i) => (
                                                        <CompletedRow
                                                            key={task.id}
                                                            variant="done"
                                                            task={task}
                                                            showBorder={i < reviewed.length - 1}
                                                            canEdit={canEditTask(task)}
                                                            currentUserId={user.id}
                                                            onSendBack={() => void runAction(() => unreviewTask(task.id))}
                                                            onEdit={() => setEditingTask(task)}
                                                            onDelete={() => void handleDelete(task)}
                                                        />
                                                    ))}
                                                </div>
                                            </div>
                                        )}
                                    </div>
                                )}
                            </section>
                        )}

                        {isEmpty && (
                            <div className="rounded-xl border theme-border theme-bg text-center text-sm theme-subtext-color" style={{ padding: 28 }}>
                                Nothing matches this filter.
                            </div>
                        )}
                    </div>
                </div>
            </div>

            {editingTask && (
                <EditTaskModal
                    task={editingTask}
                    canAssign={canAssign}
                    people={people}
                    onClose={() => setEditingTask(null)}
                    onSaved={task => { applyTask(task); setEditingTask(null) }}
                    onError={setActionError}
                />
            )}
        </div>
    )
}

function MicroFilter({ label, width, children }: { label: string; width: number; children: ReactNode }) {
    return (
        <div className="flex items-center gap-1.5">
            <span className="text-[11px] font-bold uppercase theme-subtext-color" style={{ letterSpacing: "0.12em" }}>{label}</span>
            {/* No overflow-hidden here: Dropdown renders its menu absolutely
                positioned inside this wrapper, so clipping would hide it. */}
            <div className="rounded-lg border theme-border theme-bg theme-text" style={{ width }}>
                {children}
            </div>
        </div>
    )
}

function ErrorBanner({ message, onDismiss }: { message: string; onDismiss?: () => void }) {
    return (
        <p
            className="text-sm px-3 py-2 rounded-lg border theme-subtext-color theme-border flex items-center justify-between gap-2 m-0"
            style={{ background: "color-mix(in oklch, var(--theme-border) 40%, transparent)" }}
        >
            <span>{message}</span>
            {onDismiss && (
                <button onClick={onDismiss} className="shrink-0 theme-subtext-color hover:opacity-70 transition-opacity">
                    <X size={14} />
                </button>
            )}
        </p>
    )
}

function BucketButton({ active, label, count, onClick }: { active: boolean; label: string; count: number; onClick: () => void }) {
    return (
        <button
            onClick={onClick}
            className="flex items-center justify-between gap-2 text-left transition-colors"
            style={{
                flex: "1 1 140px",
                minHeight: 40,
                borderRadius: 8,
                padding: "10px 12px",
                border: `1px solid ${active ? "var(--theme-border)" : "transparent"}`,
                background: active ? tint("--theme-text-contrast", 12) : "transparent",
                color: active ? "var(--theme-text-contrast)" : "var(--theme-text)",
                opacity: active ? 1 : 0.62,
            }}
        >
            <span className="text-sm font-semibold">{label}</span>
            <span className="text-xs tabular-nums opacity-70">{count}</span>
        </button>
    )
}

interface RowActionsProps {
    canEdit: boolean
    onEdit: () => void
    onDelete: () => void
}

/** Restrained edit/delete affordances — not part of the mockup (its seed data
 *  has no such feature), kept per the product spec and fitted to the row's
 *  visual language as small trailing icon buttons. */
function RowActions({ canEdit, onEdit, onDelete }: RowActionsProps) {
    if (!canEdit) return null
    return (
        <div className="shrink-0 flex items-center gap-0.5">
            <button onClick={onEdit} title="Edit task" className="p-1 rounded-md theme-subtext-color hover:opacity-70 transition-opacity">
                <Pencil size={13} />
            </button>
            <button onClick={onDelete} title="Delete task" className="p-1 rounded-md theme-subtext-color hover:opacity-70 transition-opacity">
                <Trash2 size={13} />
            </button>
        </div>
    )
}

interface TaskRowProps extends RowActionsProps {
    task: Task
    showBorder: boolean
    canAssign: boolean
    people: Person[]
    currentUser: OnboardedUser
    onCyclePriority: () => void
    onCycleStatus: () => void
    onComplete: () => void
    onClaim: () => void
    onReassign: (personId: string) => void
}

function TaskRow({ task, showBorder, canEdit, canAssign, people, currentUser, onCyclePriority, onCycleStatus, onComplete, onClaim, onReassign, onEdit, onDelete }: TaskRowProps) {
    return (
        <div
            className="flex flex-wrap items-center gap-3 px-3.5 py-3"
            style={showBorder ? { borderBottom: `1px solid ${tint("--theme-border", 60)}` } : undefined}
        >
            <button
                onClick={onComplete}
                disabled={!canEdit}
                title={canEdit ? "Mark ready for review" : "Only the creator or a lead can update this task"}
                aria-label="Toggle complete"
                className="shrink-0 rounded-md transition-opacity disabled:opacity-40 disabled:cursor-not-allowed hover:opacity-70"
                style={OPEN_BOX_STYLE}
            />

            <div className="min-w-0 flex flex-col gap-0.5" style={{ flex: "4 1 220px" }}>
                <span className="text-sm font-semibold theme-h1-color">{task.title}</span>
                <span className="text-[11px] theme-subtext-color">{formatDue(task.due_date)} · {bucketLabel(task.bucket)}</span>
            </div>

            <button
                onClick={onCyclePriority}
                disabled={!canEdit}
                title={canEdit ? "Change priority" : undefined}
                className="shrink-0 whitespace-nowrap transition-opacity disabled:cursor-default hover:opacity-80"
                style={priorityPillStyle(task.priority)}
            >
                {PRIORITY_LABEL[task.priority]}
            </button>

            <button
                onClick={onCycleStatus}
                disabled={!canEdit}
                title={canEdit ? "Change status" : undefined}
                className="shrink-0 whitespace-nowrap transition-opacity disabled:cursor-default hover:opacity-80"
                style={statusPillStyle(task.status)}
            >
                {STATUS_LABEL[task.status]}
            </button>

            <div className="shrink-0" style={{ flex: "0 0 auto", width: 156 }}>
                {task.assignee_id ? (
                    canAssign ? (
                        <div className="rounded-lg border theme-border" style={{ minHeight: 36 }}>
                            <Dropdown value={task.assignee_id} onChange={onReassign} options={assigneeOptions(people)} triggerClassName="px-3 py-2 text-xs theme-text" menuAlign="right" />
                        </div>
                    ) : (
                        <p className="text-xs theme-subtext-color truncate text-right pr-1 m-0">{task.assignee_name ?? "Assigned"}</p>
                    )
                ) : (
                    <button
                        onClick={onClaim}
                        className="w-full rounded-lg text-xs font-semibold theme-text-contrast whitespace-nowrap overflow-hidden text-ellipsis transition-colors hover:bg-(--theme-button-hover)"
                        style={{ border: "1px dashed var(--theme-border)", background: "transparent", padding: "9px 10px" }}
                    >
                        Claim as {currentUser.given_name}
                    </button>
                )}
            </div>

            <RowActions canEdit={canEdit} onEdit={onEdit} onDelete={onDelete} />
        </div>
    )
}

interface CompletedRowProps extends RowActionsProps {
    task: Task
    variant: "review" | "done"
    showBorder: boolean
    currentUserId: string
    onReopen?: () => void
    onMarkReviewed?: () => void
    onSendBack?: () => void
}

function CompletedRow({ task, variant, showBorder, canEdit, currentUserId, onReopen, onMarkReviewed, onSendBack, onEdit, onDelete }: CompletedRowProps) {
    const isFinisher = task.finished_by === currentUserId
    const meta = variant === "review"
        ? `Finished by ${task.finished_by_name ?? "unclaimed"} · awaiting review`
        : `Reviewed by ${task.reviewed_by_name ?? "—"}`
    const disabledTitle = "Only the creator or a lead can update this task"

    return (
        <div
            className="flex flex-wrap items-center gap-3 px-3.5 py-3 opacity-60"
            style={showBorder ? { borderBottom: `1px solid ${tint("--theme-border", 60)}` } : undefined}
        >
            {variant === "review" ? (
                <button
                    onClick={onReopen}
                    disabled={!canEdit}
                    title={canEdit ? "Reopen" : disabledTitle}
                    aria-label="Reopen task"
                    className="shrink-0 rounded-md flex items-center justify-center text-xs disabled:opacity-50 disabled:cursor-not-allowed hover:opacity-80 transition-opacity"
                    style={CHECKED_BOX_STYLE}
                >
                    ✓
                </button>
            ) : (
                <span className="shrink-0 rounded-md flex items-center justify-center text-xs" style={CHECKED_BOX_STYLE}>✓</span>
            )}

            <div className="min-w-0 flex flex-col gap-0.5" style={{ flex: "4 1 220px" }}>
                <span className="text-sm font-semibold theme-h1-color line-through">{task.title}</span>
                <span className="text-[11px] theme-subtext-color">{meta}</span>
            </div>

            {variant === "review" && (
                <>
                    <button
                        onClick={onReopen}
                        disabled={!canEdit}
                        title={canEdit ? "Send back to To do" : disabledTitle}
                        className="shrink-0 rounded-lg theme-text text-xs font-semibold px-3.5 py-2 whitespace-nowrap transition-colors hover:bg-(--theme-button-hover) disabled:opacity-40 disabled:cursor-not-allowed"
                        style={{ border: "1px solid var(--theme-border)", background: "transparent" }}
                    >
                        Reopen
                    </button>
                    <button
                        onClick={onMarkReviewed}
                        disabled={isFinisher}
                        title={isFinisher ? "You finished this task — someone else needs to review it" : "Mark reviewed"}
                        className="shrink-0 rounded-lg theme-text-contrast text-xs font-semibold px-3.5 py-2 whitespace-nowrap transition-colors hover:bg-(--theme-button-hover) disabled:opacity-40 disabled:cursor-not-allowed"
                        style={{ border: "1px solid var(--theme-border)", background: "var(--theme-button-bg)" }}
                    >
                        Mark reviewed
                    </button>
                </>
            )}

            {variant === "done" && (
                <button
                    onClick={onSendBack}
                    disabled={!canEdit}
                    title={canEdit ? "Send back for review" : disabledTitle}
                    className="shrink-0 rounded-lg theme-text text-xs font-semibold px-3.5 py-2 whitespace-nowrap transition-colors hover:bg-(--theme-button-hover) disabled:opacity-40 disabled:cursor-not-allowed"
                    style={{ border: "1px solid var(--theme-border)", background: "transparent" }}
                >
                    Send back
                </button>
            )}

            <RowActions canEdit={canEdit} onEdit={onEdit} onDelete={onDelete} />
        </div>
    )
}

const fieldInputClass = "rounded-lg border theme-border theme-text text-sm px-2.5 outline-none focus:ring-1 bg-transparent"
const fieldInputStyle: CSSProperties = { minHeight: 38, boxSizing: "border-box" }
// Deliberately no overflow-hidden: Dropdown's menu is absolutely positioned
// inside this wrapper, and clipping it would make the menu invisible.
const dropdownWrapClass = "rounded-lg border theme-border theme-text"
const dropdownWrapStyle: CSSProperties = { minHeight: 38, boxSizing: "border-box" }

interface CreateTaskFormProps {
    canAssign: boolean
    people: Person[]
    defaultBucket: string
    onCreated: (task: Task) => void
    onError: (message: string) => void
}

function CreateTaskForm({ canAssign, people, defaultBucket, onCreated, onError }: CreateTaskFormProps) {
    const [title, setTitle] = useState("")
    const [area, setArea] = useState("")
    const [bucket, setBucket] = useState(defaultBucket)
    const [priority, setPriority] = useState<TaskPriority>("med")
    const [dueDate, setDueDate] = useState("")
    const [assigneeId, setAssigneeId] = useState("")
    const [submitting, setSubmitting] = useState(false)

    async function handleSubmit(e: FormEvent) {
        e.preventDefault()
        if (!title.trim()) return
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
            onError(err instanceof Error ? err.message : "Failed to create task")
        } finally {
            setSubmitting(false)
        }
    }

    return (
        <form
            onSubmit={e => void handleSubmit(e)}
            className="rounded-xl border theme-border theme-bg flex flex-wrap items-end gap-3"
            style={{ padding: 16 }}
        >
            <FormField label="Task" style={{ flex: "3 1 240px" }}>
                <input value={title} onChange={e => setTitle(e.target.value)} required autoFocus placeholder="e.g. Re-tension the intake belts" className={fieldInputClass} style={fieldInputStyle} />
            </FormField>

            <FormField label="Area" style={{ flex: "1 1 150px" }}>
                <input value={area} onChange={e => setArea(e.target.value)} placeholder="General" className={fieldInputClass} style={fieldInputStyle} />
            </FormField>

            <FormField label="Subteam" style={{ flex: "1 1 150px" }}>
                <div className={dropdownWrapClass} style={dropdownWrapStyle}>
                    <Dropdown value={bucket} onChange={setBucket} options={BUCKET_OPTIONS} triggerClassName="px-3 py-2 text-sm theme-text" />
                </div>
            </FormField>

            {canAssign && (
                <FormField label="Assign to" style={{ flex: "1 1 150px" }}>
                    <div className={dropdownWrapClass} style={dropdownWrapStyle}>
                        <Dropdown value={assigneeId} onChange={setAssigneeId} options={assigneeOptions(people)} triggerClassName="px-3 py-2 text-sm theme-text" placeholder="Unassigned" />
                    </div>
                </FormField>
            )}

            <FormField label="Priority" style={{ flex: "1 1 130px" }}>
                <div className={dropdownWrapClass} style={dropdownWrapStyle}>
                    <Dropdown value={priority} onChange={v => setPriority(v as TaskPriority)} options={PRIORITY_ORDER.map(p => ({ value: p, label: PRIORITY_LABEL[p] }))} triggerClassName="px-3 py-2 text-sm theme-text" />
                </div>
            </FormField>

            <FormField label="Due" style={{ flex: "1 1 140px" }}>
                <input type="date" value={dueDate} onChange={e => setDueDate(e.target.value)} className={fieldInputClass} style={fieldInputStyle} />
            </FormField>

            <button
                type="submit"
                disabled={submitting || !title.trim()}
                className="rounded-lg text-[13px] font-semibold px-[18px] py-2.5 whitespace-nowrap transition-colors hover:bg-(--theme-button-hover) theme-text-contrast disabled:opacity-40 disabled:cursor-not-allowed"
                style={{ border: "1px solid var(--theme-border)", background: "var(--theme-button-bg)" }}
            >
                {submitting ? "Adding…" : "Add task"}
            </button>
        </form>
    )
}

function FormField({ label, style, children }: { label: string; style: CSSProperties; children: ReactNode }) {
    return (
        <div className="flex flex-col gap-1.5" style={style}>
            <span className="text-xs font-semibold theme-h1-color">{label}</span>
            {children}
        </div>
    )
}

interface EditTaskModalProps {
    task: Task
    canAssign: boolean
    people: Person[]
    onClose: () => void
    onSaved: (task: Task) => void
    onError: (message: string) => void
}

function EditTaskModal({ task, canAssign, people, onClose, onSaved, onError }: EditTaskModalProps) {
    const [title, setTitle] = useState(task.title)
    const [area, setArea] = useState(task.area)
    const [bucket, setBucket] = useState(task.bucket)
    const [priority, setPriority] = useState<TaskPriority>(task.priority)
    const [dueDate, setDueDate] = useState(task.due_date ?? "")
    const [assigneeId, setAssigneeId] = useState(task.assignee_id ?? "")
    const [saving, setSaving] = useState(false)

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
            onError(err instanceof Error ? err.message : "Failed to save task")
        } finally {
            setSaving(false)
        }
    }

    return (
        <div
            className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4"
            style={{ background: "rgba(0,0,0,0.5)" }}
            onClick={e => { if (e.target === e.currentTarget) onClose() }}
        >
            <div className="w-full max-w-md rounded-2xl border p-5 flex flex-col gap-4 backdrop-blur-sm theme-bg theme-border">
                <div className="flex items-center gap-2">
                    <Pencil size={16} className="theme-subtext-color" />
                    <h2 className="text-sm font-semibold theme-text-contrast flex-1">Edit task</h2>
                    <button onClick={onClose} className="theme-subtext-color hover:opacity-70 transition-opacity">
                        <X size={16} />
                    </button>
                </div>

                <div className="flex flex-col gap-3">
                    <label className="flex flex-col gap-1">
                        <span className="text-xs font-medium theme-subtext-color">Title</span>
                        <input value={title} onChange={e => setTitle(e.target.value)} className={fieldInputClass} style={fieldInputStyle} />
                    </label>
                    <div className="grid grid-cols-2 gap-3">
                        <label className="flex flex-col gap-1">
                            <span className="text-xs font-medium theme-subtext-color">Area</span>
                            <input value={area} onChange={e => setArea(e.target.value)} className={fieldInputClass} style={fieldInputStyle} />
                        </label>
                        <label className="flex flex-col gap-1">
                            <span className="text-xs font-medium theme-subtext-color">Due date</span>
                            <input type="date" value={dueDate} onChange={e => setDueDate(e.target.value)} className={fieldInputClass} style={fieldInputStyle} />
                        </label>
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                        <label className="flex flex-col gap-1">
                            <span className="text-xs font-medium theme-subtext-color">Subteam</span>
                            <div className={dropdownWrapClass} style={dropdownWrapStyle}>
                                <Dropdown value={bucket} onChange={setBucket} options={BUCKET_OPTIONS} triggerClassName="px-3 py-2 text-sm theme-text" />
                            </div>
                        </label>
                        <label className="flex flex-col gap-1">
                            <span className="text-xs font-medium theme-subtext-color">Priority</span>
                            <div className={dropdownWrapClass} style={dropdownWrapStyle}>
                                <Dropdown
                                    value={priority}
                                    onChange={v => setPriority(v as TaskPriority)}
                                    options={PRIORITY_ORDER.map(p => ({ value: p, label: PRIORITY_LABEL[p] }))}
                                    triggerClassName="px-3 py-2 text-sm theme-text"
                                />
                            </div>
                        </label>
                    </div>
                    {canAssign && (
                        <label className="flex flex-col gap-1">
                            <span className="text-xs font-medium theme-subtext-color">Assign to</span>
                            <div className={dropdownWrapClass} style={dropdownWrapStyle}>
                                <Dropdown value={assigneeId} onChange={setAssigneeId} options={assigneeOptions(people)} triggerClassName="px-3 py-2 text-sm theme-text" />
                            </div>
                        </label>
                    )}
                </div>

                <div className="flex items-center justify-end gap-2">
                    <button onClick={onClose} className="rounded-lg border px-3.5 py-1.5 text-sm font-medium theme-text theme-border transition-opacity hover:opacity-80">
                        Cancel
                    </button>
                    <button
                        onClick={() => void handleSave()}
                        disabled={saving || !title.trim()}
                        className="rounded-lg px-3.5 py-1.5 text-sm font-semibold transition-opacity hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed"
                        style={{ background: "var(--theme-text-contrast)", color: "var(--theme-bg)" }}
                    >
                        {saving ? "Saving…" : "Save"}
                    </button>
                </div>
            </div>
        </div>
    )
}
