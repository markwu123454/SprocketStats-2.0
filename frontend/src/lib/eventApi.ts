import type { EventEntry, HubTab } from "@/lib/events"

const API = import.meta.env.VITE_BACKEND_URL

export interface CompEventLinks {
    tba?: string | null
    statbotics?: string | null
    nexus?: string | null
    youtube?: string | null
    twitch?: string | null
}

export interface ItineraryItem {
    dt: string
    label: string
    detail: string | null
}

export interface PackingCategory {
    category: string
    items: string[]
}

export interface Instruction {
    heading: string
    body: string
}

export interface RosterMember {
    user_id: string | null
    display_name: string
    role: string
    phone: string | null
    // Sorted ascending; null for people on the roster from before this field
    // existed, or added by hand rather than through check-in.
    days: string[] | null
}

export interface TBAMatch {
    key: string
    comp_level: string
    set_number: number
    match_number: number
    alliances: {
        red: { team_keys: string[]; score: number }
        blue: { team_keys: string[]; score: number }
    }
    winning_alliance: string
    scheduled_time: number | null
    predicted_time: number | null
    actual_time: number | null
    post_result_time: number | null
}

export interface TBARankEntry {
    rank: number
    team_key: string
    matches_played: number
    record: { wins: number; losses: number; ties: number }
    sort_orders: number[]
}

export interface NexusData {
    status: { nowQueuing?: string; [key: string]: unknown } | null
    inspection: Record<string, { inspected?: boolean; [key: string]: unknown }> | null
}

export interface EventInfo {
    event_key: string
    event_name: string
    links: CompEventLinks | null
    itinerary: ItineraryItem[] | null
    packing_list: PackingCategory[] | null
    instructions: Instruction[] | null
    roster: RosterMember[] | null
    matches: TBAMatch[]
    rankings: { rankings: TBARankEntry[] } | null
    nexus: NexusData | null
}

export interface EventUpdate {
    matches: TBAMatch[]
    rankings: { rankings: TBARankEntry[] } | null
    nexus: NexusData | null
}

export interface CheckInStatus {
    checked_in: boolean
    /** The caller hid this event's check-in prompt. */
    dismissed: boolean
}

export interface CheckInResult {
    checked_in: true
    roster: RosterMember[]
}

export interface CheckInBody {
    role: string // a key from the event's checkinRoles
    phone: string | null
    days: string[]
}

export interface RosterMemberPatch {
    role?: string // a key from the event's checkinRoles
    days?: string[]
}

export interface RosterUpdateResult {
    roster: RosterMember[]
}

/** Body for `PATCH /events/schedule/{id}`. `end`/`checkin_opens` accept
 *  null to clear; values are "YYYY-MM-DD" or "YYYY-MM-DDTHH:MM". */
export interface EventSchedulePatch {
    name?: string
    location?: string
    type?: string
    start?: string
    end?: string | null
    checkin_opens?: string | null
    hidden_tabs?: HubTab[]
    /** Overview intro text; null or blank clears it. */
    description?: string | null
    checkin_enabled?: boolean
    /** Replaces the whole list. Keep a role's `key` to rename it; omit it for a new role. */
    checkin_roles?: { key?: string; label: string }[]
}

/** Body for `POST /events/schedule`. Values are "YYYY-MM-DD" or "YYYY-MM-DDTHH:MM". */
export interface EventCreateBody {
    name: string
    start: string
    end?: string | null
    location: string
    type: string
    checkin_opens?: string | null
    checkin_enabled?: boolean
}

export type EventContentPatch =Partial<Pick<EventInfo, "itinerary" | "packing_list" | "instructions">>

export type EventContent = Pick<
    EventInfo,
    "event_key" | "event_name" | "links" | "itinerary" | "packing_list" | "instructions" | "roster"
>

// FastAPI's own 422 (request validation failure, e.g. a bad phone number)
// sends `detail` as an ARRAY of error objects, not a string -- every other
// error path here (404, 403, app-raised 400s, ...) sends a plain string.
// Without this, an array `detail` stringifies to "[object Object]" wherever
// `.message` gets shown to the user.
interface ApiErrorBody {
    detail?: string | { msg?: string }[]
}

async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
    const res = await fetch(`${API}${path}`, {
        credentials: "include",
        headers: init?.body ? { "Content-Type": "application/json" } : undefined,
        ...init,
    })
    if (!res.ok) {
        const data = await res.json().catch(() => null) as ApiErrorBody | null
        const detail = data?.detail
        const message = Array.isArray(detail) ? detail[0]?.msg : detail
        throw Object.assign(new Error(message ?? `HTTP ${res.status}`), { status: res.status })
    }
    if (res.status === 204) return undefined as T
    return res.json() as Promise<T>
}

export function fetchEventInfo(eventKey: string) {
    return apiFetch<EventInfo>(`/events/${eventKey}/info`)
}

export function fetchEventUpdate(eventKey: string) {
    return apiFetch<EventUpdate>(`/events/${eventKey}/update`)
}

export function fetchCheckInStatus(eventKey: string): Promise<CheckInStatus> {
    return apiFetch<CheckInStatus>(`/events/${eventKey}/check-in`)
}

/** Hide (or, with `false`, bring back) this event's check-in prompt for the caller. */
export function setCheckInDismissed(eventKey: string, dismissed: boolean): Promise<{ dismissed: boolean }> {
    return apiFetch(`/events/${eventKey}/check-in/dismiss`, { method: dismissed ? "POST" : "DELETE" })
}

export function checkInToEvent(eventKey: string, body: CheckInBody): Promise<CheckInResult> {
    return apiFetch<CheckInResult>(`/events/${eventKey}/check-in`, { method: "POST", body: JSON.stringify(body) })
}

export function updateRosterMember(eventKey: string, userId: string, patch: RosterMemberPatch): Promise<RosterUpdateResult> {
    return apiFetch<RosterUpdateResult>(`/events/${eventKey}/roster/${userId}`, {
        method: "PATCH",
        body: JSON.stringify(patch),
    })
}

export function fetchEvents(): Promise<EventEntry[]> {
    return apiFetch<EventEntry[]>("/events")
}

export function patchEventSchedule(eventId: number, patch: EventSchedulePatch): Promise<EventEntry> {
    return apiFetch<EventEntry>(`/events/schedule/${eventId}`, { method: "PATCH", body: JSON.stringify(patch) })
}

export function patchEventContent(eventKey: string, patch: EventContentPatch): Promise<EventContent> {
    return apiFetch<EventContent>(`/events/${eventKey}/content`, { method: "PATCH", body: JSON.stringify(patch) })
}

export function createEvent(body: EventCreateBody): Promise<EventEntry> {
    return apiFetch<EventEntry>("/events/schedule", { method: "POST", body: JSON.stringify(body) })
}
