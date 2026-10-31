import {useEffect, useState} from "react"
import {ChevronRight, Pencil, Plus} from "lucide-react"
import {Link} from "react-router-dom";
import {
    type EventEntry, checkInOpensAt, formatCountdown, formatScheduleMoment, hasEventPage, hubKeyOf, isCheckInOpen, isHubOpen, resolveEvents, usesCheckIn,
    STATUS_META,
} from "@/lib/events.ts"
import {useBootstrapped} from "@/contexts/bootstrapContext"
import {useOnboardedUser} from "@/contexts/authContext"
import {can} from "@/lib/permissions"
import EventScheduleEditor from "@/components/events/EventScheduleEditor"
import EventEditSheet from "@/components/events/EventEditSheet"
import {confirmAnyDiscard} from "@/lib/useDiscardGuard"
import {useIsMobile} from "@/lib/useIsMobile"
import Button from "@/components/ui/Button"
import {focusRing, typeH1, typeH2} from "@/lib/uiClasses"

const API = import.meta.env.VITE_BACKEND_URL
const cardStyle = {background: "var(--theme-bg)", borderColor: "var(--theme-border)"}

// "View" button fill -- the accent for live/upcoming events, a muted mix of
// the accent and subtext for archived ones so they read as history.
const VIEW_BG_ACTIVE = "var(--theme-text-contrast)"
const VIEW_BG_ARCHIVED = "color-mix(in oklch, var(--theme-text-contrast) 35%, var(--theme-subtext-color))"

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

    const user = useOnboardedUser()
    const isEditor = can(user.permissions, "events.edit")
    const [editingId, setEditingId] = useState<number | null>(null)
    const [creating, setCreating] = useState(false)
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

