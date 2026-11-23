import { Check, MessageSquare } from "lucide-react"
import Avatar from "@/components/Avatar"
import { peopleOf } from "@/lib/boardActions"
import { bucketLabel } from "@/lib/taskBuckets"
import { PRIORITY_LABEL, type Task } from "@/lib/tasksApi"
import { AVATAR_INK, DANGER_RED, MONTHS, avatarBg, initialOf, isOverdue, tint } from "@/lib/taskFormat"
import { focusRing } from "@/lib/uiClasses"

/** A person on the board, sized in rem so it grows with the board's type (see BoardPage). */
export function BoardAvatar({ name, picture, size = 1.75, ring }: {
    name: string | null
    picture: string | null | undefined
    size?: number
    ring?: boolean
}) {
    return (
        <Avatar
            name={name ?? "Someone"}
            picture={picture}
            title={name ?? undefined}
            monogram={initialOf(name)}
            style={{ width: `${size}rem`, height: `${size}rem`, border: ring ? "2px solid var(--theme-bg)" : undefined }}
            monogramStyle={{ background: avatarBg(name ?? "?"), color: AVATAR_INK, fontSize: `${size * 0.45}rem`, fontWeight: 700 }}
        />
    )
}

/** First names, so the board reads from across the room: "Ava", "Ava & Ben", "Ava +2". */
function whoText(people: { name: string | null }[]): string {
    const first = (name: string | null) => (name ?? "Someone").split(" ")[0]
    if (people.length === 1) return first(people[0].name)
    if (people.length === 2) return `${first(people[0].name)} & ${first(people[1].name)}`
    return `${first(people[0].name)} +${people.length - 1}`
}

/**
 * One task on the TV: title, where it belongs, who's on it and when it's due,
 * big enough to read across the shop. Tapping it opens the task.
 */
export default function BoardCard({ task, todayMs, showBucket, mine, onOpen }: {
    task: Task
    todayMs: number
    /** The board shows every subteam, so say which one this is. */
    showBucket: boolean
    /** The member acting on the board is on this task. */
    mine: boolean
    onOpen: () => void
}) {
    const done = task.status === "done"
    const critical = task.priority === "critical" && !done
    const people = peopleOf(task)
    const where = [showBucket ? bucketLabel(task.bucket) : null, task.area.trim()].filter(Boolean).join(" · ")

    if (done) {
        return (
            <button
                type="button"
                onClick={onOpen}
                className={`text-left rounded-lg border theme-border px-3 py-2 flex items-center gap-2 ${focusRing}`}
                style={{ background: "var(--theme-bg)", opacity: 0.75 }}
            >
                <Check className="size-4 shrink-0 theme-text-contrast" aria-hidden="true"/>
                <span className="text-sm font-semibold theme-text truncate flex-1 min-w-0">{task.title}</span>
                {people.length > 0 && <span className="text-xs theme-subtext-color shrink-0">{whoText(people)}</span>}
            </button>
        )
    }

    return (
        <button
            type="button"
            onClick={onOpen}
            className={`text-left rounded-xl border p-3 flex flex-col gap-1.5 transition-colors ${focusRing}`}
            style={{
                background: critical ? `color-mix(in oklch, ${DANGER_RED} 8%, var(--theme-bg))` : "var(--theme-bg)",
                borderColor: mine ? "var(--theme-text-contrast)" : critical ? tint("--theme-danger", 55) : "var(--theme-border)",
                boxShadow: mine ? "0 0 0 2px var(--theme-text-contrast)" : "none",
            }}
        >
            {critical && (
                <span className="text-xs font-bold uppercase tracking-wider" style={{ color: DANGER_RED }}>☠ {PRIORITY_LABEL.critical}</span>
            )}
            <span className="text-lg font-semibold leading-snug line-clamp-2 break-words theme-h1-color">{task.title}</span>
            <span className="flex items-center gap-2 text-sm min-w-0">
                <span className="theme-subtext-color truncate min-w-0">{where}</span>
                <span className="ml-auto flex items-center gap-2.5 whitespace-nowrap shrink-0">
                    {task.note_count > 0 && (
                        <span className="flex items-center gap-1 theme-subtext-color">
                            <MessageSquare className="size-4" aria-hidden="true"/>
                            {task.note_count}
                            <span className="sr-only">notes</span>
                        </span>
                    )}
                    <DueText task={task} todayMs={todayMs}/>
                </span>
            </span>
            <span className="flex items-center gap-2 min-h-8 pt-0.5">
                {people.length > 0 ? (
                    <>
                        <span className="flex items-center shrink-0">
                            {people.slice(0, 3).map((p, i) => (
                                <span key={p.id} style={{ marginLeft: i === 0 ? 0 : "-0.4rem" }}>
                                    <BoardAvatar name={p.name} picture={p.picture} ring={i > 0}/>
                                </span>
                            ))}
                        </span>
                        <span className="text-sm font-semibold theme-text truncate min-w-0">{whoText(people)}</span>
                    </>
                ) : (
                    <span className="text-sm font-semibold theme-text-contrast">Unclaimed</span>
                )}
                {mine && <span className="ml-auto shrink-0 text-xs font-bold uppercase tracking-wider theme-text-contrast">You</span>}
            </span>
        </button>
    )
}

/** "Overdue · Nov 14" in red, "High · Nov 24" when it's urgent, else just "Nov 24". */
export function DueText({ task, todayMs }: { task: Task; todayMs: number }) {
    if (task.status === "done") return null
    const date = task.due_date ? new Date(`${task.due_date}T00:00`) : null
    const day = date ? `${MONTHS[date.getMonth()]} ${date.getDate()}` : null
    if (isOverdue(task, todayMs)) return <span className="font-semibold" style={{ color: DANGER_RED }}>Overdue · {day}</span>
    const high = task.priority === "high"
    if (!day && !high) return null
    return (
        <span style={{ color: high ? DANGER_RED : "var(--theme-subtext-color)" }}>
            {[high ? "High" : null, day].filter(Boolean).join(" · ")}
        </span>
    )
}
