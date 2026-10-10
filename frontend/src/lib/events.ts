import type { RosterMember } from "@/lib/eventApi"

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
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]

// `new Date("2026-10-09")` (date-only, no time) is parsed as UTC midnight,
// while `new Date("2027-01-09T09:00")` (has a time) is parsed as local time.
// Reading either back with local getters (getMonth/getDate) then shows the
// date-only ones a day early in any timezone behind UTC. Force date-only
// strings to be parsed as local time so both forms round-trip consistently.
function parseEventDate(value: string): Date {
    return /^\d{4}-\d{2}-\d{2}$/.test(value) ? new Date(`${value}T00:00`) : new Date(value)
}

// A date-only `end` (or an omitted `end`, which defaults to `start`) has to
// count through the END of that local day -- otherwise the last day of a
// multi-day event (and the whole of a single-day date-only event) reads as
// "done" the instant local midnight passes, instead of staying "current"
// until the day is actually over. An `end` with an explicit time is taken
// exactly as given -- no bump.
function parseEventEndDate(value: string): Date {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return new Date(value)
    const d = new Date(`${value}T00:00`)
    d.setHours(23, 59, 59, 999)
    return d
}

export function resolveEvent(entry: EventEntry, now: Date): ResolvedEvent {
    const start = parseEventDate(entry.start)
    const end = parseEventEndDate(entry.end ?? entry.start)

    let status: EventStatus
    if (now < start) status = "upcoming"
    else if (now <= end) status = "current"
    else status = "done"

    // `end`'s time-of-day was bumped above, but its date (year/month/day) is
    // untouched, so these label computations are unaffected by the fix.
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

// Picks the one event to show on the dashboard's active-event card: among
// everything currently happening, a TBA-linked event (it has a hub page with
// check-in/matches) wins over one that's merely on the schedule, since that's
// the only kind of "current" event the card can actually act on.
export function pickActiveEvent(events: EventEntry[], now: Date = new Date()): ResolvedEvent | null {
    const current = resolveEvents(events, now).filter((e) => e.status === "current")
    if (current.length === 0) return null
    return current.find((e) => e.tbaKey) ?? current[0]
}

function toLocalDateString(d: Date): string {
    const y = d.getFullYear()
    const m = String(d.getMonth() + 1).padStart(2, "0")
    const day = String(d.getDate()).padStart(2, "0")
    return `${y}-${m}-${day}`
}

// The check-in form's day picker and the roster's per-day columns both need
// the event's own list of calendar days -- local "YYYY-MM-DD" strings from
// `start` through `end` inclusive (end defaults to start, same as
// `resolveEvent`). `start`/`end` may be date-only or datetimes; only the
// calendar date matters here, so `parseEventDate` (not the end-of-day
// variant) is enough -- we only ever read its Y/M/D, never its time. Capped
// at 31 days defensively (matches the backend's own check-in day limit).
export function eventDays(entry: EventEntry): string[] {
    const start = parseEventDate(entry.start)
    const end = parseEventDate(entry.end ?? entry.start)
    const cursor = new Date(start.getFullYear(), start.getMonth(), start.getDate())
    const last = new Date(end.getFullYear(), end.getMonth(), end.getDate())

    const days: string[] = []
    while (cursor <= last && days.length < 31) {
        days.push(toLocalDateString(cursor))
        cursor.setDate(cursor.getDate() + 1)
    }
    return days
}

// Label for a single local "YYYY-MM-DD" day, e.g. "2026-03-19" -> "Thu, Mar 19".
// Builds the Date from the string's own parts with the local constructor
// (never `new Date(str)`) so it can't read back a day early/late in any
// timezone behind UTC.
export function eventDayLabel(day: string): string {
    const [y, m, d] = day.split("-").map(Number)
    const date = new Date(y, m - 1, d)
    return `${WEEKDAYS[date.getDay()]}, ${MONTHS[date.getMonth()]} ${date.getDate()}`
}

// RosterPage's fallback when there's no bootstrap schedule entry for the
// event to run `eventDays` on: the sorted, de-duplicated union of every day
// already present across the roster's own `days` arrays (members with a
// null `days` contribute nothing). Still empty when nobody has any days on
// file, which is the signal to render no day columns at all.
export function unionRosterDays(roster: RosterMember[]): string[] {
    const days = new Set<string>()
    for (const member of roster) {
        for (const day of member.days ?? []) days.add(day)
    }
    return [...days].sort()
}
