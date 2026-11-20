import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent, type ReactNode } from "react"
import { createPortal } from "react-dom"
import { AgGridReact } from "ag-grid-react"
import type {
    CellClassParams, ColDef, EditableCallbackParams, ICellRendererParams,
    RowClassParams, SuppressKeyboardEventParams, ValueGetterParams, ValueSetterParams,
} from "ag-grid-community"
import "@/lib/agGrid"
import { useBootstrapped } from "@/contexts/bootstrapContext"
import { Ban, Check, ChevronRight, MoreHorizontal, Pencil, Plus, RotateCcw, ScanLine, Tag, X } from "lucide-react"
import { useAuth } from "@/contexts/authContext"
import { can, canModerate, getPerm, type RoleCatalogEntry } from "@/lib/permissions"
import Avatar from "@/components/Avatar"
import Dropdown from "@/components/ui/Dropdown"
import Button from "@/components/ui/Button"
import FormFooter from "@/components/ui/FormFooter"
import Sheet from "@/components/ui/Sheet"
import Notice from "@/components/ui/Notice"
import EmptyState from "@/components/ui/EmptyState"
import Skeleton from "@/components/ui/Skeleton"
import { fieldErrorClass, fieldLabelClass, focusRing, helperClass, inputClass, menuRowClass } from "@/lib/uiClasses"
import { useDiscardGuard, useIsDirty } from "@/lib/useDiscardGuard"
import { useIsMobile } from "@/lib/useIsMobile"

const API = import.meta.env.VITE_BACKEND_URL

interface MemberRow {
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
    // null if nobody has yet. Approving is one-way (no unapprove) and, like
    // banning, is staged locally and only persisted via its dedicated endpoint
    // when Save is pressed — so the acting approver can never be spoofed
    // through the bulk PUT.
    approved_by: string | null
    // ISO timestamp the member was banned, or null. Same staged-until-save
    // treatment as approved_by, persisted via the dedicated ban/unban endpoints.
    banned_at: string | null
    // Tags are not part of the Save/Reset cycle — add/remove calls the API
    // immediately and updates local state directly.
    tags: string[]
    // Per-member kiosk grant (scan member codes + set up kiosks), on top of any
    // role that already has kiosk.authorize. Like tags, it applies immediately
    // through its own endpoint rather than the Save/Reset cycle.
    kiosk_access_until: string | null
    kiosk_access_no_end: boolean
}

/** Fields the roster lets you edit; email stays read-only (OAuth identity). */
const EDITABLE = ["name", "display_name", "role", "grade", "team_year"] as const
type EditableField = (typeof EDITABLE)[number]

/** Fields staged like edits (dirty-tracked, reset/save together) but persisted
 *  through their own endpoints on Save rather than the bulk PUT. */
const PENDING = ["approved_by", "banned_at"] as const
type PendingField = (typeof PENDING)[number]

const ALL_TRACKED = [...EDITABLE, ...PENDING] as const

/** A row carries its original DB values so we can detect & revert edits. */
interface MemberRowState extends MemberRow {
    _orig: Pick<MemberRow, EditableField | PendingField>
}

const TAG_RE = /^[a-z0-9_]{1,64}$/

// Static enum option lists (leading "" = clear the value, shown as an em dash).
const GRADE_OPTIONS = ["", "freshman", "sophomore", "junior", "senior"]
const YEAR_OPTIONS  = ["", "year_1", "year_2", "year_3", "year_4"]

/** Treat empty string and null/undefined as the same "no value" for comparisons. */
const norm = (v: string | null | undefined): string | null => (v === "" || v == null ? null : v)

/** "scouting_lead" → "Scouting Lead", "year_1" → "Year 1". */
function pretty(v: string): string {
    return v.split("_").map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(" ")
}

function snapshot(m: MemberRow): Pick<MemberRow, EditableField | PendingField> {
    return {
        name: m.name, display_name: m.display_name, role: m.role, grade: m.grade, team_year: m.team_year,
        approved_by: m.approved_by, banned_at: m.banned_at,
    }
}

const isDirty = (m: MemberRowState, fields: readonly (EditableField | PendingField)[] = ALL_TRACKED) =>
    fields.some(f => norm(m._orig[f]) !== norm(m[f]))

type Status = "approved" | "pending" | "banned"

const statusOf = (m: MemberRow): Status =>
    m.banned_at ? "banned" : m.approved_by ? "approved" : "pending"

const STATUS_LABEL: Record<Status, string> = { approved: "Approved", pending: "Pending", banned: "Banned" }

type Tab = "all" | Status
const TABS: [Tab, string][] = [["all", "All"], ["approved", "Approved"], ["pending", "Pending"], ["banned", "Banned"]]

/** Roles with no subteam are grouped by level instead, in this order around the subteams. */
const LEVEL_GROUPS_BEFORE: [string, string][] = [["captain", "Captains"], ["mentor", "Mentors"]]
const LEVEL_GROUPS_AFTER: [string, string][]  = [["alumni", "Alumni"], ["visitor", "Visitors"]]
const NO_ROLE_GROUP = "_none"
const BANNED_GROUP = "_banned"

/** Height of the title row (title, Save, Reset). Fixed, because on a phone it sticks and the group headers stick right under it. */
const TITLE_ROW_H = 72

/** Dropdown trigger styled as a form field (same box as inputClass; Dropdown supplies the focus ring). */
const DROPDOWN_TRIGGER = "rounded-lg border px-3 py-2.5 min-h-11 text-base md:text-sm transition theme-bg theme-outline theme-text"

const tagChip: CSSProperties = {
    background: "color-mix(in oklch, var(--theme-text-contrast) 18%, transparent)",
    color: "var(--theme-text-contrast)",
}

/** "sophomore" + "year_2" → "Soph · Yr 2". Short enough not to wrap in the Grade column. */
function gradeLabel(grade: string | null, year: string | null): string {
    const g = grade ? (grade === "sophomore" ? "Soph" : pretty(grade)) : null
    const y = year ? `Yr ${year.replace("year_", "")}` : null
    return [g, y].filter(Boolean).join(" · ") || "—"
}

/** Live kiosk grant: "no_end", the end time, or null when there is none (or it lapsed). */
function kioskGrantOf(m: MemberRow, now = Date.now()): "no_end" | Date | null {
    if (m.kiosk_access_no_end) return "no_end"
    if (!m.kiosk_access_until) return null
    const until = new Date(m.kiosk_access_until)
    return until.getTime() > now ? until : null
}

/** "3:40 PM" today, otherwise "Sat, Nov 15, 3:40 PM". */
function formatEnd(d: Date): string {
    const sameDay = d.toDateString() === new Date().toDateString()
    return d.toLocaleString(undefined, sameDay
        ? { hour: "numeric", minute: "2-digit" }
        : { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })
}

function kioskGrantLabel(grant: "no_end" | Date): string {
    return grant === "no_end" ? "No end" : `Until ${formatEnd(grant)}`
}

function initials(name: string): string {
    return name.trim().split(/\s+/).map(w => w.charAt(0).toUpperCase()).join("").slice(0, 2) || "?"
}

const nameOf = (m: MemberRow): string => m.name ?? m.display_name ?? m.email ?? "Unnamed"

/** Secondary line under a member's name: nickname, onboarding state, or hidden email. */
function goesByOf(m: MemberRow): string {
    const firstName = nameOf(m).split(" ")[0]
    return !m.display_name ? "Hasn't finished onboarding"
        : m.display_name !== firstName ? `Goes by ${m.display_name}`
        : !m.email ? "Email hidden" : ""
}

/** Leads/members show their subteam (paired with a Lead badge); other roles show their label.
 *  A visitor's own FIRST team, when they gave one, follows it ("Visitor · FTC 12345"). */
function roleTextOf(m: MemberRow, role: RoleCatalogEntry | undefined): string {
    const label = role ? (role.subteam ? role.label.replace(/ (Lead|Member)$/, "") : role.label)
        : m.role ? pretty(m.role) : "—"
    return m.first_program && m.first_team_number ? `${label} · ${m.first_program} ${m.first_team_number}` : label
}

function MemberAvatar({ name, picture, size = 32 }: { name: string; picture: string | null; size?: number }) {
    return (
        <Avatar
            name={name}
            picture={picture}
            size={size}
            monogram={initials(name)}
            monogramStyle={{ background: "var(--theme-button-hover)", color: "var(--theme-h1-color)", fontSize: 12 }}
        />
    )
}

function LeadBadge() {
    return (
        <span className="text-xs font-semibold px-1.5 py-0.5 rounded-full border shrink-0 theme-text-contrast"
              style={{ borderColor: "var(--theme-text-contrast)" }}>
            LEAD
        </span>
    )
}

interface RowAction {
    label: string
    icon: typeof Check
    onClick: () => void
    disabled: boolean
    /** Why the action is unavailable, shown as the tooltip instead of `label`. */
    reason?: string
}

