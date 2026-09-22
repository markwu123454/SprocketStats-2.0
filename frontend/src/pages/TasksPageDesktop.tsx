import { useEffect, useMemo, useState, type CSSProperties, type FormEvent, type KeyboardEvent } from "react"
import { useLocation } from "react-router-dom"
import { Pencil, X } from "lucide-react"
import { useOnboardedUser, type OnboardedUser } from "@/contexts/authContext"
import Dropdown from "@/components/ui/Dropdown"
import { BUCKET_OPTIONS, TASK_BUCKETS, bucketLabel } from "@/lib/taskBuckets"
import {
    addContributor, addNote, createTask, deleteNote, fetchNotes, leaveTask, removeContributor, reviewTask, unreviewTask, updateTask,
    PRIORITY_LABEL, STATUS_LABEL,
    type CreateTaskInput, type Person, type Task, type TaskNote, type TaskPriority, type UpdateTaskInput,
} from "@/lib/tasksApi"
import {
    DANGER_RED, PRIORITY_ORDER, PRIORITY_COLOR, AVATAR_INK,
    tint, tintColor, avatarBg, initialOf, formatRelativeTime, isOverdue, rowDue, assigneeOptions, sortWithinArea,
    matchesFilter, type SettableStatus, type WhoFilter, type StatusFilter, type Quick,
} from "@/lib/taskFormat"
import { useTaskBoard } from "@/lib/useTaskBoard"

/** Router `state` accepted by `/tasks` to pre-set its filters. */
export interface TasksPageState {
    bucket?: string
    who?: WhoFilter
}

interface SubteamGroup {
    bucket: string
    label: string
    countLabel: string
    singleArea: boolean
    areas: { area: string; tasks: Task[] }[]
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
    const { tasks, people, loading, loadError, actionError, setActionError, canAssign, mySubteam, canEditTask, todayMs, unread } = board

    // Links can pre-set the filters via router state -- e.g. the dashboard's
    // "Your tasks" card opens on every bucket filtered to the viewer, since
    // their tasks aren't necessarily in their own subteam.
    const initialFilters = useLocation().state as TasksPageState | null

    const [bucketFilter, setBucketFilter] = useState<string>(initialFilters?.bucket ?? mySubteam ?? "all")
    const [whoFilter, setWhoFilter] = useState<WhoFilter>(initialFilters?.who ?? "everyone")
    const [statusFilter, setStatusFilter] = useState<StatusFilter>("all")
    const [quick, setQuick] = useState<Quick>(null)
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

    // Rail counts and the header's quick-filter chips read the whole board,
    // independent of the active bucket/who/status/quick filters -- an
    // at-a-glance overview, matching the mockup's own unfiltered computation.
    const bucketCounts = useMemo(() => {
        const counts: Record<string, number> = Object.fromEntries(TASK_BUCKETS.map(b => [b, 0]))
        for (const t of tasks) if (t.bucket in counts) counts[t.bucket]++
        return counts
    }, [tasks])
    const allCount = tasks.length
    const hiddenCount = TASK_BUCKETS.filter(b => !bucketCounts[b]).length
    const unclaimedCount = tasks.filter(t => !t.assignee_id).length
    const overdueCount = tasks.filter(t => isOverdue(t, todayMs)).length
    const reviewCount = tasks.filter(t => t.status === "review").length
    const totalLabel = `${allCount} ${allCount === 1 ? "task" : "tasks"}`

    const visibleTasks = useMemo(
        () => tasks.filter(t => matchesFilter(t, { bucket: bucketFilter, status: statusFilter, who: whoFilter, quick }, user.id, todayMs)),
        [tasks, bucketFilter, statusFilter, whoFilter, quick, user.id, todayMs],
    )

    const groups = useMemo<SubteamGroup[]>(() => {
        const result: SubteamGroup[] = []
        for (const bucket of TASK_BUCKETS) {
            const bucketTasks = visibleTasks.filter(t => t.bucket === bucket)
            if (bucketTasks.length === 0) continue
            const areaNames = Array.from(new Set(bucketTasks.map(t => t.area))).sort((a, b) => a.localeCompare(b))
            const areas = areaNames.map(area => ({
                area,
                tasks: bucketTasks.filter(t => t.area === area).sort(sortWithinArea),
            }))
            result.push({
                bucket,
                label: bucketLabel(bucket),
                countLabel: bucketTasks.length === 1 ? "1 task" : `${bucketTasks.length} tasks`,
                areas,
                singleArea: areas.length === 1,
            })
        }
        return result
    }, [visibleTasks])
    const isEmpty = groups.length === 0

    const whoOptions = [
        { value: "everyone", label: "Everyone" },
        { value: "me", label: "My tasks" },
        { value: "unclaimed", label: "Unassigned" },
        ...people.map(p => ({ value: p.id, label: p.display_name })),
    ]
    const statusOptions = [
        { value: "all", label: "Any status" },
        { value: "todo", label: STATUS_LABEL.todo },
        { value: "doing", label: STATUS_LABEL.doing },
        { value: "review", label: STATUS_LABEL.review },
        { value: "done", label: STATUS_LABEL.done },
    ]

