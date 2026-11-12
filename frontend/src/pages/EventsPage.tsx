import {useEffect, useState} from "react"
import {ChevronDown, ChevronUp, Pencil, Plus} from "lucide-react"
import {Link} from "react-router-dom";
import {
    type EventEntry, type ResolvedEvent, type TimelineItem,
    checkInOpensAt, dateBadgeOf, formatCountdown, formatScheduleMoment, formatShortCountdown, groupTimeline,
    hasEventPage, hubKeyOf, isCheckInOpen, isHubOpen, isTimelineDone, resolveEvents, timelineEvents, usesCheckIn,
} from "@/lib/events.ts"
import {useBootstrapped} from "@/contexts/bootstrapContext"
import {useOnboardedUser} from "@/contexts/authContext"
import {can} from "@/lib/permissions"
import EventScheduleEditor from "@/components/events/EventScheduleEditor"
import EventEditSheet from "@/components/events/EventEditSheet"
import {confirmAnyDiscard} from "@/lib/useDiscardGuard"
import {useIsMobile} from "@/lib/useIsMobile"
import Button from "@/components/ui/Button"
import {focusRing, typeH1} from "@/lib/uiClasses"

const API = import.meta.env.VITE_BACKEND_URL

const CARD_BG = "color-mix(in oklch, var(--theme-bg) 94%, transparent)"
const ACCENT = "var(--theme-text-contrast)"

// Where an event's card links: its hub, once that's open and has something on it.
function linkFor(event: ResolvedEvent, now: number): string | null {
    // Every scheduled event has a hub (the backend creates it on first visit),
    // even when its row has no explicit url.
    const key = hubKeyOf(event)
    const hubUrl = event.url ?? (key ? `/events/${key}` : undefined)
    return hubUrl && isHubOpen(event, now) && hasEventPage(event) ? hubUrl : null
}

// Only worth a line while it's ahead of the event itself -- once an event is
// current, check-in being open is a given.
function checkInNoteFor(event: ResolvedEvent, now: number): string | null {
    if (event.status !== "upcoming" || !event.checkinOpens || !usesCheckIn(event)) return null
    return isCheckInOpen(event, now) ? "Check-in open" : `Check-in opens ${formatScheduleMoment(event.checkinOpens)}`
}

function shortStatus(event: ResolvedEvent, now: number): string {
    if (event.status === "current") return "Now"
    if (event.status === "done") return "Done"
    return formatShortCountdown(event.startsAt - now)
}