/**
 * Members control page — the roster, grouped by subteam.
 *
 * Search narrows the groups as well as the rows (it matches role names too, so
 * "cad" finds the CAD subteam); on a phone, status tabs do too. Leads come first
 * in each group and banned accounts are collected at the bottom. Approve/ban/unban and profile edits made in the row editor are staged
 * locally; "Reset" reverts every row to its DB snapshot and "Save" persists only
 * the changed rows. Captains, Mentors and the Scouting Lead can edit anyone; Leads
 * can edit their own subteam's members (and alumni), except for their role. The `/members` endpoints
 * enforce the same scope — this UI is cosmetic, the backend is the real boundary.
 *
 * From `md` up the roster is an AG Grid (`MembersGrid`): sortable, resizable,
 * filterable columns, Role, Grade and Year edited in place, and each group's
 * header kept above its members under any sort or filter. Below `md` it's a
 * stacked list: tapping a member opens a bottom sheet holding every action (edit,
 * tags, moderation). Save/Reset sit beside the title at every width (disabled
 * until something is staged); on a phone that row sticks to the top.
 */
export default function MembersPage() {
    const { user } = useAuth()
    const isMobile = useIsMobile()

    // Bootstrap pre-seeds — null means "not yet resolved", [] means "resolved but empty"
    const [bMembers] = useBootstrapped<MemberRow[] | null>("members", null)
    const [bTagMap]  = useBootstrapped<Record<string, string[]> | null>("tag_assignments", null)

    const [rows, setRows] = useState<MemberRowState[]>(() => {
        if (!bMembers) return []
        const tagMap = bTagMap ?? {}
        return bMembers.map(m => ({ ...m, tags: tagMap[m.id] ?? [], _orig: snapshot(m) }))
    })
    const [catalog, setCatalog] = useBootstrapped<RoleCatalogEntry[]>("roles", [])

    // Captains, Mentors and the Scouting Lead (control_panel.members) edit anyone,
    // role included. Leads edit within their moderation scope — their subteam's
    // members and alumni — but can't change anyone's role.
    const canManage = can(user?.permissions, "control_panel.members")
    // Tag editing is available to anyone with roster access: Captains, Mentors,
    // and Leads (anyone with a can_moderate spec on their policy).
    const canEditTags = canManage || Boolean(getPerm(user?.permissions, "can_moderate"))
    const [editingTagsFor, setEditingTagsFor] = useState<string | null>(null)
    const [editingFor, setEditingFor]         = useState<string | null>(null)
    const [kioskFor, setKioskFor]             = useState<string | null>(null)
    // Mobile only: the member whose action sheet is open.
    const [sheetFor, setSheetFor]             = useState<string | null>(null)
    const [loading, setLoading]              = useState(bMembers === null)
    // Tracks whether the real load() has started; prevents bootstrap from overwriting fresh data.
    const loadStarted = useRef(false)
    const [saving, setSaving] = useState(false)
    const [error, setError]   = useState<string | null>(null)

    const [query, setQuery]     = useState("")
    const [tab, setTab]         = useState<Tab>("all")

    // Seed rows from bootstrap if it resolves after this component mounted
    // but before load() has started (async case on slow connections).
    useEffect(() => {
        if (loadStarted.current || !bMembers) return
        const tagMap = bTagMap ?? {}
        setRows(bMembers.map(m => ({ ...m, tags: tagMap[m.id] ?? [], _orig: snapshot(m) })))
        setLoading(false)
    }, [bMembers, bTagMap])

    const load = useCallback(async () => {
        loadStarted.current = true
        setError(null)
        try {
            const [mRes, rRes, tRes] = await Promise.all([
                fetch(`${API}/members`, { credentials: "include" }),
                fetch(`${API}/auth/roles`, { credentials: "include" }),
                fetch(`${API}/tags/assignments`, { credentials: "include" }),
            ])
            if (!mRes.ok) throw new Error("members")
            const members = await mRes.json() as MemberRow[]
            const tagMap: Record<string, string[]> = tRes.ok ? await tRes.json() as Record<string, string[]> : {}
            if (rRes.ok) setCatalog(await rRes.json() as RoleCatalogEntry[])
            setRows(members.map(m => ({ ...m, tags: tagMap[m.id] ?? [], _orig: snapshot(m) })))
        } catch {
            setError("Couldn't load members")
        } finally {
            setLoading(false)
        }
    }, [setCatalog])

    useEffect(() => { void load() }, [load])

    const roleById = useMemo(() => new Map(catalog.map(c => [c.value, c])), [catalog])

    /** Whether the viewer may edit the profile of a member holding `role`. */
    const canEditMember = useCallback((role: string | null) =>
        canManage || canModerate(user?.permissions, role, catalog), [canManage, user, catalog])

    /** Patch one row's staged fields; dirty state is derived from `_orig`. */
    const patchRow = useCallback((id: string, patch: Partial<MemberRowState>) => {
        setRows(prev => prev.map(r => (r.id === id ? { ...r, ...patch } : r)))
    }, [])

    const changes = useMemo(() => rows.filter(r => isDirty(r)).length, [rows])
    const hasChanges = changes > 0
    // Staged edits are lost on a link click or tab close, and Reset throws them away on purpose.
    const confirmDiscardStaged = useDiscardGuard(hasChanges)

    // Approve/ban only stage a local change — the actual API calls happen in
    // handleSave, alongside the rest of the pending edits, so Reset can still
    // discard them.
    const handleApprove = useCallback((id: string) => {
        if (!user) return
        patchRow(id, { approved_by: user.id })
    }, [patchRow, user])

    const handleBan   = useCallback((id: string) => patchRow(id, { banned_at: new Date().toISOString() }), [patchRow])
    const handleUnban = useCallback((id: string) => patchRow(id, { banned_at: null }), [patchRow])

    const handleTagAdd = useCallback(async (userId: string, tag: string) => {
        await fetch(`${API}/tags/user/${userId}/${tag}`, { method: "POST", credentials: "include" })
        setRows(prev => prev.map(r =>
            r.id === userId && !r.tags.includes(tag) ? { ...r, tags: [...r.tags, tag].sort() } : r))
    }, [])

    const handleTagRemove = useCallback(async (userId: string, tag: string) => {
        await fetch(`${API}/tags/user/${userId}/${tag}`, { method: "DELETE", credentials: "include" })
        setRows(prev => prev.map(r => (r.id === userId ? { ...r, tags: r.tags.filter(t => t !== tag) } : r)))
    }, [])

    /** Grant (minutes, or null for no end) or revoke kiosk access; applies immediately. */
    const handleKioskAccess = useCallback(async (userId: string, minutes: number | null | "revoke") => {
        const res = await fetch(`${API}/members/${userId}/kiosk_access`, minutes === "revoke"
            ? { method: "DELETE", credentials: "include" }
            : {
                method: "POST",
                credentials: "include",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ minutes }),
            })
        if (!res.ok) {
            const detail = await res.json().then((b: { detail?: unknown }) => b.detail, () => null)
            throw new Error(typeof detail === "string" ? detail : "Couldn't update kiosk access")
        }
        const body = await res.json() as Pick<MemberRow, "kiosk_access_until" | "kiosk_access_no_end">
        patchRow(userId, { kiosk_access_until: body.kiosk_access_until, kiosk_access_no_end: body.kiosk_access_no_end })
    }, [patchRow])

    const handleReset = useCallback(() => {
        setRows(prev => prev.map(r => ({ ...r, ...r._orig })))
    }, [])

    const handleSave = useCallback(async () => {
        const editableChanged = rows.filter(r => isDirty(r, EDITABLE))
        const approveChanged  = rows.filter(r => isDirty(r, ["approved_by"]))
        const banChanged      = rows.filter(r => isDirty(r, ["banned_at"]))
        if (!editableChanged.length && !approveChanged.length && !banChanged.length) return

        setSaving(true)
        setError(null)
        try {
            if (editableChanged.length) {
                const res = await fetch(`${API}/members`, {
                    method: "PUT",
                    credentials: "include",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify(editableChanged.map(d => ({
                        id: d.id,
                        name: d.name,
                        display_name: d.display_name,
                        role: d.role,
                        grade: norm(d.grade),
                        team_year: norm(d.team_year),
                    }))),
                })
                if (!res.ok) throw new Error("save")
            }

            for (const d of approveChanged) {
                const res = await fetch(`${API}/members/${d.id}/approve`, { method: "POST", credentials: "include" })
                if (!res.ok) throw new Error("approve")
            }

            for (const d of banChanged) {
                const res = await fetch(`${API}/members/${d.id}/ban`, {
                    method: d.banned_at ? "POST" : "DELETE",
                    credentials: "include",
                })
                if (!res.ok) throw new Error("ban")
            }

            // Reload from the server rather than trusting local state as the new
            // baseline: a role change clears approved_by server-side (see
            // db.update_users), so the authoritative approved_by/banned_at can
            // differ from what was staged here.
            await load()
        } catch {
            setError("Couldn't save changes")
        } finally {
            setSaving(false)
        }
    }, [rows, load])

    /** Group key for a member: their role's subteam, else its level, else "no role". */
    const groupKeyOf = useCallback((m: MemberRow): string => {
        const entry = m.role ? roleById.get(m.role) : undefined
        if (!entry) return m.role ? m.role : NO_ROLE_GROUP
        return entry.subteam ?? entry.level
    }, [roleById])

    /** Ordered [key, label] pairs for every group the catalog can produce. */
    const groupOrder = useMemo<[string, string][]>(() => {
        const subteams: [string, string][] = []
        for (const c of catalog) {
            if (c.subteam && !subteams.some(([k]) => k === c.subteam)) {
                // "CAD Lead" → "CAD" keeps the catalog's own capitalisation.
                subteams.push([c.subteam, c.label.replace(/ (Lead|Member)$/, "")])
            }
        }
        return [...LEVEL_GROUPS_BEFORE, ...subteams, ...LEVEL_GROUPS_AFTER, [NO_ROLE_GROUP, "No role"]]
    }, [catalog])

    const groupLabel = useCallback((key: string) =>
        groupOrder.find(([k]) => k === key)?.[1] ?? pretty(key), [groupOrder])

    // Search is phone-only; desktop filters with the grid's column filters.
    const ql = isMobile ? query.trim().toLowerCase() : ""
    const roleLabel = useCallback((role: string | null) =>
        role ? (roleById.get(role)?.label ?? pretty(role)) : "", [roleById])

    // Search first; tab counts are computed over this set.
    const base = useMemo(() => rows.filter(m => {
        if (!ql) return true
        return [m.name, m.display_name, m.email, roleLabel(m.role)]
            .some(v => v?.toLowerCase().includes(ql))
    }), [rows, ql, roleLabel])

    /** Roster order: by group (captains, mentors, each subteam, alumni, visitors), leads first, then
     *  name, with banned accounts last. The phone list groups this way; the desktop grid's Role sort uses it. */
    const compareRoster = useCallback((a: MemberRow, b: MemberRow) => {
        const groupIndex = (m: MemberRow) => {
            const i = groupOrder.findIndex(([k]) => k === groupKeyOf(m))
            return i === -1 ? groupOrder.length - 1.5 : i // unknown roles just before "No role", as in the list
        }
        const isLead = (m: MemberRow) => (m.role ? roleById.get(m.role)?.level === "lead" : false)
        return Number(!!a.banned_at) - Number(!!b.banned_at)
            || groupIndex(a) - groupIndex(b)
            || Number(isLead(b)) - Number(isLead(a))
            || (a.name ?? "").localeCompare(b.name ?? "")
    }, [groupOrder, groupKeyOf, roleById])

    // The status tabs are phone-only; desktop filters status with the grid's column filter.
    const statusTab: Tab = isMobile ? tab : "all"
    const visible = useMemo(() => base.filter(m => statusTab === "all" || statusOf(m) === statusTab), [base, statusTab])

    /** Phone list: `visible` split into its groups, each in roster order, banned accounts in their own group last. */
    const groups = useMemo(() => {
        const byName = (a: MemberRow, b: MemberRow) => (a.name ?? "").localeCompare(b.name ?? "")
        const buckets = new Map<string, MemberRowState[]>()
        const banned: MemberRowState[] = []
        for (const m of visible) {
            if (m.banned_at) { banned.push(m); continue }
            const k = groupKeyOf(m)
            buckets.set(k, [...(buckets.get(k) ?? []), m])
        }
        // Keys not in the catalog order (unknown roles) go just before "No role".
        const known = groupOrder.map(([k]) => k)
        const extra = [...buckets.keys()].filter(k => !known.includes(k)).sort()
        const keys = [...known.slice(0, -1), ...extra, NO_ROLE_GROUP]
        const out = keys
            .filter(k => buckets.has(k))
            .map(k => ({
                key: k,
                name: groupLabel(k),
                rows: buckets.get(k)!.sort(compareRoster),
            }))
        if (banned.length) out.push({ key: BANNED_GROUP, name: "Banned", rows: banned.sort(byName) })
        return out
    }, [visible, groupKeyOf, groupOrder, groupLabel, compareRoster])

    /** The single moderation action shown at the end of a row. */
    const actionFor = (m: MemberRowState): RowAction => {
        const isSelf = m.id === user?.id
        const inScope = canModerate(user?.permissions, m.role, catalog)
        const scopeReason = isSelf ? "You can't moderate yourself"
            : !inScope ? "This member is outside your moderation scope" : undefined
        const status = statusOf(m)
        if (status === "banned") {
            return { label: "Unban", icon: RotateCcw, onClick: () => handleUnban(m.id), disabled: !!scopeReason, reason: scopeReason }
        }
        if (status === "pending") {
            const reason = scopeReason ?? (!m.display_name ? "Member hasn't finished onboarding" : undefined)
            return { label: "Approve", icon: Check, onClick: () => handleApprove(m.id), disabled: !!reason, reason }
        }
        return { label: "Ban", icon: Ban, onClick: () => handleBan(m.id), disabled: !!scopeReason, reason: scopeReason }
    }

    /** Why the viewer can't change this member's kiosk access, or undefined when they can. */
    const kioskBlockedReason = (m: MemberRowState): string | undefined =>
        m.id === user?.id ? "You can't change your own kiosk access"
            : !canModerate(user?.permissions, m.role, catalog) ? "This member is outside your moderation scope"
            : m.banned_at ? "Banned members can't use kiosks"
            : undefined

    const editingMember = editingFor ? rows.find(r => r.id === editingFor) : undefined
    const kioskMember = kioskFor ? rows.find(r => r.id === kioskFor) : undefined
    const editingTagsMember = editingTagsFor ? rows.find(r => r.id === editingTagsFor) : undefined
    const sheetMember = sheetFor ? rows.find(r => r.id === sheetFor) : undefined

    const resetButton = (
        <Button variant="outlined" onClick={() => void confirmDiscardStaged().then(ok => { if (ok) handleReset() })} disabled={!hasChanges || saving}>
            Reset
        </Button>
    )
    const saveButton = (
        <Button onClick={() => void handleSave()} disabled={!hasChanges || saving}>
            {saving ? "Saving…" : "Save"}
        </Button>
    )
    const searchBox = (className: string) => (
        <input
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Search name, email, role, subteam…"
            className={`members-search ${className} ${inputClass}`}
            aria-label="Search members"
            style={{ background: "var(--ag-grid-chrome-bg)" }}
        />
    )
    const unsavedLabel = `${changes} unsaved change${changes > 1 ? "s" : ""}`

    const loadingSkeleton = (
        <div className="flex flex-col gap-3 px-4 md:px-6 py-4" role="status" aria-label="Loading members">
            {Array.from({ length: 6 }, (_, i) => <Skeleton key={i} className="h-12 w-full" />)}
        </div>
    )

    /** What the desktop grid's cells call back into; the grid reads it fresh on every redraw. */
    const gridHandlers: GridHandlers = {
        roleById,
        actionFor,
        onEdit: m => (canEditMember(m.role) ? () => setEditingFor(m.id) : undefined),
        onEditTags: m => (canEditTags ? () => setEditingTagsFor(m.id) : undefined),
        kioskBlocked: kioskBlockedReason,
        onKioskAccess: m => setKioskFor(m.id),
        onRevokeKiosk: m => {
            setError(null)
            void handleKioskAccess(m.id, "revoke").catch((e: Error) => setError(e.message))
        },
    }

    /** Mobile list: loading / empty states, else each group's sticky header followed by its rows. */
    const renderGroups = (renderRow: (m: MemberRowState) => ReactNode) =>
        loading ? loadingSkeleton : groups.length === 0 ? (
            <div className="px-4 md:px-6 py-6">
                <EmptyState>No members match these filters.</EmptyState>
            </div>
        ) : groups.map(g => (
            <div key={g.key} className="flex flex-col">
                {/* Sticks just under the sticky title row. */}
                <div className="sticky z-10 flex items-baseline gap-2.5 px-4 md:px-6 pt-3.5 pb-2 border-b theme-border theme-bg" style={{ top: TITLE_ROW_H }}>
                    <span className="text-sm font-semibold theme-h1-color">{g.name}</span>
                    <span className="text-xs theme-subtext-color">{g.rows.length}</span>
                </div>
                {g.rows.map(renderRow)}
            </div>
        ))

    return (
        // Desktop pins the card to the viewport and scrolls the grid inside it; on
        // mobile the whole page scrolls (overflow-clip, not hidden, so the title row
        // and group headers can still stick) to give the list the full screen.
        <div className="px-4 py-3 md:px-6 md:py-6 flex flex-col gap-4 md:h-full">
            <div className="rounded-xl border overflow-clip md:overflow-hidden theme-border theme-bg flex flex-col md:flex-1 md:min-h-0">
                {/* Title with Save and Reset. On a phone it sticks to the top, so they stay in reach
                    while the list scrolls under it. */}
                <div
                    className="sticky top-0 z-20 md:static shrink-0 flex items-center gap-3 md:gap-4 px-4 md:px-6 border-b theme-border theme-bg"
                    style={{ height: TITLE_ROW_H }}
                >
                    <div className="flex flex-col min-w-0">
                        <h1 className="text-2xl font-bold leading-tight theme-h1-color">Members</h1>
                        {/* Takes no space when there is nothing unsaved, so the title stays centred; still announced. */}
                        <span className={hasChanges ? "text-xs theme-text-contrast" : "sr-only"} aria-live="polite">{hasChanges ? unsavedLabel : ""}</span>
                    </div>
                    <div className="flex-1" />
                    <div className="flex items-center gap-2 shrink-0">
                        {resetButton}
                        {saveButton}
                    </div>
                </div>

                {/* Phone: status tabs and search. Desktop filters with the grid's column filters instead. */}
                <div className="md:hidden flex flex-col gap-3 px-4 py-3 border-b theme-border">
                    <div className="flex gap-1 p-1 rounded-xl max-w-full overflow-x-auto" style={{ background: "var(--ag-grid-chrome-bg)" }}>
                        {TABS.map(([k, label]) => (
                            <button
                                key={k}
                                onClick={() => setTab(k)}
                                className={`flex items-center gap-1.5 px-3 min-h-11 md:min-h-9 rounded-lg text-sm whitespace-nowrap cursor-pointer ${focusRing}`}
                                style={{
                                    background: tab === k ? "var(--theme-button-hover)" : "transparent",
                                    color: tab === k ? "var(--theme-h1-color)" : "var(--theme-subtext-color)",
                                }}
                            >
                                {label}
                                <span className="opacity-70">
                                    {k === "all" ? base.length : base.filter(m => statusOf(m) === k).length}
                                </span>
                            </button>
                        ))}
                    </div>
                    {searchBox("w-full")}
                </div>

                {error && <Notice className="mx-4 md:mx-6 mt-3 shrink-0">{error}</Notice>}

                {isMobile ? (
                    <div className="flex flex-col">
                        {renderGroups(m => (
                            <MemberListRow
                                key={m.id}
                                member={m}
                                role={m.role ? roleById.get(m.role) : undefined}
                                onOpen={() => setSheetFor(m.id)}
                            />
                        ))}
                    </div>
                ) : loading ? loadingSkeleton : (
                    <MembersGrid
                        members={visible}
                        compareRoster={compareRoster}
                        catalog={catalog}
                        canManage={canManage}
                        canEditMember={canEditMember}
                        onPatch={patchRow}
                        handlers={gridHandlers}
                    />
                )}
            </div>

            {/* Hover-only affordances are gated on real hover so a tap on touch screens
                isn't swallowed as a hover, and the tag button stays visible without one. */}
            <style>{`
                .members-search::placeholder { color: var(--theme-subtext-color); opacity: .7; }
                /* Grid cells: centre custom content, and don't inherit the grid's row-height line-height. */
                .members-cell { display: flex; align-items: center; line-height: 1.35; }
                .members-banned .ag-cell { opacity: .6; }
                .members-grid .ag-body-viewport, .members-grid .ag-body-horizontal-scroll-viewport, .members-grid .ag-center-cols-viewport {
                    scrollbar-color: var(--scrollbar-thumb) var(--scrollbar-track);
                }
                /* Under the pinned actions column the grid keeps a spacer the height of the horizontal
                   scrollbar, drawn as an empty scrollbar of its own. Keep the space, drop the stray bar. */
                .members-grid .ag-horizontal-right-spacer { overflow-x: hidden; }
                @media (hover: hover) {
                    .members-row:hover .members-tag-edit { opacity: 1; }
                    .members-action:not(:disabled):hover { border-color: var(--theme-border); color: var(--theme-h1-color); }
                    .members-menu-item:not(:disabled):hover { background: color-mix(in oklch, var(--theme-button-bg) 90%, transparent); }
                }
                @media (hover: none) {
                    .members-tag-edit { opacity: 1; }
                }
                .members-list-row:active { background: var(--ag-grid-hover-bg); }
                .members-menu-item:not(:disabled):focus-visible { background: color-mix(in oklch, var(--theme-button-bg) 90%, transparent); }
            `}</style>

            {sheetMember && (
                <MemberSheet
                    member={sheetMember}
                    role={sheetMember.role ? roleById.get(sheetMember.role) : undefined}
                    action={actionFor(sheetMember)}
                    onClose={() => setSheetFor(null)}
                    onEdit={canEditMember(sheetMember.role) ? () => { setSheetFor(null); setEditingFor(sheetMember.id) } : undefined}
                    onEditTags={canEditTags ? () => { setSheetFor(null); setEditingTagsFor(sheetMember.id) } : undefined}
                    kioskBlocked={kioskBlockedReason(sheetMember)}
                    onKioskAccess={() => { setSheetFor(null); setKioskFor(sheetMember.id) }}
                />
            )}

            {editingMember && (
                <EditMemberModal
                    member={editingMember}
                    catalog={catalog}
                    canChangeRole={canManage}
                    onClose={() => setEditingFor(null)}
                    onApply={patch => { patchRow(editingMember.id, patch); setEditingFor(null) }}
                />
            )}

            {kioskMember && (
                <KioskAccessModal
                    member={kioskMember}
                    onClose={() => setKioskFor(null)}
                    onSubmit={minutes => handleKioskAccess(kioskMember.id, minutes)}
                />
            )}

            {editingTagsMember && (
                <TagsModal
                    member={editingTagsMember}
                    onClose={() => setEditingTagsFor(null)}
                    onAdd={handleTagAdd}
                    onRemove={handleTagRemove}
                />
            )}
        </div>
    )
}

