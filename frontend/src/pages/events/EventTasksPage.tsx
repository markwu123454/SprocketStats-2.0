import { useEffect, useState } from "react"
import { Link } from "react-router-dom"
import { Link2, Plus, Unlink } from "lucide-react"
import { useEventContext } from "@/contexts/eventContext"
import { useOnboardedUser } from "@/contexts/authContext"
import Dropdown from "@/components/ui/Dropdown"
import { can, getPerm } from "@/lib/permissions"
import { BUCKET_OPTIONS, bucketLabel, isTaskBucket } from "@/lib/taskBuckets"
import {
    createTask, fetchTasks, updateTask,
    PRIORITY_LABEL, STATUS_LABEL, type Task, type TaskPriority,
} from "@/lib/tasksApi"
import { DANGER_RED, PRIORITY_COLOR, formatDue, priorityChoices, tintColor } from "@/lib/taskFormat"
import { saveErrorMessage } from "@/lib/eventContent"
import type { TasksPageState } from "@/lib/taskFormat"

const cardStyle = { background: "var(--theme-bg)", borderColor: "var(--theme-border)" }
const addButtonClass = "inline-flex items-center gap-1.5 rounded-lg border theme-border theme-bg theme-text-contrast text-sm font-semibold px-3 py-2 min-h-11 hover:opacity-90 transition-opacity outline-none focus:ring-2 focus:ring-[var(--theme-text-contrast)] disabled:opacity-40"
const primaryButtonClass =
    "theme-bg border theme-border theme-text-contrast rounded-xl text-sm font-semibold h-11 px-4 " +
    "inline-flex items-center justify-center gap-2 outline-none focus:ring-2 transition-opacity " +
    "disabled:opacity-40 disabled:cursor-not-allowed"
const ghostButtonClass =
    "h-11 px-2 rounded-lg text-sm theme-subtext-color hover:underline outline-none focus:ring-2 " +
    "disabled:opacity-40 disabled:cursor-not-allowed"
const inputClass = "rounded-lg border theme-border px-3 py-2.5 text-sm outline-none focus:ring-2 transition theme-bg theme-text disabled:opacity-60"
const dropdownTriggerClass = "rounded-lg border px-3 py-2.5 text-sm outline-none focus:ring-2 transition theme-bg theme-border theme-text"

// Open work first (most actionable status first), finished work last.
const STATUS_RANK: Record<Task["status"], number> = { review: 0, doing: 1, todo: 2, done: 3 }