export default function EventsPage() {
    const [rawEvents, setRawEvents] = useBootstrapped<EventEntry[]>("events", [])

    useEffect(() => {
        let cancelled = false
        fetch(`${API}/events`, {credentials: "include"})
            .then(r => r.ok ? r.json() : [])
            .then((data: EventEntry[]) => { if (!cancelled) setRawEvents(data) })
            .catch(() => {})
        return () => { cancelled = true }
    }, [setRawEvents])

    // Drives the countdowns, and re-resolves statuses so an event flips from
    // upcoming -> current -> done (and its hub opens) without a reload.
    const [now, setNow] = useState(() => Date.now())
    useEffect(() => {
        const id = setInterval(() => setNow(Date.now()), 1000)
        return () => clearInterval(id)
    }, [])

    // Date order -- the server sends it this way too, but a date edited here
    // has to move its card without a reload.
    const events = resolveEvents(rawEvents, new Date(now)).sort((a, b) => a.startsAt - b.startsAt)
    const items = groupTimeline(events)
    const doneItems = items.filter(isTimelineDone)
    const liveItems = items.filter(i => !isTimelineDone(i))
    // The hero card: an event happening right now beats a season block that
    // merely spans today; otherwise the first thing not yet over.
    const featuredItem = liveItems.find(i => i.kind === "single" && i.event.status === "current") ?? liveItems[0]

    const user = useOnboardedUser()
    const isEditor = can(user.permissions, "events.edit")
    const [editingId, setEditingId] = useState<number | null>(null)
    const [creating, setCreating] = useState(false)
    const [showCompleted, setShowCompleted] = useState(false)
    // Series the user collapsed; open by default so every week is visible.
    const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set())
    const isMobile = useIsMobile()
    // Phones edit in a bottom sheet; wider screens expand the card inline.
    const editingEvent = isMobile && editingId !== null ? events.find(e => e.id === editingId) : undefined

    function applyCreated(created: EventEntry) {
        setRawEvents(prev => [...prev, created])
        setCreating(false)
    }

    function applySaved(updated: EventEntry) {
        setRawEvents(prev => prev.map(e => e.id === updated.id ? updated : e))
        setEditingId(null)
    }

    function toggleEdit(id: number) {
        void confirmAnyDiscard().then(ok => { if (ok) setEditingId(editingId === id ? null : id) })
    }

    function toggleSeries(key: string) {
        setCollapsed(prev => {
            const next = new Set(prev)
            if (next.has(key)) next.delete(key)
            else next.add(key)
            return next
        })
    }

    const editProps = (event: ResolvedEvent) => isEditor && event.id !== undefined
        ? {editing: editingId === event.id, onEdit: () => toggleEdit(event.id!)}
        : undefined

    function renderItem(item: TimelineItem, featured: boolean) {
        const all = timelineEvents(item)
        const first = all[0]
        const last = all[all.length - 1]
        const archived = isTimelineDone(item)
        // Desktop edits inline, under whichever card holds the event.
        const inlineEditing = !isMobile && editingId !== null ? all.find(e => e.id === editingId) : undefined
        const key = item.kind === "single" ? `${first.name}-${first.start}` : item.key

        return (
            <div key={key} className={`relative flex gap-3 sm:gap-4 items-start ${archived ? "opacity-60 hover:opacity-90 transition-opacity" : ""}`}>
                <DateBadge start={first.start} end={item.kind === "single" ? first.end : last.end ?? last.start} filled={featured}/>
                <div className="flex-1 min-w-0 flex flex-col gap-2">
                    {item.kind === "single" ? (
                        <SingleCard event={first} featured={featured} now={now} edit={editProps(first)}/>
                    ) : (
                        <SeriesCard
                            item={item}
                            featured={featured}
                            now={now}
                            open={!collapsed.has(item.key)}
                            onToggle={() => toggleSeries(item.key)}
                            editFor={editProps}
                        />
                    )}
                    {inlineEditing && (
                        <div className="rounded-xl border theme-border px-4 md:px-6 pt-4" style={{background: "var(--theme-bg)"}}>
                            <EventScheduleEditor
                                event={{...inlineEditing, id: inlineEditing.id!}}
                                onSaved={applySaved}
                                onCancel={() => setEditingId(null)}
                                footerClassName="rounded-b-xl"
                            />
                        </div>
                    )}
                </div>
            </div>
        )
    }

    const shown = showCompleted ? [...doneItems, ...liveItems] : liveItems

    return (
        <div className="mx-auto w-full max-w-[960px] px-4 py-8 flex flex-col">
            <div className="flex items-end justify-between gap-3 mb-6 sm:mb-7">
                <div>
                    <h1 className={`${typeH1} sm:text-[32px] theme-h1-color`}>Events</h1>
                    <p className="text-sm sm:text-base theme-subtext-color">Season schedule</p>
                </div>
                {isEditor && (
                    <Button className="shrink-0" onClick={() => void confirmAnyDiscard().then(ok => { if (ok) { setEditingId(null); setCreating(true) } })}>
                        <Plus size={16}/>
                        New event
                    </Button>
                )}
            </div>

            {doneItems.length > 0 && (
                <button
                    type="button"
                    aria-expanded={showCompleted}
                    onClick={() => setShowCompleted(v => !v)}
                    className={`flex items-center gap-3 px-4 py-2.5 mb-5 sm:mb-6 rounded-xl border theme-border text-sm theme-subtext-color text-left ${focusRing}`}
                    style={{background: "color-mix(in oklch, var(--theme-bg) 85%, transparent)"}}
                >
                    <span className="font-semibold shrink-0">Completed ({doneItems.length})</span>
                    <span className="min-w-0 truncate hidden sm:inline">
                        {doneItems.map(i => i.kind === "single" ? i.event.name : i.base).join(" · ")}
                    </span>
                    <span className="ml-auto shrink-0 flex items-center gap-1 font-semibold" style={{color: ACCENT}}>
                        {showCompleted ? "Hide" : "Show"}
                        {showCompleted ? <ChevronUp size={16}/> : <ChevronDown size={16}/>}
                    </span>
                </button>
            )}

            <div className="relative flex flex-col gap-3.5">
                {/* Rail through the centre of the date badges */}
                {shown.length > 1 && (
                    <div aria-hidden className="absolute top-5 bottom-5 w-0.5 left-[23px] sm:left-[35px]" style={{background: "var(--theme-border)"}}/>
                )}
                {shown.map(item => renderItem(item, item === featuredItem))}
            </div>

            {creating && (
                <EventEditSheet title="New event" onClose={() => setCreating(false)}>
                    <EventScheduleEditor onSaved={applyCreated} onCancel={() => setCreating(false)}/>
                </EventEditSheet>
            )}
            {editingEvent && (
                <EventEditSheet title="Edit event" onClose={() => setEditingId(null)}>
                    <EventScheduleEditor
                        event={{...editingEvent, id: editingEvent.id!}}
                        onSaved={applySaved}
                        onCancel={() => setEditingId(null)}
                    />
                </EventEditSheet>
            )}
        </div>
    )
}

