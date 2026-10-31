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
import Dropdown from "@/components/ui/Dropdown"
import Checkbox from "@/components/ui/Checkbox"
import Button from "@/components/ui/Button"
import FormFooter from "@/components/ui/FormFooter"
import Notice from "@/components/ui/Notice"
import Skeleton from "@/components/ui/Skeleton"
import EmptyState from "@/components/ui/EmptyState"
import { isDirtyVs, useDiscardGuard } from "@/lib/useDiscardGuard"
import { focusRing, inputClass, typeBadge, typeH2, typeTitle } from "@/lib/uiClasses"

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

/** Dropdown trigger styled as a form field (same box as inputClass; Dropdown supplies the focus ring). */
const DROPDOWN_TRIGGER = "rounded-lg border px-3 py-2.5 min-h-11 text-base md:text-sm transition theme-bg theme-outline theme-text"

type Repeat = "none" | "daily" | "weekly" | "biweekly"

const REPEAT_OPTIONS: { value: Repeat, label: string, days: number }[] = [
    { value: "none", label: "Does not repeat", days: 0 },
    { value: "daily", label: "Every day", days: 1 },
    { value: "weekly", label: "Every week", days: 7 },
    { value: "biweekly", label: "Every 2 weeks", days: 14 },
]

const MAX_OCCURRENCES = 200