/** What the grid's cells need from the page. */
interface GridHandlers {
    roleById: Map<string, RoleCatalogEntry>
    actionFor: (m: MemberRowState) => RowAction
    /** Absent when the member is outside the viewer's editing scope. */
    onEdit: (m: MemberRowState) => (() => void) | undefined
    onEditTags: (m: MemberRowState) => (() => void) | undefined
    /** Why kiosk access can't be changed for this member; undefined when it can. */
    kioskBlocked: (m: MemberRowState) => string | undefined
    onKioskAccess: (m: MemberRowState) => void
    onRevokeKiosk: (m: MemberRowState) => void
}

/** The grid's `context` is fixed when it's created, so cells reach the page's latest handlers through this. */
interface GridContext { handlers: () => GridHandlers }
type CellProps = ICellRendererParams<MemberRowState, unknown, GridContext>

/**
 * Lets Tab step through the buttons inside a cell before the grid moves to the next
 * cell, and lets Enter/Space press a focused button instead of the grid acting on
 * the cell (AG Grid's pattern for interactive cell renderers).
 */
function cellButtonKeys({ event }: SuppressKeyboardEventParams<MemberRowState>): boolean {
    const target = event.target as HTMLElement
    if ((event.key === "Enter" || event.key === " ") && target.closest("button")) return true
    if (event.key !== "Tab") return false
    const cell = target.closest(".ag-cell")
    const buttons = cell ? [...cell.querySelectorAll<HTMLButtonElement>("button:not(:disabled)")] : []
    const next = buttons.indexOf(target as HTMLButtonElement) + (event.shiftKey ? -1 : 1)
    if (event.shiftKey && target === cell) return false
    if (next < 0 || next >= buttons.length) return false
    event.preventDefault()
    buttons[next].focus()
    return true
}

