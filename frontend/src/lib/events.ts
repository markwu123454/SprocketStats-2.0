import type { RosterMember } from "@/lib/eventApi"

export type EventStatus = "done" | "current" | "upcoming"

// Hub tabs an event may hide (Overview never can). Mirrors HIDEABLE_TABS in
// backend/db/events.py.
export const HIDEABLE_TABS = ["itinerary", "packing", "roster", "comp", "tasks"] as const
export type HubTab = (typeof HIDEABLE_TABS)[number]

export interface EventEntry {
    id?: number   // `events` row id -- what the schedule PATCH addresses
    name: string
    start: string // ISO datetime
    end?: string  // ISO datetime; defaults to `start` for single-day events
    location: string
    type: string
    url?: string    // omit for no link
    tbaKey?: string // TBA event key, e.g. "2026cass"
    hubKey?: string // hub address: tbaKey, or "e<id>" for events without one
    checkinOpens?: string // omit to open check-in when the event starts
    hiddenTabs?: HubTab[]
}

export interface ResolvedEvent extends EventEntry {
    dateLabel: string
    status: EventStatus
    startsAt: number // epoch ms of `start`, parsed the same way as `status`
}

// How far ahead of an upcoming event its hub page (itinerary, packing,
// roster...) opens up from the events list. Done and current events are
// always openable -- done ones as a read-only archive.
export const HUB_LEAD_DAYS = 14
const DAY_MS = 24 * 60 * 60 * 1000

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

    return {...entry, dateLabel, status, startsAt: start.getTime()}
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

export function isHubOpen(event: ResolvedEvent, now: number = Date.now()): boolean {
    return event.status !== "upcoming" || event.startsAt - now <= HUB_LEAD_DAYS * DAY_MS || isCheckInOpen(event, now)
}

// Epoch ms when self check-in opens: the event's `checkinOpens` if set,
// otherwise its start (date-only values mean local midnight either way).
export function checkInOpensAt(entry: EventEntry): number {
    return parseEventDate(entry.checkinOpens ?? entry.start).getTime()
}

// Check-in is open from `checkInOpensAt` until the event is over.
export function isCheckInOpen(event: ResolvedEvent, now: number = Date.now()): boolean {
    return event.status !== "done" && now >= checkInOpensAt(event)
}

// The key an event's hub lives under (/events/<key>). Every scheduled event
// has one; `tbaKey` is the fallback for a schedule sent before hubKey existed.
export function hubKeyOf(entry: EventEntry): string | undefined {
    return entry.hubKey ?? entry.tbaKey
}

export function findByHubKey(events: EventEntry[], key: string | undefined): EventEntry | undefined {
    if (!key) return undefined
    return events.find((e) => hubKeyOf(e) === key || e.url === `/events/${key}`)
}

// Comp (matches, rankings) only exists for TBA events, so it's always hidden
// for one without a tbaKey, on top of whatever tabs an editor hid.
export function hiddenTabsOf(entry: EventEntry | undefined): HubTab[] {
    if (!entry) return []
    const hidden = entry.hiddenTabs ?? []
    return entry.tbaKey || hidden.includes("comp") ? hidden : [...hidden, "comp"]
}

export function isTabHidden(entry: EventEntry | undefined, tab: HubTab): boolean {
    return hiddenTabsOf(entry).includes(tab)
}

// "Mar 1" or "Mar 1, 6:00 PM" for a date-only / datetime schedule value.
export function formatScheduleMoment(value: string): string {
    const d = parseEventDate(value)
    const day = `${MONTHS[d.getMonth()]} ${d.getDate()}`
    if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return day
    return `${day}, ${d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}`
}

// Time left until `ms` elapses, e.g. "12d 04h 31m" -- or, inside the last
// day, "04h 31m 09s" so the final stretch visibly ticks.
export function formatCountdown(ms: number): string {
    const total = Math.max(0, Math.floor(ms / 1000))
    const days = Math.floor(total / 86400)
    const pad = (n: number) => String(n).padStart(2, "0")
    const h = pad(Math.floor(total / 3600) % 24)
    const m = pad(Math.floor(total / 60) % 60)
    if (days > 0) return `${days}d ${h}h ${m}m`
    return `${h}h ${m}m ${pad(total % 60)}s`
}

// Picks the one event to show on the dashboard's active-event card: anything
// currently happening, or upcoming with its check-in already open. Happening
// now beats check-in-only, and within each a TBA-linked event (it also has
// matches to show) wins over a non-competition one like outreach.
export function pickActiveEvent(events: EventEntry[], now: Date = new Date()): ResolvedEvent | null {
    const resolved = resolveEvents(events, now)
    const current = resolved.filter((e) => e.status === "current")
    const checkInOnly = resolved
        .filter((e) => e.status === "upcoming" && isCheckInOpen(e, now.getTime()))
        .sort((a, b) => a.startsAt - b.startsAt)
    for (const group of [current, checkInOnly]) {
        if (group.length > 0) return group.find((e) => e.tbaKey) ?? group[0]
    }
    return null
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
