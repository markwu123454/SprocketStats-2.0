import { useEffect, useState, type KeyboardEvent } from "react"
import Avatar from "@/components/Avatar"
import Button from "@/components/ui/Button"
import EmptyState from "@/components/ui/EmptyState"
import Notice from "@/components/ui/Notice"
import Skeleton from "@/components/ui/Skeleton"
import TaskAvatar from "@/components/tasks/TaskAvatar"
import { addNote, deleteNote, fetchNotes, type TaskNote } from "@/lib/tasksApi"
import { failMessage, formatRelativeTime, initialOf } from "@/lib/taskFormat"
import { focusRing, inputClass, typeH2 } from "@/lib/uiClasses"

const detailLabelClass = `${typeH2} theme-subtext-color`

export interface NotesThreadProps {
    taskId: string
    currentUserId: string
    currentUserGivenName: string
    currentUserPicture?: string
    canAssign: boolean
    /** Notes can be read but not posted or deleted. */
    readOnly: boolean
    unreadCount: number
    draft: string
    onDraftChange: (value: string) => void
    onNoteCountChange: (taskId: string, delta: number) => void
}

/** A task's notes -- fetched when the details open (only one task is open at a time). */
export default function NotesThread({ taskId, currentUserId, currentUserGivenName, currentUserPicture, canAssign, readOnly, unreadCount, draft, onDraftChange, onNoteCountChange }: NotesThreadProps) {
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
        <div style={{ minWidth: 0, display: "flex", flexDirection: "column", gap: 10 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span className={detailLabelClass}>Notes</span>
                <span className="text-xs theme-subtext-color opacity-70">
                    {count > 0 ? (unreadCount > 0 ? `${count} · ${unreadCount} new` : String(count)) : ""}
                </span>
            </div>

            {error && <Notice onDismiss={() => setError(null)}>{error}</Notice>}

            {notes === null ? (
                <div role="status" aria-label="Loading notes" className="flex flex-col gap-2">
                    <Skeleton className="h-10 w-full" />
                    <Skeleton className="h-10 w-full" />
                </div>
            ) : notes.length === 0 ? (
                <EmptyState>No notes yet.</EmptyState>
            ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                    {notes.map((note, i) => {
                        const isUnread = i >= firstUnreadIndex
                        const mine = note.author_id === currentUserId
                        const canDelete = !readOnly && (mine || canAssign)
                        return (
                            <div key={note.id} style={{ display: "flex", gap: 10, padding: "9px 8px 9px 0", borderTop: i === 0 ? "none" : "1px solid var(--ag-grid-row-border)" }}>
                                <TaskAvatar name={note.author_name} picture={note.author_picture} />
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

            {!readOnly && <div style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
                <Avatar
                    name={currentUserGivenName}
                    picture={currentUserPicture}
                    size={24}
                    monogram={initialOf(currentUserGivenName)}
                    monogramStyle={{ background: "var(--theme-text-contrast)", color: "var(--theme-bg)", fontSize: 12, fontWeight: 700 }}
                />
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
            </div>}
        </div>
    )
}
