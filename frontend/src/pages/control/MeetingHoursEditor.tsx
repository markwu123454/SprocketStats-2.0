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

/**
 * Admin editor for the `meeting_hours` table — schedule, edit, and delete
 * meetings. Rendered inside the Meeting control page's "Meeting Time" section
 * (gated there on `control_panel.meeting_time`; this component assumes the
 * caller already holds that capability, and the backend re-enforces it on
 * every request regardless).
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
    const [error, setError] = useState<string | null>(null)

    const [mode, setMode] = useState<"add" | "edit">("add")
    const [editingId, setEditingId] = useState<string | null>(null)
    const [description, setDescription] = useState("")
    const [dateKey, setDateKey] = useState(() => localDateKey(new Date()))
    const [startTime, setStartTime] = useState(DEFAULT_START)
    const [endTime, setEndTime] = useState(DEFAULT_END)
    const [justAdded, setJustAdded] = useState(false)

    const [calOpen, setCalOpen] = useState(false)
    const calTriggerRef = useRef<HTMLDivElement>(null)
    const [calPos, setCalPos] = useState<{ top: number, left: number } | null>(null)
    const [viewY, setViewY] = useState(() => new Date().getFullYear())
    const [viewM, setViewM] = useState(() => new Date().getMonth())

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

    // Keep the calendar view centered on the selected date whenever it changes.
    useEffect(() => {
        const d = dateKeyToDate(dateKey)
        setViewY(d.getFullYear())
        setViewM(d.getMonth())
    }, [dateKey])

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

    const resetForm = useCallback(() => {
        setMode("add")
        setEditingId(null)
        setDescription("")
        setDateKey(localDateKey(new Date()))
        setStartTime(DEFAULT_START)
        setEndTime(DEFAULT_END)
    }, [])

    const updateDescription = (v: string) => { setDescription(v); setJustAdded(false) }
    const selectDate = (key: string) => { setDateKey(key); setCalOpen(false); setJustAdded(false) }
    const updateStart = (v: string) => { setStartTime(v); setJustAdded(false) }
    const updateEnd = (v: string) => { setEndTime(v); setJustAdded(false) }

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

    const sortedMeetings = useMemo(
        () => [...meetings].sort((a, b) => new Date(a.start_time).getTime() - new Date(b.start_time).getTime()),
        [meetings],
    )

    const weeks = useMemo(() => buildWeeks(viewY, viewM), [viewY, viewM])
    const stepMonth = (delta: number) => {
        let m = viewM + delta, y = viewY
        if (m < 0) { m = 11; y-- }
        if (m > 11) { m = 0; y++ }
        setViewM(m); setViewY(y)
    }

    const total = useMemo(() => diffHoursMinutes(startTime, endTime), [startTime, endTime])
    const rawMinutes = useMemo(() => rawMinutesDiff(startTime, endTime), [startTime, endTime])
    const timeRangeInvalid = rawMinutes <= 0
    const formDisabled = !description.trim() || !dateKey || timeRangeInvalid || saving

    async function handleSubmit() {
        if (formDisabled) return
        setSaving(true)
        setError(null)
        try {
            const date = dateKeyToDate(dateKey)
            const body = {
                start_time: combineDateAndTime(date, startTime).toISOString(),
                end_time: combineDateAndTime(date, endTime).toISOString(),
                meeting_purpose: description.trim(),
            }
            const isEdit = mode === "edit"
            const res = await fetch(isEdit ? `${API}/meeting-hours/${editingId}` : `${API}/meeting-hours`, {
                method: isEdit ? "PUT" : "POST",
                credentials: "include",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(body),
            })
            if (!res.ok) throw new Error("save")
            await load()
            resetForm()
            if (!isEdit) {
                setJustAdded(true)
                setTimeout(() => setJustAdded(false), 1600)
            }
        } catch {
            setError(mode === "edit" ? "Failed to save changes" : "Failed to add meeting")
        } finally {
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
        setJustAdded(false)
        setCalOpen(false)
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
                <div className="relative" ref={calTriggerRef}>
                    <button
                        onClick={() => setCalOpen(o => !o)}
                        className="w-full flex items-center gap-2.5 rounded-lg border px-3.5 py-2.5 text-left"
                        style={fieldStyle}
                    >
                        <CalendarIcon size={16} className="theme-subtext-color shrink-0" />
                        <span className="text-sm theme-text truncate">{formatDateLabel(dateKey)}</span>
                        <ChevronDown size={14} className="theme-subtext-color shrink-0 ml-auto" />
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
                                                const isSel = key === dateKey
                                                return (
                                                    <button
                                                        key={di}
                                                        onClick={() => selectDate(key)}
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
                        document.body,
                    )}
                </div>

                {/* Start / end time wheels */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4">
                    <TimeWheel label="Start" value={startTime} onChange={updateStart} />
                    <TimeWheel label="End" value={endTime} onChange={updateEnd} />
                </div>

                <div className="flex items-center justify-center gap-1.5 -mt-1">
                    <ChevronsUpDown size={12} className="theme-subtext-color opacity-60" />
                    <span className="text-[11px] theme-subtext-color opacity-80">Drag to set · snaps to 5 min</span>
                </div>

                <div className="flex items-center justify-between gap-3">
                    {timeRangeInvalid ? (
                        <p className="text-sm text-red-500">End must be after start</p>
                    ) : (
                        <p className="text-sm theme-text">
                            Total <span className="font-mono font-bold theme-text-contrast">{total.h}h {String(total.m).padStart(2, "0")}m</span>
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
                                : (saving ? "Adding…" : justAdded ? "Added" : "Add meeting")}
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
