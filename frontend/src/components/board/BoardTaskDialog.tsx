import { type ReactNode, useEffect, useId, useRef, useState } from "react"
import { Mail, ScanLine, X } from "lucide-react"
import Button from "@/components/ui/Button"
import Dialog from "@/components/ui/Dialog"
import { BoardAvatar, DueText } from "@/components/board/BoardCard"
import { BOARD_ACTION_LABEL, peopleOf, type BoardAction } from "@/lib/boardActions"
import { boardErrorMessage, fetchBoardNotes, type Acting } from "@/lib/boardApi"
import { bucketLabel } from "@/lib/taskBuckets"
import { PRIORITY_LABEL, STATUS_LABEL, type Task, type TaskNote } from "@/lib/tasksApi"
import { formatRelativeTime } from "@/lib/taskFormat"
import { focusRing, inputClass, typeH2, typeTitle } from "@/lib/uiClasses"

const MAX_NOTE = 2000

/**
 * One task, opened from the board: its details and notes for anyone, and the
 * changes the member acting on the board may make.
 */
export default function BoardTaskDialog({ task, acting, actions, todayMs, onRun, onAddNote, onScan, onIdentify, onClose }: {
    task: Task
    acting: Acting | null
    actions: BoardAction[]
    todayMs: number
    onRun: (action: BoardAction) => Promise<void>
    /** Resolves to the new note, or null when it couldn't be added. */
    onAddNote: (body: string) => Promise<TaskNote | null>
    /** Sign in with a code (opens the camera). */
    onScan: () => void
    /** Sign in with an email. */
    onIdentify: () => void
    onClose: () => void
}) {
    const titleId = useId()
    const closeRef = useRef<HTMLButtonElement>(null)
    const [pending, setPending] = useState<BoardAction | "note" | null>(null)
    const [notes, setNotes] = useState<TaskNote[] | null>(null)
    const [notesError, setNotesError] = useState<string | null>(null)
    const [draft, setDraft] = useState("")
    const people = peopleOf(task)

    // Notes load on open, and again when the board sees the count change.
    useEffect(() => {
        let cancelled = false
        fetchBoardNotes(task.id).then(list => {
            if (cancelled) return
            setNotes(list)
            setNotesError(null)
        }, err => {
            if (!cancelled) setNotesError(boardErrorMessage(err))
        })
        return () => { cancelled = true }
    }, [task.id, task.note_count])

    const run = async (action: BoardAction) => {
        setPending(action)
        try {
            await onRun(action)
        } finally {
            setPending(null)
        }
    }

    const addNote = async () => {
        const body = draft.trim()
        if (!body) return
        setPending("note")
        try {
            const note = await onAddNote(body)
            if (note) {
                setDraft("")
                setNotes(prev => [...(prev ?? []), note])
            }
        } finally {
            setPending(null)
        }
    }

    const facts: [string, ReactNode][] = [
        ["Status", STATUS_LABEL[task.status]],
        ["Subteam", [bucketLabel(task.bucket), task.area.trim()].filter(Boolean).join(" · ")],
        ["Priority", PRIORITY_LABEL[task.priority]],
    ]
    if (task.due_date && task.status !== "done") facts.push(["Due", <DueText key="due" task={task} todayMs={todayMs}/>])
    if (task.finished_by_name && (task.status === "review" || task.status === "done")) facts.push(["Finished by", task.finished_by_name])
    if (task.reviewed_by_name && task.status === "done") facts.push(["Reviewed by", task.reviewed_by_name])

    return (
        <Dialog labelledBy={titleId} onDismiss={onClose} initialFocus={closeRef} className="max-w-2xl max-h-[92dvh] flex flex-col">
            <div className="shrink-0 flex items-start justify-between gap-3 pl-6 pr-3 pt-5 pb-3">
                <h2 id={titleId} className={`${typeTitle} theme-h1-color break-words pt-1.5`}>{task.title}</h2>
                <button
                    ref={closeRef}
                    type="button"
                    onClick={onClose}
                    aria-label="Close"
                    className={`size-11 shrink-0 flex items-center justify-center rounded-lg theme-subtext-color hover:opacity-80 ${focusRing}`}
                >
                    <X className="size-6" aria-hidden="true"/>
                </button>
            </div>

            <div className="min-h-0 overflow-y-auto theme-scrollbar px-6 pb-6 flex flex-col gap-5">
                <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 text-sm">
                    {facts.map(([label, value]) => (
                        <div key={label} className="contents">
                            <dt className="theme-subtext-color">{label}</dt>
                            <dd className="theme-text font-semibold">{value}</dd>
                        </div>
                    ))}
                    <dt className="theme-subtext-color">On it</dt>
                    <dd className="flex flex-wrap items-center gap-x-4 gap-y-2">
                        {people.length === 0 && <span className="theme-text font-semibold">Nobody yet</span>}
                        {people.map(p => (
                            <span key={p.id} className="flex items-center gap-2 theme-text font-semibold">
                                <BoardAvatar name={p.name} picture={p.picture} size={1.5}/>
                                {p.name ?? "Someone"}
                            </span>
                        ))}
                    </dd>
                </dl>

                <section className="flex flex-col gap-3" aria-label="Changes">
                    {acting ? (
                        <>
                            <p className="text-sm theme-subtext-color">
                                As <span className="font-semibold theme-text">{acting.name}</span>
                                {acting.level === "email" && task.status === "review" && " (by email: show your code to review tasks)"}
                            </p>
                            {actions.length > 0 ? (
                                <div className="flex flex-wrap gap-2">
                                    {actions.map(action => (
                                        <Button
                                            key={action}
                                            size="hero"
                                            variant={action === "leave" ? "outlined" : "filled"}
                                            disabled={pending !== null}
                                            onClick={() => void run(action)}
                                        >
                                            {pending === action ? "Saving…" : BOARD_ACTION_LABEL[action]}
                                        </Button>
                                    ))}
                                </div>
                            ) : task.status !== "done" && (
                                <p className="text-sm theme-text">Nothing here you can change from the board.</p>
                            )}
                        </>
                    ) : (
                        <div className="rounded-xl border theme-border p-4 flex flex-wrap items-center gap-3">
                            <p className="text-sm theme-text flex-1 min-w-48">Sign in as a member to edit this task.</p>
                            <Button onClick={onScan}>
                                <ScanLine className="size-4" aria-hidden="true"/>
                                Sign in with code
                            </Button>
                            <Button variant="outlined" onClick={onIdentify}>
                                <Mail className="size-4" aria-hidden="true"/>
                                Enter email
                            </Button>
                        </div>
                    )}
                </section>

                <section className="flex flex-col gap-3" aria-labelledby={`${titleId}-notes`}>
                    <h3 id={`${titleId}-notes`} className={`${typeH2} theme-subtext-color`}>Notes</h3>
                    {notesError && <p className="text-sm theme-danger">{notesError}</p>}
                    {notes && notes.length === 0 && <p className="text-sm theme-subtext-color">No notes yet.</p>}
                    {notes && notes.length > 0 && (
                        <ul className="flex flex-col gap-3">
                            {notes.map(n => (
                                <li key={n.id} className="flex gap-3">
                                    <BoardAvatar name={n.author_name} picture={n.author_picture} size={1.5}/>
                                    <div className="min-w-0 flex-1">
                                        <p className="text-xs theme-subtext-color">
                                            <span className="font-semibold theme-text">{n.author_name ?? "Someone"}</span> · {formatRelativeTime(n.created_at)}
                                        </p>
                                        <p className="text-sm theme-text whitespace-pre-wrap break-words">{n.body}</p>
                                    </div>
                                </li>
                            ))}
                        </ul>
                    )}
                    {acting && task.status !== "done" && (
                        <div className="flex flex-col gap-2">
                            <label htmlFor={`${titleId}-draft`} className="sr-only">Add a note</label>
                            <textarea
                                id={`${titleId}-draft`}
                                value={draft}
                                onChange={e => setDraft(e.target.value.slice(0, MAX_NOTE))}
                                rows={2}
                                placeholder="Add a note"
                                className={`${inputClass} w-full resize-none`}
                            />
                            <div className="flex justify-end">
                                <Button disabled={!draft.trim() || pending !== null} onClick={() => void addNote()}>
                                    {pending === "note" ? "Adding…" : "Add note"}
                                </Button>
                            </div>
                        </div>
                    )}
                </section>
            </div>
        </Dialog>
    )
}