/** Local-time occurrences from `first` through `untilKey` (inclusive), stepping by whole calendar days so DST doesn't shift the clock time. */
function expandOccurrences(first: Date, untilKey: string, stepDays: number): Date[] {
    const until = dateKeyToDate(untilKey)
    const out: Date[] = []
    for (let d = new Date(first); d <= until && out.length <= MAX_OCCURRENCES; d = new Date(d.getFullYear(), d.getMonth(), d.getDate() + stepDays)) {
        out.push(d)
    }
    return out
}

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

    const [mode, setMode] = useState<"add" | "edit" | "bulk">("add")
    const [selected, setSelected] = useState<Set<string>>(() => new Set())
    const [editingId, setEditingId] = useState<string | null>(null)
    const [description, setDescription] = useState("")
    const [dateKey, setDateKey] = useState(() => localDateKey(new Date()))
    const [startTime, setStartTime] = useState(DEFAULT_START)
    const [endTime, setEndTime] = useState(DEFAULT_END)
    const [justAdded, setJustAdded] = useState(false)
    const [repeat, setRepeat] = useState<Repeat>("none")
    const [repeatUntil, setRepeatUntil] = useState(() => localDateKey(new Date()))

    // The values the form opened with (set wherever the form is reset or loaded with a meeting); dirty = anything differs.
    const [baseline, setBaseline] = useState(() => ({
        description: "", dateKey: localDateKey(new Date()), startTime: DEFAULT_START, endTime: DEFAULT_END, repeat: "none" as Repeat,
    }))
    const confirmDiscard = useDiscardGuard(isDirtyVs({ description, dateKey, startTime, endTime, repeat }, baseline))

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
            setError("Couldn't load meetings")
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
        setRepeat("none")
        setSelected(new Set())
        setBaseline({ description: "", dateKey: localDateKey(new Date()), startTime: DEFAULT_START, endTime: DEFAULT_END, repeat: "none" })
    }, [])

    const updateDescription = (v: string) => { setDescription(v); setJustAdded(false) }
    const selectDate = (key: string) => {
        setDateKey(key); setCalOpen(false); setJustAdded(false)
        setRepeatUntil(prev => prev < key ? key : prev)
    }
    const updateStart = (v: string) => { setStartTime(v); setJustAdded(false) }
    const updateEnd = (v: string) => { setEndTime(v); setJustAdded(false) }

    // Dates that already have a meeting get a dot on the calendar — but not the
    // meeting currently being edited, whose original date shouldn't look stale.
    const scheduledSet = useMemo(() => {
        const s = new Set<string>()
        for (const m of meetings) {
            if (m.id === editingId || (mode === "bulk" && selected.has(m.id))) continue
            s.add(localDateKey(new Date(m.start_time)))
        }
        return s
    }, [meetings, editingId, mode, selected])

    const sortedMeetings = useMemo(
        () => [...meetings].sort((a, b) => new Date(b.start_time).getTime() - new Date(a.start_time).getTime()),
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
    const stepDays = REPEAT_OPTIONS.find(o => o.value === repeat)?.days ?? 0
    const isRecurring = mode === "add" && repeat !== "none"
    const occurrences = useMemo(
        () => isRecurring && dateKey ? expandOccurrences(dateKeyToDate(dateKey), repeatUntil, stepDays) : [],
        [isRecurring, dateKey, repeatUntil, stepDays],
    )
    const repeatInvalid = isRecurring && (occurrences.length === 0 || occurrences.length > MAX_OCCURRENCES)
    const formDisabled = !description.trim() || (mode !== "bulk" && !dateKey) || timeRangeInvalid || repeatInvalid || saving

    async function handleSubmit() {
        if (formDisabled) return
        setSaving(true)
        setError(null)
        try {
            if (mode === "bulk") {
                const targets = meetings.filter(m => selected.has(m.id))
                const results = await Promise.all(targets.map(m => {
                    const day = new Date(m.start_time)
                    return fetch(`${API}/meeting-hours/${m.id}`, {
                        method: "PUT",
                        credentials: "include",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({
                            start_time: combineDateAndTime(day, startTime).toISOString(),
                            end_time: combineDateAndTime(day, endTime).toISOString(),
                            meeting_purpose: description.trim(),
                        }),
                    })
                }))
                await load()
                if (results.some(r => !r.ok)) throw new Error("save")
                resetForm()
                return
            }
            const date = dateKeyToDate(dateKey)
            const isEdit = mode === "edit"
            const body = isRecurring
                ? {
                    slots: occurrences.map(d => ({
                        start_time: combineDateAndTime(d, startTime).toISOString(),
                        end_time: combineDateAndTime(d, endTime).toISOString(),
                    })),
                    meeting_purpose: description.trim(),
                }
                : {
                    start_time: combineDateAndTime(date, startTime).toISOString(),
                    end_time: combineDateAndTime(date, endTime).toISOString(),
                    meeting_purpose: description.trim(),
                }
            const url = isEdit ? `${API}/meeting-hours/${editingId}` : `${API}/meeting-hours${isRecurring ? "/batch" : ""}`
            const res = await fetch(url, {
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
            setError(mode !== "add" ? "Couldn't save changes" : "Couldn't add meeting")
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
        setBaseline({ description: row.meeting_purpose ?? "", dateKey: localDateKey(start), startTime: toHHMM(start), endTime: toHHMM(end), repeat })
        setJustAdded(false)
        setCalOpen(false)
    }

    function toggleSelected(id: string) {
        setSelected(prev => {
            const next = new Set(prev)
            if (next.has(id)) next.delete(id); else next.add(id)
            return next
        })
    }

    function toggleAll() {
        setSelected(prev => prev.size === sortedMeetings.length ? new Set() : new Set(sortedMeetings.map(m => m.id)))
    }

    function handleEditSelected() {
        const picked = sortedMeetings.filter(m => selected.has(m.id))
        if (picked.length === 0) return
        if (picked.length === 1) { handleEdit(picked[0]); return }
        const first = picked[0]
        setMode("bulk")
        setEditingId(null)
        setDescription(first.meeting_purpose ?? "")
        setStartTime(toHHMM(new Date(first.start_time)))
        setEndTime(toHHMM(new Date(first.end_time)))
        setBaseline({ description: first.meeting_purpose ?? "", dateKey, startTime: toHHMM(new Date(first.start_time)), endTime: toHHMM(new Date(first.end_time)), repeat })
        setJustAdded(false)
        setCalOpen(false)
    }

    async function handleDeleteSelected() {
        setError(null)
        try {
            const results = await Promise.all([...selected].map(id =>
                fetch(`${API}/meeting-hours/${id}`, { method: "DELETE", credentials: "include" })))
            if (mode !== "add") resetForm()
            setSelected(new Set())
            await load()
            if (results.some(r => !r.ok)) throw new Error("delete")
        } catch {
            setError("Couldn't delete some meetings")
        }
    }

    async function handleDelete(id: string) {
        setError(null)
        try {
            const res = await fetch(`${API}/meeting-hours/${id}`, { method: "DELETE", credentials: "include" })
            if (!res.ok) throw new Error("delete")
            if (editingId === id) resetForm()
            setSelected(prev => { const n = new Set(prev); n.delete(id); return n })
            await load()
        } catch {
            setError("Couldn't delete meeting")
        }
    }

    return (
        <div className="flex flex-col gap-4">
            {error && <Notice>{error}</Notice>}

            {/* Schedule / edit a meeting */}
            <div className="rounded-xl border p-6 flex flex-col gap-4 backdrop-blur-sm theme-bg theme-border">
                <div>
                    <p className={`${typeH2} theme-subtext-color`}>
                        {mode === "bulk" ? "EDIT MEETINGS" : mode === "edit" ? "EDIT MEETING" : "SCHEDULE A MEETING"}
                    </p>
                    <h3 className={`${typeTitle} theme-h1-color`}>
                        {mode === "bulk" ? `Edit ${selected.size} meetings` : mode === "edit" ? "Edit meeting hours" : "Add meeting hours"}
                    </h3>
                </div>

                <input
                    type="text"
                    value={description}
                    onChange={(e) => updateDescription(e.target.value)}
                    placeholder="Short description — e.g. Board sync, Sprint planning"
                    maxLength={128}
                    aria-label="Meeting description"
                    className={`w-full ${inputClass}`}
                />

                {/* Date picker (inline calendar) */}
                {mode === "bulk" ? (
                    <p className="text-xs theme-subtext-color -mt-1">
                        Each meeting keeps its own date — the description and times below are applied to all {selected.size} selected.
                    </p>
                ) : (
                <div className="relative" ref={calTriggerRef}>
                    <button
                        onClick={() => setCalOpen(o => !o)}
                        className={`w-full flex items-center gap-2.5 text-left ${inputClass}`}
                    >
                        <CalendarIcon size={16} className="theme-subtext-color shrink-0" />
                        <span className="theme-text truncate">{formatDateLabel(dateKey)}</span>
                        <ChevronDown size={14} className="theme-subtext-color shrink-0 ml-auto" />
                    </button>

                    {calOpen && calPos && createPortal(
                        <>
                            <div className="fixed inset-0 z-40" onClick={() => setCalOpen(false)} />
                            <div
                                className="fixed z-40 -translate-x-1/2 rounded-xl border p-3 w-max shadow-lg theme-bg theme-border"
                                style={{ top: calPos.top, left: calPos.left }}
                            >
                                <div className="flex items-center justify-between mb-2.5">
                                    <button onClick={() => stepMonth(-1)} aria-label="Previous month" className={`w-11 h-11 rounded-lg border flex items-center justify-center theme-text theme-border ${focusRing}`}>
                                        <ChevronLeft size={14} />
                                    </button>
                                    <span className="text-sm font-semibold theme-h1-color">{MONTHS[viewM]} {viewY}</span>
                                    <button onClick={() => stepMonth(1)} aria-label="Next month" className={`w-11 h-11 rounded-lg border flex items-center justify-center theme-text theme-border ${focusRing}`}>
                                        <ChevronRight size={14} />
                                    </button>
                                </div>
                                <div className="grid grid-cols-7 gap-[3px] mb-1">
                                    {DOW.map((d, i) => (
                                        <div key={i} className="h-[22px] flex items-center justify-center font-mono text-xs theme-subtext-color">{d}</div>
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
                                                        className={`w-[38px] h-[38px] rounded-lg font-mono text-sm flex items-center justify-center relative cursor-pointer ${focusRing}`}
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
                )}

                {/* Recurrence (new meetings only) */}
                {mode === "add" && (
                    <div className="flex flex-col sm:flex-row gap-3">
                        <Dropdown
                            value={repeat}
                            onChange={(v) => { setRepeat(v as Repeat); setJustAdded(false) }}
                            options={REPEAT_OPTIONS.map(o => ({ value: o.value, label: o.label }))}
                            className="flex-1"
                            triggerClassName={DROPDOWN_TRIGGER}
                        />
                        {repeat !== "none" && (
                            <label className={`flex-1 flex items-center gap-2 focus-within:ring-2 focus-within:ring-[var(--theme-text-contrast)] ${inputClass}`}>
                                <span className="theme-subtext-color shrink-0">Until</span>
                                <input
                                    type="date"
                                    value={repeatUntil}
                                    min={dateKey}
                                    onChange={(e) => { setRepeatUntil(e.target.value); setJustAdded(false) }}
                                    className="flex-1 bg-transparent outline-none theme-text min-w-0 text-base md:text-sm"
                                />
                            </label>
                        )}
                    </div>
                )}

                {/* Start / end time wheels */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4">
                    <TimeWheel label="Start" value={startTime} onChange={updateStart} />
                    <TimeWheel label="End" value={endTime} onChange={updateEnd} />
                </div>

                <div className="flex items-center justify-center gap-1.5 -mt-1">
                    <ChevronsUpDown size={14} className="theme-subtext-color opacity-60" />
                    <span className="text-xs theme-subtext-color opacity-80">Drag to set · snaps to 5 min</span>
                </div>

                <FormFooter className="-mx-6 -mb-6 rounded-b-xl">
                    {timeRangeInvalid ? (
                        <p className="text-sm theme-danger">End must be after start</p>
                    ) : repeatInvalid ? (
                        <p className="text-sm theme-danger">
                            {occurrences.length === 0 ? "Pick an end date on or after the start" : `Too many meetings (max ${MAX_OCCURRENCES})`}
                        </p>
                    ) : (
                        <p className="text-sm theme-text">
                            Total <span className="font-mono font-bold theme-text-contrast">{total.h}h {String(total.m).padStart(2, "0")}m</span>
                            {isRecurring && <span className="theme-subtext-color"> · {occurrences.length} meetings</span>}
                        </p>
                    )}

                    <div className="flex items-center gap-2 ml-auto">
                        {mode !== "add" && (
                            <Button variant="outlined" size="footer" onClick={() => void confirmDiscard().then(ok => { if (ok) resetForm() })}>
                                Cancel
                            </Button>
                        )}
                        <Button size="footer" onClick={() => void handleSubmit()} disabled={formDisabled}>
                            {mode !== "add" || justAdded ? <Check size={16} /> : <Plus size={16} />}
                            {mode !== "add"
                                ? (saving ? "Saving…" : "Save changes")
                                : (saving ? "Adding…" : justAdded ? "Added" : isRecurring ? "Add meetings" : "Add meeting")}
                        </Button>
                    </div>
                </FormFooter>
            </div>

            {/* Scheduled meetings */}
            <div className="rounded-xl border p-5 flex flex-col gap-0.5 backdrop-blur-sm theme-bg theme-border">
                <div className="flex items-center justify-between mb-2">
                    <h3 className={`${typeTitle} theme-h1-color`}>Scheduled meetings</h3>
                    <span className={`${typeBadge} theme-subtext-color`}>
                        {sortedMeetings.length} {sortedMeetings.length === 1 ? "MEETING" : "MEETINGS"}
                    </span>
                </div>

                {sortedMeetings.length > 0 && (
                    <div className="flex items-center gap-3.5 pb-2 text-xs theme-subtext-color">
                        <Checkbox
                            aria-label="Select all meetings"
                            checked={selected.size === sortedMeetings.length}
                            indeterminate={selected.size > 0 && selected.size < sortedMeetings.length}
                            onChange={toggleAll}
                        />
                        {selected.size === 0 ? (
                            <span>Select meetings to edit together</span>
                        ) : (
                            <>
                                <span className="font-semibold theme-text">{selected.size} selected</span>
                                <button onClick={handleEditSelected} className={`flex items-center gap-1 min-h-11 rounded-lg font-semibold theme-text-contrast hover:opacity-80 ${focusRing}`}>
                                    <Pencil size={14} /> Edit
                                </button>
                                <button onClick={() => void handleDeleteSelected()} className={`flex items-center gap-1 min-h-11 rounded-lg font-semibold hover:opacity-80 theme-text ${focusRing}`}>
                                    <Trash2 size={14} /> Delete
                                </button>
                                <button onClick={() => setSelected(new Set())} className={`ml-auto min-h-11 rounded-lg hover:opacity-80 ${focusRing}`}>Clear</button>
                            </>
                        )}
                    </div>
                )}

                {loading ? (
                    <div className="flex flex-col gap-3 py-3" role="status" aria-label="Loading meetings">
                        {Array.from({ length: 3 }, (_, i) => <Skeleton key={i} className="h-10 w-full" />)}
                    </div>
                ) : sortedMeetings.length === 0 ? (
                    <EmptyState>No meetings scheduled yet.</EmptyState>
                ) : (
                    sortedMeetings.map((m) => {
                        const start = new Date(m.start_time)
                        const end = new Date(m.end_time)
                        const durMinutes = Math.round((end.getTime() - start.getTime()) / 60000)
                        return (
                            <div key={m.id} className="flex flex-wrap md:flex-nowrap items-center gap-x-3.5 gap-y-1 py-3 border-t first:border-t-0 theme-border">
                                {/* Below md: line 1 = checkbox, weekday, purpose + date, edit/delete; line 2 = time and duration,
                                    indented under the text (16px checkbox + 14px gap + 32px weekday + 14px gap). */}
                                <div className="order-1 flex items-center gap-3.5 min-w-0 flex-1">
                                    <Checkbox
                                        aria-label="Select meeting"
                                        checked={selected.has(m.id)}
                                        onChange={() => toggleSelected(m.id)}
                                    />
                                    <span className={`${typeBadge} theme-subtext-color w-8 shrink-0`}>
                                        {start.toLocaleDateString("en-US", { weekday: "short" }).toUpperCase()}
                                    </span>
                                    <div className="min-w-0 flex-1">
                                        <p className="text-sm font-semibold theme-text truncate">{m.meeting_purpose || "Untitled meeting"}</p>
                                        <p className="text-xs theme-subtext-color mt-0.5 truncate">
                                            {start.toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                                        </p>
                                    </div>
                                </div>
                                <div className="order-3 md:order-2 w-full md:w-auto pl-[76px] md:pl-0 min-w-0 flex flex-wrap md:flex-nowrap items-center gap-x-3 gap-y-1">
                                    <span className="font-mono text-sm font-semibold theme-text whitespace-nowrap">
                                        {formatMeetingRange(m.start_time, m.end_time, true)}
                                    </span>
                                    <span
                                        className="font-mono text-xs font-bold theme-text-contrast rounded-full px-2 py-0.5 whitespace-nowrap"
                                        style={{ background: "color-mix(in oklch, var(--theme-text-contrast) 15%, transparent)" }}
                                    >
                                        {Math.floor(durMinutes / 60)}h {String(durMinutes % 60).padStart(2, "0")}m
                                    </span>
                                </div>
                                <div className="order-2 md:order-3 flex items-center shrink-0">
                                    <Button
                                        variant="icon"
                                        onClick={() => handleEdit(m)}
                                        className="shrink-0"
                                        title="Edit"
                                        aria-label="Edit meeting"
                                    >
                                        <Pencil size={16} />
                                    </Button>
                                    <Button
                                        variant="icon"
                                        onClick={() => void handleDelete(m.id)}
                                        className="shrink-0"
                                        title="Delete"
                                        aria-label="Delete meeting"
                                    >
                                        <Trash2 size={16} />
                                    </Button>
                                </div>
                            </div>
                        )
                    })
                )}
            </div>
        </div>
    )
}
