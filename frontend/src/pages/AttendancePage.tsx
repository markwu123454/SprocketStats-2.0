import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { createPortal } from "react-dom"
import { Calendar, Check, ChevronDown, ChevronLeft, ChevronRight, ChevronsUpDown, Trophy } from "lucide-react"

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

// ─── Time-wheel model: 5-minute slots from 6:00 AM to 11:55 PM ───────────────
const WHEEL_START = 6 * 60
const WHEEL_STEP = 5
const WHEEL_END = 23 * 60 + 55
const ITEM_H = 44

interface TimeSlot {
    big: string
    ampm: string
    mins: number
    hhmm: string
}

const TIME_SLOTS: TimeSlot[] = (() => {
    const slots: TimeSlot[] = []
    for (let mins = WHEEL_START; mins <= WHEEL_END; mins += WHEEL_STEP) {
        const h24 = Math.floor(mins / 60)
        const m = mins % 60
        const ampm = h24 < 12 ? "AM" : "PM"
        const h12 = h24 % 12 === 0 ? 12 : h24 % 12
        slots.push({
            big: `${h12}:${String(m).padStart(2, "0")}`,
            ampm,
            mins,
            hhmm: `${String(h24).padStart(2, "0")}:${String(m).padStart(2, "0")}`,
        })
    }
    return slots
})()

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n))
const idxToPos = (i: number) => 4 - i * ITEM_H

function hhmmToIdx(hhmm: string): number {
    const [h, m] = hhmm.split(":").map(Number)
    const mins = h * 60 + m
    return clamp(Math.round((mins - WHEEL_START) / WHEEL_STEP), 0, TIME_SLOTS.length - 1)
}

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

function rawMinutesDiff(start: string, end: string): number {
    if (!start || !end) return 0
    const [sh, sm] = start.split(":").map(Number)
    const [eh, em] = end.split(":").map(Number)
    return (eh * 60 + em) - (sh * 60 + sm)
}

function combineDateAndTime(date: Date, hhmm: string): Date {
    const [h, m] = hhmm.split(":").map(Number)
    const combined = new Date(date)
    combined.setHours(h, m, 0, 0)
    return combined
}

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"]
const DOW = ["S", "M", "T", "W", "T", "F", "S"]

function buildWeeks(y: number, m: number): (number | null)[][] {
    const startDow = new Date(y, m, 1).getDay()
    const days = new Date(y, m + 1, 0).getDate()
    const cells: (number | null)[] = []
    for (let i = 0; i < startDow; i++) cells.push(null)
    for (let d = 1; d <= days; d++) cells.push(d)
    while (cells.length % 7) cells.push(null)
    const weeks: (number | null)[][] = []
    for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7))
    return weeks
}

const cardStyle = { background: "var(--theme-bg)", borderColor: "var(--theme-border)" }
const fieldStyle = { background: "color-mix(in oklch, var(--theme-button-bg) 60%, transparent)", borderColor: "var(--theme-border)" }