    const dropdownTriggerClassName = "rounded-lg border px-3 py-2 text-sm transition theme-bg theme-border theme-text"
    const defaultBucket = bucketFilter !== "all" ? bucketFilter : (mySubteam ?? "general")

    if (loading) {
        return (
            <div className="px-4 py-6">
                <p className="text-sm theme-subtext-color">Loading tasks…</p>
            </div>
        )
    }

    return (
        <div className="px-4 py-6">
            <div className="flex flex-col gap-[18px]" style={{ maxWidth: 1180, margin: "0 auto" }}>

                <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 20, flexWrap: "wrap" }}>
                    <div>
                        <h1 style={{ margin: 0, fontSize: 28, lineHeight: 1.1, fontWeight: 700, letterSpacing: "-0.02em", color: "var(--theme-h1-color)" }}>Task board</h1>
                        <div style={{ marginTop: 8, display: "flex", alignItems: "center", gap: 7, flexWrap: "wrap", fontSize: 12.5, color: "var(--theme-subtext-color)" }}>
                            <span style={{ whiteSpace: "nowrap", marginRight: 2 }}>{totalLabel}</span>
                            <QuickChip label="Unclaimed" dot="#f5d547" count={unclaimedCount} active={quick === "unclaimed"} onClick={() => setQuick(q => q === "unclaimed" ? null : "unclaimed")} />
                            <QuickChip label="Overdue" dot="#f87171" count={overdueCount} active={quick === "overdue"} onClick={() => setQuick(q => q === "overdue" ? null : "overdue")} />
                            <QuickChip label="Needs review" dot="#9ad4c4" count={reviewCount} active={quick === "review"} onClick={() => setQuick(q => q === "review" ? null : "review")} />
                        </div>
                    </div>
                    <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 10 }}>
                        <div style={{ width: 150 }}>
                            <Dropdown value={whoFilter} onChange={v => setWhoFilter(v as WhoFilter)} options={whoOptions} triggerClassName={dropdownTriggerClassName} searchable />
                        </div>
                        <div style={{ width: 150 }}>
                            <Dropdown value={statusFilter} onChange={v => setStatusFilter(v as StatusFilter)} options={statusOptions} triggerClassName={dropdownTriggerClassName} menuAlign="right" />
                        </div>
                        <button
                            onClick={() => setComposing(v => !v)}
                            className="hover:brightness-110"
                            style={{
                                whiteSpace: "nowrap", flex: "none", height: 38, padding: "0 16px", borderRadius: 8,
                                border: `1px solid ${composing ? "var(--theme-border)" : "transparent"}`,
                                fontSize: 13.5, fontWeight: 700, cursor: "pointer",
                                background: composing ? "var(--theme-button-bg)" : "var(--theme-text-contrast)",
                                color: composing ? "var(--theme-text-contrast)" : "var(--theme-bg)",
                            }}
                        >
                            {composing ? "Close" : "New task"}
                        </button>
                    </div>
                </div>

                {loadError && <ErrorBanner message={loadError} />}
                {actionError && <ErrorBanner message={actionError} onDismiss={() => setActionError(null)} />}

                {composing && (
                    <ComposeForm
                        canAssign={canAssign}
                        people={people}
                        defaultBucket={defaultBucket}
                        dropdownTriggerClassName={dropdownTriggerClassName}
                        onCreated={task => { board.applyTask(task); setComposing(false) }}
                        onClose={() => setComposing(false)}
                        onError={setActionError}
                    />
                )}

                <div style={{ display: "flex", flexWrap: "wrap", gap: 20, alignItems: "flex-start" }}>

                    <aside style={{
                        flex: "1 1 200px", maxWidth: 240, minWidth: 180, boxSizing: "border-box",
                        border: "1px solid var(--theme-border)", borderRadius: 12, background: "var(--theme-button-bg)",
                        padding: 12, display: "flex", flexDirection: "column", gap: 2,
                    }}>
                        <div style={{ fontSize: 10, letterSpacing: "0.12em", textTransform: "uppercase", color: "var(--theme-subtext-color)", padding: "4px 8px 8px" }}>Subteam</div>
                        <RailRow active={bucketFilter === "all"} label="All tasks" count={allCount} onClick={() => setBucketFilter("all")} />
                        {BUCKET_OPTIONS.filter(b => showEmpties || (bucketCounts[b.value] ?? 0) > 0).map(b => (
                            <RailRow key={b.value} active={bucketFilter === b.value} label={b.label} count={bucketCounts[b.value] ?? 0} onClick={() => setBucketFilter(b.value)} />
                        ))}
                        <button
                            type="button"
                            onClick={() => setShowEmpties(v => !v)}
                            style={{
                                font: "inherit", border: "none", background: "transparent", width: "100%", textAlign: "left",
                                marginTop: 6, padding: "9px 9px 2px", borderTop: "1px solid var(--theme-border)", fontSize: 12, cursor: "pointer", color: "var(--theme-text-contrast)",
                            }}
                        >
                            {showEmpties ? "Hide empty subteams" : `Show ${hiddenCount} empty subteams`}
                        </button>
                    </aside>

                    <div style={{ flex: "999 1 440px", minWidth: 0, display: "flex", flexDirection: "column", gap: 18 }}>
                        {groups.map(group => (
                            <section key={group.bucket}>
                                <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "0 2px 8px" }}>
                                    <span style={{ fontSize: 10.5, letterSpacing: "0.12em", textTransform: "uppercase", fontWeight: 700, color: "var(--theme-h1-color)" }}>{group.label}</span>
                                    <span style={{ fontSize: 11.5, color: "var(--theme-subtext-color)" }}>{group.countLabel}</span>
                                    <span style={{ flex: 1, height: 1, background: "var(--theme-border)" }} />
                                </div>
                                <div style={{ display: "flex", flexDirection: "column", gap: group.singleArea ? 0 : 14 }}>
                                    {group.areas.map(areaGroup => (
                                        <div key={areaGroup.area}>
                                            {!group.singleArea && (
                                                <div style={{ fontSize: 10, letterSpacing: "0.1em", textTransform: "uppercase", color: "var(--theme-subtext-color)", padding: "0 2px 6px" }}>
                                                    {areaGroup.area}
                                                </div>
                                            )}
                                            <div style={{ border: "1px solid var(--theme-border)", borderRadius: 12, background: "var(--theme-button-bg)" }}>
                                                {areaGroup.tasks.map((task, i) => (
                                                    <TaskRow
                                                        key={task.id}
                                                        task={task}
                                                        isFirst={i === 0}
                                                        canEdit={canEditTask(task)}
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
                                                ))}
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </section>
                        ))}

                        {isEmpty && (
                            <div style={{ border: "1px dashed var(--theme-border)", borderRadius: 12, padding: "40px 24px", textAlign: "center" }}>
                                <div style={{ fontSize: 15, fontWeight: 600, color: "var(--theme-h1-color)" }}>Nothing matches these filters</div>
                                <div style={{ marginTop: 6, fontSize: 13, color: "var(--theme-subtext-color)" }}>Try switching Who back to Everyone, or clear the status filter.</div>
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
                    onSaved={task => { board.applyTask(task); setEditingTask(null) }}
                    onError={setActionError}
                />
            )}
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

function RailRow({ active, label, count, onClick }: { active: boolean; label: string; count: number; onClick: () => void }) {
    return (
        <button
            type="button"
            onClick={onClick}
            style={{
                font: "inherit", border: "none", width: "100%", textAlign: "left",
                display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8,
                height: 34, padding: "0 9px", borderRadius: 7, cursor: "pointer", fontSize: 13.5,
                background: active ? "var(--ag-grid-selected-bg)" : "transparent",
                color: active ? "var(--theme-text-contrast)" : "var(--theme-text)",
                fontWeight: active ? 700 : 500,
            }}
        >
            <span>{label}</span>
            <span style={{ fontSize: 12, color: active ? "var(--theme-text-contrast)" : tint("--theme-subtext-color", 70) }}>{count}</span>
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
            style={{
                font: "inherit",
                display: "flex", alignItems: "center", gap: 6, cursor: empty ? "default" : "pointer",
                whiteSpace: "nowrap", borderRadius: 999, padding: "4px 11px", fontWeight: 600,
                border: `1px solid ${active ? dot : "var(--theme-border)"}`,
                background: active ? tintColor(dot, 16) : "transparent",
                color: active ? "var(--theme-h1-color)" : "var(--theme-subtext-color)",
                opacity: empty && !active ? 0.55 : 1,
            }}
        >
            <span style={{ width: 6, height: 6, borderRadius: "50%", background: dotColor }} />
            <span>{label}</span>
            <span style={{ fontVariantNumeric: "tabular-nums" }}>{count}</span>
        </button>
    )
}

const composeLabelStyle: CSSProperties = { fontSize: 12.5, fontWeight: 700, color: "var(--theme-h1-color)" }
const composeInputStyle: CSSProperties = {
    height: 38, boxSizing: "border-box", width: "100%", padding: "0 12px", borderRadius: 8,
    border: "1px solid var(--theme-border)", background: "var(--theme-bg)", color: "var(--theme-text)",
    font: "inherit", fontSize: 14, outline: "none",
}
// Tailwind arbitrary-value focus utility referencing a CSS var, per the
// established idiom in this file (see the DANGER_RED note above for why
// these have to be literal strings rather than built from a JS constant).
const composeInputFocusClass = "focus:border-(--theme-h1-color)"

interface ComposeFormProps {
    canAssign: boolean
    people: Person[]
    defaultBucket: string
    dropdownTriggerClassName: string
    onCreated: (task: Task) => void
    onClose: () => void
    onError: (message: string) => void
}

function ComposeForm({ canAssign, people, defaultBucket, dropdownTriggerClassName, onCreated, onClose, onError }: ComposeFormProps) {
    const [title, setTitle] = useState("")
    const [area, setArea] = useState("")
    const [bucket, setBucket] = useState(defaultBucket)
    const [priority, setPriority] = useState<TaskPriority>("med")
    const [dueDate, setDueDate] = useState("")
    const [assigneeId, setAssigneeId] = useState("")
    const [submitting, setSubmitting] = useState(false)

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
            onError(err instanceof Error ? err.message : "Failed to create task")
        } finally {
            setSubmitting(false)
        }
    }

    function onFormKeyDown(e: KeyboardEvent<HTMLFormElement>) {
        if (e.key === "Escape") onClose()
    }

    const canSubmit = title.trim().length > 0 && !submitting

    return (
        <div style={{ border: "1px solid var(--theme-border)", borderRadius: 12, background: "var(--theme-button-bg)", padding: "18px 20px", display: "flex", flexDirection: "column", gap: 14 }}>
            <form onSubmit={e => void handleSubmit(e)} onKeyDown={onFormKeyDown} style={{ display: "contents" }}>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 12 }}>
                    <div style={{ display: "flex", flexDirection: "column", gap: 6, gridColumn: "span 2", minWidth: 0 }}>
                        <span style={composeLabelStyle}>Task</span>
                        <input
                            value={title}
                            onChange={e => setTitle(e.target.value)}
                            autoFocus
                            placeholder="e.g. Re-tension the intake belts"
                            className={composeInputFocusClass}
                            style={composeInputStyle}
                        />
                    </div>
                    <div style={{ display: "flex", flexDirection: "column", gap: 6, minWidth: 0 }}>
                        <span style={composeLabelStyle}>Area</span>
                        <input
                            value={area}
                            onChange={e => setArea(e.target.value)}
                            placeholder="General"
                            className={composeInputFocusClass}
                            style={composeInputStyle}
                        />
                    </div>
                    <div style={{ display: "flex", flexDirection: "column", gap: 6, minWidth: 0 }}>
                        <span style={composeLabelStyle}>Subteam</span>
                        <Dropdown value={bucket} onChange={setBucket} options={BUCKET_OPTIONS} triggerClassName={dropdownTriggerClassName} />
                    </div>
                    {canAssign && (
                        <div style={{ display: "flex", flexDirection: "column", gap: 6, minWidth: 0 }}>
                            <span style={composeLabelStyle}>Assign to</span>
                            <Dropdown value={assigneeId} onChange={setAssigneeId} options={assigneeOptions(people)} triggerClassName={dropdownTriggerClassName} searchable />
                        </div>
                    )}
                    <div style={{ display: "flex", flexDirection: "column", gap: 6, minWidth: 0 }}>
                        <span style={composeLabelStyle}>Priority</span>
                        <Dropdown value={priority} onChange={v => setPriority(v as TaskPriority)} options={PRIORITY_ORDER.map(p => ({ value: p, label: PRIORITY_LABEL[p] }))} triggerClassName={dropdownTriggerClassName} />
                    </div>
                    <div style={{ display: "flex", flexDirection: "column", gap: 6, minWidth: 0 }}>
                        <span style={composeLabelStyle}>Due</span>
                        <input
                            type="date"
                            value={dueDate}
                            onChange={e => setDueDate(e.target.value)}
                            className={composeInputFocusClass}
                            style={{ ...composeInputStyle, padding: "0 10px" }}
                        />
                    </div>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
                    <button
                        type="submit"
                        disabled={!canSubmit}
                        style={{
                            whiteSpace: "nowrap", flex: "none", height: 36, padding: "0 16px", borderRadius: 8,
                            border: "1px solid var(--theme-border)", fontSize: 13.5, fontWeight: 700,
                            cursor: canSubmit ? "pointer" : "default",
                            background: canSubmit ? "var(--theme-text-contrast)" : "transparent",
                            color: canSubmit ? "var(--theme-bg)" : tint("--theme-text-contrast", 45),
                        }}
                    >
                        {submitting ? "Adding…" : "Add task"}
                    </button>
                    <span style={{ fontSize: 12, color: "var(--theme-subtext-color)" }}>
                        {canAssign ? "↵ to add · Esc to close" : "New tasks start unclaimed — claim it after adding. ↵ to add"}
                    </span>
                </div>
            </form>
        </div>
    )
}

