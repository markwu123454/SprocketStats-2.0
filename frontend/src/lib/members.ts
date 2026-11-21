// The Members page's data model and pure helpers, shared by the page
// (pages/control/MembersPage.tsx), its state hook (useMembersRoster.ts) and both
// roster views (components/members/MembersGrid.tsx on desktop, MembersList.tsx
// on a phone).

import type { CSSProperties } from "react"
import type { Check } from "lucide-react"
import type { RoleCatalogEntry } from "@/lib/permissions"

export interface MemberRow {
    id: string
    // Null when the server masks it — currently every Mentor's email, which is
    // hidden from all viewers.
    email: string | null
    name: string | null
    display_name: string | null
    // Google profile picture, or null if Google gave none.
    picture: string | null
    role: string | null
    grade: string | null
    team_year: string | null
    // A visitor's own FIRST team from onboarding ("FRC" / "FTC" / "FLL" and the
    // number), or null when they aren't on one or weren't asked.
    first_program?: string | null
    first_team_number?: number | null
    // Id of the captain/mentor who approved this member's identity + role, or
    // null if nobody has yet. Set only through the approve endpoint, which takes
    // the approver from the session, so it can't be spoofed through the profile PUT.
    approved_by: string | null
    // ISO timestamp the member was banned, or null. Set through the ban/unban endpoints.
    banned_at: string | null
    tags: string[]
    // Per-member kiosk grant (scan member codes + set up kiosks), on top of any
    // role that already has kiosk.authorize.
    kiosk_access_until: string | null
    kiosk_access_no_end: boolean
}

/** Profile fields the roster lets you edit; email stays read-only (OAuth identity). */
export type EditableField = "name" | "display_name" | "role" | "grade" | "team_year"
export type ProfilePatch = Partial<Pick<MemberRow, EditableField>>

export const TAG_RE = /^[a-z0-9_]{1,64}$/

// Static enum option lists (leading "" = clear the value, shown as an em dash).
export const GRADE_OPTIONS = ["", "freshman", "sophomore", "junior", "senior"]
export const YEAR_OPTIONS  = ["", "year_1", "year_2", "year_3", "year_4"]

/** Treat empty string and null/undefined as the same "no value" for comparisons. */
export const norm = (v: string | null | undefined): string | null => (v === "" || v == null ? null : v)

/** "scouting_lead" → "Scouting Lead", "year_1" → "Year 1". */
export function pretty(v: string): string {
    return v.split("_").map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(" ")
}

export type Status = "approved" | "pending" | "banned"

export const statusOf = (m: MemberRow): Status =>
    m.banned_at ? "banned" : m.approved_by ? "approved" : "pending"

export const STATUS_LABEL: Record<Status, string> = { approved: "Approved", pending: "Pending", banned: "Banned" }

/** The phone list's status tabs; desktop filters status with the grid's column filter. */
export type Tab = "all" | Status
export const TABS: [Tab, string][] = [["all", "All"], ["approved", "Approved"], ["pending", "Pending"], ["banned", "Banned"]]

/** Dropdown trigger styled as a form field (same box as inputClass; Dropdown supplies the focus ring). */
export const DROPDOWN_TRIGGER = "rounded-lg border px-3 py-2.5 min-h-11 text-base md:text-sm transition theme-bg theme-outline theme-text"

export const tagChip: CSSProperties = {
    background: "color-mix(in oklch, var(--theme-text-contrast) 18%, transparent)",
    color: "var(--theme-text-contrast)",
}

/** "sophomore" + "year_2" → "Soph · Yr 2". Short enough not to wrap in the Grade column. */
export function gradeLabel(grade: string | null, year: string | null): string {
    const g = grade ? (grade === "sophomore" ? "Soph" : pretty(grade)) : null
    const y = year ? `Yr ${year.replace("year_", "")}` : null
    return [g, y].filter(Boolean).join(" · ") || "—"
}

/** Live kiosk grant: "no_end", the end time, or null when there is none (or it lapsed). */
export function kioskGrantOf(m: MemberRow, now = Date.now()): "no_end" | Date | null {
    if (m.kiosk_access_no_end) return "no_end"
    if (!m.kiosk_access_until) return null
    const until = new Date(m.kiosk_access_until)
    return until.getTime() > now ? until : null
}

/** "3:40 PM" today, otherwise "Sat, Nov 15, 3:40 PM". */
export function formatEnd(d: Date): string {
    const sameDay = d.toDateString() === new Date().toDateString()
    return d.toLocaleString(undefined, sameDay
        ? { hour: "numeric", minute: "2-digit" }
        : { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })
}

export function kioskGrantLabel(grant: "no_end" | Date): string {
    return grant === "no_end" ? "No end" : `Until ${formatEnd(grant)}`
}

export function initials(name: string): string {
    return name.trim().split(/\s+/).map(w => w.charAt(0).toUpperCase()).join("").slice(0, 2) || "?"
}

export const nameOf = (m: MemberRow): string => m.name ?? m.display_name ?? m.email ?? "Unnamed"

/** Secondary line under a member's name: nickname, onboarding state, or hidden email. */
export function goesByOf(m: MemberRow): string {
    const firstName = nameOf(m).split(" ")[0]
    return !m.display_name ? "Hasn't finished onboarding"
        : m.display_name !== firstName ? `Goes by ${m.display_name}`
        : !m.email ? "Email hidden" : ""
}

/** Leads/members show their subteam (paired with a Lead badge); other roles show their label.
 *  A visitor's own FIRST team, when they gave one, follows it ("Visitor · FTC 12345"). */
