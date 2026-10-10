import type { ItineraryItem } from "@/lib/eventApi"

/**
 * Pure helpers for the event-content editors (ItineraryPage / PackingPage).
 * Everything here is string-based rather than `Date`-based on purpose: `dt`
 * is a timezone-less local datetime ("YYYY-MM-DDTHH:MM:SS"), and slicing the
 * string is both correct and immune to the host's own timezone, unlike
 * `new Date(dt).getDate()` which silently reinterprets it as local time
 * (fine for display, but a trap for round-tripping back to the same string).
 */

// Backend field length limits (mirrored client-side so invalid input is
// caught before the round trip, not just after a 400).
export const MAX_SHORT_TEXT = 200   // label / category / heading
export const MAX_PACKING_ITEM = 100 // one packing-list item
export const MAX_LONG_TEXT = 2000   // detail / body

/** One itinerary row being edited: `time` is "HH:MM", not yet combined with the day. */
export interface ItineraryRowDraft {
    time: string
    label: string
    detail: string
}

export interface DayGroup {
    day: string
    items: ItineraryItem[]
}

/** Local "YYYY-MM-DD" slice of a no-suffix local datetime string. */
export function dayKey(dt: string): string {
    return dt.slice(0, 10)
}

/** Local "HH:MM" slice of a no-suffix local datetime string. */
export function timeOf(dt: string): string {
    return dt.slice(11, 16)
}

/** Combine a "YYYY-MM-DD" day and an "HH:MM" time into the backend's
 *  no-suffix local datetime format. */
export function buildDt(day: string, time: string): string {
    return `${day}T${time}:00`
}

/** Stable chronological sort — safe because fixed-width "YYYY-MM-DDTHH:MM:SS"
 *  strings compare lexicographically in the same order as time. `Array#sort`
 *  is spec-guaranteed stable, so items that share a `dt` keep their relative
 *  order instead of shuffling. */
export function sortItinerary(items: ItineraryItem[]): ItineraryItem[] {
    return [...items].sort((a, b) => (a.dt < b.dt ? -1 : a.dt > b.dt ? 1 : 0))
}

/** Group a sorted-or-not itinerary into ordered per-day buckets. */
export function groupItineraryByDay(items: ItineraryItem[]): DayGroup[] {
    const sorted = sortItinerary(items)
    const groups: DayGroup[] = []
    for (const item of sorted) {
        const day = dayKey(item.dt)
        const last = groups[groups.length - 1]
        if (last && last.day === day) last.items.push(item)
        else groups.push({ day, items: [item] })
    }
    return groups
}

/** Return the full itinerary with one day's items replaced wholesale —
 *  passing an empty `newItems` removes the day entirely. Every other day's
 *  items pass through untouched, and the result is re-sorted. This is the
 *  one write path for all three day operations (edit / add / delete); the
 *  caller decides which by what it passes for `day` and `newItems`. */
export function replaceDay(all: ItineraryItem[], day: string, newItems: ItineraryItem[]): ItineraryItem[] {
    const others = all.filter(item => dayKey(item.dt) !== day)
    return sortItinerary([...others, ...newItems])
}

/** Trim and drop blank strings — used for packing-list items, where a
 *  leftover blank row from "Add item" should just disappear rather than
 *  being treated as a validation error. */
export function cleanStrings(items: string[]): string[] {
    return items.map(item => item.trim()).filter(item => item.length > 0)
}

function isBlank(s: string): boolean {
    return s.trim().length === 0
}

/** Validate one itinerary day's draft rows before building `ItineraryItem[]`
 *  and saving. Mirrors the backend: non-blank trimmed label, dt-friendly
 *  time, and the 200/2000 length caps. Returns a human-readable message, or
 *  `null` if the day is good to save. */
export function validateItineraryDay(day: string, rows: ItineraryRowDraft[]): string | null {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return "Pick a date for this day."
    if (rows.length === 0) return "Add at least one item, or delete the day instead."
    for (const row of rows) {
        if (!row.time) return "Set a time for every item."
        if (isBlank(row.label)) return "Every item needs a label."
        if (row.label.trim().length > MAX_SHORT_TEXT) return `Labels can't be longer than ${MAX_SHORT_TEXT} characters.`
        if (row.detail.trim().length > MAX_LONG_TEXT) return `Details can't be longer than ${MAX_LONG_TEXT} characters.`
    }
    return null
}

