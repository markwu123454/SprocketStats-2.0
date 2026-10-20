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

export const PRIORITY_ORDER: TaskPriority[] = ["critical", "high", "med", "low"]
// Priority stripe / label colors. Medium and low are fixed pastel accents
// (SPEC "Colors": "deliberate, theme-independent accents") — kept literal in
// every season. High is folded into DANGER_RED rather than the mockup's own
// #f87171 ("one red, not two").
// Critical shares the danger red, but is drawn louder everywhere it appears
// (filled badge, tinted row) -- see `CRITICAL_BADGE_STYLE`.
export const PRIORITY_COLOR: Record<TaskPriority, string> = { critical: DANGER_RED, high: DANGER_RED, med: "#f5d547", low: "#45908d" }

/** Filled, can't-miss badge for a "Perish if not done" task. */
export const CRITICAL_BADGE_STYLE = {
    display: "inline-flex", alignItems: "center", gap: 5, padding: "3px 9px", borderRadius: 999, whiteSpace: "nowrap",
    fontSize: 11, fontWeight: 800, letterSpacing: "0.06em", textTransform: "uppercase",
    background: DANGER_RED, color: "#fff", boxShadow: `0 0 0 3px ${tintColor(DANGER_RED, 22)}`,
} as const

/** Priorities a viewer may pick in a form. "critical" is leads-only; a
 *  non-lead editing a task that's already critical sees it locked there. */
export function priorityChoices(canAssign: boolean, current?: TaskPriority): TaskPriority[] {
    if (canAssign) return PRIORITY_ORDER
    if (current === "critical") return ["critical"]
    return PRIORITY_ORDER.filter(p => p !== "critical")
}

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

const PRIORITY_RANK: Record<TaskPriority, number> = { critical: 0, high: 1, med: 2, low: 3 }

function compareDue(a: Task, b: Task): number {
    if (a.due_date === b.due_date) return 0
    if (a.due_date === null) return 1
    if (b.due_date === null) return -1
    return a.due_date.localeCompare(b.due_date)
}

/** How the board orders rows inside a group: by priority (high → low, then
 *  soonest due) by default, or by due date (soonest first, then priority). */
export type TaskSort = "priority" | "due"
export const TASK_SORT_OPTIONS: { value: TaskSort; label: string }[] = [
    { value: "priority", label: "Sort: Priority" },
    { value: "due", label: "Sort: Due date" },
]

export function compareTasks(sort: TaskSort): (a: Task, b: Task) => number {
    return (a, b) => {
        const byPriority = PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority]
        const primary = sort === "priority" ? byPriority || compareDue(a, b) : compareDue(a, b) || byPriority
        return primary || a.title.localeCompare(b.title)
    }
}

/** Done tasks sit in their own collapsed section, most recently finished first. */
export function compareDone(a: Task, b: Task): number {
    return b.updated_at.localeCompare(a.updated_at)
}

/** "Posted Oct 3" from a task's `created_at` timestamp. */
export function formatPosted(iso: string): string {
    const d = new Date(iso)
    return `Posted ${MONTHS[d.getMonth()]} ${d.getDate()}`
}

/** Router `state` accepted by `/tasks` to pre-set its filters. `taskId`
 *  opens (and scrolls to) that one task -- e.g. from the dashboard card. */
export interface TasksPageState {
    bucket?: string
    who?: WhoFilter
    taskId?: string
}

export type WhoFilter = "everyone" | "me" | "unclaimed" | string // string branch = a person id
export type StatusFilter = "all" | TaskStatus
export type Quick = null | "unclaimed" | "overdue" | "review" | "todo" | "doing"

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
    if (filter.quick === "todo" && task.status !== "todo") return false
    if (filter.quick === "doing" && task.status !== "doing") return false
    return true
}

/** Distinct existing area names in `bucket` (first spelling seen, case-
 *  insensitive), alphabetical -- the new/edit task form's area suggestions. */
export function areaSuggestions(tasks: Task[], bucket: string): string[] {
    const byKey = new Map<string, string>()
    for (const t of tasks) {
        if (t.bucket !== bucket || !t.area.trim()) continue
        const key = t.area.trim().toLowerCase()
        if (!byKey.has(key)) byKey.set(key, t.area.trim())
    }
    return Array.from(byKey.values()).sort((a, b) => a.localeCompare(b))
}

/** One-line explanations behind the "?" next to each task form label. */
export const TASK_FIELD_HELP = {
    title: "A short description of the work. This is what everyone sees on the board.",
    area: "The project this belongs to inside the subteam, like Drivetrain. Tasks with the same area are grouped together. Pick an existing one or type a new name; blank means General.",
    bucket: "Which subteam's board this task shows up on.",
    assignee: "Who owns this task. Leave it Unassigned so anyone can claim it.",
    priority: "How urgent it is. The board lists Perish if not done first (leads only), then High, Medium, and Low.",
    due: "When it should be done by. After this date the task shows as overdue.",
} as const