/** Staged edits show in italics until Save or Reset. */
const italicIfDirty = (field: EditableField) => ({
    italic: (p: CellClassParams<MemberRowState>) => !!p.data && isDirty(p.data, [field]),
})

/** The grid's own column filters: a "contains" text box per column, matching what the cell shows (`filterText`). */
const DEFAULT_COL_DEF: ColDef<MemberRowState> = {
    sortable: true, resizable: true, suppressMovable: true, cellClass: "members-cell",
    filter: "agTextColumnFilter",
    filterParams: { filterOptions: ["contains"], maxNumConditions: 1 },
}

/** A column filter's text for a member: what their cell shows. */
const filterText = (text: (m: MemberRowState) => string) => (p: ValueGetterParams<MemberRowState>) =>
    (p.data ? text(p.data) : "")

const ROW_CLASS_RULES = {
    "members-banned": (p: RowClassParams<MemberRowState>) => !!p.data?.banned_at,
}

const STATUS_ORDER: Status[] = ["pending", "approved", "banned"]

interface MembersGridProps {
    /** The members to show, already narrowed by search. */
    members: MemberRowState[]
    catalog: RoleCatalogEntry[]
    /** Roster order (by group, leads first, then name; banned last): what sorting by Role uses. */
    compareRoster: (a: MemberRowState, b: MemberRowState) => number
    /** Captains, Mentors and the Scouting Lead: may change roles. */
    canManage: boolean
    canEditMember: (role: string | null) => boolean
    /** Stages an edit on a row; it persists on Save like any other. */
    onPatch: (id: string, patch: Partial<MemberRowState>) => void
    handlers: GridHandlers
}

/**
 * The desktop roster: one row per member, starting sorted by Role in roster order
 * (captains, mentors, each subteam with its leads first, alumni, visitors; banned
 * last). Every column sorts and has the grid's own "contains" filter. Role (for
 * those who may change it), Grade and Year are edited in place with a single
 * click, staged like the profile editor's edits; name and display name stay in
 * the profile editor, opened by clicking the member.
 */