/** Validate one packing category's draft (name + items) against the other
 *  categories' names for the case-insensitive duplicate check. Blank item
 *  rows are not an error — `cleanStrings` is expected to drop them before
 *  saving — but at least one non-blank item must remain. */
export function validatePackingCategory(category: string, items: string[], otherCategories: string[]): string | null {
    if (isBlank(category)) return "Give this category a name."
    const name = category.trim()
    if (name.length > MAX_SHORT_TEXT) return `Category names can't be longer than ${MAX_SHORT_TEXT} characters.`
    if (otherCategories.some(other => other.trim().toLowerCase() === name.toLowerCase())) {
        return "Another category already has this name."
    }
    const nonBlank = cleanStrings(items)
    if (nonBlank.length === 0) return "Add at least one item, or delete the category instead."
    for (const item of nonBlank) {
        if (item.length > MAX_PACKING_ITEM) return `Items can't be longer than ${MAX_PACKING_ITEM} characters.`
    }
    return null
}

/** Validate one instruction block's draft (heading + body). */
export function validateInstruction(heading: string, body: string): string | null {
    if (isBlank(heading)) return "Give this instruction a heading."
    if (heading.trim().length > MAX_SHORT_TEXT) return `Headings can't be longer than ${MAX_SHORT_TEXT} characters.`
    if (isBlank(body)) return "Add some body text, or delete the instruction instead."
    if (body.trim().length > MAX_LONG_TEXT) return `Body text can't be longer than ${MAX_LONG_TEXT} characters.`
    return null
}

/** Format a Date using LOCAL getters into the same no-suffix shape as `dt`
 *  ("YYYY-MM-DDTHH:MM:SS"), so it can be compared against itinerary `dt`
 *  strings lexicographically (== chronologically) without any UTC detour
 *  (unlike `toISOString`, which is UTC and would shift the clock). */
function localDtString(d: Date): string {
    const pad = (n: number, len = 2) => String(n).padStart(len, "0")
    return `${pad(d.getFullYear(), 4)}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}

/** Index of the itinerary item that is currently "happening" right now —
 *  the latest item whose `dt` is at or before `now`, as long as that item's
 *  local day is today. An item that's merely the most recently started one
 *  from a day that's already over isn't "current"; it's just old. Returns
 *  -1 when nothing qualifies: nothing has started yet, or the latest
 *  started item was on an earlier day than today. Items don't need to be
 *  sorted — this scans `items` in its own order and returns an index into
 *  it as given. Ties at the same `dt` resolve to the last matching index,
 *  matching how a backend that appends same-time rows would order them. */
export function currentItineraryIndex(items: ItineraryItem[], now: Date): number {
    const nowStr = localDtString(now)
    const today = dayKey(nowStr)

    let bestIndex = -1
    let bestDt = ""
    for (let i = 0; i < items.length; i++) {
        const dt = items[i].dt
        if (dt > nowStr) continue
        if (dt >= bestDt) {
            bestDt = dt
            bestIndex = i
        }
    }

    if (bestIndex === -1 || dayKey(bestDt) !== today) return -1
    return bestIndex
}

/** Decide what to show the user after a failed save/delete. `apiFetch` (in
 *  `lib/eventApi.ts`) throws an `Error` carrying a `.status` for any non-2xx
 *  response, with `.message` set to the backend's own `detail` when one was
 *  sent. A 4xx is the backend telling us something about *our* request (bad
 *  input, a conflict, etc.) worth showing verbatim; a 5xx, a missing
 *  `.status` (a thrown value that isn't from `apiFetch` at all), or a plain
 *  network failure ("Failed to fetch") is not something the user can act on,
 *  so those fall back to a fixed message that states the situation and the
 *  fix instead of leaking "HTTP 500" onto the screen. */
export function saveErrorMessage(e: unknown, fallback: string): string {
    const status = e != null && typeof e === "object" && "status" in e ? (e as { status?: unknown }).status : undefined
    if (typeof status === "number" && status >= 400 && status < 500 && e instanceof Error) {
        return e.message
    }
    return fallback
}