export default function EventTasksPage() {
    const { eventKey, info } = useEventContext()
    const user = useOnboardedUser()
    const canAssign = can(user.permissions, "tasks.assign")
    const rawSubteam = getPerm(user.permissions, "subteam")
    const defaultBucket = typeof rawSubteam === "string" && isTaskBucket(rawSubteam) ? rawSubteam : "general"

    const [tasks, setTasks] = useState<Task[] | null>(null)
    const [allTasks, setAllTasks] = useState<Task[] | null>(null)
    const [loadError, setLoadError] = useState(false)
    const [mode, setMode] = useState<"idle" | "create" | "link">("idle")
    const [busy, setBusy] = useState(false)
    const [error, setError] = useState<string | null>(null)

    const [title, setTitle] = useState("")
    const [bucket, setBucket] = useState<string>(defaultBucket)
    const [priority, setPriority] = useState<TaskPriority>("med")
    const [due, setDue] = useState("")

    useEffect(() => {
        let cancelled = false
        fetchTasks(eventKey)
            .then(data => { if (!cancelled) setTasks(data) })
            .catch(() => { if (!cancelled) setLoadError(true) })
        return () => { cancelled = true }
    }, [eventKey])

    // The full board is only needed to pick a task to link -- fetched the
    // first time that picker opens, not on every visit.
    useEffect(() => {
        if (mode !== "link" || allTasks !== null) return
        let cancelled = false
        fetchTasks()
            .then(data => { if (!cancelled) setAllTasks(data) })
            .catch(() => { if (!cancelled) setAllTasks([]) })
        return () => { cancelled = true }
    }, [mode, allTasks])

    // Mirrors the backend's edit rule for anything beyond a status change.
    const canEditTask = (task: Task) => canAssign || task.created_by === user.id

    const linkable = (allTasks ?? []).filter(t => t.event_key !== eventKey && t.status !== "done" && canEditTask(t))

    function closeForm() {
        setMode("idle")
        setError(null)
    }

    function replaceTask(updated: Task) {
        setTasks(prev => {
            const others = (prev ?? []).filter(t => t.id !== updated.id)
            return updated.event_key === eventKey ? [updated, ...others] : others
        })
        setAllTasks(prev => prev?.map(t => t.id === updated.id ? updated : t) ?? prev)
    }

    async function handleCreate() {
        if (!title.trim()) { setError("Give the task a title."); return }
        setBusy(true)
        setError(null)
        try {
            const created = await createTask({ title: title.trim(), bucket, priority, due_date: due || null, event_key: eventKey })
            replaceTask(created)
            setTitle("")
            setDue("")
            setMode("idle")
        } catch (e) {
            setError(saveErrorMessage(e, "Couldn't create the task. Try again."))
        } finally {
            setBusy(false)
        }
    }

    async function setLink(task: Task, link: boolean) {
        setBusy(true)
        setError(null)
        try {
            replaceTask(await updateTask(task.id, { event_key: link ? eventKey : null }))
            if (link) setMode("idle")
        } catch (e) {
            setError(saveErrorMessage(e, link ? "Couldn't link the task. Try again." : "Couldn't unlink the task. Try again."))
        } finally {
            setBusy(false)
        }
    }

    const sorted = (tasks ?? []).slice().sort((a, b) =>
        STATUS_RANK[a.status] - STATUS_RANK[b.status] || a.title.localeCompare(b.title)
    )

    return (
        <div className="max-w-xl mx-auto px-4 py-6 flex flex-col gap-4">
            <div className="flex items-center justify-between gap-3">
                <h2 className="text-[11px] font-bold tracking-wider uppercase" style={{ color: "var(--theme-subtext-color)" }}>
                    Tasks for {info?.event_name ?? "this event"}
                </h2>
                <Link to="/tasks" className="text-sm theme-text-contrast hover:underline min-h-11 inline-flex items-center">
                    Task board
                </Link>
            </div>

            {error && (
                <p
                    role="alert"
                    className="text-xs rounded-lg px-3 py-2"
                    style={{ color: DANGER_RED, background: tintColor(DANGER_RED, 10), border: `1px solid ${tintColor(DANGER_RED, 40)}` }}
                >
                    {error}
                </p>
            )}

            {loadError ? (
                <EmptyCard>Couldn't load tasks. Refresh to try again.</EmptyCard>
            ) : tasks === null ? (
                <EmptyCard>Loading tasks…</EmptyCard>
            ) : sorted.length === 0 ? (
                <EmptyCard>No tasks linked to this event yet.</EmptyCard>
            ) : (
                <div className="rounded-xl border overflow-hidden" style={cardStyle}>
                    {sorted.map(task => (
                        <TaskRow
                            key={task.id}
                            task={task}
                            onUnlink={canEditTask(task) ? () => void setLink(task, false) : undefined}
                            disabled={busy}
                        />
                    ))}
                </div>
            )}

            {mode === "idle" && (
                <div className="flex flex-wrap gap-2">
                    <button type="button" onClick={() => { setMode("create"); setError(null) }} className={addButtonClass}>
                        <Plus size={15} />
                        New task
                    </button>
                    <button type="button" onClick={() => { setMode("link"); setError(null) }} className={addButtonClass}>
                        <Link2 size={15} />
                        Link existing task
                    </button>
                </div>
            )}

            {mode === "create" && (
                <div className="rounded-xl border p-4 flex flex-col gap-3" style={cardStyle}>
                    <p className="text-sm font-semibold theme-text">New task</p>
                    <div className="flex flex-col gap-1">
                        <label htmlFor="event-task-title" className="text-sm font-semibold theme-text">Title</label>
                        <input
                            id="event-task-title"
                            value={title}
                            disabled={busy}
                            onChange={e => setTitle(e.target.value)}
                            onKeyDown={e => { if (e.key === "Enter") void handleCreate() }}
                            className={inputClass}
                            autoFocus
                        />
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                        <div className="flex flex-col gap-1" role="group" aria-labelledby="event-task-bucket">
                            <span id="event-task-bucket" className="text-sm font-semibold theme-text">Subteam</span>
                            <Dropdown value={bucket} options={BUCKET_OPTIONS} onChange={setBucket} disabled={busy} triggerClassName={dropdownTriggerClass} />
                        </div>
                        <div className="flex flex-col gap-1" role="group" aria-labelledby="event-task-priority">
                            <span id="event-task-priority" className="text-sm font-semibold theme-text">Priority</span>
                            <Dropdown
                                value={priority}
                                options={priorityChoices(canAssign).map(p => ({ value: p, label: PRIORITY_LABEL[p] }))}
                                onChange={v => setPriority(v as TaskPriority)}
                                disabled={busy}
                                triggerClassName={dropdownTriggerClass}
                            />
                        </div>
                        <div className="flex flex-col gap-1">
                            <label htmlFor="event-task-due" className="text-sm font-semibold theme-text">Due (optional)</label>
                            <input id="event-task-due" type="date" value={due} disabled={busy} onChange={e => setDue(e.target.value)} className={inputClass} />
                        </div>
                    </div>
                    <div className="flex items-center gap-3">
                        <button type="button" onClick={() => void handleCreate()} disabled={busy} className={primaryButtonClass}>
                            {busy ? "Creating…" : "Create task"}
                        </button>
                        <button type="button" onClick={closeForm} disabled={busy} className={ghostButtonClass}>Cancel</button>
                    </div>
                </div>
            )}

            {mode === "link" && (
                <div className="rounded-xl border p-4 flex flex-col gap-3" style={cardStyle}>
                    <p className="text-sm font-semibold theme-text">Link an existing task</p>
                    {allTasks === null ? (
                        <p className="text-sm theme-subtext-color">Loading tasks…</p>
                    ) : linkable.length === 0 ? (
                        <p className="text-sm theme-subtext-color">
                            No open tasks to link. You can link tasks you created{canAssign ? " or any open task" : ""}.
                        </p>
                    ) : (
                        <Dropdown
                            value=""
                            placeholder="Pick a task…"
                            options={linkable.map(t => ({ value: t.id, label: `${t.title} · ${bucketLabel(t.bucket)}` }))}
                            onChange={id => {
                                const task = linkable.find(t => t.id === id)
                                if (task) void setLink(task, true)
                            }}
                            disabled={busy}
                            searchable
                            searchPlaceholder="Search tasks"
                            defaultOpen
                            triggerClassName={dropdownTriggerClass}
                        />
                    )}
                    <div>
                        <button type="button" onClick={closeForm} disabled={busy} className={ghostButtonClass}>Cancel</button>
                    </div>
                </div>
            )}
        </div>
    )
}