function MembersGrid({ members, catalog, compareRoster, canManage, canEditMember, onPatch, handlers }: MembersGridProps) {
    const gridRef = useRef<AgGridReact<MemberRowState>>(null)
    const handlersRef = useRef(handlers)
    useLayoutEffect(() => { handlersRef.current = handlers })
    const [context] = useState<GridContext>(() => ({ handlers: () => handlersRef.current }))

    // Cells read role labels and permissions through `context`, which the grid doesn't
    // watch, so redraw them when those change (rows changing redraws them anyway).
    useEffect(() => {
        gridRef.current?.api?.refreshCells({ force: true })
    }, [handlers.roleById, canManage, canEditMember])

    // Depends only on things that rarely change: new column definitions would reset
    // the widths someone dragged.
    const columnDefs = useMemo<ColDef<MemberRowState>[]>(() => {
        const roleById = new Map(catalog.map(c => [c.value, c]))
        const roleLabel = (v: unknown) => (typeof v === "string" && v ? roleById.get(v)?.label ?? pretty(v) : "—")
        const byPosition = (list: readonly string[]) => (a: unknown, b: unknown) =>
            list.indexOf(String(a ?? "")) - list.indexOf(String(b ?? ""))
        const mayEdit = (p: EditableCallbackParams<MemberRowState>) => !!p.data && canEditMember(p.data.role)
        const stage = (field: EditableField) => (p: ValueSetterParams<MemberRowState>) => {
            if (p.data) onPatch(p.data.id, { [field]: norm(p.newValue as string | null) })
            return false // the page owns the row; its re-render brings the new value in
        }
        return [
            {
                colId: "member", headerName: "Member", flex: 1.6, minWidth: 180,
                valueGetter: p => (p.data ? nameOf(p.data) : ""),
                comparator: (a, b) => String(a).localeCompare(String(b)),
                filterValueGetter: filterText(m => `${nameOf(m)} ${m.display_name ?? ""}`),
                cellRenderer: MemberCell, suppressKeyboardEvent: cellButtonKeys,
            },
            {
                colId: "email", headerName: "Email", flex: 1.4, minWidth: 140,
                valueGetter: p => p.data?.email ?? null,
                valueFormatter: p => (p.value as string | null) ?? "Hidden",
                comparator: (a, b) => (a == null ? 1 : b == null ? -1 : String(a).localeCompare(String(b))),
                filterValueGetter: filterText(m => m.email ?? "Hidden"),
                cellClass: "members-cell text-xs theme-subtext-color",
            },
            {
                colId: "role", headerName: "Role", flex: 1.3, minWidth: 140,
                initialSort: "asc",
                valueGetter: p => p.data?.role ?? "",
                valueFormatter: p => roleLabel(p.value),
                comparator: (_a, _b, nodeA, nodeB) => (nodeA.data && nodeB.data ? compareRoster(nodeA.data, nodeB.data) : 0),
                filterValueGetter: filterText(m => `${roleLabel(m.role)} ${roleTextOf(m, m.role ? roleById.get(m.role) : undefined)}`),
                cellRenderer: RoleCell,
                editable: p => canManage && !!p.data,
                cellEditor: "agSelectCellEditor",
                cellEditorParams: { values: catalog.map(c => c.value) },
                valueSetter: stage("role"),
                headerTooltip: canManage ? "Click a role to change it" : undefined,
            },
            {
                colId: "grade", headerName: "Grade", width: 100,
                valueGetter: p => p.data?.grade ?? "",
                valueFormatter: p => (p.value ? pretty(String(p.value)) : "—"),
                comparator: byPosition(GRADE_OPTIONS),
                filterValueGetter: filterText(m => (m.grade ? pretty(m.grade) : "")),
                editable: mayEdit,
                cellEditor: "agSelectCellEditor",
                cellEditorParams: { values: GRADE_OPTIONS },
                valueSetter: stage("grade"),
                cellClassRules: italicIfDirty("grade"),
            },
            {
                colId: "year", headerName: "Year", width: 80,
                valueGetter: p => p.data?.team_year ?? "",
                valueFormatter: p => (p.value ? `Yr ${String(p.value).replace("year_", "")}` : "—"),
                comparator: byPosition(YEAR_OPTIONS),
                filterValueGetter: filterText(m => (m.team_year ? `Yr ${m.team_year.replace("year_", "")}` : "")),
                editable: mayEdit,
                cellEditor: "agSelectCellEditor",
                cellEditorParams: { values: YEAR_OPTIONS },
                valueSetter: stage("team_year"),
                cellClassRules: italicIfDirty("team_year"),
            },
            {
                colId: "status", headerName: "Status", width: 130,
                valueGetter: p => (p.data ? statusOf(p.data) : ""),
                comparator: byPosition(STATUS_ORDER),
                filterValueGetter: filterText(m => `${STATUS_LABEL[statusOf(m)]}${kioskGrantOf(m) ? " Kiosk" : ""}`),
                cellRenderer: StatusCell,
            },
            {
                colId: "tags", headerName: "Tags", flex: 1, minWidth: 100, sortable: false,
                valueGetter: p => p.data?.tags.join(" ") ?? "",
                filterValueGetter: filterText(m => m.tags.join(" ")),
                cellRenderer: TagsCell, suppressKeyboardEvent: cellButtonKeys,
            },
            {
                colId: "actions", headerName: "", width: 80, pinned: "right", sortable: false, resizable: false, filter: false,
                cellRenderer: ActionsCell, suppressKeyboardEvent: cellButtonKeys,
            },
        ]
    }, [catalog, compareRoster, canManage, canEditMember, onPatch])

    return (
        <div className="members-grid flex-1 min-h-0">
            <AgGridReact<MemberRowState>
                ref={gridRef}
                rowData={members}
                columnDefs={columnDefs}
                defaultColDef={DEFAULT_COL_DEF}
                context={context}
                getRowId={p => p.data.id}
                rowHeight={56}
                rowClass="members-row"
                rowClassRules={ROW_CLASS_RULES}
                singleClickEdit
                stopEditingWhenCellsLoseFocus
                noRowsOverlayComponent={NoMembersOverlay}
            />
        </div>
    )
}

function NoMembersOverlay() {
    return <EmptyState>No members match these filters.</EmptyState>
}

/** Avatar and name; clicking opens the profile editor when the viewer may edit this member. */
function MemberCell({ data: m, context }: CellProps) {
    if (!m) return null
    const onEdit = context.handlers().onEdit(m)
    const name = nameOf(m)
    const goesBy = goesByOf(m)
    return (
        <button
            type="button"
            onClick={onEdit}
            disabled={!onEdit}
            title={onEdit ? "Edit member" : undefined}
            className={`flex items-center gap-3 min-w-0 w-full text-left rounded-lg enabled:cursor-pointer ${focusRing}`}
        >
            <MemberAvatar name={name} picture={m.picture} />
            <span className="flex flex-col min-w-0">
                <span className={`text-sm font-medium truncate theme-h1-color ${isDirty(m, ["name", "display_name"]) ? "italic" : ""}`}>{name}</span>
                {goesBy && <span className="text-xs truncate theme-subtext-color">{goesBy}</span>}
            </span>
        </button>
    )
}

function RoleCell({ data: m, context }: CellProps) {
    if (!m) return null
    const role = m.role ? context.handlers().roleById.get(m.role) : undefined
    return (
        <span className="flex items-center gap-2 min-w-0">
            <span className={`text-sm truncate theme-text ${isDirty(m, ["role"]) ? "italic" : ""}`}>{roleTextOf(m, role)}</span>
            {role?.level === "lead" && <LeadBadge />}
        </span>
    )
}

function StatusCell({ data: m }: CellProps) {
    if (!m) return null
    const kiosk = kioskGrantOf(m)
    return (
        <span className="flex items-center gap-1.5 min-w-0">
            {/* A staged, unsaved moderation change is italicised until Save/Reset. */}
            <span className={`text-sm theme-text ${isDirty(m, PENDING) ? "italic" : ""}`}>{STATUS_LABEL[statusOf(m)]}</span>
            {kiosk && <KioskBadge grant={kiosk} />}
        </span>
    )
}

function TagsCell({ data: m, context }: CellProps) {
    if (!m) return null
    const onEditTags = context.handlers().onEditTags(m)
    return (
        <span className="flex items-center gap-1 min-w-0 w-full">
            <span className="flex items-center gap-1 min-w-0 overflow-hidden" title={m.tags.join(", ") || undefined}>
                {m.tags.map(t => (
                    <span key={t} className="text-xs px-2 py-0.5 rounded-full shrink-0" style={tagChip}>{t}</span>
                ))}
            </span>
            {onEditTags && (
                <button
                    type="button"
                    onClick={onEditTags}
                    title="Edit tags"
                    aria-label={`Edit tags for ${nameOf(m)}`}
                    className={`members-tag-edit shrink-0 rounded-lg p-0.5 theme-subtext-color opacity-0 focus:opacity-100 hover:opacity-70 transition-opacity ${focusRing}`}
                >
                    <Tag size={14} />
                </button>
            )}
        </span>
    )
}

