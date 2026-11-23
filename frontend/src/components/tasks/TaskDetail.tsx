import { useState, type ReactNode } from "react"
import { Link } from "react-router-dom"
import { Pencil, Trash2 } from "lucide-react"
import Button from "@/components/ui/Button"
import Dropdown from "@/components/ui/Dropdown"
import TaskAvatar from "@/components/tasks/TaskAvatar"
import ContributorsSection from "@/components/tasks/TaskContributors"
import NotesThread from "@/components/tasks/TaskNotes"
import type { OnboardedUser } from "@/contexts/authContext"
import { bucketLabel } from "@/lib/taskBuckets"
import {
    addContributor, leaveTask, removeContributor, reviewTask, unreviewTask, updateTask,
    PRIORITY_LABEL, STATUS_LABEL, type Person, type Task,
} from "@/lib/tasksApi"
import { DANGER_RED, assigneeOptions, formatPosted, rowDue, type SettableStatus } from "@/lib/taskFormat"
import type { TaskBoard } from "@/lib/useTaskBoard"
import { focusRing, typeH2 } from "@/lib/uiClasses"

const labelClass = `${typeH2} theme-subtext-color`
const DROPDOWN_TRIGGER = "rounded-lg border theme-outline theme-bg theme-text px-3 min-h-11 md:min-h-10 text-sm w-full"
const STATUSES: SettableStatus[] = ["todo", "doing", "review"]

/**
 * Everything about one task and every change you can make to it: status,
 * owner, helpers, notes, edit and delete. The page shows it in a side panel
 * on web and in a full sheet on phones; this is only the contents.
 */
