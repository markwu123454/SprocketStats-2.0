import {useEffect, useState, type ReactNode} from "react"
import { Link } from "react-router-dom"
import { useOnboardedUser } from "@/contexts/authContext"
import { useBootstrapped } from "@/contexts/bootstrapContext"
import { Calendar, Eye, EyeOff, KeyRound, ChevronRight, ListChecks } from "lucide-react"
import Avatar from "@/components/Avatar.tsx"
import { resolveEvent, type EventEntry } from "@/lib/events"
import type { EventInfo } from "@/lib/eventApi"
import { can } from "@/lib/permissions"
import type { TasksPageState } from "@/pages/TasksPageRouter"
import { fetchTasks, PRIORITY_LABEL, STATUS_LABEL, type Task, type TaskPriority } from "@/lib/tasksApi"

const API = import.meta.env.VITE_BACKEND_URL

// The one hardcoded color on this page: High priority / overdue. The theme
// has no "danger" token (see .design-sync/conventions.md) -- mirrors the
// existing exception in TasksPage.tsx.
const DANGER_RED = "#dc2626"

interface MeetingHours {
    id: string
    start_time: string
    end_time: string
    meeting_purpose: string | null
}

function formatClockTime(iso: string): string {
    return new Date(iso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })
}

function formatMeetingDay(iso: string): string {
    const d = new Date(iso)
    if (d.toDateString() === new Date().toDateString()) return "Today"
    return d.toLocaleDateString("en-US", { weekday: "long" })
}

// Parses a "YYYY-MM-DD" date as a LOCAL date (never UTC) so due dates don't
// shift a day depending on the viewer's timezone.
function parseLocalDate(dateStr: string): Date {
    const [y, m, d] = dateStr.split("-").map(Number)
    return new Date(y, m - 1, d)
}

function formatDueDate(dateStr: string): string {
    return parseLocalDate(dateStr).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })
}

function isOverdue(dateStr: string): boolean {
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    return parseLocalDate(dateStr) < today
}

const PRIORITY_RANK: Record<TaskPriority, number> = { high: 0, med: 1, low: 2 }

const cardStyle = { background: "var(--theme-bg)", borderColor: "var(--theme-border)" }