/** The member's one moderation action, then the "…" menu with the rest. */
function ActionsCell({ data: m, context }: CellProps) {
    if (!m) return null
    const h = context.handlers()
    const action = h.actionFor(m)
    const onEdit = h.onEdit(m)
    const onEditTags = h.onEditTags(m)
    const kioskBlocked = h.kioskBlocked(m)
    const kiosk = kioskGrantOf(m)
    const Icon = action.icon
    return (
        <span className="flex items-center gap-1">
            <button
                type="button"
                onClick={action.onClick}
                disabled={action.disabled}
                title={action.reason ?? action.label}
                aria-label={`${action.label} ${nameOf(m)}`}
                className={`members-action w-8 h-8 rounded-lg border border-transparent grid place-items-center theme-subtext-color cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed ${focusRing}`}
            >
                <Icon size={14} />
            </button>
            <RowMenu
                label={`More actions for ${nameOf(m)}`}
                items={[
                    { label: "Edit profile", icon: Pencil, onClick: onEdit, reason: onEdit ? undefined : "This member is outside your editing scope" },
                    { label: "Edit tags", icon: Tag, onClick: onEditTags, reason: onEditTags ? undefined : "You can't edit tags" },
                    { label: kiosk ? "Change kiosk access…" : "Grant kiosk access…", icon: ScanLine, onClick: kioskBlocked ? undefined : () => h.onKioskAccess(m), reason: kioskBlocked, divider: true },
                    ...(kiosk ? [{ label: "Revoke kiosk access", icon: X, onClick: kioskBlocked ? undefined : () => h.onRevokeKiosk(m), reason: kioskBlocked, danger: true }] : []),
                ]}
            />
        </span>
    )
}

/** Marks a member holding a live kiosk grant; the tooltip says when it ends. */
function KioskBadge({ grant }: { grant: "no_end" | Date }) {
    const text = `Kiosk access · ${kioskGrantLabel(grant)}`
    return (
        <span
            title={text}
            aria-label={text}
            className="inline-flex items-center gap-1 text-xs font-semibold px-1.5 py-0.5 rounded-full shrink-0"
            style={tagChip}
        >
            <ScanLine size={12} aria-hidden /> Kiosk
        </span>
    )
}

interface RowMenuItem {
    label: string
    icon: typeof Check
    /** Absent = disabled; `reason` becomes the tooltip. */
    onClick?: () => void
    reason?: string
    /** Draw a separator above this item. */
    divider?: boolean
    danger?: boolean
}

/**
 * Desktop row "…" menu: an anchored menu (design-system/modals.md, z-40). Grid
 * cells clip what overflows them, so the menu renders on <body>, fixed beside its
 * button, opening upward when there isn't room below. Arrow keys move between
 * items; Esc, an outside click, or scrolling the roster closes it.
 */
function RowMenu({ label, items }: { label: string; items: RowMenuItem[] }) {
    const [pos, setPos] = useState<{ top?: number; bottom?: number; right: number } | null>(null)
    const open = pos !== null
    const triggerRef = useRef<HTMLButtonElement>(null)
    const menuRef = useRef<HTMLDivElement>(null)

    const close = useCallback((refocus: boolean) => {
        setPos(null)
        if (refocus) triggerRef.current?.focus()
    }, [])

    useEffect(() => {
        if (!open) return
        const outside = (target: EventTarget | null) =>
            !menuRef.current?.contains(target as Node) && !triggerRef.current?.contains(target as Node)
        const onDown = (e: MouseEvent) => { if (outside(e.target)) close(false) }
        // The menu is fixed where the button was; once anything scrolls, it no longer lines up.
        const onScroll = (e: Event) => { if (!menuRef.current?.contains(e.target as Node)) close(false) }
        const onResize = () => close(false)
        document.addEventListener("mousedown", onDown)
        window.addEventListener("scroll", onScroll, true)
        window.addEventListener("resize", onResize)
        menuRef.current?.querySelector<HTMLButtonElement>("button:not(:disabled)")?.focus()
        return () => {
            document.removeEventListener("mousedown", onDown)
            window.removeEventListener("scroll", onScroll, true)
            window.removeEventListener("resize", onResize)
        }
    }, [open, close])

    const toggle = () => {
        const trigger = triggerRef.current
        if (open || !trigger) { close(false); return }
        const rect = trigger.getBoundingClientRect()
        const right = window.innerWidth - rect.right
        const upward = window.innerHeight - rect.bottom < 44 * items.length + 24
        setPos(upward ? { bottom: window.innerHeight - rect.top + 6, right } : { top: rect.bottom + 6, right })
    }

    const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
        e.stopPropagation()
        if (e.key === "Escape") { close(true); return }
        if (e.key === "Tab") { close(false); return }
        if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return
        e.preventDefault()
        const enabled = [...(menuRef.current?.querySelectorAll<HTMLButtonElement>("button:not(:disabled)") ?? [])]
        const i = enabled.indexOf(document.activeElement as HTMLButtonElement)
        enabled[(i + (e.key === "ArrowDown" ? 1 : -1) + enabled.length) % enabled.length]?.focus()
    }

    return (
        <>
            <button
                ref={triggerRef}
                type="button"
                onClick={toggle}
                aria-label={label}
                title="More actions"
                aria-haspopup="menu"
                aria-expanded={open}
                className={`members-action w-8 h-8 rounded-lg border border-transparent grid place-items-center theme-subtext-color cursor-pointer ${focusRing}`}
                style={open ? { borderColor: "var(--theme-border)", color: "var(--theme-h1-color)" } : undefined}
            >
                <MoreHorizontal size={16} />
            </button>
            {open && createPortal(
                <div
                    ref={menuRef}
                    role="menu"
                    aria-label={label}
                    onKeyDown={onKeyDown}
                    className="fixed z-40 w-60 rounded-xl border shadow-lg theme-border p-1 flex flex-col"
                    style={{ ...pos, background: "var(--theme-bg)" }}
                >
                    {items.map(item => {
                        const ItemIcon = item.icon
                        return (
                            <div key={item.label} className="flex flex-col">
                                {item.divider && <div className="my-1 border-t theme-border" role="separator" />}
                                <button
                                    type="button"
                                    role="menuitem"
                                    disabled={!item.onClick}
                                    title={item.onClick ? undefined : item.reason}
                                    onClick={() => { close(true); item.onClick?.() }}
                                    className={`members-menu-item ${menuRowClass} font-medium cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed`}
                                    style={{ color: item.danger ? "var(--theme-danger)" : "var(--theme-text)" }}
                                >
                                    <span className="flex items-center gap-3 min-w-0">
                                        <ItemIcon size={16} className="shrink-0" aria-hidden />
                                        <span className="truncate">{item.label}</span>
                                    </span>
                                </button>
                            </div>
                        )
                    })}
                </div>,
                document.body,
            )}
        </>
    )
}

/** Small status chip for the mobile list; approved members carry none to keep rows quiet. */
function StatusPill({ status, dirty }: { status: Status; dirty: boolean }) {
    return (
        <span
            className={`text-xs font-semibold px-2 py-0.5 rounded-full shrink-0 ${dirty ? "italic" : ""}`}
            style={status === "pending"
                ? tagChip
                : { background: "var(--theme-button-hover)", color: "var(--theme-subtext-color)" }}
        >
            {STATUS_LABEL[status]}
        </span>
    )
}

interface MemberListRowProps {
    member: MemberRowState
    role: RoleCatalogEntry | undefined
    onOpen: () => void
}

/** Mobile roster row: the whole row is one tap target that opens the member's sheet. */
function MemberListRow({ member: m, role, onOpen }: MemberListRowProps) {
    const name = nameOf(m)
    const status = statusOf(m)
    const statusDirty = isDirty(m, PENDING)
    const sub = [roleTextOf(m, role), gradeLabel(m.grade, m.team_year)].filter(v => v !== "—").join(" · ")

    return (
        <button
            type="button"
            onClick={onOpen}
            className={`members-list-row w-full flex items-center gap-3 px-4 py-3 text-left cursor-pointer ${focusRing}`}
            style={{ borderBottom: "1px solid var(--ag-grid-row-border)", opacity: m.banned_at ? 0.6 : 1 }}
        >
            <MemberAvatar name={name} picture={m.picture} size={40} />
            <span className="flex flex-col gap-1 flex-1 min-w-0">
                <span className="flex items-center gap-2 min-w-0">
                    <span className={`text-base font-medium truncate theme-h1-color ${isDirty(m, EDITABLE) ? "italic" : ""}`}>{name}</span>
                    {role?.level === "lead" && <LeadBadge />}
                </span>
                <span className="text-xs truncate theme-subtext-color">{sub || goesByOf(m) || "No role"}</span>
                {m.tags.length > 0 && (
                    <span className="flex flex-wrap gap-1">
                        {m.tags.map(t => (
                            <span key={t} className="text-xs px-1.5 py-0.5 rounded-full" style={tagChip}>{t}</span>
                        ))}
                    </span>
                )}
            </span>
            {kioskGrantOf(m) && <ScanLine size={16} className="shrink-0 theme-text-contrast" aria-label="Has kiosk access" />}
            {(status !== "approved" || statusDirty) && <StatusPill status={status} dirty={statusDirty} />}
            <ChevronRight size={18} className="shrink-0 theme-subtext-color" />
        </button>
    )
}

