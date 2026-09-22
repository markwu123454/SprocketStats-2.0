import type { Person, Task, TaskPriority, TaskStatus } from "@/lib/tasksApi"

// The one hardcoded color on this page: High priority / destructive actions.
// The theme has no "danger" token (see .design-sync/conventions.md); the
// design mockup's own reds (#f87171/#fca5a5) are tuned for the dark teal
// season and fail contrast on the light 2026 cream, so every "danger" use
// in the mockup is routed through this instead (see SPEC "Colors").
export const DANGER_RED = "#dc2626"
// A handful of hover accents below use "#dc2626"/"rgba(248,113,113,0.12)"
// as literal strings inside Tailwind arbitrary-value classes (e.g.
// `hover:text-[#dc2626]`) rather than interpolating DANGER_RED — Tailwind's
// class scanner only sees literal text in source, not runtime template
// values, so the class name has to be spelled out. Keep them in sync by hand.

/** `color-mix(in oklch, var(--token) pct%, transparent)` — the design's own
 *  tint helper, used anywhere a themed color needs partial opacity without
 *  touching the token itself. */
export function tint(token: string, pct: number): string {
    return `color-mix(in oklch, var(${token}) ${pct}%, transparent)`
}

/** Same idea as {@link tint}, but for a literal color (e.g. a fixed accent
 *  hex) instead of a theme token. */
export function tintColor(color: string, pct: number): string {
    return `color-mix(in oklch, ${color} ${pct}%, transparent)`
}

export const PRIORITY_ORDER: TaskPriority[] = ["high", "med", "low"]
// Priority stripe / label colors. Medium and low are fixed pastel accents
// (SPEC "Colors": "deliberate, theme-independent accents") — kept literal in
// every season. High is folded into DANGER_RED rather than the mockup's own
// #f87171 ("one red, not two").
export const PRIORITY_COLOR: Record<TaskPriority, string> = { high: DANGER_RED, med: "#f5d547", low: "#45908d" }

// Sort order for rows *within* an area card: open work first, then whatever
// needs a look, done last. Distinct from the old cycling order (which never
// included "done" — a bare PATCH can't reach it) since this is pure display
// sorting, not a set of reachable states.
export const STATUS_SORT_ORDER: TaskStatus[] = ["todo", "doing", "review", "done"]
export type SettableStatus = Exclude<TaskStatus, "done">

// The 5 avatar background pastels + the fixed dark-ink initial color, picked
// by `name.charCodeAt(0) % 5` (mirrors the mockup's `avBg`). These are fixed
// swatches independent of season, so the initial glyph has to stay dark in
// every theme -- including the light 2026 cream -- which is why this is the
// one place a literal near-black hex is intentional outside DANGER_RED.
export const AVATAR_COLORS = ["#f5d547", "#9ad4c4", "#c4b5fd", "#fca5a5", "#93c5fd"]
export const AVATAR_INK = "#082626"
export function avatarBg(name: string): string {
    if (!name) return AVATAR_COLORS[0]
    return AVATAR_COLORS[name.charCodeAt(0) % AVATAR_COLORS.length]
}
export function initialOf(name: string | null | undefined): string {
    return name && name.length > 0 ? name.charAt(0).toUpperCase() : "?"
}

export const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]

/** `due_date` is a bare "YYYY-MM-DD" — parse as local midnight so it never
 *  reads a day early west of UTC (same fix as `resolveEvent` in lib/events.ts). */
export function formatDue(dateStr: string | null): string {
    if (!dateStr) return "No due date"
    const d = new Date(`${dateStr}T00:00`)
    return `Due ${MONTHS[d.getMonth()]} ${d.getDate()}`
}

/** "just now" / "5m ago" / "2h ago" / "3d ago", falling back to a short date
 *  ("Mar 4") past a week — used for note timestamps. */
export function formatRelativeTime(iso: string): string {
    const minutes = Math.floor((Date.now() - new Date(iso).getTime()) / 60000)
    if (minutes < 1) return "just now"
    if (minutes < 60) return `${minutes}m ago`
    const hours = Math.floor(minutes / 60)
    if (hours < 24) return `${hours}h ago`
    const days = Math.floor(hours / 24)
    if (days < 7) return `${days}d ago`
    const d = new Date(iso)
    return `${MONTHS[d.getMonth()]} ${d.getDate()}`
}

export function startOfTodayMs(): number {
    const d = new Date()
    d.setHours(0, 0, 0, 0)
    return d.getTime()
}

export function isOverdue(task: Task, todayMs: number): boolean {
    if (task.status === "done" || !task.due_date) return false
    return new Date(`${task.due_date}T00:00`).getTime() < todayMs
}

/** Due text + color for a row: "Overdue · Sep 21" in danger red, else the
 *  plain "Due Sep 21" (or "No due date") in subtext. */
export function rowDue(task: Task, todayMs: number): { text: string; color: string } {
    if (isOverdue(task, todayMs)) {
        const d = new Date(`${task.due_date}T00:00`)
        return { text: `Overdue · ${MONTHS[d.getMonth()]} ${d.getDate()}`, color: DANGER_RED }
    }
    return { text: formatDue(task.due_date), color: "var(--theme-subtext-color)" }
}

export function assigneeOptions(people: Person[]) {
    return [{ value: "", label: "Unassigned" }, ...people.map(p => ({ value: p.id, label: p.display_name }))]
}

export function sortWithinArea(a: Task, b: Task): number {
    const byStatus = STATUS_SORT_ORDER.indexOf(a.status) - STATUS_SORT_ORDER.indexOf(b.status)
    if (byStatus !== 0) return byStatus
    if (a.due_date === b.due_date) return 0
    if (a.due_date === null) return 1
    if (b.due_date === null) return -1
    return a.due_date.localeCompare(b.due_date)
}

export type WhoFilter = "everyone" | "me" | "unclaimed" | string // string branch = a person id
export type StatusFilter = "all" | TaskStatus
export type Quick = null | "unclaimed" | "overdue" | "review"

export interface TaskFilter {
    bucket: string          // "all" | bucket slug
    status: StatusFilter
    who: WhoFilter
    quick: Quick
}

/** The board's single filter predicate — identical semantics to the web
 *  board's `visibleTasks` memo. Both pages call this so they never drift. */
export function matchesFilter(
    task: Task, filter: TaskFilter, currentUserId: string, todayMs: number,
): boolean {
    if (filter.bucket !== "all" && task.bucket !== filter.bucket) return false
    if (filter.status !== "all" && task.status !== filter.status) return false
    if (filter.who === "me") {
        if (task.assignee_id !== currentUserId && !task.contributors.some(c => c.id === currentUserId)) return false
    } else if (filter.who === "unclaimed") {
        if (task.assignee_id) return false
    } else if (filter.who !== "everyone") {
        if (task.assignee_id !== filter.who) return false
    }
    if (filter.quick === "unclaimed" && task.assignee_id) return false
    if (filter.quick === "overdue" && !isOverdue(task, todayMs)) return false
    if (filter.quick === "review" && task.status !== "review") return false
    return true
}