// ─── Drag-to-set time wheel ──────────────────────────────────────────────────
function TimeWheel({ label, value, onChange }: { label: string, value: string, onChange: (v: string) => void }) {
    const wheelRef = useRef<HTMLDivElement>(null)
    const stackRef = useRef<HTMLDivElement>(null)
    const posRef = useRef(hhmmToIdx(value))
    const velRef = useRef(0)
    const rafRef = useRef(0)
    const runningRef = useRef(false)
    const interactingRef = useRef(false)
    const dragRef = useRef<{ lastY: number, lastT: number } | null>(null)
    const lastEmitRef = useRef(value)
    const onChangeRef = useRef(onChange)
    onChangeRef.current = onChange

    // Keep the wheel in sync when the value is changed from outside (but never mid-interaction).
    useEffect(() => {
        if (interactingRef.current) return
        posRef.current = hhmmToIdx(value)
        lastEmitRef.current = value
        if (stackRef.current) stackRef.current.style.transform = `translateY(${idxToPos(posRef.current)}px)`
    }, [value])

    useEffect(() => {
        const el = wheelRef.current
        const stack = stackRef.current
        if (!el || !stack) return

        const apply = () => { stack.style.transform = `translateY(${idxToPos(posRef.current)}px)` }
        apply()

        const setPos = (p: number) => {
            p = clamp(p, 0, TIME_SLOTS.length - 1)
            posRef.current = p
            apply()
            const hhmm = TIME_SLOTS[Math.round(p)].hhmm
            if (hhmm !== lastEmitRef.current) {
                lastEmitRef.current = hhmm
                onChangeRef.current(hhmm)
            }
        }

        const cancel = () => { if (rafRef.current) cancelAnimationFrame(rafRef.current); runningRef.current = false }

        const snap = () => {
            const from = posRef.current
            const to = clamp(Math.round(from), 0, TIME_SLOTS.length - 1)
            const done = () => { interactingRef.current = false }
            if (Math.abs(from - to) < 0.001) { setPos(to); done(); return }
            const start = performance.now(), dur = 240
            const ease = (t: number) => 1 - Math.pow(1 - t, 3)
            const tick = (now: number) => {
                const t = Math.min(1, (now - start) / dur)
                setPos(from + (to - from) * ease(t))
                if (t < 1) rafRef.current = requestAnimationFrame(tick)
                else done()
            }
            rafRef.current = requestAnimationFrame(tick)
        }

        const spin = () => {
            runningRef.current = true
            const max = TIME_SLOTS.length - 1
            let last = performance.now()
            const tick = (now: number) => {
                const dt = Math.min(40, now - last); last = now
                let pos = posRef.current + velRef.current * dt
                velRef.current *= Math.pow(0.985, dt)
                if (pos < 0) { pos = 0; velRef.current = 0 }
                if (pos > max) { pos = max; velRef.current = 0 }
                setPos(pos)
                if (Math.abs(velRef.current) > 0.001) rafRef.current = requestAnimationFrame(tick)
                else { runningRef.current = false; snap() }
            }
            rafRef.current = requestAnimationFrame(tick)
        }

        const momentum = () => {
            if (Math.abs(velRef.current) < 0.001) { snap(); return }
            if (!runningRef.current) spin()
        }

        const onMove = (e: PointerEvent) => {
            if (!dragRef.current) return
            const { lastY, lastT } = dragRef.current
            const now = performance.now()
            const dy = e.clientY - lastY
            const dt = Math.max(1, now - lastT)
            const dIdx = -dy / ITEM_H
            setPos(posRef.current + dIdx)
            velRef.current = dIdx / dt
            dragRef.current.lastY = e.clientY
            dragRef.current.lastT = now
        }

        const onUp = () => {
            window.removeEventListener("pointermove", onMove)
            window.removeEventListener("pointerup", onUp)
            document.body.style.cursor = ""
            dragRef.current = null
            momentum()
        }

        const onDown = (e: PointerEvent) => {
            e.preventDefault()
            cancel()
            interactingRef.current = true
            dragRef.current = { lastY: e.clientY, lastT: performance.now() }
            velRef.current = 0
            window.addEventListener("pointermove", onMove)
            window.addEventListener("pointerup", onUp)
            document.body.style.cursor = "grabbing"
        }

        const onWheel = (e: WheelEvent) => {
            e.preventDefault()
            interactingRef.current = true
            cancel()

            const DIRECT_SENSITIVITY = 0.006
            const dIdx = clamp(e.deltaY * DIRECT_SENSITIVITY, -0.6, 0.6)
            setPos(posRef.current + dIdx)

            const cap = 0.02
            velRef.current = clamp(dIdx * 0.15, -cap, cap)

            if (runningRef.current) return
            spin()
        }

        el.addEventListener("pointerdown", onDown)
        el.addEventListener("wheel", onWheel, { passive: false })
        return () => {
            el.removeEventListener("pointerdown", onDown)
            el.removeEventListener("wheel", onWheel)
            window.removeEventListener("pointermove", onMove)
            window.removeEventListener("pointerup", onUp)
            cancel()
        }
    }, [])

    return (
        <div className="relative rounded-lg border overflow-hidden h-[58px]" style={fieldStyle}>
            <div
                ref={wheelRef}
                className="absolute inset-0 cursor-grab touch-none select-none"
                style={{ WebkitMaskImage: "linear-gradient(180deg,transparent,#000 30%,#000 70%,transparent)", maskImage: "linear-gradient(180deg,transparent,#000 30%,#000 70%,transparent)" }}
            >
                <div ref={stackRef} style={{ willChange: "transform" }}>
                    {TIME_SLOTS.map((t) => (
                        <div key={t.hhmm} className="h-11 flex items-center justify-end gap-1.5 pr-[22px]">
                            <span className="font-mono text-[23px] font-bold theme-h1-color">{t.big}</span>
                            <span className="text-xs theme-subtext-color">{t.ampm}</span>
                        </div>
                    ))}
                </div>
            </div>
            <div className="absolute top-0 bottom-0 left-4 flex items-center font-mono text-[15px] font-bold tracking-wide uppercase theme-text pointer-events-none z-[2]">
                {label}
            </div>
        </div>
    )
}

