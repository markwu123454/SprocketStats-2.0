import { MessageSquare } from "lucide-react"
import TaskAvatar from "@/components/tasks/TaskAvatar"
import { bucketLabel } from "@/lib/taskBuckets"
import { PRIORITY_LABEL, reviewTask, type Task } from "@/lib/tasksApi"
import { DANGER_RED, MONTHS, isOverdue, tint } from "@/lib/taskFormat"
import type { TaskBoard } from "@/lib/useTaskBoard"
import { focusRing } from "@/lib/uiClasses"

/**
 * One task on the board, the same on every screen: title, subteam and area,
 * who's on it, and when it's due. Tapping the card opens its details; the
 * only button on it is the one action that applies right now (Claim an
 * unowned task, or Review one that's waiting on you).
 */
export default function TaskCard({ task, board, currentUserId, selected, highlighted, onOpen }: {
    task: Task
    board: TaskBoard
    currentUserId: string
    /** Its details are open. */
    selected: boolean
    /** Briefly ringed after a link opened it. */
    highlighted: boolean
    onOpen: () => void
}) {
    const done = task.status === "done"
    const critical = task.priority === "critical" && !done
    const unread = board.unread(task)
    const where = [bucketLabel(task.bucket), task.area.trim()].filter(Boolean).join(" · ")
    const people = task.assignee_id
        ? [{ id: task.assignee_id, name: task.assignee_name, picture: task.assignee_picture }, ...task.contributors.map(c => ({ id: c.id, name: c.display_name, picture: c.picture }))]
        : []

    const writable = !board.readOnly && !board.offline
    const canClaim = writable && !task.assignee_id && !done
    // The finisher can't review their own work unless they're a lead (the server enforces the same).
    const canReview = writable && task.status === "review" && (task.finished_by !== currentUserId || board.canAssign)

    return (
        <div
            data-task-id={task.id}
            className="relative rounded-xl border p-3 flex flex-col gap-2 transition-colors hover:border-(--theme-outline)"
            style={{
                background: critical ? `color-mix(in oklch, ${DANGER_RED} 8%, var(--theme-bg))` : "var(--theme-bg)",
                borderColor: selected || highlighted ? "var(--theme-text-contrast)" : critical ? tint("--theme-danger", 55) : "var(--theme-border)",
                boxShadow: highlighted ? "0 0 0 2px var(--theme-text-contrast)" : "none",
                opacity: done ? 0.7 : 1,
            }}
        >
            {/* The whole card opens the details; the action buttons sit above it. */}
            <button type="button" onClick={onOpen} aria-label={`Open ${task.title}`} aria-expanded={selected} className={`absolute inset-0 rounded-[inherit] cursor-pointer ${focusRing}`} />

            <div className="relative pointer-events-none flex flex-col gap-0.5 min-w-0">
                {critical && <span className="text-[11px] font-bold uppercase tracking-wider" style={{ color: DANGER_RED }}>☠ {PRIORITY_LABEL.critical}</span>}
                <span className="text-sm font-semibold leading-snug line-clamp-2 break-words" style={{ color: done ? "var(--theme-subtext-color)" : "var(--theme-h1-color)", textDecoration: done ? "line-through" : "none" }}>
                    {task.title}
                </span>
                <span className="text-xs theme-subtext-color truncate">{where}</span>
            </div>

            <div className="relative flex flex-wrap items-center gap-x-2 gap-y-1.5 min-h-7">
                {people.length > 0 ? (
                    <span className="pointer-events-none flex items-center">
                        {people.slice(0, 4).map((p, i) => (
                            <TaskAvatar key={p.id} name={p.name} picture={p.picture} title={p.name ?? undefined}
                                style={{ marginLeft: i === 0 ? 0 : -6, border: "1.5px solid var(--theme-bg)" }} />
                        ))}
                        {people.length > 4 && <span className="ml-1 text-xs theme-subtext-color">+{people.length - 4}</span>}
                    </span>
                ) : canClaim ? (
                    <button type="button" onClick={() => void board.handleClaim(task.id)}
                        className={`relative z-10 h-7 px-3 rounded-full border border-dashed text-xs font-semibold theme-text-contrast hover:bg-(--ag-grid-selected-bg) ${focusRing}`}
                        style={{ borderColor: "var(--theme-text-contrast)" }}>
                        Claim
                    </button>
                ) : (
                    <span className="pointer-events-none text-xs theme-subtext-color">Unclaimed</span>
                )}

                {canReview && (
                    <button type="button" onClick={() => void board.runAction(() => reviewTask(task.id))}
                        className={`relative z-10 h-7 px-3 rounded-lg text-xs font-bold theme-accent-fill hover:opacity-90 ${focusRing}`}>
                        Review
                    </button>
                )}

                <span className="pointer-events-none ml-auto flex items-center gap-2.5 text-xs whitespace-nowrap">
                    {task.note_count > 0 && (
                        <span className="flex items-center gap-1" style={{ color: unread > 0 ? "var(--theme-text-contrast)" : "var(--theme-subtext-color)" }}>
                            <MessageSquare size={13} aria-hidden="true" />
                            {task.note_count}
                            {unread > 0 && <span className="sr-only">, {unread} new</span>}
                            {unread > 0 && <span aria-hidden="true" className="size-1.5 rounded-full" style={{ background: "var(--theme-text-contrast)" }} />}
                        </span>
                    )}
                    <DueLabel task={task} todayMs={board.todayMs} />
                </span>
            </div>
        </div>
    )
}

/** "Overdue · Nov 14" in red, "High · Nov 24" when it's urgent, else just "Nov 24". */
function DueLabel({ task, todayMs }: { task: Task; todayMs: number }) {
    if (task.status === "done") return null
    const date = task.due_date ? new Date(`${task.due_date}T00:00`) : null
    const day = date ? `${MONTHS[date.getMonth()]} ${date.getDate()}` : null
    if (isOverdue(task, todayMs)) return <span style={{ color: DANGER_RED }}>Overdue · {day}</span>
    const high = task.priority === "high"
    if (!day && !high) return null
    return (
        <span style={{ color: high ? DANGER_RED : "var(--theme-subtext-color)" }}>
            {[high ? "High" : null, day].filter(Boolean).join(" · ")}
        </span>
    )
}