interface MemberSheetProps {
    member: MemberRowState
    role: RoleCatalogEntry | undefined
    action: RowAction
    onClose: () => void
    /** Absent when the member is outside the viewer's editing scope. */
    onEdit?: () => void
    onEditTags?: () => void
    /** Why kiosk access can't be changed for this member; undefined when it can. */
    kioskBlocked?: string
    onKioskAccess: () => void
}

/**
 * Mobile bottom sheet for one member: their details plus every action the
 * desktop row spreads across columns (profile edit, tags, approve/ban/unban).
 * Like the grid, moderation only stages the change — Save still persists it.
 */
function MemberSheet({ member: m, role, action, onClose, onEdit, onEditTags, kioskBlocked, onKioskAccess }: MemberSheetProps) {
    const name = nameOf(m)
    const goesBy = goesByOf(m)
    const kiosk = kioskGrantOf(m)
    const statusDirty = isDirty(m, PENDING)
    const Icon = action.icon

    const details: [string, ReactNode][] = [
        ["Email", m.email ?? "Hidden"],
        ["Role", (
            <span className="flex items-center justify-end gap-2">
                {role?.label ?? (m.role ? pretty(m.role) : "—")}
                {role?.level === "lead" && <LeadBadge />}
            </span>
        )],
        ["Grade", gradeLabel(m.grade, m.team_year)],
        ["Status", (
            <span className={statusDirty ? "italic" : ""}>
                {STATUS_LABEL[statusOf(m)]}{statusDirty ? " (unsaved)" : ""}
            </span>
        )],
        ["Kiosk access", kiosk ? kioskGrantLabel(kiosk) : "None"],
    ]

    return (
        <Sheet title={name} onClose={onClose}>
            <div className="flex flex-col gap-4">
                <div className="flex items-center gap-3">
                    <MemberAvatar name={name} picture={m.picture} size={44} />
                    <div className="flex flex-col min-w-0 flex-1">
                        <span className={`text-base font-semibold truncate theme-h1-color ${isDirty(m, EDITABLE) ? "italic" : ""}`}>{name}</span>
                        {goesBy && <span className="text-xs truncate theme-subtext-color">{goesBy}</span>}
                    </div>
                </div>

                <dl className="flex flex-col rounded-xl border theme-border">
                    {details.map(([label, value], i) => (
                        <div
                            key={label}
                            className="flex items-center justify-between gap-4 px-4 py-2.5"
                            style={i ? { borderTop: "1px solid var(--ag-grid-row-border)" } : undefined}
                        >
                            <dt className="text-xs shrink-0 theme-subtext-color">{label}</dt>
                            <dd className="text-sm text-right min-w-0 truncate theme-text">{value}</dd>
                        </div>
                    ))}
                </dl>

                {(m.tags.length > 0 || onEditTags) && (
                    <div className="flex flex-col gap-2">
                        <span className="text-xs theme-subtext-color">Tags</span>
                        <div className="flex flex-wrap gap-1.5">
                            {m.tags.length === 0 && <span className="text-xs theme-subtext-color">No tags yet</span>}
                            {m.tags.map(t => (
                                <span key={t} className="text-xs px-2 py-0.5 rounded-full" style={tagChip}>{t}</span>
                            ))}
                        </div>
                    </div>
                )}

                <div className="flex flex-col gap-2">
                    {onEdit && (
                        <Button className="w-full" onClick={onEdit}>
                            <Pencil size={16} /> Edit profile &amp; role
                        </Button>
                    )}
                    {onEditTags && (
                        <Button variant="outlined" className="w-full" onClick={onEditTags}>
                            <Tag size={16} /> Edit tags
                        </Button>
                    )}
                    <Button variant="outlined" className="w-full" onClick={onKioskAccess} disabled={!!kioskBlocked}>
                        <ScanLine size={16} /> {kiosk ? "Change kiosk access" : "Grant kiosk access"}
                    </Button>
                    {kioskBlocked && <p className={`text-center ${helperClass}`}>{kioskBlocked}</p>}
                    <Button
                        variant="outlined"
                        className="w-full"
                        onClick={() => { action.onClick(); onClose() }}
                        disabled={action.disabled}
                    >
                        <Icon size={16} /> {action.label}
                    </Button>
                    {action.disabled && action.reason && (
                        <p className={`text-center ${helperClass}`}>{action.reason}</p>
                    )}
                </div>

                <p className={`text-center ${helperClass}`}>
                    Profile and status changes are staged — press Save to keep them. Kiosk access applies right away.
                </p>
            </div>
        </Sheet>
    )
}

interface EditMemberModalProps {
    member: MemberRowState
    catalog: RoleCatalogEntry[]
    /** False for Leads: they can edit names/grade/year but the role stays locked. */
    canChangeRole: boolean
    onClose: () => void
    /** Stages the edited fields on the row; they persist on Save like any other change. */
    onApply: (patch: Pick<MemberRow, EditableField>) => void
}

/** Profile editor — opened from a member's row (desktop) or sheet (mobile). */
function EditMemberModal({ member, catalog, canChangeRole, onClose, onApply }: EditMemberModalProps) {
    const [draft, setDraft] = useState<Pick<MemberRow, EditableField>>({
        name: member.name, display_name: member.display_name, role: member.role,
        grade: member.grade, team_year: member.team_year,
    })
    const set = (patch: Partial<typeof draft>) => setDraft(d => ({ ...d, ...patch }))
    const dirty = useIsDirty(draft)
    const confirmDiscard = useDiscardGuard(dirty)

    const fieldClass = `w-full ${inputClass}`
    const triggerClass = DROPDOWN_TRIGGER
    const roleOptions = catalog.map(c => ({ value: c.value, label: c.label }))
    const enumOptions = (vals: string[]) => vals.map(v => ({ value: v, label: v ? pretty(v) : "—" }))

    return (
        <Sheet
            title={`Edit — ${member.name ?? member.display_name ?? member.email}`}
            onClose={onClose}
            dirty={dirty}
            footer={
                <FormFooter safeArea>
                    <Button variant="outlined" size="footer" className="ml-auto" onClick={() => void confirmDiscard().then(ok => { if (ok) onClose() })}>Cancel</Button>
                    <Button
                        size="footer"
                        onClick={() => onApply({ ...draft, name: norm(draft.name), display_name: norm(draft.display_name) })}
                    >
                        Apply
                    </Button>
                </FormFooter>
            }
        >
            <div className="flex flex-col gap-4">
                <label className={`flex flex-col gap-1.5 ${fieldLabelClass}`}>
                    Name
                    <input className={fieldClass} value={draft.name ?? ""} onChange={e => set({ name: e.target.value })} />
                </label>
                <label className={`flex flex-col gap-1.5 ${fieldLabelClass}`}>
                    Display name
                    <input className={fieldClass} value={draft.display_name ?? ""} onChange={e => set({ display_name: e.target.value })} />
                </label>
                <div className={`flex flex-col gap-1.5 ${fieldLabelClass}`}>
                    Role
                    <Dropdown value={draft.role ?? ""} options={roleOptions} onChange={v => set({ role: v })}
                              label="Role" placeholder="—" triggerClassName={triggerClass} disabled={!canChangeRole} />
                    {!canChangeRole && <span className={`font-normal ${helperClass}`}>Only Captains, Mentors and the Scouting Lead can change roles.</span>}
                </div>
                <div className="grid grid-cols-2 gap-3">
                    <div className={`flex flex-col gap-1.5 ${fieldLabelClass}`}>
                        Grade
                        <Dropdown value={draft.grade ?? ""} options={enumOptions(GRADE_OPTIONS)} onChange={v => set({ grade: v })}
                                  label="Grade" triggerClassName={triggerClass} />
                    </div>
                    <div className={`flex flex-col gap-1.5 ${fieldLabelClass}`}>
                        Year
                        <Dropdown value={draft.team_year ?? ""} options={enumOptions(YEAR_OPTIONS)} onChange={v => set({ team_year: v })}
                                  label="Year" triggerClassName={triggerClass} />
                    </div>
                </div>

                <p className={helperClass}>
                    Changes are staged — press Save on the roster to keep them.
                </p>
            </div>
        </Sheet>
    )
}

interface TagsModalProps {
    member: MemberRowState
    onClose: () => void
    onAdd: (userId: string, tag: string) => Promise<void>
    onRemove: (userId: string, tag: string) => Promise<void>
}