function DateBadge({start, end, filled}: {start: string, end?: string, filled: boolean}) {
    const {month, days, range} = dateBadgeOf(start, end)
    return (
        <div
            className={`relative w-12 sm:w-[72px] shrink-0 text-center rounded-[14px] py-2 ${filled ? "" : "border theme-outline"}`}
            style={filled ? {background: ACCENT, color: "var(--theme-bg)"} : {background: "var(--theme-bg)"}}
        >
            <div
                className={`font-bold whitespace-nowrap ${month.length > 3 ? "text-[9px] sm:text-[11px] tracking-normal" : "text-[11px] tracking-[.1em]"}`}
                style={filled ? undefined : {color: "var(--theme-subtext-color)"}}
            >
                {month}
            </div>
            <div
                className={`font-extrabold tabular-nums whitespace-nowrap ${range ? "text-[15px] sm:text-[22px] leading-[1.1]" : "text-[22px] sm:text-[28px] leading-none"}`}
                style={filled ? undefined : {color: ACCENT}}
            >
                {days}
            </div>
        </div>
    )
}

interface EditControl { editing: boolean, onEdit: () => void }

function EditButton({name, edit}: {name: string, edit: EditControl}) {
    return (
        <button
            type="button"
            aria-label={`Edit ${name}`}
            aria-expanded={edit.editing}
            onClick={edit.onEdit}
            className={`relative z-10 shrink-0 -my-2 -mr-2 w-11 h-11 flex items-center justify-center rounded-lg theme-subtext-color opacity-70 hover:opacity-100 transition-opacity ${focusRing}`}
        >
            <Pencil size={15}/>
        </button>
    )
}

// A full-bleed link under the content, so the card is one big tap target while
// the edit button (z-10, above it) still gets its own clicks.
function CardLink({to, label}: {to: string, label: string}) {
    return <Link to={to} aria-label={label} className={`absolute inset-0 z-0 rounded-[inherit] ${focusRing}`}/>
}

function SingleCard({event, featured, now, edit}: {
    event: ResolvedEvent, featured: boolean, now: number, edit?: EditControl,
}) {
    const link = linkFor(event, now)
    const checkInNote = checkInNoteFor(event, now)
    const checkInColor = checkInOpensAt(event) <= now ? ACCENT : "var(--theme-subtext-color)"
    const sub = [event.type, event.location].filter(Boolean).join(" · ")

    if (featured) {
        const label = event.status === "current" ? "Happening now" : "Next up"
        return (
            <div
                className={`relative rounded-[18px] border theme-outline backdrop-blur-sm p-4 sm:px-6 sm:py-5 flex items-start sm:items-center gap-3 sm:gap-6 transition-colors ${link ? "hover:border-(--theme-text-contrast)" : ""}`}
                style={{background: CARD_BG}}
            >
                {link && <CardLink to={link} label={`Open ${event.name}`}/>}
                <div className="relative pointer-events-none flex-1 min-w-0 flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-6">
                    <div className="flex-1 min-w-0">
                        <div className="text-[11px] font-bold tracking-[.12em] uppercase" style={{color: ACCENT}}>{label}</div>
                        <div className="text-xl sm:text-2xl font-bold theme-h1-color my-0.5 break-words">{event.name}</div>
                        {sub && <div className="text-sm sm:text-base theme-subtext-color">{sub}</div>}
                    </div>
                    <div className="sm:text-right shrink-0">
                        <div className="text-lg sm:text-[22px] font-bold tabular-nums" style={{color: ACCENT}}>
                            {event.status === "upcoming" ? formatCountdown(event.startsAt - now) : event.dateLabel}
                        </div>
                        {checkInNote
                            ? <div className="text-[13px]" style={{color: checkInColor}}>{checkInNote}</div>
                            : event.status === "current" && isCheckInOpen(event, now) && <div className="text-[13px]" style={{color: ACCENT}}>Check-in open</div>}
                    </div>
                </div>
                {edit && <EditButton name={event.name} edit={edit}/>}
            </div>
        )
    }

    return (
        <div
            className={`relative rounded-[18px] border theme-border backdrop-blur-sm px-4 py-3.5 sm:px-6 sm:py-4 flex items-start sm:items-center gap-3 sm:gap-6 transition-colors ${link ? "hover:border-(--theme-text-contrast)" : ""}`}
            style={{background: CARD_BG}}
        >
            {link && <CardLink to={link} label={`Open ${event.name}`}/>}
            <div className="relative pointer-events-none flex-1 min-w-0">
                <div className="text-base sm:text-[19px] font-bold theme-h1-color break-words sm:truncate">{event.name}</div>
                {sub && <div className="text-sm theme-subtext-color sm:truncate">{sub}</div>}
                {/* Phones: status under the name, so long names get the full width */}
                <div className="sm:hidden text-sm font-semibold tabular-nums mt-0.5" style={{color: event.status === "done" ? "var(--theme-subtext-color)" : ACCENT}}>
                    {shortStatus(event, now)}
                    {checkInNote && <span className="font-normal" style={{color: checkInColor}}> · {checkInNote}</span>}
                </div>
            </div>
            <div className="relative pointer-events-none shrink-0 text-right hidden sm:block">
                <div className="text-sm font-semibold tabular-nums" style={{color: event.status === "done" ? "var(--theme-subtext-color)" : ACCENT}}>
                    {shortStatus(event, now)}
                </div>
                {checkInNote && <div className="text-xs" style={{color: checkInColor}}>{checkInNote}</div>}
            </div>
            {edit && <EditButton name={event.name} edit={edit}/>}
        </div>
    )
}

