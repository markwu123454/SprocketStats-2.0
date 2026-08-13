export type EventStatus = "done" | "current" | "upcoming"

export interface EventEntry {
    name: string
    start: string // ISO datetime
    end?: string  // ISO datetime; defaults to `start` for single-day events
    location: string
    type: string
    url?: string    // omit for no link
    tbaKey?: string // TBA event key, e.g. "2026cass"
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

export function resolveEvents(events: EventEntry[], now: Date = new Date()): ResolvedEvent[] {
    return events.map((entry) => resolveEvent(entry, now))
}

// Looks up a schedule entry by its detail-page url (e.g. "/events/2026cass")
// so a dedicated event page can pull name/date/location/type from the DB-sourced list.
export function resolveEventByUrl(events: EventEntry[], url: string, now: Date = new Date()): ResolvedEvent | undefined {
    const entry = events.find((e) => e.url === url)
    return entry ? resolveEvent(entry, now) : undefined
}