function TagsModal({ member, onClose, onAdd, onRemove }: TagsModalProps) {
    const [tags, setTags] = useState<string[]>(member.tags ?? [])
    const [input, setInput] = useState("")
    const [busy, setBusy] = useState(false)
    const [tagError, setTagError] = useState<string | null>(null)
    const inputRef = useRef<HTMLInputElement>(null)

    useEffect(() => { inputRef.current?.focus() }, [])

    async function handleAdd() {
        const tag = input.trim().toLowerCase()
        if (!TAG_RE.test(tag)) {
            setTagError("Lowercase letters, numbers, and underscores only (1–64 chars)")
            return
        }
        if (tags.includes(tag)) {
            setTagError("Tag already assigned")
            return
        }
        setTagError(null)
        setBusy(true)
        try {
            await onAdd(member.id, tag)
            setTags(prev => [...prev, tag].sort())
            setInput("")
        } finally {
            setBusy(false)
        }
    }

    async function handleRemove(tag: string) {
        setBusy(true)
        try {
            await onRemove(member.id, tag)
            setTags(prev => prev.filter(t => t !== tag))
        } finally {
            setBusy(false)
        }
    }

    return (
        <Sheet title={`Tags — ${member.display_name ?? member.name}`} onClose={onClose}>
            <div className="flex flex-col gap-4">
                <div className="flex flex-wrap gap-1.5 min-h-8">
                    {tags.length === 0 && (
                        <span className="text-xs theme-subtext-color">No tags yet</span>
                    )}
                    {tags.map(t => (
                        <span
                            key={t}
                            className="flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium"
                            style={{ background: "color-mix(in oklch, var(--theme-text-contrast) 15%, transparent)", color: "var(--theme-text-contrast)" }}
                        >
                            {t}
                            <button
                                onClick={() => void handleRemove(t)}
                                disabled={busy}
                                aria-label={`Remove tag ${t}`}
                                className={`rounded-full hover:opacity-60 transition-opacity disabled:opacity-40 disabled:cursor-not-allowed ${focusRing}`}
                            >
                                <X size={14} />
                            </button>
                        </span>
                    ))}
                </div>

                <div className="flex gap-2">
                    <input
                        ref={inputRef}
                        value={input}
                        onChange={e => { setInput(e.target.value); setTagError(null) }}
                        onKeyDown={e => { if (e.key === "Enter") void handleAdd() }}
                        placeholder="new_tag"
                        aria-label="New tag"
                        disabled={busy}
                        className={`flex-1 min-w-0 ${inputClass}`}
                    />
                    <Button onClick={() => void handleAdd()} disabled={busy || !input.trim()}>
                        <Plus size={16} />
                        Add
                    </Button>
                </div>

                {tagError && (
                    <p className={fieldErrorClass}>{tagError}</p>
                )}

                <p className={helperClass}>
                    Tag changes save immediately and don't require pressing Save.
                </p>
            </div>
        </Sheet>
    )
}

/** Preset kiosk grant lengths in minutes; null = no end. */
const KIOSK_PRESETS: { key: string; label: string; minutes: number | null }[] = [
    { key: "5m",   label: "5 min",  minutes: 5 },
    { key: "15m",  label: "15 min", minutes: 15 },
    { key: "1h",   label: "1 hr",   minutes: 60 },
    { key: "8h",   label: "8 hr",   minutes: 480 },
    { key: "none", label: "No end", minutes: null },
]

const CUSTOM_UNITS = [
    { value: "1",    label: "Minutes" },
    { value: "60",   label: "Hours" },
    { value: "1440", label: "Days" },
]

/** Mirrors the backend cap (KIOSK_ACCESS_MAX_MINUTES): one year. */
const KIOSK_MAX_MINUTES = 60 * 24 * 365

interface KioskAccessModalProps {
    member: MemberRowState
    onClose: () => void
    /** Minutes from now, null for no end, or "revoke". Rejects with a user-facing message. */
    onSubmit: (minutes: number | null | "revoke") => Promise<void>
}

/**
 * Grant a member kiosk access for a set time: they can scan member codes with
 * their phone and set up a kiosk by showing their own code. Unlike profile
 * edits this applies immediately — kiosk access isn't part of Save/Reset.
 */
function KioskAccessModal({ member, onClose, onSubmit }: KioskAccessModalProps) {
    const current = kioskGrantOf(member)
    const [choice, setChoice] = useState("1h")
    const [customAmount, setCustomAmount] = useState("30")
    const [customUnit, setCustomUnit] = useState("1")
    const [busy, setBusy] = useState(false)
    const [submitError, setSubmitError] = useState<string | null>(null)

    const firstName = (member.display_name ?? nameOf(member)).split(" ")[0]
    const amount = Number(customAmount)
    const customMinutes = Math.round(amount * Number(customUnit))
    const customInvalid = choice === "custom" && (!customAmount.trim() || !Number.isFinite(amount) || customMinutes < 1)
    const customTooLong = choice === "custom" && !customInvalid && customMinutes > KIOSK_MAX_MINUTES
    const minutes: number | null = choice === "custom"
        ? customMinutes
        : KIOSK_PRESETS.find(p => p.key === choice)?.minutes ?? null
    const endsAt = minutes == null ? null : new Date(Date.now() + minutes * 60_000)

    const run = async (value: number | null | "revoke") => {
        setBusy(true)
        setSubmitError(null)
        try {
            await onSubmit(value)
            onClose()
        } catch (e) {
            setSubmitError(e instanceof Error ? e.message : "Couldn't update kiosk access")
            setBusy(false)
        }
    }

    const chip = (key: string, label: string) => {
        const selected = choice === key
        return (
            <button
                key={key}
                type="button"
                role="radio"
                aria-checked={selected}
                onClick={() => setChoice(key)}
                className={`min-h-11 md:min-h-10 px-3 rounded-lg border text-sm font-medium cursor-pointer transition-colors ${focusRing}`}
                style={selected
                    ? { ...tagChip, borderColor: "var(--theme-text-contrast)" }
                    : { borderColor: "var(--theme-border)", color: "var(--theme-text)" }}
            >
                {label}
            </button>
        )
    }

    return (
        <Sheet
            title={`Kiosk access — ${nameOf(member)}`}
            onClose={onClose}
            footer={
                <FormFooter safeArea>
                    {current && (
                        <Button variant="dangerOutlined" size="footer" className="mr-auto" disabled={busy} onClick={() => void run("revoke")}>
                            Revoke
                        </Button>
                    )}
                    <Button variant="outlined" size="footer" className={current ? "" : "ml-auto"} onClick={onClose} disabled={busy}>
                        Cancel
                    </Button>
                    <Button size="footer" disabled={busy || customInvalid || customTooLong} onClick={() => void run(minutes)}>
                        {busy ? "Saving…" : current ? "Update" : "Grant"}
                    </Button>
                </FormFooter>
            }
        >
            <div className="flex flex-col gap-4">
                <p className="text-sm theme-text">
                    Lets {firstName} scan member codes to check people in, and set up a kiosk by showing their own code.
                </p>

                {current && (
                    <div className="flex items-center gap-2 rounded-xl border theme-border px-4 py-2.5">
                        <ScanLine size={16} className="shrink-0 theme-text-contrast" aria-hidden />
                        <span className="text-sm theme-text">
                            Has access now · <span className="theme-subtext-color">{kioskGrantLabel(current)}</span>
                        </span>
                    </div>
                )}

                <div className={`flex flex-col gap-1.5 ${fieldLabelClass}`}>
                    <span id="kiosk-duration-label">Duration</span>
                    <div role="radiogroup" aria-labelledby="kiosk-duration-label" className="grid grid-cols-3 gap-2 font-normal">
                        {KIOSK_PRESETS.map(p => chip(p.key, p.label))}
                        {chip("custom", "Custom")}
                    </div>
                </div>

                {choice === "custom" && (
                    <div className="grid grid-cols-2 gap-3">
                        <label className={`flex flex-col gap-1.5 ${fieldLabelClass}`}>
                            Amount
                            <input
                                type="number"
                                inputMode="decimal"
                                min={1}
                                step="any"
                                value={customAmount}
                                onChange={e => setCustomAmount(e.target.value)}
                                className={`w-full ${inputClass}`}
                                aria-invalid={customInvalid || customTooLong}
                            />
                        </label>
                        <div className={`flex flex-col gap-1.5 ${fieldLabelClass}`}>
                            Unit
                            <Dropdown value={customUnit} options={CUSTOM_UNITS} onChange={setCustomUnit}
                                      label="Unit" triggerClassName={DROPDOWN_TRIGGER} />
                        </div>
                    </div>
                )}

                {customInvalid ? <p className={fieldErrorClass}>Enter a length of at least 1 minute.</p>
                    : customTooLong ? <p className={fieldErrorClass}>Up to 365 days — pick No end for longer.</p>
                    : (
                        <p className={helperClass}>
                            {endsAt ? `Ends ${formatEnd(endsAt)}.` : "Stays on until you revoke it."}
                            {" "}Kiosks {firstName} sets up stop working when access ends.
                        </p>
                    )}

                {submitError && <Notice>{submitError}</Notice>}

                <p className={helperClass}>Kiosk access applies right away — no need to press Save.</p>
            </div>
        </Sheet>
    )
}