function SeriesCard({item, featured, now, open, onToggle, editFor}: {
    item: Extract<TimelineItem, {kind: "series"}>
    featured: boolean
    now: number
    open: boolean
    onToggle: () => void
    editFor: (event: ResolvedEvent) => EditControl | undefined
}) {
    const first = item.events[0]
    const last = item.events[item.events.length - 1]
    const span = `${first.dateLabel.split("–")[0]} – ${resolveLabelEnd(last)}`
    const live = item.events.some(e => e.status === "current")
    const n = item.events.length

    return (
        <div className={`rounded-[18px] border backdrop-blur-sm overflow-hidden ${featured ? "theme-outline" : "theme-border"}`} style={{background: CARD_BG}}>
            <button
                type="button"
                aria-expanded={open}
                onClick={onToggle}
                className={`w-full flex items-center gap-3 sm:gap-6 px-4 py-3.5 sm:px-6 sm:py-4 text-left ${focusRing}`}
            >
                <div className="flex-1 min-w-0">
                    {featured && (
                        <div className="text-[11px] font-bold tracking-[.12em] uppercase" style={{color: ACCENT}}>
                            {live ? "Happening now" : "Next up"}
                        </div>
                    )}
                    <div className="text-base sm:text-[19px] font-bold theme-h1-color sm:truncate">{item.label}</div>
                    <div className="text-sm theme-subtext-color sm:truncate">{[item.location, span].filter(Boolean).join(" · ")}</div>
                </div>
                <span className="shrink-0 flex items-center gap-1 text-sm font-semibold" style={{color: ACCENT}}>
                    {open ? "Hide" : "Show"}
                    {open ? <ChevronUp size={16}/> : <ChevronDown size={16}/>}
                </span>
            </button>
            {open && (
                <div className="flex flex-col border-t theme-border">
                    {item.events.map((event, i) => (
                        <SeriesRow key={`${event.name}-${event.start}`} event={event} now={now} isLast={i === n - 1} edit={editFor(event)}/>
                    ))}
                </div>
            )}
        </div>
    )
}

// "Feb 21" -- the last calendar day of an event, for a series' date span.
function resolveLabelEnd(event: ResolvedEvent): string {
    const parts = event.dateLabel.split("–")
    if (parts.length === 1) return parts[0]
    const tail = parts[1]
    // "Jan 11–17" -> tail "17" shares the start month; "Jan 30–Feb 2" has its own.
    return /^\d+$/.test(tail) ? `${parts[0].split(" ")[0]} ${tail}` : tail
}

function SeriesRow({event, now, isLast, edit}: {event: ResolvedEvent, now: number, isLast: boolean, edit?: EditControl}) {
    const link = linkFor(event, now)
    const week = /week\s*(\d+)$/i.exec(event.name)?.[1]
    const status = shortStatus(event, now)
    return (
        <div
            className={`relative flex items-center gap-2 sm:gap-4 pl-3 pr-2 sm:px-6 py-3 ${isLast ? "" : "border-b theme-border"} ${event.status === "done" ? "opacity-60" : ""} ${link ? "hover:bg-[color-mix(in_oklch,var(--theme-text-contrast)_6%,transparent)]" : ""}`}
        >
            {link && <CardLink to={link} label={`Open ${event.name}`}/>}
            <div className="relative pointer-events-none sm:w-[90px] shrink-0 text-sm sm:text-base font-semibold theme-h1-color">{week ? `Week ${week}` : event.name}</div>
            <div className="relative pointer-events-none flex-1 min-w-0 truncate text-[13px] sm:text-base theme-subtext-color">{event.dateLabel}</div>
            <div className="relative pointer-events-none shrink-0 text-sm font-semibold tabular-nums" style={{color: event.status === "done" ? "var(--theme-subtext-color)" : ACCENT}}>
                {status}
            </div>
            {edit && <EditButton name={event.name} edit={edit}/>}
        </div>
    )
}

