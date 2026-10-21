import {useEffect, useState} from "react"
import {ChevronRight} from "lucide-react"
import {Link} from "react-router-dom";
import {type EventEntry, formatCountdown, isHubOpen, resolveEvents, STATUS_META} from "@/lib/events.ts"
import {useBootstrapped} from "@/contexts/bootstrapContext"

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

    const events = resolveEvents(rawEvents, new Date(now))

return (
    <div className="mx-auto px-4 py-8 flex flex-col gap-1">
        <h1 className="text-2xl font-bold theme-h1-color">Events</h1>
        <p className="text-sm theme-subtext-color mb-6">Season schedule</p>

        <div className="flex flex-col">
            {events.map((event, i) => {
                const meta = STATUS_META[event.status]
                const isLast = i === events.length - 1
                const archived = event.status === "done"
                const link = event.url && isHubOpen(event, now) ? event.url : null
                const cardClassName = [
                    "flex items-center gap-3 sm:gap-5 rounded-xl border backdrop-blur-sm p-3 sm:p-4 pl-4 sm:pl-5 transition-[border-color,opacity]",
                    link ? "hover:border-(--theme-text-contrast)" : "",
                    archived ? "opacity-60 hover:opacity-90" : "",
                ].join(" ")

                const cardContent = (
                    <>
                        <div className="flex flex-col min-w-0 sm:min-w-[150px]">
                            <span className="text-[11px] font-bold tracking-wider truncate"
                                  style={{color: meta.color}}>
                                {meta.label.toUpperCase()}
                            </span>
                            <span
                                className="text-xs sm:text-sm theme-subtext-color mt-0.5">{event.dateLabel}</span>
                            {event.status === "upcoming" && (
                                <span
                                    className="text-xs font-semibold tabular-nums mt-0.5 whitespace-nowrap"
                                    style={{color: "var(--theme-text-contrast)"}}
                                >
                                    in {formatCountdown(event.startsAt - now)}
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

                            {/* Event card */}
                            <div className="flex-1 min-w-0 pb-6">
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
                        </div>
                    )
                })}
            </div>
        </div>
    )
}
