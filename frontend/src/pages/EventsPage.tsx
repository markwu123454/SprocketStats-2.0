import {ChevronRight} from "lucide-react"
import {Link} from "react-router-dom";

type EventStatus = "done" | "current" | "upcoming"

interface EventEntry {
    name: string
    start: string // ISO datetime
    end?: string  // ISO datetime; defaults to `start` for single-day events
    location: string
    type: string
    url?: string  // omit for no link
}

// Season schedule, in display order. Edit this list directly to update the
// schedule — order here is the order rendered, top to bottom.
const EVENTS: EventEntry[] = [
    {
        name: "FLL Competition (details TBD)",
        start: "2026-12-12",
        location: "Gym",
        type: "FLL",
        url: "/events/fll"
    },
    {name: "Kickoff", start: "2027-01-09T09:00", location: "Hwang's room", type: "Season Event"},
    {
        name: "Build Season – Week 1",
        start: "2027-01-11",
        end: "2027-01-17",
        location: "Woodshop",
        type: "Build Season"
    },
    {
        name: "FTC Competition (details TBD)",
        start: "2027-01-16",
        end: "2027-01-17",
        location: "Gym",
        type: "FTC",
        url: "/events/ftc"
    },
    {
        name: "Build Season – Week 2",
        start: "2027-01-18",
        end: "2027-01-24",
        location: "Woodshop",
        type: "Build Season"
    },
    {
        name: "Build Season – Week 3",
        start: "2027-01-25",
        end: "2027-01-31",
        location: "Woodshop",
        type: "Build Season"
    },
    {
        name: "Build Season – Week 4",
        start: "2027-02-01",
        end: "2027-02-07",
        location: "Woodshop",
        type: "Build Season"
    },
    {
        name: "Build Season – Week 5",
        start: "2027-02-08",
        end: "2027-02-14",
        location: "Woodshop",
        type: "Build Season"
    },
    {
        name: "Build Season – Week 6",
        start: "2027-02-15",
        end: "2027-02-19",
        location: "Woodshop",
        type: "Build Season"
    },
    {name: "Comp Season - Week 0", start: "2027-02-20", end: "2027-02-27", location: "TBD", type: "Competition Week"},
    {name: "Comp Season - Week 1", start: "2027-03-03", end: "2027-03-07", location: "TBD", type: "Competition Week"},
    {
        name: "Regional 1 (details TBD)",
        start: "2027-03-06T08:00",
        end: "2027-03-07T18:00",
        location: "Sacramento, CA",
        type: "Regional",
        url: "/events/week1"
    },
    {name: "Comp Season - Week 2", start: "2027-03-10", end: "2027-03-14", location: "TBD", type: "Competition Week"},
    {name: "Comp Season - Week 3", start: "2027-03-17", end: "2027-03-21", location: "TBD", type: "Competition Week"},
    {
        name: "Regional 2 (details TBD)",
        start: "2027-03-20T08:00",
        end: "2027-03-21T18:00",
        location: "Fresno, CA",
        type: "Regional",
        url: "/events/week3"
    },
    {name: "Comp Season - Week 4", start: "2027-03-24", end: "2027-03-28", location: "TBD", type: "Competition Week"},
    {name: "Comp Season - Week 5", start: "2027-03-31", end: "2027-04-04", location: "TBD", type: "Competition Week"},
    {
        name: "SoCal District Championship (details TBD)",
        start: "2027-04-07T08:00",
        end: "2027-04-11T18:00",
        location: "Anaheim Convention Center",
        type: "District Championship"
    },
    {name: "Comp Season - Week 7", start: "2027-04-14", end: "2027-04-18", location: "TBD", type: "Competition Week"},
    {
        name: "FIRST Championship",
        start: "2027-04-28T08:00",
        end: "2027-05-01T18:00",
        location: "Houston, TX",
        type: "Championship",
        url: "/events/worlds"
    },
]

const STATUS_META: Record<EventStatus, { label: string; dotFilled: boolean; color: string }> = {
    done: {label: "Completed", dotFilled: true, color: "var(--theme-subtext-color)"},
    current: {label: "Happening now", dotFilled: true, color: "var(--theme-text-contrast)"},
    upcoming: {label: "Upcoming", dotFilled: false, color: "var(--theme-subtext-color)"},
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]

const cardStyle = {background: "var(--theme-bg)", borderColor: "var(--theme-border)"}

interface ResolvedEvent extends EventEntry {
    dateLabel: string
    status: EventStatus
}

function resolveEvent(entry: EventEntry, now: Date): ResolvedEvent {
    const start = new Date(entry.start)
    const end = entry.end ? new Date(entry.end) : start

    let status: EventStatus
    if (now < start) status = "upcoming"
    else if (now <= end) status = "current"
    else status = "done"

    const startLabel = `${MONTHS[start.getMonth()]} ${start.getDate()}`
    let dateLabel: string
    if (start.toDateString() === end.toDateString()) dateLabel = startLabel
    else if (start.getMonth() === end.getMonth()) dateLabel = `${startLabel}–${end.getDate()}`
    else dateLabel = `${startLabel}–${MONTHS[end.getMonth()]} ${end.getDate()}`

    return {...entry, dateLabel, status}
}

export default function EventsPage() {
    const now = new Date()
    const events = EVENTS.map((entry) => resolveEvent(entry, now))

    return (
        <div className="mx-auto px-4 py-8 flex flex-col gap-1">
            <h1 className="text-2xl font-bold theme-h1-color">Events</h1>
            <p className="text-sm theme-subtext-color mb-6">Season schedule</p>

            <div className="flex flex-col">
                {events.map((event, i) => {
                    const meta = STATUS_META[event.status]
                    const isLast = i === events.length - 1
                    const cardClassName = `flex items-center gap-3 sm:gap-5 rounded-xl border backdrop-blur-sm p-3 sm:p-4 pl-4 sm:pl-5 transition-colors ${event.url ? "hover:border-(--theme-text-contrast)" : ""}`

                    const cardContent = (
                        <>
                            <div className="flex flex-col min-w-0 sm:min-w-[150px]">
                                <span className="text-[11px] font-bold tracking-wider truncate"
                                      style={{color: meta.color}}>
                                    {meta.label.toUpperCase()}
                                </span>
                                <span
                                    className="text-xs sm:text-sm theme-subtext-color mt-0.5">{event.dateLabel}</span>
                            </div>

                            <div className="flex-1 min-w-0">
                                <div
                                    className="text-sm sm:text-base font-bold theme-text truncate">{event.name}</div>
                                <div
                                    className="text-xs sm:text-sm theme-subtext-color truncate">{event.type} · {event.location}</div>
                            </div>

                            {/* Big "View" action — mobile collapses to a 44px circular tap target */}
                            {event.url && (
                                <div
                                    className="shrink-0 flex items-center justify-center gap-1 font-bold rounded-full sm:rounded-lg w-11 h-11 sm:w-auto sm:h-auto sm:px-4 sm:py-2.5"
                                    style={{background: "var(--theme-text-contrast)", color: "var(--theme-bg)"}}
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
                                {event.url ? (
                                    <Link to={event.url} className={cardClassName} style={cardStyle}>
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
