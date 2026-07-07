import { useCallback, useEffect, useMemo, useState } from "react"
import { Calendar, Check, Trophy } from "lucide-react"
import Dropdown from "@/components/ui/Dropdown"

const API = import.meta.env.VITE_BACKEND_URL

interface MeetingHours {
    id: string
    start_time: string
    end_time: string
}

interface LeaderboardRow {
    user_id: string
    name: string
    total_seconds: number
    is_current_user: boolean
}

const TIME_OPTIONS: { value: string, label: string }[] = (() => {
    const options: { value: string, label: string }[] = []
    for (let h = 0; h < 24; h++) {
        for (let m = 0; m < 60; m += 15) {
            const period = h >= 12 ? "PM" : "AM"
            const h12 = h % 12 || 12
            options.push({
                value: `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`,
                label: `${h12}:${String(m).padStart(2, "0")} ${period}`,
            })
        }
    }
    return options
})()

function localDateKey(d: Date): string {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`
}

function dateKeyToDate(key: string): Date {
    const [y, m, d] = key.split("-").map(Number)
    return new Date(y, m - 1, d)
}

function formatDateLabel(key: string): string {
    return dateKeyToDate(key).toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric" })
}

function formatClockTime(iso: string): { label: string, period: "AM" | "PM" } {
    const d = new Date(iso)
    const period = d.getHours() >= 12 ? "PM" : "AM"
    const h12 = d.getHours() % 12 || 12
    return { label: `${h12}:${String(d.getMinutes()).padStart(2, "0")}`, period }
}

function formatMeetingRange(startIso: string, endIso: string, withPeriod: boolean): string {
    const start = formatClockTime(startIso)
    const end = formatClockTime(endIso)
    if (!withPeriod) return `${start.label} – ${end.label}`
    if (start.period === end.period) return `${start.label} – ${end.label} ${end.period}`
    return `${start.label} ${start.period} – ${end.label} ${end.period}`
}

function dayLabel(iso: string): string {
    return new Date(iso).toLocaleDateString("en-US", { weekday: "short" }).toUpperCase()
}

function weekRangeLabel(): string {
    const now = new Date()
    const offset = now.getDay() === 0 ? 6 : now.getDay() - 1
    const monday = new Date(now)
    monday.setDate(now.getDate() - offset)
    const sunday = new Date(monday)
    sunday.setDate(monday.getDate() + 6)
    const month = (d: Date) => d.toLocaleDateString("en-US", { month: "short" })
    return monday.getMonth() === sunday.getMonth()
        ? `${month(monday)} ${monday.getDate()} – ${sunday.getDate()}`
        : `${month(monday)} ${monday.getDate()} – ${month(sunday)} ${sunday.getDate()}`
}

function formatSecondsClocked(totalSeconds: number): string {
    const h = Math.floor(totalSeconds / 3600)
    const m = Math.floor((totalSeconds % 3600) / 60)
    return `${h}:${String(m).padStart(2, "0")}`
}

function diffHoursMinutes(start: string, end: string): { h: number, m: number } {
    if (!start || !end) return { h: 0, m: 0 }
    const [sh, sm] = start.split(":").map(Number)
    const [eh, em] = end.split(":").map(Number)
    let mins = (eh * 60 + em) - (sh * 60 + sm)
    if (mins < 0) mins += 24 * 60
    return { h: Math.floor(mins / 60), m: mins % 60 }
}

function combineDateAndTime(date: Date, hhmm: string): Date {
    const [h, m] = hhmm.split(":").map(Number)
    const combined = new Date(date)
    combined.setHours(h, m, 0, 0)
    return combined
}

const cardStyle = { background: "var(--theme-bg)", borderColor: "var(--theme-border)" }
const fieldStyle = { background: "color-mix(in oklch, var(--theme-button-bg) 60%, transparent)", borderColor: "var(--theme-border)" }

export default function AttendancePage() {
    const [selectedDateKey, setSelectedDateKey] = useState("")
    const [clockIn, setClockIn] = useState("15:30")
    const [clockOut, setClockOut] = useState("18:30")
    const [submitting, setSubmitting] = useState(false)
    const [submitted, setSubmitted] = useState(false)
    const [submitError, setSubmitError] = useState<string | null>(null)

    const [meetings, setMeetings] = useState<MeetingHours[]>([])
    const [leaderboard, setLeaderboard] = useState<LeaderboardRow[]>([])
    const [loading, setLoading] = useState(true)
    const [loadError, setLoadError] = useState<string | null>(null)

    const total = useMemo(() => diffHoursMinutes(clockIn, clockOut), [clockIn, clockOut])
    const today = useMemo(() => new Date(), [])

    const fetchMeetings = useCallback(async () => {
        const res = await fetch(`${API}/attendance/meetings`, { credentials: "include" })
        if (!res.ok) throw new Error("Failed to load meetings")
        setMeetings(await res.json())
    }, [])

    const fetchLeaderboard = useCallback(async () => {
        const res = await fetch(`${API}/attendance/leaderboard`, { credentials: "include" })
        if (!res.ok) throw new Error("Failed to load leaderboard")
        setLeaderboard(await res.json())
    }, [])

    useEffect(() => {
        async function load() {
            try {
                await Promise.all([fetchMeetings(), fetchLeaderboard()])
            } catch {
                setLoadError("Failed to load attendance data")
            } finally {
                setLoading(false)
            }
        }
        void load()
    }, [fetchMeetings, fetchLeaderboard])

    // One meeting_hours row per scheduled date (first meeting of that date wins if there are several).
    const scheduledDates = useMemo(() => {
        const byDate = new Map<string, MeetingHours>()
        for (const m of meetings) {
            const key = localDateKey(new Date(m.start_time))
            if (!byDate.has(key)) byDate.set(key, m)
        }
        return [...byDate.entries()].sort(([a], [b]) => a.localeCompare(b))
    }, [meetings])

    useEffect(() => {
        if (selectedDateKey || scheduledDates.length === 0) return
        const todayKey = localDateKey(today)
        const match = scheduledDates.find(([key]) => key === todayKey)
        setSelectedDateKey((match ?? scheduledDates[0])[0])
    }, [scheduledDates, selectedDateKey, today])

    const selectedMeeting = scheduledDates.find(([key]) => key === selectedDateKey)?.[1]
    const dateOptions = useMemo(
        () => scheduledDates.map(([key]) => ({ value: key, label: formatDateLabel(key) })),
        [scheduledDates],
    )

    const liveMeeting = useMemo(() => {
        const now = new Date()
        return meetings.find(m => new Date(m.start_time) <= now && now <= new Date(m.end_time))
    }, [meetings])
    const maxSeconds = Math.max(1, ...leaderboard.map(r => r.total_seconds))

    async function handleSubmit() {
        if (!selectedDateKey) return
        setSubmitting(true)
        setSubmitError(null)
        try {
            const date = dateKeyToDate(selectedDateKey)
            const res = await fetch(`${API}/attendance`, {
                method: "POST",
                credentials: "include",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    clock_in: combineDateAndTime(date, clockIn).toISOString(),
                    clock_out: combineDateAndTime(date, clockOut).toISOString(),
                }),
            })
            if (!res.ok) throw new Error("Failed to submit hours")
            setSubmitted(true)
            void fetchLeaderboard()
        } catch {
            setSubmitError("Failed to submit hours")
        } finally {
            setSubmitting(false)
        }
    }

    return (
        <div className="max-w-6xl mx-auto px-4 py-8 flex flex-col gap-4">
            <h1 className="text-2xl font-bold theme-h1-color">Attendance & Schedule</h1>

            {/* Log hours */}
            <div className="rounded-xl border p-6 flex flex-col gap-5 backdrop-blur-sm" style={cardStyle}>
                <div className="flex items-start justify-between gap-3">
                    <div>
                        <p className="text-xs font-semibold tracking-wider theme-subtext-color">LOG YOUR HOURS</p>
                        <h2 className="text-lg font-bold theme-text">Enter your time</h2>
                    </div>
                    <span className="shrink-0 text-xs font-medium px-2.5 py-1 rounded-full border theme-subtext-color theme-border">
                        Honor system
                    </span>
                </div>

                <div className="flex items-center justify-between gap-3 px-4 py-3 rounded-lg border" style={fieldStyle}>
                    <div className="flex items-center gap-2 theme-text min-w-0">
                        <Calendar size={16} className="theme-subtext-color shrink-0" />
                        <Dropdown
                            value={selectedDateKey}
                            options={dateOptions}
                            onChange={(v) => { setSelectedDateKey(v); setSubmitted(false) }}
                            disabled={dateOptions.length === 0}
                            placeholder="No meetings scheduled"
                            triggerClassName="font-medium theme-text"
                        />
                    </div>
                    <span className="shrink-0 text-sm theme-subtext-color">
                        {selectedMeeting ? formatMeetingRange(selectedMeeting.start_time, selectedMeeting.end_time, false) : ""}
                    </span>
                </div>

                <div className="grid grid-cols-2 gap-3 sm:gap-4">
                    {/* Reduced vertical padding to py-0.5 */}
                    <div className="rounded-lg border px-3 sm:px-4 py-0.5" style={fieldStyle}>
                        {/* Removed bottom margin entirely (mb-0) */}
                        <p className="text-xs font-semibold tracking-wider theme-subtext-color mb-0">CLOCK IN</p>
                        <Dropdown
                            value={clockIn}
                            options={TIME_OPTIONS}
                            onChange={(v) => { setClockIn(v); setSubmitted(false) }}
                            triggerClassName="text-lg sm:text-2xl font-bold theme-text"
                            initialMaxHeight={90}
                        />
                    </div>
                    {/* Reduced vertical padding to py-0.5 */}
                    <div className="rounded-lg border px-3 sm:px-4 py-0.5" style={fieldStyle}>
                        {/* Removed bottom margin entirely (mb-0) */}
                        <p className="text-xs font-semibold tracking-wider theme-subtext-color mb-0">CLOCK OUT</p>
                        <Dropdown
                            value={clockOut}
                            options={TIME_OPTIONS}
                            onChange={(v) => { setClockOut(v); setSubmitted(false) }}
                            triggerClassName="text-lg sm:text-2xl font-bold theme-text"
                            initialMaxHeight={90}
                        />
                    </div>
                </div>

                <div className="flex items-center justify-between gap-3">
                    <p className="text-sm theme-text">
                        Total <span className="font-bold theme-text-contrast">{total.h}h {String(total.m).padStart(2, "0")}m</span>
                    </p>
                    <button
                        onClick={() => void handleSubmit()}
                        disabled={submitting || !selectedDateKey}
                        className="flex items-center gap-2 rounded-lg px-5 py-2.5 font-semibold text-sm transition-opacity hover:opacity-90 disabled:opacity-60"
                        style={{ background: "var(--theme-text-contrast)", color: "var(--theme-bg)" }}
                    >
                        <Check size={16} />
                        {submitting ? "Submitting…" : submitted ? "Submitted" : "Submit hours"}
                    </button>
                </div>

                {submitError && (
                    <p className="text-sm px-3 py-2 rounded-lg border theme-subtext-color theme-border"
                       style={{ background: "color-mix(in oklch, var(--theme-border) 40%, transparent)" }}>
                        {submitError}
                    </p>
                )}
            </div>

            {/* Schedule + Leaderboard */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 items-start">
                <div className="flex flex-col gap-4">
                    {/* Live now */}
                    {liveMeeting && (
                        <div
                            className="rounded-xl border pl-4 pr-5 py-4 flex items-center justify-between gap-3 backdrop-blur-sm"
                            style={{ ...cardStyle, borderLeft: "3px solid var(--theme-text-contrast)" }}
                        >
                            <div className="min-w-0">
                                <div className="flex items-center gap-1.5 mb-1">
                                    <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: "var(--theme-text-contrast)" }} />
                                    <span className="text-xs font-semibold tracking-wider theme-text-contrast">LIVE NOW</span>
                                </div>
                                <p className="font-bold theme-text truncate">Team Meeting</p>
                            </div>
                            <span className="shrink-0 text-sm font-medium theme-subtext-color">
                                {formatMeetingRange(liveMeeting.start_time, liveMeeting.end_time, true)}
                            </span>
                        </div>
                    )}

                    {/* This week */}
                    <div className="rounded-xl border p-5 flex flex-col backdrop-blur-sm" style={cardStyle}>
                        <div className="flex items-center justify-between mb-2">
                            <h3 className="font-bold theme-text">This week</h3>
                            <span className="text-xs theme-subtext-color">{weekRangeLabel()}</span>
                        </div>
                        {loading ? (
                            <p className="text-sm theme-subtext-color py-2">Loading…</p>
                        ) : meetings.length === 0 ? (
                            <p className="text-sm theme-subtext-color py-2">No meetings scheduled this week.</p>
                        ) : (
                            meetings.map((meeting) => {
                                const active = liveMeeting?.id === meeting.id
                                return (
                                    <div key={meeting.id} className="flex items-center justify-between gap-3 py-2 border-t first:border-t-0 theme-border">
                                        <span className={`text-xs font-semibold w-8 shrink-0 ${active ? "theme-text-contrast" : "theme-subtext-color"}`}>
                                            {dayLabel(meeting.start_time)}
                                        </span>
                                        <span className={`shrink-0 text-sm font-medium ${active ? "theme-text-contrast" : "theme-text"}`}>
                                            {formatMeetingRange(meeting.start_time, meeting.end_time, false)}
                                        </span>
                                    </div>
                                )
                            })
                        )}
                    </div>
                </div>

                {/* Leaderboard */}
                <div className="rounded-xl border p-5 flex flex-col gap-1 backdrop-blur-sm" style={cardStyle}>
                    <div className="flex items-center justify-between gap-3 mb-2">
                        <div className="flex items-center gap-2">
                            <Trophy size={16} className="theme-text-contrast" />
                            <h3 className="font-bold theme-text">Leaderboard</h3>
                        </div>
                        <span className="text-xs font-semibold tracking-wider theme-subtext-color">TIME CLOCKED</span>
                    </div>
                    {loading ? (
                        <p className="text-sm theme-subtext-color py-2">Loading…</p>
                    ) : leaderboard.length === 0 ? (
                        <p className="text-sm theme-subtext-color py-2">No hours logged yet.</p>
                    ) : (
                        leaderboard.map((row, i) => (
                            <div
                                key={row.user_id}
                                className="flex flex-col gap-1.5 px-3 py-2.5 rounded-lg"
                                style={row.is_current_user ? { background: "color-mix(in oklch, var(--theme-button-bg) 90%, transparent)" } : {}}
                            >
                                <div className="flex items-center justify-between gap-3">
                                    <span className="text-sm font-medium theme-text truncate">
                                        <span className="theme-subtext-color mr-2">{i + 1}</span>
                                        {row.name}{row.is_current_user ? " · You" : ""}
                                    </span>
                                    <span className="shrink-0 text-sm font-semibold theme-text">{formatSecondsClocked(row.total_seconds)}</span>
                                </div>
                                <div className="w-full h-1.5 rounded-full overflow-hidden" style={{ background: "color-mix(in oklch, var(--theme-border) 80%, transparent)" }}>
                                    <div
                                        className="h-full rounded-full"
                                        style={{ width: `${(row.total_seconds / maxSeconds) * 100}%`, background: "var(--theme-text-contrast)" }}
                                    />
                                </div>
                            </div>
                        ))
                    )}
                </div>
            </div>

            {loadError && (
                <p className="text-sm px-3 py-2 rounded-lg border theme-subtext-color theme-border"
                   style={{ background: "color-mix(in oklch, var(--theme-border) 40%, transparent)" }}>
                    {loadError}
                </p>
            )}
        </div>
    )
}
