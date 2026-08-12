export type EventStatus = "done" | "current" | "upcoming"

export interface EventEntry {
    name: string
    start: string // ISO datetime
    end?: string  // ISO datetime; defaults to `start` for single-day events
    location: string
    type: string
    url?: string  // omit for no link
}

export interface ResolvedEvent extends EventEntry {
    dateLabel: string
    status: EventStatus
}

// Shared status → label/color mapping. Used by EventsPage (the list) and
// EventDetailLayout (individual event pages) so both agree on what "done" /
// "current" / "upcoming" looks like.
export const STATUS_META: Record<EventStatus, { label: string; dotFilled: boolean; color: string }> = {
    done: {label: "Completed", dotFilled: true, color: "var(--theme-subtext-color)"},
    current: {label: "Happening now", dotFilled: true, color: "var(--theme-text-contrast)"},
    upcoming: {label: "Upcoming", dotFilled: false, color: "var(--theme-subtext-color)"},
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]

// Season schedule, in display order. Edit this list directly to update the
// schedule — order here is the order rendered, top to bottom.
export const EVENTS: EventEntry[] = [
    {
        name: "2026 Socal Showdown",
        start: "2026-10-09",
        end: "2026-10-11",
        location: "Da Vinci Schools",
        type: "Off-Season Event",
        url: "/events/2026cass"
    },
    /*{
        name: "FLL Competition (details TBD)",
        start: "2026-12-12",
        location: "Gym",
        type: "FLL",
        url: "/events/fll"
    },*/
    {name: "Kickoff", start: "2027-01-09T09:00", location: "Hwang's room", type: "Season Event"},
    {
        name: "Build Season – Week 1",
        start: "2027-01-11",
        end: "2027-01-17",
        location: "Woodshop",
        type: "Build Season"
    },
/*{
    name: "FTC Competition (details TBD)",
    start: "2027-01-16",
    end: "2027-01-17",
    location: "Gym",
    type: "FTC",
    url: "/events/ftc"
},*/
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
/*{
    name: "Regional 1 (details TBD)",
    start: "2027-03-06T08:00",
    end: "2027-03-07T18:00",
    location: "Sacramento, CA",
    type: "Regional",
    url: "/events/week1"
},*/
{name: "Comp Season - Week 2", start: "2027-03-10", end: "2027-03-14", location: "TBD", type: "Competition Week"},
{name: "Comp Season - Week 3", start: "2027-03-17", end: "2027-03-21", location: "TBD", type: "Competition Week"},
/*{
    name: "Regional 2 (details TBD)",
    start: "2027-03-20T08:00",
    end: "2027-03-21T18:00",
    location: "Fresno, CA",
    type: "Regional",
    url: "/events/week3"
},*/
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
    url: "/events/2027cmptx"
},
]

// `new Date("2026-10-09")` (date-only, no time) is parsed as UTC midnight,
// while `new Date("2027-01-09T09:00")` (has a time) is parsed as local time.
// Reading either back with local getters (getMonth/getDate) then shows the
// date-only ones a day early in any timezone behind UTC. Force date-only
// strings to be parsed as local time so both forms round-trip consistently.
function parseEventDate(value: string): Date {
    return /^\d{4}-\d{2}-\d{2}$/.test(value) ? new Date(`${value}T00:00`) : new Date(value)
}

export function resolveEvent(entry: EventEntry, now: Date): ResolvedEvent {
    const start = parseEventDate(entry.start)
    const end = entry.end ? parseEventDate(entry.end) : start

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

export function resolveEvents(now: Date = new Date()): ResolvedEvent[] {
    return EVENTS.map((entry) => resolveEvent(entry, now))
}

// Looks up a schedule entry by its detail-page url (e.g. "/events/2026cass")
// so a dedicated event page can pull name/date/location/type from the single
// EVENTS list instead of repeating them.
export function resolveEventByUrl(url: string, now: Date = new Date()): ResolvedEvent | undefined {
    const entry = EVENTS.find((e) => e.url === url)
    return entry ? resolveEvent(entry, now) : undefined
}