export default function DashboardPage() {
    const user = useOnboardedUser()
    const [meetings, setMeetings]   = useBootstrapped<MeetingHours[] | null>("meetings", null)
    const [rawEvents]               = useBootstrapped<EventEntry[]>("events", [])
    const [currentEvent]            = useBootstrapped<EventInfo | null>("current_event", null)
    const [codeVisible, setCodeVisible] = useState(false)
    const [tasks, setTasks] = useState<Task[] | null>(null)

    const eventEntry   = rawEvents.find(e => e.tbaKey === currentEvent?.event_key)
    const resolvedEvent = eventEntry ? resolveEvent(eventEntry, new Date()) : null
    const canViewTasks = can(user.permissions, "tasks.view")

    useEffect(() => {
        let cancelled = false
        fetch(`${API}/attendance/meetings`, { credentials: "include" })
            .then(res => (res.ok ? res.json() : []))
            .then((data: MeetingHours[]) => { if (!cancelled) setMeetings(data) })
            .catch(() => { if (!cancelled) setMeetings([]) })
        return () => { cancelled = true }
    }, [setMeetings])

    useEffect(() => {
        if (!canViewTasks) return
        let cancelled = false
        fetchTasks()
            .then(data => { if (!cancelled) setTasks(data) })
            .catch(() => { if (!cancelled) setTasks([]) })
        return () => { cancelled = true }
    }, [canViewTasks])

    const now = new Date()
    const sorted = (meetings ?? [])
        .slice()
        .sort((a, b) => new Date(a.start_time).getTime() - new Date(b.start_time).getTime())
    const current = sorted.find(m => new Date(m.start_time) <= now && now <= new Date(m.end_time))
    const next = sorted.find(m => new Date(m.start_time) > now)

    // Grade/team_year are only ever set for roles that require school info
    // (see OnboardingRequest.validate_school_info_required on the backend) --
    // mentors/alumni never have them, so their absence gates this card.
    const hasSchoolInfo = Boolean(user.grade && user.team_year)

    const myTasks = (tasks ?? [])
        .filter(t => (t.assignee_id === user.id || t.contributors.some(c => c.id === user.id)) && (t.status === "todo" || t.status === "doing"))
        .slice()
        .sort((a, b) =>
            PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority]
            || (a.due_date === b.due_date ? 0 : a.due_date === null ? 1 : b.due_date === null ? -1 : a.due_date.localeCompare(b.due_date))
            || a.title.localeCompare(b.title)
        )

    return (
        <div className="max-w-7xl mx-auto px-4 py-8 flex flex-col gap-8">
            {/* Header */}
            <div className="flex items-center gap-4">
                <Avatar name={user.name} picture={user.picture} size={48} className="ring-2" />
                <div>
                    <h1 className="text-2xl font-bold theme-text">
                        Welcome back, {user.display_name}
                    </h1>
                    <p className="text-sm theme-subtext-color">Here's your overview</p>
                </div>
            </div>

            {/* Current event card */}
            {currentEvent && (
                <Link
                    to={`/events/${currentEvent.event_key}`}
                    className="rounded-xl border p-5 flex items-center gap-4 backdrop-blur-sm transition-colors hover:border-(--theme-text-contrast)"
                    style={cardStyle}
                >
                    <div className="flex-1 min-w-0">
                        {resolvedEvent && (
                            <span
                                className="text-[10px] font-bold tracking-wider uppercase block mb-0.5"
                                style={{
                                    color: resolvedEvent.status === "current" ? "var(--theme-text-contrast)" : "var(--theme-subtext-color)",
                                }}
                            >
                                {resolvedEvent.status === "current" ? "Happening now" : resolvedEvent.status === "upcoming" ? "Upcoming" : "Completed"}
                            </span>
                        )}
                        <p className="text-base font-bold theme-text truncate">{currentEvent.event_name}</p>
                        {resolvedEvent && (
                            <p className="text-sm theme-subtext-color mt-0.5">{resolvedEvent.dateLabel} · {resolvedEvent.location}</p>
                        )}
                    </div>
                    <div
                        className="shrink-0 flex items-center justify-center w-9 h-9 rounded-full"
                        style={{ background: "var(--theme-text-contrast)", color: "var(--theme-bg)" }}
                    >
                        <ChevronRight size={18} />
                    </div>
                </Link>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {/* This week's meeting */}
                <div className="rounded-xl border p-5 flex flex-col gap-3 backdrop-blur-sm" style={cardStyle}>
                    <div className="flex items-center justify-between">
                        <span className="text-sm font-medium theme-text opacity-70">This week</span>
                        <Calendar size={18} className="theme-text-contrast opacity-80" />
                    </div>

                    {meetings === null ? (
                        <p className="text-sm theme-subtext-color">Loading…</p>
                    ) : current ? (
                        <>
                            <p className="text-lg font-semibold theme-text">Meeting in progress</p>
                            <p className="text-sm theme-subtext-color">Ends at {formatClockTime(current.end_time)}</p>
                            {current.meeting_purpose && (
                                <p className="text-sm theme-text opacity-80">{current.meeting_purpose}</p>
                            )}
                        </>
                    ) : next ? (
                        <>
                            <p className="text-lg font-semibold theme-text">{formatMeetingDay(next.start_time)}, {formatClockTime(next.start_time)} – {formatClockTime(next.end_time)}</p>
                            <p className="text-sm theme-subtext-color">
                                {next.meeting_purpose}
                            </p>
                        </>
                    ) : (
                        <>
                            <p className="text-lg font-semibold theme-text">No meetings left</p>
                            <p className="text-sm theme-subtext-color">Nothing else scheduled this week.</p>
                        </>
                    )}
                </div>

                {/* Your tasks -- only for roles with tasks.view permission */}
                {canViewTasks && (
                    <div className="rounded-xl border p-5 flex flex-col gap-3 backdrop-blur-sm" style={cardStyle}>
                        <div className="flex items-center justify-between">
                            <span className="text-sm font-medium theme-text opacity-70">Your tasks</span>
                            <ListChecks size={18} className="theme-text-contrast opacity-80" />
                        </div>

                        {tasks === null ? (
                            <p className="text-sm theme-subtext-color">Loading…</p>
                        ) : myTasks.length === 0 ? (
                            <>
                                <p className="text-lg font-semibold theme-text">No tasks assigned</p>
                                <p className="text-sm theme-subtext-color">You're all caught up.</p>
                            </>
                        ) : (
                            <>
                                <div className="flex flex-col gap-2.5">
                                    {myTasks.slice(0, 5).map(task => {
                                        const overdue = task.due_date != null && isOverdue(task.due_date)
                                        const metaParts: ReactNode[] = [STATUS_LABEL[task.status]]
                                        if (task.assignee_id !== user.id && task.contributors.some(c => c.id === user.id)) {
                                            metaParts.push(<span key="contributing">Contributing</span>)
                                        }
                                        if (task.priority === "high") {
                                            metaParts.push(<span key="priority" style={{ color: DANGER_RED }}>{PRIORITY_LABEL.high}</span>)
                                        }
                                        if (task.due_date) {
                                            metaParts.push(
                                                overdue
                                                    ? <span key="due" style={{ color: DANGER_RED }}>Overdue</span>
                                                    : <span key="due">Due {formatDueDate(task.due_date)}</span>
                                            )
                                        }
                                        return (
                                            <div key={task.id} className="min-w-0">
                                                <p className="text-sm font-medium theme-text truncate">{task.title}</p>
                                                <p className="text-xs theme-subtext-color flex items-center gap-1 flex-wrap">
                                                    {metaParts.map((part, i) => (
                                                        <span key={i} className="flex items-center gap-1">
                                                            {i > 0 && <span aria-hidden="true">·</span>}
                                                            {part}
                                                        </span>
                                                    ))}
                                                </p>
                                            </div>
                                        )
                                    })}
                                </div>
                                <Link
                                    to="/tasks"
                                    state={{ bucket: "all", who: "me" } satisfies TasksPageState}
                                    className="text-sm theme-text-contrast hover:underline flex items-center gap-1 self-start"
                                >
                                    {myTasks.length > 5 ? `View all (${myTasks.length})` : "Open tasks"}
                                    <ChevronRight size={14} />
                                </Link>
                            </>
                        )}
                    </div>
                )}

                {/* Offline account code -- only for roles with school info on file */}
                {hasSchoolInfo && (
                    <div className="rounded-xl border p-5 flex flex-col gap-3 backdrop-blur-sm" style={cardStyle}>
                        <div className="flex items-center justify-between">
                            <span className="text-sm font-medium theme-text opacity-70">Your account code</span>
                            <KeyRound size={18} className="theme-text-contrast opacity-80" />
                        </div>

                        <div className="flex items-center gap-2">
                            <p className="text-2xl font-mono font-bold theme-text tracking-[0.3em]">
                                {codeVisible ? user.offline_code : "•".repeat(user.offline_code.length)}
                            </p>
                            <button
                                type="button"
                                onClick={() => setCodeVisible(v => !v)}
                                aria-label={codeVisible ? "Hide account code" : "Show account code"}
                                aria-pressed={codeVisible}
                                className="p-1.5 rounded-lg theme-subtext-color hover:theme-button-hover transition-colors"
                            >
                                {codeVisible ? <EyeOff size={16} /> : <Eye size={16} />}
                            </button>
                        </div>
                        <p className="text-xs theme-subtext-color">
                            Do not share this code with others.
                        </p>
                    </div>
                )}
            </div>
        </div>
    )
}
