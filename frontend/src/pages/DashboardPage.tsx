import {useEffect, useState, type ReactNode} from "react"
import { Link } from "react-router-dom"
import { useOnboardedUser } from "@/contexts/authContext"
import { useBootstrapped } from "@/contexts/bootstrapContext"
import { Calendar, Eye, EyeOff, KeyRound, ChevronRight, ListChecks, LogIn, UserX } from "lucide-react"
import Avatar from "@/components/Avatar.tsx"
import Skeleton from "@/components/ui/Skeleton"
import Button from "@/components/ui/Button"
import { focusRing } from "@/lib/uiClasses"
import ActiveEventCard from "@/components/events/ActiveEventCard"
import NextMeetingAbsencesCard from "@/components/meetings/NextMeetingAbsences"
import { hubKeyOf, pickActiveEvent, type EventEntry } from "@/lib/events"
import { fetchEvents, type EventInfo } from "@/lib/eventApi"
import { can } from "@/lib/permissions"
import type { TasksPageState } from "@/pages/TasksPageRouter"
import { canViewOthersAbsences, meetingAbsencesFor, useMeetingAbsences } from "@/lib/meetings"
import { fetchTasks, PRIORITY_LABEL, STATUS_LABEL, type Task, type TaskPriority } from "@/lib/tasksApi"

const API = import.meta.env.VITE_BACKEND_URL

interface MeetingHours {
    id: string
    start_time: string
    end_time: string
    meeting_purpose: string | null
}

interface AttendanceEntry {
    id: number
    checkin_time: string
    checkout_time: string | null
}

function formatClockTime(iso: string): string {
    return new Date(iso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })
}

function formatMeetingDay(iso: string): string {
    const d = new Date(iso)
    if (d.toDateString() === new Date().toDateString()) return "Today"
    return d.toLocaleDateString("en-US", { weekday: "long" })
}