export default function AttendancePage() {
    const [selectedDateKey, setSelectedDateKey] = useState("")
    const [clockIn, setClockIn] = useState("15:30")
    const [clockOut, setClockOut] = useState("18:30")
    const [submitting, setSubmitting] = useState(false)
    const [submitted, setSubmitted] = useState(false)
    const [submitError, setSubmitError] = useState<string | null>(null)

    const [calOpen, setCalOpen] = useState(false)
    const calTriggerRef = useRef<HTMLDivElement>(null)
    const [calPos, setCalPos] = useState<{ top: number, left: number } | null>(null)
    const [viewY, setViewY] = useState(() => new Date().getFullYear())
    const [viewM, setViewM] = useState(() => new Date().getMonth())

    const [meetings, setMeetings] = useState<MeetingHours[]>([])
    const [leaderboard, setLeaderboard] = useState<LeaderboardRow[]>([])
    const [loading, setLoading] = useState(true)
    const [loadError, setLoadError] = useState<string | null>(null)

    const total = useMemo(() => diffHoursMinutes(clockIn, clockOut), [clockIn, clockOut])
    const rawMinutes = useMemo(() => rawMinutesDiff(clockIn, clockOut), [clockIn, clockOut])
    const timeRangeInvalid = rawMinutes < 0
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

    const scheduledSet = useMemo(() => new Set(scheduledDates.map(([k]) => k)), [scheduledDates])

    useEffect(() => {
        if (selectedDateKey || scheduledDates.length === 0) return
        const todayKey = localDateKey(today)
        const match = scheduledDates.find(([key]) => key === todayKey)
        setSelectedDateKey((match ?? scheduledDates[0])[0])
    }, [scheduledDates, selectedDateKey, today])

    // Keep calendar view centered on the selected date whenever it changes.
    useEffect(() => {
        if (!selectedDateKey) return
        const d = dateKeyToDate(selectedDateKey)
        setViewY(d.getFullYear())
        setViewM(d.getMonth())
    }, [selectedDateKey])

    // Position the portaled calendar popover under its trigger, and close it if the page scrolls/resizes.
    useEffect(() => {
        if (!calOpen) return
        const el = calTriggerRef.current
        if (!el) return
        const r = el.getBoundingClientRect()
        setCalPos({ top: r.bottom + 4, left: r.left + r.width / 2 })

        const close = () => setCalOpen(false)
        window.addEventListener("scroll", close, true)
        window.addEventListener("resize", close)
        return () => {
            window.removeEventListener("scroll", close, true)
            window.removeEventListener("resize", close)
        }
    }, [calOpen])

    const selectedMeeting = scheduledDates.find(([key]) => key === selectedDateKey)?.[1]

    const liveMeeting = useMemo(() => {
        const now = new Date()
        return meetings.find(m => new Date(m.start_time) <= now && now <= new Date(m.end_time))
    }, [meetings])
    const maxSeconds = Math.max(1, ...leaderboard.map(r => r.total_seconds))

    const weeks = useMemo(() => buildWeeks(viewY, viewM), [viewY, viewM])
    const stepMonth = (delta: number) => {
        let m = viewM + delta, y = viewY
        if (m < 0) { m = 11; y-- }
        if (m > 11) { m = 0; y++ }
        setViewM(m); setViewY(y)
    }

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
                    source: "normal",
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
            <div className="rounded-xl border p-6 flex flex-col gap-4 backdrop-blur-sm" style={cardStyle}>
                <div>
                    <p className="text-xs font-semibold tracking-wider theme-subtext-color">LOG YOUR HOURS</p>
                    <h2 className="text-lg font-bold theme-text">Enter your time</h2>
                </div>

                {/* Date picker (inline calendar) */}
                <div className="relative" ref={calTriggerRef}>
                    <button
                        onClick={() => setCalOpen(o => !o)}
                        className="w-full flex items-center gap-2.5 rounded-lg border px-3.5 py-2.5 text-left"
                        style={fieldStyle}
                    >
                        <Calendar size={16} className="theme-subtext-color shrink-0" />
                        <span className="text-sm theme-text">
                            {selectedDateKey ? formatDateLabel(selectedDateKey) : "No meetings scheduled"}
                        </span>
                        {selectedMeeting && (
                            <span className="ml-auto text-sm theme-subtext-color">
                                {formatMeetingRange(selectedMeeting.start_time, selectedMeeting.end_time, false)}
                            </span>
                        )}
                        <ChevronDown size={14} className={`theme-subtext-color shrink-0 ${selectedMeeting ? "ml-2.5" : "ml-auto"}`} />
                    </button>

                    {calOpen && calPos && createPortal(
                        <>
                            <div className="fixed inset-0 z-50" onClick={() => setCalOpen(false)} />
                            <div
                                className="fixed z-50 -translate-x-1/2 rounded-xl border p-3 w-max shadow-[0_20px_50px_-18px_rgba(0,0,0,0.6)]"
                                style={{ ...cardStyle, top: calPos.top, left: calPos.left }}
                            >
                                <div className="flex items-center justify-between mb-2.5">
                                    <button onClick={() => stepMonth(-1)} className="w-7 h-7 rounded-lg border flex items-center justify-center theme-text theme-border">
                                        <ChevronLeft size={14} />
                                    </button>
                                    <span className="text-sm font-bold theme-h1-color">{MONTHS[viewM]} {viewY}</span>
                                    <button onClick={() => stepMonth(1)} className="w-7 h-7 rounded-lg border flex items-center justify-center theme-text theme-border">
                                        <ChevronRight size={14} />
                                    </button>
                                </div>
                                <div className="grid grid-cols-7 gap-[3px] mb-1">
                                    {DOW.map((d, i) => (
                                        <div key={i} className="h-[22px] flex items-center justify-center font-mono text-[10px] theme-subtext-color">{d}</div>
                                    ))}
                                </div>
                                <div className="flex flex-col gap-0.5">
                                    {weeks.map((w, wi) => (
                                        <div key={wi} className="grid grid-cols-7 gap-[3px]">
                                            {w.map((d, di) => {
                                                if (d == null) return <div key={di} className="w-[38px] h-[38px]" />
                                                const key = `${viewY}-${String(viewM + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`
                                                const scheduled = scheduledSet.has(key)
                                                const isSel = key === selectedDateKey
                                                return (
                                                    <button
                                                        key={di}
                                                        onClick={() => { setSelectedDateKey(key); setSubmitted(false); setCalOpen(false) }}
                                                        className="w-[38px] h-[38px] rounded-[9px] font-mono text-[13px] flex items-center justify-center relative cursor-pointer"
                                                        style={isSel
                                                            ? { background: "var(--theme-text-contrast)", color: "var(--theme-bg)", fontWeight: 700 }
                                                            : { color: "var(--theme-text)", fontWeight: 500 }}
                                                    >
                                                        {d}
                                                        {scheduled && !isSel && (
                                                            <span className="absolute bottom-1 left-1/2 -translate-x-1/2 w-1 h-1 rounded-full" style={{ background: "var(--theme-text-contrast)" }} />
                                                        )}
                                                    </button>
                                                )
                                            })}
                                        </div>
                                    ))}
                                </div>
                            </div>
                        </>,
                        document.body
                    )}
                </div>

                {/* Clock in / out wheels */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4">
                    <TimeWheel label="Clock in" value={clockIn} onChange={(v) => { setClockIn(v); setSubmitted(false) }} />
                    <TimeWheel label="Clock out" value={clockOut} onChange={(v) => { setClockOut(v); setSubmitted(false) }} />
                </div>

                <div className="flex items-center justify-center gap-1.5 -mt-1">
                    <ChevronsUpDown size={12} className="theme-subtext-color opacity-60" />
                    <span className="text-[11px] theme-subtext-color opacity-80">Drag to set · snaps to 5 min</span>
                </div>

                <div className="flex items-center justify-between gap-3">
                    {timeRangeInvalid ? (
                        <p className="text-sm text-red-500">Clock out must be after clock in</p>
                    ) : (
                        <p className="text-sm theme-text">
                            Total <span className="font-mono font-bold theme-text-contrast">{total.h}h {String(total.m).padStart(2, "0")}m</span>
                        </p>
                    )}
                    <button
                        onClick={() => void handleSubmit()}
                        disabled={submitting || !selectedDateKey || timeRangeInvalid}
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
