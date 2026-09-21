import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { createPortal } from "react-dom"
import {
    Calendar as CalendarIcon,
    Check,
    ChevronDown,
    ChevronLeft,
    ChevronRight,
    ChevronsUpDown,
    Pencil,
    Plus,
    Repeat,
    Trash2,
} from "lucide-react"
import { TimeWheel } from "@/components/ui/TimeWheel"

const API = import.meta.env.VITE_BACKEND_URL

interface MeetingRow {
    id: string
    start_time: string
    end_time: string
    meeting_purpose: string | null
}

function localDateKey(d: Date): string {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`
}

function dateKeyToDate(key: string): Date {
    const [y, m, d] = key.split("-").map(Number)
    return new Date(y, m - 1, d)
}

function addDaysToKey(key: string, days: number): string {
    const d = dateKeyToDate(key)
    d.setDate(d.getDate() + days)
    return localDateKey(d)
}

function formatDateLabel(key: string): string {
    return dateKeyToDate(key).toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric" })
}

function formatShortDate(key: string): string {
    return dateKeyToDate(key).toLocaleDateString("en-US", { month: "short", day: "numeric" })
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

function toHHMM(d: Date): string {
    return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`
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

const DEFAULT_START = "15:30"
const DEFAULT_END = "18:30"

// ─── Recurrence ──────────────────────────────────────────────────────────────

type Frequency = "daily" | "weekly" | "biweekly"
type EndMode = "count" | "date"

const FREQUENCIES: { id: Frequency, label: string }[] = [
    { id: "daily", label: "Daily" },
    { id: "weekly", label: "Weekly" },
    { id: "biweekly", label: "Every 2 weeks" },
]

/**
 * Hard ceiling on how many meetings one "add" can create. Repeats are stored as
 * plain individual rows (the backend has no series concept), so every occurrence
 * costs a POST — this keeps a stray "ends on 2099" from firing thousands.
 */
const REPEAT_LIMIT = 60

const DEFAULT_UNTIL_OFFSET = 56  // 8 weeks out — a sane default season length

interface Recurrence {
    startKey: string
    frequency: Frequency
    weekdays: number[]   // 0 = Sunday; used by weekly/biweekly only
    endMode: EndMode
    count: number
    untilKey: string
}

/**
 * Expand a recurrence into the concrete local date keys it covers, capped at
 * `REPEAT_LIMIT`. Weekly/biweekly walk whole weeks from the week containing the
 * start date, emitting each selected weekday that is not before the start — so
 * a Monday start with Tue/Thu selected first meets on Tuesday.
 */
function expandRecurrence(r: Recurrence): string[] {
    const start = dateKeyToDate(r.startKey)
    const limit = r.endMode === "count"
        ? Math.min(Math.max(Math.floor(r.count) || 1, 1), REPEAT_LIMIT)
        : REPEAT_LIMIT
    const until = r.endMode === "date" ? dateKeyToDate(r.untilKey) : null
    const out: string[] = []

    if (r.frequency === "daily") {
        const d = new Date(start)
        while (out.length < limit) {
            if (until && d > until) break
            out.push(localDateKey(d))
            d.setDate(d.getDate() + 1)
        }
        return out
    }

    const days = [...r.weekdays].sort((a, b) => a - b)
    const step = r.frequency === "biweekly" ? 14 : 7

    // Walk from the Sunday of the start date's week so weekday order is stable.
    const cursor = new Date(start)
    cursor.setDate(cursor.getDate() - cursor.getDay())

    // Bounded regardless of the date arithmetic below, so a bad input can't hang the UI.
    for (let week = 0; week < REPEAT_LIMIT * 2 && out.length < limit; week++) {
        for (const dow of days) {
            const d = new Date(cursor)
            d.setDate(d.getDate() + dow)
            if (d < start) continue
            if (until && d > until) return out
            if (out.length >= limit) return out
            out.push(localDateKey(d))
        }
        cursor.setDate(cursor.getDate() + step)
    }
    return out
}

/**
 * The calendar popover shared by the start-date and "ends on" fields — portaled
 * to `document.body`, anchored under its trigger, and closed on scroll/resize.
 * Markup matches AttendancePage's clock in/out calendar so the two pages' date
 * pickers stay visually identical.
 */
function CalendarField({ value, onChange, dotted, minKey, compact }: {
    value: string
    onChange: (key: string) => void
    dotted?: Set<string>
    minKey?: string
    compact?: boolean
}) {
    const [open, setOpen] = useState(false)
    const triggerRef = useRef<HTMLDivElement>(null)
    const [pos, setPos] = useState<{ top: number, left: number } | null>(null)
    const [viewY, setViewY] = useState(() => dateKeyToDate(value).getFullYear())
    const [viewM, setViewM] = useState(() => dateKeyToDate(value).getMonth())

    // Keep the calendar view centered on the selected date whenever it changes.
    useEffect(() => {
        const d = dateKeyToDate(value)
        setViewY(d.getFullYear())
        setViewM(d.getMonth())
    }, [value])

    useEffect(() => {
        if (!open) return
        const el = triggerRef.current
        if (!el) return
        const r = el.getBoundingClientRect()
        setPos({ top: r.bottom + 4, left: r.left + r.width / 2 })

        const close = () => setOpen(false)
        window.addEventListener("scroll", close, true)
        window.addEventListener("resize", close)
        return () => {
            window.removeEventListener("scroll", close, true)
            window.removeEventListener("resize", close)
        }
    }, [open])

    const weeks = useMemo(() => buildWeeks(viewY, viewM), [viewY, viewM])
    const stepMonth = (delta: number) => {
        let m = viewM + delta, y = viewY
        if (m < 0) { m = 11; y-- }
        if (m > 11) { m = 0; y++ }
        setViewM(m); setViewY(y)
    }

    return (
        <div className="relative" ref={triggerRef}>
            <button
                onClick={() => setOpen(o => !o)}
                className={`w-full flex items-center gap-2.5 rounded-lg border text-left ${compact ? "px-3 py-2" : "px-3.5 py-2.5"}`}
                style={fieldStyle}
            >
                <CalendarIcon size={compact ? 14 : 16} className="theme-subtext-color shrink-0" />
                <span className={`theme-text truncate ${compact ? "text-[13px]" : "text-sm"}`}>
                    {compact ? formatShortDate(value) : formatDateLabel(value)}
                </span>
                <ChevronDown size={14} className="theme-subtext-color shrink-0 ml-auto" />
            </button>

            {open && pos && createPortal(
                <>
                    <div className="fixed inset-0 z-50" onClick={() => setOpen(false)} />
                    <div
                        className="fixed z-50 -translate-x-1/2 rounded-xl border p-3 w-max shadow-[0_20px_50px_-18px_rgba(0,0,0,0.6)]"
                        style={{ ...cardStyle, top: pos.top, left: pos.left }}
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
                                        const disabled = minKey != null && key < minKey
                                        const scheduled = dotted?.has(key) ?? false
                                        const isSel = key === value
                                        return (
                                            <button
                                                key={di}
                                                disabled={disabled}
                                                onClick={() => { onChange(key); setOpen(false) }}
                                                className="w-[38px] h-[38px] rounded-[9px] font-mono text-[13px] flex items-center justify-center relative cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed"
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
                document.body,
            )}
        </div>
    )
}

/**
 * Admin editor for the `meeting_hours` table — schedule, edit, and delete
 * meetings. Rendered inside the Meeting control page's "Meeting Time" section
 * (gated there on `control_panel.meeting_time`; this component assumes the
 * caller already holds that capability, and the backend re-enforces it on
 * every request regardless).
 *
 * Repeating meetings are expanded client-side into one ordinary row per
 * occurrence, because `meeting_hours` stores no recurrence rule and the API has
 * no series concept. The upside is that editing or deleting a single occurrence
 * needs no special handling; the cost is that nothing links a series afterwards,
 * so changing "every Tuesday" means editing each Tuesday.
 *
 * The date picker and start/end time inputs deliberately reuse the exact
 * same calendar-popover markup and `TimeWheel` widget as AttendancePage's
 * clock in/out form, so the two pages' scheduling UI stays visually and
 * behaviorally identical.
 */
export default function MeetingHoursEditor() {
    const [meetings, setMeetings] = useState<MeetingRow[]>([])
    const [loading, setLoading] = useState(true)
    const [saving, setSaving] = useState(false)
    const [progress, setProgress] = useState<{ done: number, total: number } | null>(null)
    const [error, setError] = useState<string | null>(null)

    const [mode, setMode] = useState<"add" | "edit">("add")
    const [editingId, setEditingId] = useState<string | null>(null)
    const [description, setDescription] = useState("")
    const [dateKey, setDateKey] = useState(() => localDateKey(new Date()))
    const [startTime, setStartTime] = useState(DEFAULT_START)
    const [endTime, setEndTime] = useState(DEFAULT_END)
    const [justAdded, setJustAdded] = useState(false)

    const [repeat, setRepeat] = useState(false)
    const [frequency, setFrequency] = useState<Frequency>("weekly")
    // Empty means "whatever weekday the start date falls on" — see `weekdays` below.
    const [pickedWeekdays, setPickedWeekdays] = useState<number[]>([])
    const [endMode, setEndMode] = useState<EndMode>("count")
    const [count, setCount] = useState(8)
    const [untilKey, setUntilKey] = useState(() => addDaysToKey(localDateKey(new Date()), DEFAULT_UNTIL_OFFSET))

    const load = useCallback(async () => {
        setLoading(true)
        setError(null)
        try {
            const res = await fetch(`${API}/meeting-hours`, { credentials: "include" })
            if (!res.ok) throw new Error("load")
            setMeetings(await res.json())
        } catch {
            setError("Failed to load meetings")
        } finally {
            setLoading(false)
        }
    }, [])

    useEffect(() => { void load() }, [load])

    const resetForm = useCallback(() => {
        const today = localDateKey(new Date())
        setMode("add")
        setEditingId(null)
        setDescription("")
        setDateKey(today)
        setStartTime(DEFAULT_START)
        setEndTime(DEFAULT_END)
        setRepeat(false)
        setFrequency("weekly")
        setPickedWeekdays([])
        setEndMode("count")
        setCount(8)
        setUntilKey(addDaysToKey(today, DEFAULT_UNTIL_OFFSET))
    }, [])

    const updateDescription = (v: string) => { setDescription(v); setJustAdded(false) }
    const updateStart = (v: string) => { setStartTime(v); setJustAdded(false) }
    const updateEnd = (v: string) => { setEndTime(v); setJustAdded(false) }

    const selectDate = (key: string) => {
        setDateKey(key)
        setJustAdded(false)
        // Keep the recurrence window ahead of the start date it hangs off of.
        if (untilKey <= key) setUntilKey(addDaysToKey(key, DEFAULT_UNTIL_OFFSET))
    }

    // Weekly/biweekly default to the start date's own weekday until the admin picks days.
    const weekdays = useMemo(
        () => (pickedWeekdays.length ? pickedWeekdays : [dateKeyToDate(dateKey).getDay()]),
        [pickedWeekdays, dateKey],
    )

    const toggleWeekday = (dow: number) => {
        const next = weekdays.includes(dow)
            ? weekdays.filter(d => d !== dow)
            : [...weekdays, dow].sort((a, b) => a - b)
        if (next.length === 0) return  // always leave at least one day selected
        setPickedWeekdays(next)
        setJustAdded(false)
    }

    // Dates that already have a meeting get a dot on the calendar — but not the
    // meeting currently being edited, whose original date shouldn't look stale.
    const scheduledSet = useMemo(() => {
        const s = new Set<string>()
        for (const m of meetings) {
            if (m.id === editingId) continue
            s.add(localDateKey(new Date(m.start_time)))
        }
        return s
    }, [meetings, editingId])

    // Newest first — a freshly added meeting lands at the top of the list rather
    // than being buried under the season's history.
    const sortedMeetings = useMemo(
        () => [...meetings].sort((a, b) => new Date(b.start_time).getTime() - new Date(a.start_time).getTime()),
        [meetings],
    )

    // Every date this submit will create. A one-off is just a single-entry list,
    // so submission has one code path regardless of the repeat toggle.
    const occurrences = useMemo(() => {
        if (mode === "edit" || !repeat) return [dateKey]
        return expandRecurrence({ startKey: dateKey, frequency, weekdays, endMode, count, untilKey })
    }, [mode, repeat, dateKey, frequency, weekdays, endMode, count, untilKey])

    // Only "ends on <date>" can silently lose occurrences to the cap — the count
    // field is already clamped to REPEAT_LIMIT as it's typed.
    const atRepeatLimit = repeat && mode === "add" && endMode === "date" && occurrences.length >= REPEAT_LIMIT

    const total = useMemo(() => diffHoursMinutes(startTime, endTime), [startTime, endTime])
    const rawMinutes = useMemo(() => rawMinutesDiff(startTime, endTime), [startTime, endTime])
    const timeRangeInvalid = rawMinutes <= 0
    const formDisabled = !description.trim() || !dateKey || timeRangeInvalid || occurrences.length === 0 || saving

    async function handleSubmit() {
        if (formDisabled) return
        setSaving(true)
        setError(null)

        const bodyFor = (key: string) => {
            const date = dateKeyToDate(key)
            return JSON.stringify({
                start_time: combineDateAndTime(date, startTime).toISOString(),
                end_time: combineDateAndTime(date, endTime).toISOString(),
                meeting_purpose: description.trim(),
            })
        }

        try {
            if (mode === "edit") {
                const res = await fetch(`${API}/meeting-hours/${editingId}`, {
                    method: "PUT",
                    credentials: "include",
                    headers: { "Content-Type": "application/json" },
                    body: bodyFor(dateKey),
                })
                if (!res.ok) throw new Error("save")
                await load()
                resetForm()
                return
            }

            // One POST per occurrence, sequentially so a mid-series failure leaves a
            // known prefix created rather than an arbitrary scatter of rows.
            let created = 0
            setProgress({ done: 0, total: occurrences.length })
            for (const key of occurrences) {
                const res = await fetch(`${API}/meeting-hours`, {
                    method: "POST",
                    credentials: "include",
                    headers: { "Content-Type": "application/json" },
                    body: bodyFor(key),
                })
                if (!res.ok) break
                created++
                setProgress({ done: created, total: occurrences.length })
            }
            await load()

            if (created < occurrences.length) {
                setError(created === 0
                    ? `Failed to add ${occurrences.length === 1 ? "meeting" : "meetings"}`
                    : `Added ${created} of ${occurrences.length} meetings — the rest failed. Adjust the start date and retry to avoid duplicates.`)
                return
            }

            resetForm()
            setJustAdded(true)
            setTimeout(() => setJustAdded(false), 1600)
        } catch {
            setError(mode === "edit" ? "Failed to save changes" : "Failed to add meeting")
        } finally {
            setProgress(null)
            setSaving(false)
        }
    }

    function handleEdit(row: MeetingRow) {
        const start = new Date(row.start_time)
        const end = new Date(row.end_time)
        setMode("edit")
        setEditingId(row.id)
        setDescription(row.meeting_purpose ?? "")
        setDateKey(localDateKey(start))
        setStartTime(toHHMM(start))
        setEndTime(toHHMM(end))
        setRepeat(false)  // edits always apply to the one occurrence being edited
        setJustAdded(false)
    }

    async function handleDelete(id: string) {
        setError(null)
        try {
            const res = await fetch(`${API}/meeting-hours/${id}`, { method: "DELETE", credentials: "include" })
            if (!res.ok) throw new Error("delete")
            if (editingId === id) resetForm()
            await load()
        } catch {
            setError("Failed to delete meeting")
        }
    }

    const addLabel = occurrences.length > 1 ? `Add ${occurrences.length} meetings` : "Add meeting"

    return (
        <div className="flex flex-col gap-4">
            {error && (
                <p className="text-sm px-3 py-2 rounded-lg border theme-subtext-color theme-border"
                   style={{ background: "color-mix(in oklch, var(--theme-border) 40%, transparent)" }}>
                    {error}
                </p>
            )}

            {/* Schedule / edit a meeting */}
            <div className="rounded-xl border p-6 flex flex-col gap-4 backdrop-blur-sm" style={cardStyle}>
                <div>
                    <p className="text-xs font-semibold tracking-wider theme-subtext-color">
                        {mode === "edit" ? "EDIT MEETING" : "SCHEDULE A MEETING"}
                    </p>
                    <h3 className="text-lg font-bold theme-h1-color">
                        {mode === "edit" ? "Edit meeting hours" : "Add meeting hours"}
                    </h3>
                </div>

                <input
                    type="text"
                    value={description}
                    onChange={(e) => updateDescription(e.target.value)}
                    placeholder="Short description — e.g. Board sync, Sprint planning"
                    maxLength={128}
                    className="w-full rounded-lg border px-3.5 py-3 text-sm theme-text outline-none"
                    style={fieldStyle}
                />

                {/* Date picker (inline calendar) */}
                <CalendarField value={dateKey} onChange={selectDate} dotted={scheduledSet} />

                {/* Start / end time wheels */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4">
                    <TimeWheel label="Start" value={startTime} onChange={updateStart} />
                    <TimeWheel label="End" value={endTime} onChange={updateEnd} />
                </div>

                <div className="flex items-center justify-center gap-1.5 -mt-1">
                    <ChevronsUpDown size={12} className="theme-subtext-color opacity-60" />
                    <span className="text-[11px] theme-subtext-color opacity-80">Drag to set · snaps to 5 min</span>
                </div>

                {/* Repeat — add mode only; an edit always targets one occurrence */}
                {mode === "add" && (
                    <div className="rounded-lg border flex flex-col" style={fieldStyle}>
                        <button
                            type="button"
                            onClick={() => { setRepeat(r => !r); setJustAdded(false) }}
                            className="flex items-center gap-2.5 px-3.5 py-2.5 text-left"
                        >
                            <Repeat size={16} className="theme-subtext-color shrink-0" />
                            <span className="text-sm theme-text">Repeat</span>
                            <span className="text-[11px] theme-subtext-color ml-1">
                                {repeat ? `${occurrences.length} meeting${occurrences.length === 1 ? "" : "s"}` : "Does not repeat"}
                            </span>
                            <span
                                className="ml-auto w-9 h-5 rounded-full relative transition-colors shrink-0"
                                style={{ background: repeat ? "var(--theme-text-contrast)" : "color-mix(in oklch, var(--theme-border) 90%, transparent)" }}
                            >
                                <span
                                    className="absolute top-0.5 w-4 h-4 rounded-full transition-all"
                                    style={{ background: "var(--theme-bg)", left: repeat ? "18px" : "2px" }}
                                />
                            </span>
                        </button>

                        {repeat && (
                            <div className="flex flex-col gap-3 px-3.5 pb-3.5 pt-1 border-t" style={{ borderColor: "var(--theme-border)" }}>
                                {/* Frequency */}
                                <div className="flex flex-col gap-1.5 mt-2.5">
                                    <span className="text-[11px] font-semibold tracking-wider theme-subtext-color">FREQUENCY</span>
                                    <div className="flex gap-1.5 flex-wrap">
                                        {FREQUENCIES.map(f => {
                                            const on = frequency === f.id
                                            return (
                                                <button
                                                    key={f.id}
                                                    type="button"
                                                    onClick={() => { setFrequency(f.id); setJustAdded(false) }}
                                                    className="rounded-lg border px-3 py-1.5 text-[13px] font-medium theme-border"
                                                    style={on
                                                        ? { background: "var(--theme-text-contrast)", color: "var(--theme-bg)" }
                                                        : { color: "var(--theme-text)" }}
                                                >
                                                    {f.label}
                                                </button>
                                            )
                                        })}
                                    </div>
                                </div>

                                {/* Weekday chips */}
                                {frequency !== "daily" && (
                                    <div className="flex flex-col gap-1.5">
                                        <span className="text-[11px] font-semibold tracking-wider theme-subtext-color">ON THESE DAYS</span>
                                        <div className="flex gap-1.5">
                                            {DOW.map((d, i) => {
                                                const on = weekdays.includes(i)
                                                return (
                                                    <button
                                                        key={i}
                                                        type="button"
                                                        onClick={() => toggleWeekday(i)}
                                                        className="w-9 h-9 rounded-lg border font-mono text-[13px] font-bold theme-border"
                                                        style={on
                                                            ? { background: "var(--theme-text-contrast)", color: "var(--theme-bg)" }
                                                            : { color: "var(--theme-text)" }}
                                                    >
                                                        {d}
                                                    </button>
                                                )
                                            })}
                                        </div>
                                    </div>
                                )}

                                {/* End condition */}
                                <div className="flex flex-col gap-1.5">
                                    <span className="text-[11px] font-semibold tracking-wider theme-subtext-color">ENDS</span>
                                    <div className="flex items-center gap-2 flex-wrap">
                                        <button
                                            type="button"
                                            onClick={() => { setEndMode("count"); setJustAdded(false) }}
                                            className="rounded-lg border px-3 py-1.5 text-[13px] font-medium theme-border"
                                            style={endMode === "count"
                                                ? { background: "var(--theme-text-contrast)", color: "var(--theme-bg)" }
                                                : { color: "var(--theme-text)" }}
                                        >
                                            After
                                        </button>
                                        <input
                                            type="number"
                                            min={1}
                                            max={REPEAT_LIMIT}
                                            value={count}
                                            disabled={endMode !== "count"}
                                            onChange={(e) => {
                                                const n = Number(e.target.value)
                                                setCount(Number.isFinite(n) ? Math.min(Math.max(Math.floor(n), 1), REPEAT_LIMIT) : 1)
                                                setJustAdded(false)
                                            }}
                                            className="w-16 rounded-lg border px-2.5 py-1.5 text-[13px] font-mono theme-text outline-none disabled:opacity-40"
                                            style={fieldStyle}
                                        />
                                        <span className="text-[13px] theme-subtext-color mr-1">times</span>

                                        <button
                                            type="button"
                                            onClick={() => { setEndMode("date"); setJustAdded(false) }}
                                            className="rounded-lg border px-3 py-1.5 text-[13px] font-medium theme-border"
                                            style={endMode === "date"
                                                ? { background: "var(--theme-text-contrast)", color: "var(--theme-bg)" }
                                                : { color: "var(--theme-text)" }}
                                        >
                                            On
                                        </button>
                                        <div className={`w-32 ${endMode === "date" ? "" : "opacity-40 pointer-events-none"}`}>
                                            <CalendarField
                                                value={untilKey}
                                                onChange={(k) => { setUntilKey(k); setJustAdded(false) }}
                                                dotted={scheduledSet}
                                                minKey={dateKey}
                                                compact
                                            />
                                        </div>
                                    </div>
                                </div>

                                {/* Preview */}
                                <p className="text-[12px] theme-subtext-color">
                                    {occurrences.length === 0 ? (
                                        <span className="text-red-500">No dates match this pattern</span>
                                    ) : (
                                        <>
                                            Creates <span className="font-mono font-bold theme-text-contrast">{occurrences.length}</span>
                                            {" "}separate {occurrences.length === 1 ? "meeting" : "meetings"}
                                            {occurrences.length > 1 && <> · {formatShortDate(occurrences[0])} – {formatShortDate(occurrences[occurrences.length - 1])}</>}
                                            {atRepeatLimit && <> · capped at {REPEAT_LIMIT}</>}
                                        </>
                                    )}
                                </p>
                            </div>
                        )}
                    </div>
                )}

                <div className="flex items-center justify-between gap-3">
                    {timeRangeInvalid ? (
                        <p className="text-sm text-red-500">End must be after start</p>
                    ) : (
                        <p className="text-sm theme-text">
                            Total <span className="font-mono font-bold theme-text-contrast">{total.h}h {String(total.m).padStart(2, "0")}m</span>
                            {occurrences.length > 1 && <span className="theme-subtext-color"> each</span>}
                        </p>
                    )}

                    <div className="flex items-center gap-2 ml-auto">
                        {mode === "edit" && (
                            <button
                                type="button"
                                onClick={resetForm}
                                className="rounded-lg border px-4 py-2.5 text-sm font-medium theme-text theme-border hover:opacity-80"
                            >
                                Cancel
                            </button>
                        )}
                        <button
                            onClick={() => void handleSubmit()}
                            disabled={formDisabled}
                            className="flex items-center gap-2 rounded-lg px-5 py-2.5 text-sm font-semibold transition-opacity hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed"
                            style={{ background: "var(--theme-text-contrast)", color: "var(--theme-bg)" }}
                        >
                            {mode === "edit" || justAdded ? <Check size={15} /> : <Plus size={15} />}
                            {mode === "edit"
                                ? (saving ? "Saving…" : "Save changes")
                                : saving
                                    ? (progress && progress.total > 1 ? `Adding ${progress.done}/${progress.total}…` : "Adding…")
                                    : justAdded ? "Added" : addLabel}
                        </button>
                    </div>
                </div>
            </div>

            {/* Scheduled meetings */}
            <div className="rounded-xl border p-5 flex flex-col gap-0.5 backdrop-blur-sm" style={cardStyle}>
                <div className="flex items-center justify-between mb-2">
                    <h3 className="font-bold theme-text">Scheduled meetings</h3>
                    <span className="font-mono text-[11px] font-bold tracking-wider theme-subtext-color">
                        {sortedMeetings.length} {sortedMeetings.length === 1 ? "MEETING" : "MEETINGS"}
                    </span>
                </div>

                {loading ? (
                    <p className="text-sm theme-subtext-color py-3">Loading…</p>
                ) : sortedMeetings.length === 0 ? (
                    <p className="text-sm theme-subtext-color py-3">No meetings scheduled yet.</p>
                ) : (
                    sortedMeetings.map((m) => {
                        const start = new Date(m.start_time)
                        const end = new Date(m.end_time)
                        const durMinutes = Math.round((end.getTime() - start.getTime()) / 60000)
                        return (
                            <div key={m.id} className="flex items-center gap-3.5 py-3 border-t first:border-t-0 theme-border">
                                <span className="font-mono text-[11px] font-bold theme-subtext-color w-8 shrink-0">
                                    {start.toLocaleDateString("en-US", { weekday: "short" }).toUpperCase()}
                                </span>
                                <div className="min-w-0 flex-1">
                                    <p className="text-sm font-semibold theme-text truncate">{m.meeting_purpose || "Untitled meeting"}</p>
                                    <p className="text-xs theme-subtext-color mt-0.5">
                                        {start.toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                                    </p>
                                </div>
                                <span className="font-mono text-sm font-semibold theme-text whitespace-nowrap">
                                    {formatMeetingRange(m.start_time, m.end_time, true)}
                                </span>
                                <span
                                    className="font-mono text-[11px] font-bold theme-text-contrast rounded-md px-1.5 py-0.5 whitespace-nowrap"
                                    style={{ background: "color-mix(in oklch, var(--theme-text-contrast) 15%, transparent)" }}
                                >
                                    {Math.floor(durMinutes / 60)}h {String(durMinutes % 60).padStart(2, "0")}m
                                </span>
                                <button
                                    onClick={() => handleEdit(m)}
                                    className="theme-subtext-color hover:opacity-100 opacity-70 p-1 shrink-0"
                                    title="Edit"
                                >
                                    <Pencil size={15} />
                                </button>
                                <button
                                    onClick={() => void handleDelete(m.id)}
                                    className="theme-subtext-color hover:opacity-100 opacity-70 p-1 shrink-0"
                                    title="Delete"
                                >
                                    <Trash2 size={15} />
                                </button>
                            </div>
                        )
                    })
                )}
            </div>
        </div>
    )
}