interface MenuAction {
    label: string
    onClick: () => void
    danger?: boolean
}

const detailLabelStyle: CSSProperties = { fontSize: 10, letterSpacing: "0.1em", textTransform: "uppercase", color: "var(--theme-subtext-color)" }

interface TaskRowProps {
    task: Task
    isFirst: boolean
    canEdit: boolean
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
    task, isFirst, canEdit, canAssign, people, currentUser, todayMs, unread, expanded, menuOpen, statusMenuOpen, draft,
    dropdownTriggerClassName, onDraftChange, onToggleRow, onOpenForNote, onToggleMenu, onToggleStatusMenu, onSetStatus,
    onClaim, onOwnerChange, onAddSelf, onAddOther, onRemoveContributor, onLeave, onMarkReviewed, onUnreview, onEdit, onDelete,
    onNoteCountChange,
}: TaskRowProps) {
    const done = task.status === "done"
    const review = task.status === "review"
    const due = rowDue(task, todayMs)
    const priorityColor = done ? tint("--theme-border", 70) : PRIORITY_COLOR[task.priority]
    const isFinisher = task.finished_by === currentUser.id
    const disabledTitle = "Only the creator or a lead can update this task"

    const avatarPeople = task.assignee_id
        ? [{ id: task.assignee_id, name: task.assignee_name ?? "Assigned" }, ...task.contributors.map(c => ({ id: c.id, name: c.display_name }))]
        : []

    const chipUnread = unread > 0
    const noteColor = chipUnread ? "var(--theme-text-contrast)" : (task.note_count > 0 ? "var(--theme-text)" : "var(--theme-subtext-color)")

    const menuItems: MenuAction[] = []
    if (canEdit) menuItems.push({ label: "Edit task", onClick: onEdit })
    menuItems.push({ label: "Add a note", onClick: onOpenForNote })
    if (canEdit && (task.status === "todo" || task.status === "doing")) menuItems.push({ label: "Mark ready for review", onClick: () => onSetStatus("review") })
    if (canEdit && (task.status === "doing" || task.status === "review")) menuItems.push({ label: "Send back to To do", onClick: () => onSetStatus("todo") })
    if (canEdit && done) menuItems.push({ label: "Send back for review", onClick: onUnreview })
    if (canEdit) menuItems.push({ label: "Delete task", onClick: onDelete, danger: true })

    return (
        <div style={{ borderTop: isFirst ? "none" : "1px solid var(--ag-grid-row-border)" }}>
            <div
                onClick={onToggleRow}
                className="hover:bg-(--ag-grid-hover-bg)"
                style={{
                    display: "flex", flexWrap: "wrap", alignItems: "center", gap: "8px 12px",
                    minHeight: 54, padding: "6px 12px 6px 0", cursor: "pointer",
                    background: expanded ? "var(--ag-grid-hover-bg)" : "transparent",
                }}
            >
                <span style={{ width: 3, alignSelf: "stretch", flex: "none", borderRadius: "0 3px 3px 0", background: priorityColor }} />

                <button
                    type="button"
                    onClick={e => { e.stopPropagation(); if (done || !canEdit) return; onSetStatus(review ? "doing" : "review") }}
                    disabled={done || !canEdit}
                    title={canEdit ? undefined : disabledTitle}
                    className="disabled:cursor-not-allowed"
                    style={{
                        width: 17, height: 17, flex: "none", borderRadius: 5, display: "grid", placeItems: "center",
                        fontSize: 10, fontWeight: 800, padding: 0,
                        color: done ? "var(--theme-bg)" : "var(--theme-text-contrast)",
                        border: `1.5px solid ${done || review ? "var(--theme-text-contrast)" : "var(--theme-border)"}`,
                        background: done ? "var(--theme-text-contrast)" : (review ? "var(--ag-grid-selected-bg)" : "transparent"),
                        opacity: canEdit ? 1 : 0.6,
                        cursor: canEdit && !done ? "pointer" : "default",
                    }}
                >
                    {done || review ? "✓" : ""}
                </button>

                <span style={{ flex: "1 1 200px", minWidth: 130, display: "flex", flexWrap: "wrap", alignItems: "baseline", gap: "2px 10px" }}>
                    <span style={{
                        flex: "1 1 auto", minWidth: 90, fontSize: 14.5, fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
                        color: done ? "var(--theme-subtext-color)" : "var(--theme-h1-color)", textDecoration: done ? "line-through" : "none",
                    }}>
                        {task.title}
                    </span>
                    <span style={{ flex: "none", fontSize: 12, whiteSpace: "nowrap", color: due.color }}>{due.text}</span>
                    <span style={{ flex: "none", fontSize: 11, letterSpacing: "0.08em", textTransform: "uppercase", whiteSpace: "nowrap", color: "var(--theme-subtext-color)", opacity: 0.75 }}>
                        {PRIORITY_LABEL[task.priority]}
                    </span>
                </span>

                <span style={{ display: "flex", alignItems: "center", gap: 10, flex: "none", marginLeft: "auto" }}>
                    <button
                        type="button"
                        onClick={e => { e.stopPropagation(); onOpenForNote() }}
                        aria-label="Notes"
                        className="hover:border-(--theme-text-contrast)"
                        style={{
                            font: "inherit",
                            display: "flex", alignItems: "center", gap: 5, height: 26, padding: "0 9px", borderRadius: 999,
                            fontSize: 12, fontWeight: 600, cursor: "pointer",
                            border: `1px solid ${chipUnread ? "var(--theme-text-contrast)" : "var(--theme-border)"}`,
                            background: chipUnread ? "var(--ag-grid-selected-bg)" : "transparent",
                            color: noteColor,
                        }}
                    >
                        <span style={{ fontSize: 11 }}>✎</span>
                        {task.note_count > 0 && <span>{task.note_count}</span>}
                    </button>

                    <span style={{ display: "flex", alignItems: "center" }}>
                        {avatarPeople.map(p => (
                            <span
                                key={p.id}
                                title={p.name}
                                style={{
                                    width: 24, height: 24, borderRadius: "50%", display: "grid", placeItems: "center",
                                    fontSize: 10.5, fontWeight: 700, marginLeft: -6,
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
                                className="hover:bg-(--ag-grid-selected-bg)"
                                style={{
                                    font: "inherit", background: "transparent",
                                    height: 26, padding: "0 11px", borderRadius: 999, border: "1px dashed var(--theme-text-contrast)",
                                    fontSize: 12, fontWeight: 600, display: "grid", placeItems: "center", color: "var(--theme-text-contrast)", cursor: "pointer",
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
                                onClick={e => { e.stopPropagation(); if (canEdit) onToggleStatusMenu() }}
                                disabled={!canEdit}
                                title={canEdit ? undefined : disabledTitle}
                                className="hover:border-(--theme-text-contrast) disabled:cursor-not-allowed"
                                style={{
                                    minWidth: 118, height: 28, boxSizing: "border-box", padding: "0 10px", borderRadius: 7,
                                    fontSize: 12, fontWeight: 600, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 6,
                                    border: "1px solid var(--theme-border)", background: "var(--theme-bg)", color: "var(--theme-text)",
                                    opacity: canEdit ? 1 : 0.6,
                                }}
                            >
                                <span>{STATUS_LABEL[task.status]}</span>
                                <span style={{ fontSize: 8, opacity: 0.7 }}>▾</span>
                            </button>
                            {statusMenuOpen && canEdit && (
                                <span style={{
                                    position: "absolute", top: 32, right: 0, zIndex: 30, border: "1px solid var(--theme-border)",
                                    borderRadius: 9, background: "var(--theme-bg)", padding: 5, display: "flex", flexDirection: "column",
                                    minWidth: 150, boxShadow: "0 12px 28px rgba(0,0,0,0.5)",
                                }}>
                                    {(["todo", "doing", "review"] as const).map(k => (
                                        <button
                                            key={k}
                                            type="button"
                                            onClick={e => { e.stopPropagation(); if (k !== task.status) onSetStatus(k); onToggleStatusMenu() }}
                                            className="hover:bg-(--ag-grid-hover-bg)"
                                            style={{
                                                font: "inherit", border: "none", background: "transparent", width: "100%", textAlign: "left",
                                                display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10,
                                                padding: "7px 10px", borderRadius: 6, fontSize: 13, cursor: "pointer", whiteSpace: "nowrap",
                                                fontWeight: k === task.status ? 700 : 500,
                                                color: k === task.status ? "var(--theme-text-contrast)" : "var(--theme-text)",
                                            }}
                                        >
                                            <span>{STATUS_LABEL[k]}</span>
                                            <span style={{ fontSize: 11 }}>{k === task.status ? "✓" : ""}</span>
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
                                onClick={e => { e.stopPropagation(); if (canEdit) onSetStatus("doing") }}
                                disabled={!canEdit}
                                title={canEdit ? undefined : disabledTitle}
                                className="hover:border-(--theme-text-contrast) disabled:cursor-not-allowed"
                                style={{
                                    height: 28, boxSizing: "border-box", padding: "0 11px", borderRadius: 7, fontSize: 12, fontWeight: 600,
                                    display: "grid", placeItems: "center", whiteSpace: "nowrap", border: "1px solid var(--theme-border)",
                                    color: "var(--theme-text)", opacity: canEdit ? 1 : 0.6,
                                }}
                            >
                                Reopen
                            </button>
                            {(!isFinisher || canAssign) && (
                                <button
                                    type="button"
                                    onClick={e => { e.stopPropagation(); onMarkReviewed() }}
                                    title={isFinisher && canAssign ? "You finished this task — mark it reviewed anyway" : undefined}
                                    className="hover:brightness-110"
                                    style={{
                                        height: 28, boxSizing: "border-box", padding: "0 12px", borderRadius: 7, fontSize: 12, fontWeight: 700,
                                        display: "grid", placeItems: "center", whiteSpace: "nowrap", background: "var(--theme-text-contrast)", color: "var(--theme-bg)",
                                    }}
                                >
                                    Mark reviewed
                                </button>
                            )}
                            {isFinisher && !canAssign && (
                                <span
                                    title="Someone else on the team needs to review this"
                                    style={{
                                        height: 28, boxSizing: "border-box", padding: "0 10px", borderRadius: 7, fontSize: 12, fontWeight: 600,
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
                        <span style={{
                            minWidth: 118, height: 28, boxSizing: "border-box", padding: "0 10px", borderRadius: 7, fontSize: 12, fontWeight: 600,
                            display: "flex", alignItems: "center", gap: 6, background: "var(--ag-grid-selected-bg)", color: "var(--theme-text-contrast)",
                        }}>
                            <span>✓</span><span>Done</span>
                        </span>
                    )}

                    <span style={{ position: "relative", display: "flex", alignItems: "center" }} data-task-popover>
                        <button
                            type="button"
                            onClick={e => { e.stopPropagation(); onToggleMenu() }}
                            className="hover:bg-(--ag-grid-hover-bg) hover:text-(--theme-h1-color)"
                            style={{
                                width: 26, height: 26, borderRadius: 7, display: "grid", placeItems: "center", fontSize: 14,
                                color: "var(--theme-subtext-color)", background: menuOpen ? "var(--ag-grid-hover-bg)" : "transparent",
                            }}
                        >
                            ⋯
                        </button>
                        {menuOpen && (
                            <span style={{
                                position: "absolute", top: 30, right: 0, zIndex: 30, border: "1px solid var(--theme-border)",
                                borderRadius: 9, background: "var(--theme-bg)", padding: 5, display: "flex", flexDirection: "column",
                                minWidth: 180, boxShadow: "0 12px 28px rgba(0,0,0,0.5)",
                            }}>
                                {menuItems.map((item, i) => (
                                    <button
                                        key={item.label}
                                        type="button"
                                        onClick={e => { e.stopPropagation(); item.onClick(); onToggleMenu() }}
                                        className={item.danger ? "hover:bg-[rgba(248,113,113,0.12)]" : "hover:bg-(--ag-grid-hover-bg)"}
                                        style={{
                                            font: "inherit", border: "none", background: "transparent", width: "100%", textAlign: "left",
                                            padding: item.danger && i > 0 ? "12px 10px 7px" : "7px 10px", borderRadius: 6, fontSize: 13,
                                            cursor: "pointer", whiteSpace: "nowrap",
                                            borderTop: item.danger && i > 0 ? "1px solid var(--theme-border)" : "none",
                                            marginTop: item.danger && i > 0 ? 5 : 0,
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
                            <span style={detailLabelStyle}>Owner</span>
                            {canAssign ? (
                                <Dropdown value={task.assignee_id ?? ""} onChange={onOwnerChange} options={assigneeOptions(people)} triggerClassName={dropdownTriggerClassName} searchable />
                            ) : (
                                <div style={{ display: "flex", alignItems: "center", gap: 9, minHeight: 38, flexWrap: "wrap" }}>
                                    {task.assignee_id && (
                                        <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
                                            <span style={{
                                                width: 24, height: 24, borderRadius: "50%", display: "grid", placeItems: "center",
                                                fontSize: 10.5, fontWeight: 700, color: AVATAR_INK, background: avatarBg(task.assignee_name ?? "?"),
                                            }}>
                                                {initialOf(task.assignee_name)}
                                            </span>
                                            <span style={{ fontSize: 13.5, color: "var(--theme-text)" }}>{task.assignee_name}</span>
                                        </span>
                                    )}
                                    {!task.assignee_id && (
                                        <button
                                            type="button"
                                            onClick={e => { e.stopPropagation(); onClaim() }}
                                            className="hover:brightness-110"
                                            style={{
                                                height: 32, padding: "0 14px", borderRadius: 8, fontSize: 13, fontWeight: 700, cursor: "pointer",
                                                display: "grid", placeItems: "center", background: "var(--theme-text-contrast)", color: "var(--theme-bg)",
                                            }}
                                        >
                                            Claim task
                                        </button>
                                    )}
                                    {/* Member-side "Release" is dropped entirely here: the mockup lets a
                                        member clear their own assignment, but there's no backend route for
                                        that (assignee changes always require tasks.assign) -- it would 403.
                                        A member who owns the task just sees their name with no controls. */}
                                    {task.assignee_id && task.assignee_id !== currentUser.id && (
                                        <span style={{ fontSize: 11.5, color: "var(--theme-subtext-color)", opacity: 0.8 }}>Only leads can reassign</span>
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
                        currentUserGivenName={currentUser.given_name}
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
            <span style={detailLabelStyle}>Contributors</span>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6, alignItems: "center" }}>
                {task.contributors.map(c => {
                    const removable = canAssign || c.id === currentUserId
                    return (
                        <span
                            key={c.id}
                            style={{
                                display: "flex", alignItems: "center", gap: 6, height: 28,
                                padding: removable ? "0 7px 0 10px" : "0 10px", borderRadius: 999,
                                border: "1px solid var(--theme-border)", fontSize: 12.5, color: "var(--theme-text)",
                            }}
                        >
                            <span>{c.display_name}</span>
                            {removable && (
                                <button
                                    type="button"
                                    onClick={e => { e.stopPropagation(); if (canAssign) onRemoveContributor(c.id); else onLeave() }}
                                    aria-label={`Remove ${c.display_name}`}
                                    className="hover:text-[#dc2626]"
                                    style={{ font: "inherit", border: "none", background: "transparent", padding: 0, cursor: "pointer", fontSize: 11, color: "var(--theme-subtext-color)" }}
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
                        <div style={{ width: 170 }} onClick={e => e.stopPropagation()}>
                            <Dropdown
                                value=""
                                onChange={v => { onAddOther(v); setAddingContributor(false) }}
                                options={addOtherOptions}
                                placeholder="Add…"
                                triggerClassName={dropdownTriggerClassName}
                                searchable
                                defaultOpen
                                onOpenChange={isOpen => { if (!isOpen) setAddingContributor(false) }}
                            />
                        </div>
                    ) : (
                        <button
                            type="button"
                            onClick={e => { e.stopPropagation(); if (canAssign) setAddingContributor(true); else onAddSelf() }}
                            className="hover:border-(--theme-text-contrast) hover:text-(--theme-text-contrast)"
                            style={{
                                font: "inherit", background: "transparent",
                                height: 28, padding: "0 11px", borderRadius: 999, border: "1px dashed var(--theme-border)",
                                fontSize: 12.5, cursor: "pointer", display: "grid", placeItems: "center", color: "var(--theme-subtext-color)",
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
            .catch(err => { if (!cancelled) setError(err instanceof Error ? err.message : "Failed to load notes") })
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
            setError(err instanceof Error ? err.message : "Failed to post note")
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
            setError(err instanceof Error ? err.message : "Failed to delete note")
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
                <span style={detailLabelStyle}>Notes</span>
                <span style={{ fontSize: 11, color: "var(--theme-subtext-color)", opacity: 0.7 }}>
                    {count > 0 ? (unreadCount > 0 ? `${count} · ${unreadCount} new` : String(count)) : ""}
                </span>
            </div>

            {error && <ErrorBanner message={error} onDismiss={() => setError(null)} />}

            {notes === null ? (
                <p style={{ fontSize: 13, color: "var(--theme-subtext-color)", margin: 0 }}>Loading notes…</p>
            ) : notes.length === 0 ? (
                <span style={{ fontSize: 13, color: "var(--theme-subtext-color)", padding: "2px 0 4px" }}>No notes yet — leave context for whoever picks this up.</span>
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
                                    fontSize: 10.5, fontWeight: 700, color: AVATAR_INK, background: avatarBg(note.author_name ?? "?"),
                                }}>
                                    {initialOf(note.author_name)}
                                </span>
                                <div style={{ minWidth: 0, flex: 1, display: "flex", flexDirection: "column", gap: 3 }}>
                                    <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "4px 7px" }}>
                                        <span style={{ fontSize: 12.5, fontWeight: 700, color: "var(--theme-h1-color)" }}>{note.author_name ?? "Someone"}</span>
                                        <span style={{ fontSize: 11, color: "var(--theme-subtext-color)" }}>{formatRelativeTime(note.created_at)}</span>
                                        {isUnread && <span style={{ width: 6, height: 6, borderRadius: "50%", background: "var(--theme-text-contrast)" }} />}
                                    </div>
                                    <span style={{ fontSize: 13.5, lineHeight: 1.5, color: "var(--theme-text)", overflowWrap: "anywhere" }}>{note.body}</span>
                                </div>
                                {canDelete && (
                                    <button
                                        type="button"
                                        onClick={() => void handleDelete(note)}
                                        aria-label="Delete note"
                                        className="hover:bg-[rgba(248,113,113,0.12)] hover:text-[#dc2626]"
                                        style={{
                                            font: "inherit", border: "none", background: "transparent", padding: 0,
                                            width: 24, height: 24, flex: "none", borderRadius: 6, display: "grid", placeItems: "center", fontSize: 12, cursor: "pointer", color: "var(--theme-subtext-color)",
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
                    fontSize: 10.5, fontWeight: 700, color: "var(--theme-bg)", background: "var(--theme-text-contrast)",
                }}>
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
                        className="focus:border-(--theme-text-contrast)"
                        style={{
                            width: "100%", boxSizing: "border-box", resize: "vertical", borderRadius: 9, border: "1px solid var(--theme-border)",
                            background: "var(--theme-bg)", color: "var(--theme-text)", fontSize: 13.5, lineHeight: 1.5, padding: "9px 11px", outline: "none",
                        }}
                    />
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 10 }}>
                        <span style={{ fontSize: 11, color: "var(--theme-subtext-color)" }}>{canPost ? "⌘↵ to post" : ""}</span>
                        <button
                            type="button"
                            onClick={() => void handlePost()}
                            disabled={!canPost}
                            style={{
                                height: 30, padding: "0 14px", borderRadius: 7, border: "none", fontSize: 12.5, fontWeight: 700,
                                cursor: canPost ? "pointer" : "default",
                                background: canPost ? "var(--theme-text-contrast)" : tint("--theme-border", 60),
                                color: canPost ? "var(--theme-bg)" : "var(--theme-subtext-color)",
                            }}
                        >
                            {posting ? "Posting…" : "Post note"}
                        </button>
                    </div>
                </div>
            </div>
        </div>
    )
}

const fieldInputClass = "rounded-lg border theme-border theme-text text-sm px-2.5 outline-none focus:ring-1 bg-transparent"
const fieldInputStyle: CSSProperties = { minHeight: 38, boxSizing: "border-box" }
// Deliberately no overflow-hidden: Dropdown's menu is absolutely positioned
// inside this wrapper, and clipping it would make the menu invisible.
const dropdownWrapClass = "rounded-lg border theme-border theme-text"
const dropdownWrapStyle: CSSProperties = { minHeight: 38, boxSizing: "border-box" }

interface EditTaskModalProps {
    task: Task
    canAssign: boolean
    people: Person[]
    onClose: () => void
    onSaved: (task: Task) => void
    onError: (message: string) => void
}

/** Not part of the mockup (its seed-data prototype has no equivalent) --
 *  kept from the previous implementation essentially as-is per SPEC
 *  "Housekeeping" ("restyle rather than rewrite where the design allows"). */
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
                                <Dropdown value={assigneeId} onChange={setAssigneeId} options={assigneeOptions(people)} triggerClassName="px-3 py-2 text-sm theme-text" searchable />
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
