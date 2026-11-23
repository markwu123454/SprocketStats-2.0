import { useId, useState, type CSSProperties, type FormEvent, type ReactNode } from "react"
import Dropdown from "@/components/ui/Dropdown"
import Button from "@/components/ui/Button"
import FormFooter from "@/components/ui/FormFooter"
import Sheet from "@/components/ui/Sheet"
import Toggle from "@/components/ui/Toggle"
import AreaInput from "@/components/tasks/AreaInput"
import { useDiscardGuard, useIsDirty } from "@/lib/useDiscardGuard"
import { BUCKET_OPTIONS } from "@/lib/taskBuckets"
import {
    createTask, updateTask, PRIORITY_LABEL,
    type CreateTaskInput, type Person, type Task, type TaskPriority, type UpdateTaskInput,
} from "@/lib/tasksApi"
import {
    DANGER_RED, failMessage, priorityChoices, tint, tintColor, assigneeOptions, areaSuggestions,
} from "@/lib/taskFormat"
import type { TaskBoard } from "@/lib/useTaskBoard"
import { fieldLabelClass, focusRing, inputClass } from "@/lib/uiClasses"

// ── New / Edit task sheet ────────────────────────────────────────────────

export interface TaskFormSheetProps {
    mode: "create" | "edit"
    task?: Task
    board: TaskBoard
    people: Person[]
    defaultBucket: string
    onClose: () => void
}

export default function TaskFormSheet({ mode, task, board, people, defaultBucket, onClose }: TaskFormSheetProps) {
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
                <Field label="Task">
                    <input value={title} onChange={e => setTitle(e.target.value)} placeholder="What needs doing?" aria-label="Task" autoFocus className={`${inputClass} w-full`} />
                </Field>

                <div className="flex gap-3">
                    <div className="flex-1 min-w-0">
                        <Field label="Subteam">
                            <Dropdown value={bucket} onChange={setBucket} options={BUCKET_OPTIONS} triggerClassName={inputClass} label="Subteam" />
                        </Field>
                    </div>
                    <div className="flex-1 min-w-0">
                        <Field label="Area">
                            <AreaInput value={area} onChange={setArea} suggestions={areaSuggestions(board.tasks, bucket)} placeholder="General" className={`${inputClass} w-full`} />
                        </Field>
                    </div>
                </div>

                <Field label="Due date">
                    <input type="date" value={dueDate} onChange={e => setDueDate(e.target.value)} aria-label="Due date" className={`${inputClass} w-full`} />
                </Field>

                <Field label="Priority">
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
                    <Field label="Assign to">
                        <Dropdown value={assigneeId} onChange={setAssigneeId} options={assigneeOptions(people)} triggerClassName={inputClass} searchable label="Assign to" />
                    </Field>
                )}

                {mode === "create" && !board.canAssign && (
                    <div className="flex items-center justify-between gap-3 p-3 rounded-xl border" style={{ borderColor: tint("--theme-border", 75), background: "var(--theme-button-bg)" }}>
                        <div id={claimLabelId} className="text-sm font-semibold theme-h1-color">Claim it for myself</div>
                        <Toggle checked={claimSelf} onChange={setClaimSelf} aria-labelledby={claimLabelId} />
                    </div>
                )}
            </form>
        </Sheet>
    )
}

function Field({ label, children }: { label: string; children: ReactNode }) {
    return (
        <div className="flex flex-col gap-1.5">
            <span className={fieldLabelClass}>{label}</span>
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