return (
    <div className="mx-auto px-4 py-8 flex flex-col gap-1">
        <div className="flex items-start justify-between gap-3 mb-6">
            <div>
                <h1 className={`${typeH1} theme-h1-color`}>Events</h1>
                <p className="text-sm theme-subtext-color">Season schedule</p>
            </div>
            {isEditor && (
                <Button className="shrink-0" onClick={() => void confirmAnyDiscard().then(ok => { if (ok) { setEditingId(null); setCreating(true) } })}>
                    <Plus size={16}/>
                    New event
                </Button>
            )}
        </div>

        <div className="flex flex-col">
            {events.map((event, i) => {
                const meta = STATUS_META[event.status]
                const isLast = i === events.length - 1
                const archived = event.status === "done"
                // Every scheduled event has a hub (the backend creates it on
                // first visit), even when its row has no explicit url.
                const key = hubKeyOf(event)
                const hubUrl = event.url ?? (key ? `/events/${key}` : undefined)
                const link = hubUrl && isHubOpen(event, now) && hasEventPage(event) ? hubUrl : null
                const editable = isEditor && event.id !== undefined
                const editing = editable && editingId === event.id
                // Only worth a line while it's ahead of the event itself --
                // once an event is current, check-in being open is a given.
                const checkInNote = event.status === "upcoming" && event.checkinOpens && usesCheckIn(event)
                    ? (isCheckInOpen(event, now) ? "Check-in open" : `Check-in opens ${formatScheduleMoment(event.checkinOpens)}`)
                    : null
                const cardClassName = [
                    "flex items-center gap-3 sm:gap-5 rounded-xl border backdrop-blur-sm p-3 sm:p-4 pl-4 sm:pl-5 transition-[border-color,opacity]",
                    link ? "hover:border-(--theme-text-contrast)" : "",
                    archived ? "opacity-60 hover:opacity-90" : "",
                ].join(" ")

                const cardContent = (
                    <>
                        <div className="flex flex-col min-w-0 max-w-[45%] sm:max-w-none sm:min-w-[150px]">
                            <span className={`${typeH2} truncate`}
                                  style={{color: meta.color}}>
                                {meta.label.toUpperCase()}
                            </span>
                            <span
                                className="text-xs sm:text-sm theme-subtext-color mt-0.5">{event.dateLabel}</span>
                            {event.status === "upcoming" && (
                                <span
                                    className="text-xs font-semibold tabular-nums mt-0.5 sm:whitespace-nowrap"
                                    style={{color: "var(--theme-text-contrast)"}}
                                >
                                    in {formatCountdown(event.startsAt - now)}
                                </span>
                            )}
                            {checkInNote && (
                                <span
                                    className="text-xs mt-0.5 sm:whitespace-nowrap"
                                    style={{color: checkInOpensAt(event) <= now ? "var(--theme-text-contrast)" : "var(--theme-subtext-color)"}}
                                >
                                    {checkInNote}
                                </span>
                            )}
                        </div>

                        <div className="flex-1 min-w-0">
                            <div
                                className="text-sm sm:text-base font-bold theme-text truncate">{event.name}</div>
                            <div
                                className="text-xs sm:text-sm theme-subtext-color truncate">{event.type} · {event.location}</div>
                        </div>

                        {/* Big "View" action — mobile collapses to a 44px circular tap target */}
                            {link && (
                                <div
                                    className="shrink-0 flex items-center justify-center gap-1 font-bold rounded-full sm:rounded-lg w-11 h-11 sm:w-auto sm:h-auto sm:px-4 sm:py-2.5"
                                    style={{background: archived ? VIEW_BG_ARCHIVED : VIEW_BG_ACTIVE, color: "var(--theme-bg)"}}
                                >
                                    <span className="hidden sm:inline text-sm">View</span>
                                    <ChevronRight size={18}/>
                                </div>
                            )}
                        </>
                    )

                    return (
                        <div key={`${event.name}-${event.start}`} className="flex gap-3 sm:gap-5">
                            {/* Timeline rail */}
                            <div className="flex flex-col items-center w-4 sm:w-5 shrink-0">
                                <div
                                    className="w-3 h-3 sm:w-3.5 sm:h-3.5 rounded-full shrink-0 mt-5"
                                    style={{
                                        background: meta.dotFilled ? meta.color : "transparent",
                                        border: `2px solid ${meta.color}`,
                                    }}
                                />
                                {!isLast && <div className="w-0.5 flex-1" style={{background: "var(--theme-border)"}}/>}
                            </div>

                            {/* Event card -- the edit button sits beside it, not inside,
                                so it never triggers the card's own link. */}
                            <div className="flex-1 min-w-0 pb-6 flex flex-col gap-2">
                                <div className="flex items-stretch gap-2">
                                    <div className="flex-1 min-w-0">
                                        {link ? (
                                            <Link to={link} className={cardClassName} style={cardStyle}>
                                                {cardContent}
                                            </Link>
                                        ) : (
                                            <div className={cardClassName} style={cardStyle}>
                                                {cardContent}
                                            </div>
                                        )}
                                    </div>
                                    {editable && (
                                        <button
                                            type="button"
                                            aria-label={`Edit ${event.name}`}
                                            aria-expanded={editing}
                                            onClick={() => void confirmAnyDiscard().then(ok => { if (ok) setEditingId(editing ? null : event.id!) })}
                                            className={`shrink-0 w-11 flex items-center justify-center rounded-xl border opacity-60 hover:opacity-100 transition-opacity ${focusRing}`}
                                            style={cardStyle}
                                        >
                                            <Pencil size={15} className="theme-subtext-color"/>
                                        </button>
                                    )}
                                </div>
                                {editing && !isMobile && (
                                    <div className="rounded-xl border px-4 md:px-6 pt-4" style={cardStyle}>
                                        <EventScheduleEditor
                                            event={{...event, id: event.id!}}
                                            onSaved={applySaved}
                                            onCancel={() => setEditingId(null)}
                                            footerClassName="rounded-b-xl"
                                        />
                                    </div>
                                )}
                            </div>
                        </div>
                    )
                })}
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
