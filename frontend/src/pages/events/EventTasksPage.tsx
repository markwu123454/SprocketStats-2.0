import { useEffect, useState } from "react"
import { Link } from "react-router-dom"
import { Link2, Plus, Unlink } from "lucide-react"
import { useEventContext } from "@/contexts/eventContext"
import { useOnboardedUser } from "@/contexts/authContext"
import Button from "@/components/ui/Button"
import Dropdown from "@/components/ui/Dropdown"
import EmptyState from "@/components/ui/EmptyState"
import Notice from "@/components/ui/Notice"
import Skeleton from "@/components/ui/Skeleton"
import { buttonClass, cardClass, fieldLabelClass, focusRing, inputClass, typeH2 } from "@/lib/uiClasses"
import { can, getPerm } from "@/lib/permissions"
import { BUCKET_OPTIONS, bucketLabel, isTaskBucket } from "@/lib/taskBuckets"
import {
    createTask, fetchTasks, updateTask,
    PRIORITY_LABEL, STATUS_LABEL, type Task, type TaskPriority,
} from "@/lib/tasksApi"
import { PRIORITY_COLOR, formatDue, priorityChoices } from "@/lib/taskFormat"
import { useDiscardGuard } from "@/lib/useDiscardGuard"
import { saveErrorMessage } from "@/lib/eventContent"
import type { TasksPageState } from "@/lib/taskFormat"

const cardStyle = { background: "var(--theme-bg)", borderColor: "var(--theme-border)" }

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
    const confirmDiscard = useDiscardGuard(mode === "create" && (title !== "" || due !== "" || bucket !== defaultBucket || priority !== "med"))

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
                <h2 className={`${typeH2} theme-subtext-color min-w-0 truncate`}>
                    Tasks for {info?.event_name ?? "this event"}
                </h2>
                <Link to="/tasks" className={buttonClass({ variant: "text" })}>
                    Task board
                </Link>
            </div>

            {error && <Notice>{error}</Notice>}

            {loadError ? (
                <Notice>Couldn't load tasks. Refresh to try again.</Notice>
            ) : tasks === null ? (
                <div className="rounded-xl border overflow-hidden" style={cardStyle} role="status" aria-label="Loading tasks">
                    {[0, 1, 2].map(i => (
                        <div key={i} className="px-4 py-3 border-b last:border-0" style={{ borderColor: "var(--theme-border)" }}>
                            <Skeleton className="h-10 w-full" />
                        </div>
                    ))}
                </div>
            ) : sorted.length === 0 ? (
                <div className="rounded-xl border px-4 py-1" style={cardStyle}>
                    <EmptyState>No tasks linked to this event yet.</EmptyState>
                </div>
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
                    <Button variant="outlined" onClick={() => { setMode("create"); setError(null) }}>
                        <Plus size={15} />
                        New task
                    </Button>
                    <Button variant="outlined" onClick={() => { setMode("link"); setError(null) }}>
                        <Link2 size={15} />
                        Link existing task
                    </Button>
                </div>
            )}

            {mode === "create" && (
                <div className={cardClass} style={cardStyle}>
                    <p className="text-sm font-semibold theme-text">New task</p>
                    <div className="flex flex-col gap-1">
                        <label htmlFor="event-task-title" className={fieldLabelClass}>Title</label>
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
                            <span id="event-task-bucket" className={fieldLabelClass}>Subteam</span>
                            <Dropdown value={bucket} options={BUCKET_OPTIONS} onChange={setBucket} disabled={busy} triggerClassName={inputClass} />
                        </div>
                        <div className="flex flex-col gap-1" role="group" aria-labelledby="event-task-priority">
                            <span id="event-task-priority" className={fieldLabelClass}>Priority</span>
                            <Dropdown
                                value={priority}
                                options={priorityChoices(canAssign).map(p => ({ value: p, label: PRIORITY_LABEL[p] }))}
                                onChange={v => setPriority(v as TaskPriority)}
                                disabled={busy}
                                triggerClassName={inputClass}
                            />
                        </div>
                        <div className="flex flex-col gap-1">
                            <label htmlFor="event-task-due" className={fieldLabelClass}>Due (optional)</label>
                            <input id="event-task-due" type="date" value={due} disabled={busy} onChange={e => setDue(e.target.value)} className={inputClass} />
                        </div>
                    </div>
                    <div className="flex items-center gap-3">
                        <Button onClick={() => void handleCreate()} disabled={busy}>
                            {busy ? "Creating…" : "Create task"}
                        </Button>
                        <Button variant="text" onClick={() => void confirmDiscard().then(ok => { if (ok) closeForm() })} disabled={busy}>Cancel</Button>
                    </div>
                </div>
            )}

            {mode === "link" && (
                <div className={cardClass} style={cardStyle}>
                    <p className="text-sm font-semibold theme-text">Link an existing task</p>
                    {allTasks === null ? (
                        <Skeleton className="h-11 w-full" />
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
                            triggerClassName={inputClass}
                        />
                    )}
                    <div>
                        <Button variant="text" onClick={closeForm} disabled={busy}>Cancel</Button>
                    </div>
                </div>
            )}
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
                className={`flex-1 min-w-0 rounded-lg -mx-1.5 px-1.5 py-1 hover:bg-(--ag-grid-hover-bg) ${focusRing}`}
            >
                <p className="text-sm font-medium theme-text truncate" style={{ textDecoration: done ? "line-through" : "none" }}>
                    {task.title}
                </p>
                <p className="text-xs theme-subtext-color truncate">{meta}</p>
            </Link>
            {onUnlink && (
                <Button
                    variant="icon"
                    aria-label={`Unlink ${task.title} from this event`}
                    title="Unlink from this event"
                    onClick={onUnlink}
                    disabled={disabled}
                    className="shrink-0"
                >
                    <Unlink size={14} />
                </Button>
            )}
        </div>
    )
}