export default function TaskDetail({ task, board, user, people, onEdit }: {
    task: Task
    board: TaskBoard
    user: OnboardedUser
    people: Person[]
    onEdit: () => void
}) {
    const [draft, setDraft] = useState("")
    const run = board.runAction
    const done = task.status === "done"
    const review = task.status === "review"
    const writable = !board.readOnly && !board.offline
    const canStatus = writable && board.canChangeStatus(task)
    const canEdit = writable && board.canEditTask(task)
    const isFinisher = task.finished_by === user.id
    const canReview = writable && review && (!isFinisher || board.canAssign)
    const due = rowDue(task, board.todayMs)

    return (
        <div className="flex flex-col gap-5">
            {/* Status */}
            <div className="flex flex-col gap-2">
                {done ? (
                    <div className="flex flex-wrap items-center gap-2">
                        <span className="text-sm font-semibold theme-text-contrast">✓ Done</span>
                        {task.reviewed_by_name && <span className="text-sm theme-subtext-color">Reviewed by {task.reviewed_by_name}</span>}
                        {writable && board.canAssign && (
                            <Button variant="text" className="ml-auto" onClick={() => void run(() => unreviewTask(task.id))}>Send back for review</Button>
                        )}
                    </div>
                ) : (
                    <>
                        <div role="radiogroup" aria-label="Status" className="flex gap-1 p-1 rounded-xl border theme-border" style={{ background: "var(--theme-button-bg)" }}>
                            {STATUSES.map(s => {
                                const active = task.status === s
                                // Anyone on the task may send a review back to In progress; other moves need status rights.
                                const allowed = canStatus || (review && s === "doing" && writable)
                                return (
                                    <button
                                        key={s}
                                        type="button"
                                        role="radio"
                                        aria-checked={active}
                                        disabled={!allowed && !active}
                                        onClick={() => { if (!active && allowed) void run(() => updateTask(task.id, { status: s })) }}
                                        className={`flex-1 min-w-0 min-h-10 rounded-lg text-xs sm:text-sm font-semibold disabled:cursor-not-allowed ${focusRing}`}
                                        style={{
                                            background: active ? "var(--theme-bg)" : "transparent",
                                            color: active ? "var(--theme-text-contrast)" : "var(--theme-subtext-color)",
                                            boxShadow: active ? "0 0 0 1px var(--theme-border)" : "none",
                                            opacity: !allowed && !active ? 0.5 : 1,
                                        }}
                                    >
                                        {STATUS_LABEL[s]}
                                    </button>
                                )
                            })}
                        </div>
                        {review && (canReview ? (
                            <Button onClick={() => void run(() => reviewTask(task.id))}>
                                {isFinisher ? "Mark reviewed (you finished it)" : "Mark reviewed"}
                            </Button>
                        ) : writable && isFinisher && (
                            <p className="text-xs theme-subtext-color">Waiting for someone else to review it.</p>
                        ))}
                        {!canStatus && !board.readOnly && !review && (
                            <p className="text-xs theme-subtext-color">Only its creator, a lead, or someone on this task can change its status.</p>
                        )}
                    </>
                )}
            </div>

            {/* Facts */}
            <div className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-3 items-center">
                <Fact label="Owner">
                    {board.canAssign && writable ? (
                        <Dropdown value={task.assignee_id ?? ""} onChange={id => void run(() => updateTask(task.id, { assignee_id: id || null }))}
                            options={assigneeOptions(people)} triggerClassName={DROPDOWN_TRIGGER} searchable label="Owner" />
                    ) : task.assignee_id ? (
                        <span className="flex items-center gap-2 min-w-0">
                            <TaskAvatar name={task.assignee_name} picture={task.assignee_picture} />
                            <span className="text-sm theme-text truncate">{task.assignee_name}</span>
                            {writable && task.assignee_id === user.id && !done && (
                                <button type="button" onClick={() => void run(() => leaveTask(task.id))} className={`ml-auto text-xs theme-subtext-color hover:text-(--theme-danger) ${focusRing}`}>
                                    Release
                                </button>
                            )}
                        </span>
                    ) : writable && !done ? (
                        <Button variant="outlined" className="justify-self-start" onClick={() => void board.handleClaim(task.id)}>Claim task</Button>
                    ) : (
                        <span className="text-sm theme-subtext-color">Unclaimed</span>
                    )}
                </Fact>
                <Fact label="Due"><span className="text-sm" style={{ color: due.color === DANGER_RED ? DANGER_RED : "var(--theme-text)" }}>{task.due_date ? due.text.replace(/^Due /, "") : "No due date"}</span></Fact>
                <Fact label="Priority">
                    <span className="text-sm" style={{ color: task.priority === "critical" || task.priority === "high" ? DANGER_RED : "var(--theme-text)" }}>
                        {task.priority === "critical" ? `☠ ${PRIORITY_LABEL.critical}` : PRIORITY_LABEL[task.priority]}
                    </span>
                </Fact>
                <Fact label="Subteam"><span className="text-sm theme-text">{[bucketLabel(task.bucket), task.area.trim()].filter(Boolean).join(" · ")}</span></Fact>
                {task.event_key && (
                    <Fact label="Event">
                        <Link to={`/events/${task.event_key}/tasks`} className={`text-sm theme-text-contrast underline-offset-2 hover:underline ${focusRing}`}>Open the event</Link>
                    </Fact>
                )}
            </div>

            <ContributorsSection
                task={task}
                canAssign={board.canAssign}
                readOnly={!writable}
                currentUserId={user.id}
                people={people}
                dropdownTriggerClassName={DROPDOWN_TRIGGER}
                onAddSelf={() => void run(() => addContributor(task.id))}
                onAddOther={id => void run(() => addContributor(task.id, id))}
                onRemoveContributor={id => void run(() => removeContributor(task.id, id))}
                onLeave={() => void run(() => leaveTask(task.id))}
            />

            <div className="border-t theme-border pt-4">
                <NotesThread
                    taskId={task.id}
                    currentUserId={user.id}
                    currentUserGivenName={user.display_name}
                    currentUserPicture={user.picture}
                    canAssign={board.canAssign}
                    readOnly={!writable}
                    unreadCount={board.unread(task)}
                    draft={draft}
                    onDraftChange={setDraft}
                    onNoteCountChange={board.bumpNoteCount}
                />
            </div>

            <div className="border-t theme-border pt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs theme-subtext-color">
                <span>{formatPosted(task.created_at)}{task.created_by_name ? ` by ${task.created_by_name}` : ""}</span>
                {task.finished_by_name && <span>Finished by {task.finished_by_name}</span>}
                {canEdit && (
                    <span className="ml-auto flex items-center gap-1">
                        <Button variant="text" onClick={onEdit}><Pencil size={15} aria-hidden="true" />Edit</Button>
                        <Button variant="danger" onClick={() => void board.handleDelete(task)}><Trash2 size={15} aria-hidden="true" />Delete</Button>
                    </span>
                )}
            </div>
        </div>
    )
}

function Fact({ label, children }: { label: string; children: ReactNode }) {
    return (
        <>
            <span className={labelClass}>{label}</span>
            <div className="min-w-0">{children}</div>
        </>
    )
}