export function roleTextOf(m: MemberRow, role: RoleCatalogEntry | undefined): string {
    const label = role ? (role.subteam ? role.label.replace(/ (Lead|Member)$/, "") : role.label)
        : m.role ? pretty(m.role) : "—"
    return m.first_program && m.first_team_number ? `${label} · ${m.first_program} ${m.first_team_number}` : label
}

/** A member's one moderation action (approve, ban or unban). It saves right away. */
export interface RowAction {
    label: string
    icon: typeof Check
    /** Resolves false when the person backed out of a confirmation; rejects with a user-facing message. */
    run: () => Promise<boolean>
    disabled: boolean
    /** Why the action is unavailable, shown as the tooltip instead of `label`. */
    reason?: string
}

/**
 * What both roster views call back into, built by the page. Opening a sheet goes
 * through here, so the edit, tags and kiosk sheets are drawn once, by the page.
 * Every change saves as soon as it's made.
 */
export interface MemberActions {
    roleById: Map<string, RoleCatalogEntry>
    /** Shows a failed save on the page. */
    onError: (e: unknown) => void
    actionFor: (m: MemberRow) => RowAction
    /** Absent when the member is outside the viewer's editing scope. */
    onEdit: (m: MemberRow) => (() => void) | undefined
    /** Absent when the viewer can't edit tags. */
    onEditTags: (m: MemberRow) => (() => void) | undefined
    /** Why kiosk access can't be changed for this member; undefined when it can. */
    kioskBlocked: (m: MemberRow) => string | undefined
    onKioskAccess: (m: MemberRow) => void
    onRevokeKiosk: (m: MemberRow) => void
}

/* ── Roster order and groups ─────────────────────────────────── */

/** Roles with no subteam are grouped by level instead, in this order around the subteams. */
const LEVEL_GROUPS_BEFORE: [string, string][] = [["captain", "Captains"], ["mentor", "Mentors"]]
const LEVEL_GROUPS_AFTER: [string, string][]  = [["alumni", "Alumni"], ["visitor", "Visitors"]]
const NO_ROLE_GROUP = "_none"
const BANNED_GROUP = "_banned"

export interface RosterOrder {
    /** Roster order: by group (captains, mentors, each subteam, alumni, visitors), leads first,
     *  then name, with banned accounts last. The phone list groups this way; the desktop grid's Role sort uses it. */
    compare: (a: MemberRow, b: MemberRow) => number
    /** Group key for a member: their role's subteam, else its level, else "no role". */
    groupKeyOf: (m: MemberRow) => string
    /** Ordered [key, label] pairs for every group the catalog can produce. */
    groupOrder: [string, string][]
    groupLabel: (key: string) => string
}

export function rosterOrder(catalog: RoleCatalogEntry[]): RosterOrder {
    const roleById = new Map(catalog.map(c => [c.value, c]))

    const subteams: [string, string][] = []
    for (const c of catalog) {
        if (c.subteam && !subteams.some(([k]) => k === c.subteam)) {
            // "CAD Lead" → "CAD" keeps the catalog's own capitalisation.
            subteams.push([c.subteam, c.label.replace(/ (Lead|Member)$/, "")])
        }
    }
    const groupOrder: [string, string][] = [...LEVEL_GROUPS_BEFORE, ...subteams, ...LEVEL_GROUPS_AFTER, [NO_ROLE_GROUP, "No role"]]

    const groupKeyOf = (m: MemberRow): string => {
        const entry = m.role ? roleById.get(m.role) : undefined
        if (!entry) return m.role ? m.role : NO_ROLE_GROUP
        return entry.subteam ?? entry.level
    }
    const groupLabel = (key: string) => groupOrder.find(([k]) => k === key)?.[1] ?? pretty(key)

    const compare = (a: MemberRow, b: MemberRow) => {
        const groupIndex = (m: MemberRow) => {
            const i = groupOrder.findIndex(([k]) => k === groupKeyOf(m))
            return i === -1 ? groupOrder.length - 1.5 : i // unknown roles just before "No role", as in the list
        }
        const isLead = (m: MemberRow) => (m.role ? roleById.get(m.role)?.level === "lead" : false)
        return Number(!!a.banned_at) - Number(!!b.banned_at)
            || groupIndex(a) - groupIndex(b)
            || Number(isLead(b)) - Number(isLead(a))
            || (a.name ?? "").localeCompare(b.name ?? "")
    }

    return { compare, groupKeyOf, groupOrder, groupLabel }
}

export interface RosterGroup<M extends MemberRow> {
    key: string
    name: string
    rows: M[]
}

/** `members` split into their groups, each in roster order, banned accounts in their own group last. */
export function groupRoster<M extends MemberRow>(members: M[], order: RosterOrder): RosterGroup<M>[] {
    const byName = (a: MemberRow, b: MemberRow) => (a.name ?? "").localeCompare(b.name ?? "")
    const buckets = new Map<string, M[]>()
    const banned: M[] = []
    for (const m of members) {
        if (m.banned_at) { banned.push(m); continue }
        const k = order.groupKeyOf(m)
        buckets.set(k, [...(buckets.get(k) ?? []), m])
    }
    // Keys not in the catalog order (unknown roles) go just before "No role".
    const known = order.groupOrder.map(([k]) => k)
    const extra = [...buckets.keys()].filter(k => !known.includes(k)).sort()
    const keys = [...known.slice(0, -1), ...extra, NO_ROLE_GROUP]
    const out = keys
        .filter(k => buckets.has(k))
        .map(k => ({ key: k, name: order.groupLabel(k), rows: buckets.get(k)!.sort(order.compare) }))
    if (banned.length) out.push({ key: BANNED_GROUP, name: "Banned", rows: banned.sort(byName) })
    return out
}
