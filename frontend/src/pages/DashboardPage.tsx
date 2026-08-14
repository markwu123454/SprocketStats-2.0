import {useEffect, useState} from "react"
import { Link } from "react-router-dom"
import { useOnboardedUser } from "@/contexts/authContext"
import { useBootstrapped } from "@/contexts/bootstrapContext"
import { Calendar, Eye, EyeOff, KeyRound, ChevronRight } from "lucide-react"
import Avatar from "@/components/Avatar.tsx"
import { resolveEvent, type EventEntry } from "@/lib/events"
import type { EventInfo } from "@/lib/eventApi"

const API = import.meta.env.VITE_BACKEND_URL

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

const cardStyle = { background: "var(--theme-bg)", borderColor: "var(--theme-border)" }

export default function DashboardPage() {
    const user = useOnboardedUser()
    const [meetings, setMeetings]   = useBootstrapped<MeetingHours[] | null>("meetings", null)
    const [rawEvents]               = useBootstrapped<EventEntry[]>("events", [])
    const [currentEvent]            = useBootstrapped<EventInfo | null>("current_event", null)
    const [codeVisible, setCodeVisible] = useState(false)

    const eventEntry   = rawEvents.find(e => e.tbaKey === currentEvent?.event_key)
    const resolvedEvent = eventEntry ? resolveEvent(eventEntry, new Date()) : null

    useEffect(() => {
        let cancelled = false
        fetch(`${API}/attendance/meetings`, { credentials: "include" })
            .then(res => (res.ok ? res.json() : []))
            .then((data: MeetingHours[]) => { if (!cancelled) setMeetings(data) })
            .catch(() => { if (!cancelled) setMeetings([]) })
        return () => { cancelled = true }
    }, [setMeetings])

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