function formatCheckoutDay(iso: string): string {
    const d = new Date(iso)
    if (d.toDateString() === new Date().toDateString()) return "today"
    return `on ${d.toLocaleDateString("en-US", { month: "short", day: "numeric" })}`
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

const PRIORITY_RANK: Record<TaskPriority, number> = { critical: 0, high: 1, med: 2, low: 3 }

const cardStyle = { background: "var(--theme-bg)", borderColor: "var(--theme-border)" }

export default function DashboardPage() {
    const user = useOnboardedUser()
    const [meetings, setMeetings]   = useBootstrapped<MeetingHours[] | null>("meetings", null)
    const [rawEvents, setRawEvents] = useBootstrapped<EventEntry[]>("events", [])
    const [currentEvent]            = useBootstrapped<EventInfo | null>("current_event", null)
    const [eventKeys]               = useBootstrapped<string[]>("event_keys", [])
    const [codeVisible, setCodeVisible] = useState(false)
    const [tasks, setTasks] = useBootstrapped<Task[] | null>("tasks", null)
    const [attendance, setAttendance] = useState<AttendanceEntry[] | null>(null)
    const [checkingOut, setCheckingOut] = useState(false)
    const [checkoutError, setCheckoutError] = useState(false)

    const canViewTasks = can(user.permissions, "tasks.view")

    // The bootstrap schedule is a snapshot from app load -- refetch so a
    // check-in time an editor set since then is picked up.
    useEffect(() => {
        let cancelled = false
        fetchEvents()
            .then(data => { if (!cancelled) setRawEvents(data) })
            .catch(() => {})
        return () => { cancelled = true }
    }, [setRawEvents])

    // Re-picks the active event each minute, so the card appears on its own
    // when an event starts or its check-in opens while the page is open.
    const [nowMs, setNowMs] = useState(() => Date.now())
    useEffect(() => {
        const id = setInterval(() => setNowMs(Date.now()), 60_000)
        return () => clearInterval(id)
    }, [])

    // The one event the active-event card can show. `current_event` from
    // bootstrap is only ever used as a seed (passed down to ActiveEventCard)
    // for this event's matches/check-in state -- which event to show is
    // decided purely by schedule.
    const active  = pickActiveEvent(rawEvents, new Date(nowMs))
    const key     = active ? hubKeyOf(active) : undefined
    const hasHub  = !!key && eventKeys.includes(key)
    const seeded  = currentEvent?.event_key === key ? currentEvent : null

    useEffect(() => {
        let cancelled = false
        fetch(`${API}/attendance/meetings`, { credentials: "include" })
            .then(res => (res.ok ? res.json() : []))
            .then((data: MeetingHours[]) => { if (!cancelled) setMeetings(data) })
            .catch(() => { if (!cancelled) setMeetings([]) })
        return () => { cancelled = true }
    }, [setMeetings])

    // The backend already drops abandoned open entries, so an open one here
    // means the member is checked in right now.
    useEffect(() => {
        let cancelled = false
        fetch(`${API}/attendance/me`, { credentials: "include" })
            .then(res => (res.ok ? res.json() : []))
            .then((data: AttendanceEntry[]) => { if (!cancelled) setAttendance(data) })
            .catch(() => { if (!cancelled) setAttendance([]) })
        return () => { cancelled = true }
    }, [])

    useEffect(() => {
        if (!canViewTasks) return
        let cancelled = false
        fetchTasks()
            .then(data => { if (!cancelled) setTasks(data) })
            .catch(() => { if (!cancelled) setTasks(prev => prev ?? []) })
        return () => { cancelled = true }
    }, [canViewTasks, setTasks])

    const openEntry = attendance?.find(a => a.checkout_time === null)

    // Only checking out is offered here; checking in still happens at a kiosk.
    // A 409 means the session was already closed elsewhere, so refetch either way.
    function checkOut() {
        setCheckingOut(true)
        setCheckoutError(false)
        fetch(`${API}/attendance/checkout`, { method: "POST", credentials: "include" })
            .then(res => {
                if (!res.ok && res.status !== 409) throw new Error(String(res.status))
                return fetch(`${API}/attendance/me`, { credentials: "include" })
            })
            .then(res => (res.ok ? res.json() : Promise.reject(new Error(String(res.status)))))
            .then((data: AttendanceEntry[]) => setAttendance(data))
            .catch(() => setCheckoutError(true))
            .finally(() => setCheckingOut(false))
    }
    const lastCheckout = (attendance ?? [])
        .map(a => a.checkout_time)
        .filter((t): t is string => t !== null)
        .sort((a, b) => Date.parse(a) - Date.parse(b))
        .at(-1)

    const now = new Date()
    const sorted = (meetings ?? [])
        .slice()
        .sort((a, b) => new Date(a.start_time).getTime() - new Date(b.start_time).getTime())
    const current = sorted.find(m => new Date(m.start_time) <= now && now <= new Date(m.end_time))
    const next = sorted.find(m => new Date(m.start_time) > now)

    // Absences for the meeting the card above is about: the one in progress
    // until it ends, then the next. Visibility is filtered server-side.
    const { absences, loading: absencesLoading } = useMeetingAbsences()
    const target = current ?? next
    const { mine: myAbsence, others: othersAbsent } = target && !absencesLoading
        ? meetingAbsencesFor(absences, target.id, user.id)
        : { mine: undefined, others: [] }
    const showOthersAbsent = canViewOthersAbsences(user.permissions) && othersAbsent.length > 0

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

            {/* Active event card -- only rendered when an event is currently happening,
                or its check-in has opened ahead of it. There is no separate
                "upcoming event" card by design. */}
            {active && (
                <ActiveEventCard active={active} hasHub={hasHub} eventKey={key} seed={seeded} userId={user.id} />
            )}

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {/* This week's meeting */}
                <Link to="/meetings" className={`rounded-xl border p-5 flex flex-col gap-3 backdrop-blur-sm transition-opacity hover:opacity-90 ${focusRing}`} style={cardStyle}>
                    <div className="flex items-center justify-between">
                        <span className="text-sm font-medium theme-text opacity-70">This week</span>
                        <Calendar size={18} className="theme-text-contrast opacity-80" />
                    </div>

                    {meetings === null ? (
                        <>
                            <Skeleton className="h-6 w-2/3" />
                            <Skeleton className="h-4 w-1/2" />
                        </>
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
                    {myAbsence && (
                        <p className="flex items-center gap-1.5 text-sm font-semibold theme-text-contrast">
                            <UserX size={16} aria-hidden="true" />You're marked absent
                        </p>
                    )}
                    <span className="mt-auto flex items-center gap-1 text-sm font-semibold theme-text-contrast">{myAbsence ? "Change on Meetings" : "View meetings"}<ChevronRight size={16} aria-hidden="true" /></span>
                </Link>

                {/* Kiosk check-in status */}
                <div className="rounded-xl border p-5 flex flex-col gap-3 backdrop-blur-sm" style={cardStyle}>
                    <div className="flex items-center justify-between">
                        <span className="text-sm font-medium theme-text opacity-70">Attendance</span>
                        <LogIn size={18} className="theme-text-contrast opacity-80" />
                    </div>

                    {attendance === null ? (
                        <>
                            <Skeleton className="h-6 w-2/3" />
                            <Skeleton className="h-4 w-1/2" />
                        </>
                    ) : (
                        <>
                            <p className="flex items-center gap-2 text-lg font-semibold theme-text">
                                <span className="inline-block size-2.5 rounded-full" aria-hidden="true"
                                    style={{ background: openEntry ? "#22c55e" : "#9ca3af" }} />
                                {openEntry ? "Checked in" : "Checked out"}
                            </p>
                            <p className="text-sm theme-subtext-color">
                                {openEntry
                                    // Open entries are at most 12 hours old, so the time alone is enough.
                                    ? `Since ${formatClockTime(openEntry.checkin_time)}`
                                    : lastCheckout
                                        ? `Last checked out ${formatCheckoutDay(lastCheckout)} at ${formatClockTime(lastCheckout)}`
                                        : "Check in at a kiosk when you arrive."}
                            </p>
                            {openEntry && (
                                <Button variant="outlined" className="mt-auto self-start" onClick={checkOut} disabled={checkingOut}>
                                    {checkingOut ? "Checking out…" : "Check out"}
                                </Button>
                            )}
                            {checkoutError && (
                                <p role="alert" className="text-sm" style={{ color: "var(--theme-danger)" }}>Couldn't check out. Try again.</p>
                            )}
                        </>
                    )}
                </div>

                {/* Who's out -- leads/captains/mentors only, and only when someone is */}
                {target && showOthersAbsent && (
                    <NextMeetingAbsencesCard
                        absences={othersAbsent}
                        meetingLabel={`${target.meeting_purpose || "Team meeting"} · ${current ? "In progress" : formatMeetingDay(target.start_time)}`}
                    />
                )}

                {/* Your tasks -- only for roles with tasks.view permission */}
                {canViewTasks && (
                    <div className="rounded-xl border p-5 flex flex-col gap-3 backdrop-blur-sm" style={cardStyle}>
                        <div className="flex items-center justify-between">
                            <span className="text-sm font-medium theme-text opacity-70">Your tasks</span>
                            <ListChecks size={18} className="theme-text-contrast opacity-80" />
                        </div>

                        {tasks === null ? (
                            <div className="flex flex-col gap-2.5">
                                <Skeleton className="h-9 w-full" />
                                <Skeleton className="h-9 w-full" />
                                <Skeleton className="h-9 w-full" />
                            </div>
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
                                        if (task.priority === "critical") {
                                            metaParts.push(<span key="priority" className="font-extrabold uppercase" style={{ color: "var(--theme-danger)" }}>☠ {PRIORITY_LABEL.critical}</span>)
                                        } else if (task.priority === "high") {
                                            metaParts.push(<span key="priority" style={{ color: "var(--theme-danger)" }}>{PRIORITY_LABEL.high}</span>)
                                        }
                                        if (task.due_date) {
                                            metaParts.push(
                                                overdue
                                                    ? <span key="due" style={{ color: "var(--theme-danger)" }}>Overdue</span>
                                                    : <span key="due">Due {formatDueDate(task.due_date)}</span>
                                            )
                                        }
                                        return (
                                            <Link
                                                key={task.id}
                                                to="/tasks"
                                                state={{ bucket: "all", who: "me", taskId: task.id } satisfies TasksPageState}
                                                className="min-w-0 block rounded-lg -mx-1.5 px-1.5 py-0.5 hover:bg-(--ag-grid-hover-bg)"
                                            >
                                                <p className="text-sm font-medium theme-text truncate">{task.title}</p>
                                                <p className="text-xs theme-subtext-color flex items-center gap-1 flex-wrap">
                                                    {metaParts.map((part, i) => (
                                                        <span key={i} className="flex items-center gap-1">
                                                            {i > 0 && <span aria-hidden="true">·</span>}
                                                            {part}
                                                        </span>
                                                    ))}
                                                </p>
                                            </Link>
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