function EmptyCard({ children }: { children: string }) {
    return (
        <div className="rounded-xl border px-4 py-3 text-sm" style={{ ...cardStyle, color: "var(--theme-subtext-color)" }}>
            {children}
        </div>
    )
}

function TaskRow({ task, onUnlink, disabled }: { task: Task; onUnlink?: () => void; disabled: boolean }) {
    const done = task.status === "done"
    const meta = [
        STATUS_LABEL[task.status],
        task.assignee_name ?? "Unclaimed",
        task.due_date ? `Due ${formatDue(task.due_date)}` : null,
        bucketLabel(task.bucket),
    ].filter(Boolean).join(" · ")

    return (
        <div className="flex items-center gap-3 px-4 py-3 border-b last:border-0" style={{ borderColor: "var(--theme-border)", opacity: done ? 0.6 : 1 }}>
            <span
                className="w-2 h-2 rounded-full shrink-0"
                title={PRIORITY_LABEL[task.priority]}
                style={{ background: PRIORITY_COLOR[task.priority] }}
            />
            {/* Opens the task on the board -- all subteams and people, so
                filters can't hide it -- which scrolls to and highlights it. */}
            <Link
                to="/tasks"
                state={{ bucket: "all", who: "everyone", taskId: task.id } satisfies TasksPageState}
                className="flex-1 min-w-0 rounded-md -mx-1.5 px-1.5 py-1 hover:bg-(--ag-grid-hover-bg) outline-none focus:ring-2 focus:ring-[var(--theme-text-contrast)]"
            >
                <p className="text-sm font-medium theme-text truncate" style={{ textDecoration: done ? "line-through" : "none" }}>
                    {task.title}
                </p>
                <p className="text-xs theme-subtext-color truncate">{meta}</p>
            </Link>
            {onUnlink && (
                <button
                    type="button"
                    aria-label={`Unlink ${task.title} from this event`}
                    title="Unlink from this event"
                    onClick={onUnlink}
                    disabled={disabled}
                    className="inline-flex items-center justify-center w-9 h-9 shrink-0 opacity-50 hover:opacity-100 transition-opacity rounded-lg outline-none focus:ring-2 focus:ring-[var(--theme-text-contrast)] disabled:opacity-30"
                >
                    <Unlink size={14} className="theme-subtext-color" />
                </button>
            )}
        </div>
    )
}
