import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react"
import { useBootstrapped } from "@/contexts/bootstrapContext"
import { Link } from "react-router-dom"
import { Ban, Check, ChevronLeft, Plus, RotateCcw, Tag, X } from "lucide-react"
import { useAuth } from "@/contexts/authContext"
import { can, canModerate, getPerm, type RoleCatalogEntry } from "@/lib/permissions"
import Dropdown from "@/components/ui/Dropdown"

const API = import.meta.env.VITE_BACKEND_URL

interface MemberRow {
    id: string
    // Null when the server masks it — currently only a Mentor's email, hidden
    // from viewers who aren't Captain/Mentor themselves (Leads).
    email: string | null
    name: string | null
    display_name: string | null
    role: string | null
    grade: string | null
    team_year: string | null
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

/** Shared column template for the header and every row. */
const GRID_COLS = "minmax(0,1.5fr) minmax(0,1.6fr) minmax(0,1.3fr) minmax(0,1.1fr) 110px minmax(0,0.7fr) 40px"

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

function initials(name: string): string {
    return name.trim().split(/\s+/).map(w => w.charAt(0).toUpperCase()).join("").slice(0, 2) || "?"
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
 * Status tabs, a subteam filter and search narrow the groups as well as the
 * rows. Leads come first in each group and banned accounts are collected at the
 * bottom. Approve/ban/unban and (for Captains/Mentors) profile edits made in the
 * row editor are staged locally; "Reset" reverts every row to its DB snapshot and
 * "Save" persists only the changed rows. The route guard and the `/members`
 * endpoint both enforce `control_panel.members` — this UI is cosmetic, the
 * backend is the real boundary.
 */
export default function MembersPage() {
    const { user } = useAuth()

    // Bootstrap pre-seeds — null means "not yet resolved", [] means "resolved but empty"
    const [bMembers] = useBootstrapped<MemberRow[] | null>("members", null)
    const [bTagMap]  = useBootstrapped<Record<string, string[]> | null>("tag_assignments", null)

    const [rows, setRows] = useState<MemberRowState[]>(() => {
        if (!bMembers) return []
        const tagMap = bTagMap ?? {}
        return bMembers.map(m => ({ ...m, tags: tagMap[m.id] ?? [], _orig: snapshot(m) }))
    })
    const [catalog, setCatalog] = useState<RoleCatalogEntry[]>([])

    // Full management (profile/role editing) is Captains/Mentors only; Leads
    // reach this page to moderate their subteam but can't edit profiles.
    const canManage = can(user?.permissions, "control_panel.members")
    // Tag editing is available to anyone with roster access: Captains, Mentors,
    // and Leads (anyone with a can_moderate spec on their policy).
    const canEditTags = canManage || Boolean(getPerm(user?.permissions, "can_moderate"))
    const [editingTagsFor, setEditingTagsFor] = useState<string | null>(null)
    const [editingFor, setEditingFor]         = useState<string | null>(null)
    const [loading, setLoading]               = useState(bMembers === null)
    // Tracks whether the real load() has started; prevents bootstrap from overwriting fresh data.
    const loadStarted = useRef(false)
    const [saving, setSaving] = useState(false)
    const [error, setError]   = useState<string | null>(null)

    const [query, setQuery]     = useState("")
    const [tab, setTab]         = useState<Tab>("all")
    const [subteam, setSubteam] = useState("all")

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
            setError("Failed to load members")
        } finally {
            setLoading(false)
        }
    }, [])

    useEffect(() => { void load() }, [load])

    const roleById = useMemo(() => new Map(catalog.map(c => [c.value, c])), [catalog])

    /** Patch one row's staged fields; dirty state is derived from `_orig`. */
    const patchRow = useCallback((id: string, patch: Partial<MemberRowState>) => {
        setRows(prev => prev.map(r => (r.id === id ? { ...r, ...patch } : r)))
    }, [])

    const changes = useMemo(() => rows.filter(r => isDirty(r)).length, [rows])
    const hasChanges = changes > 0

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
            setError("Failed to save changes")
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

    const ql = query.trim().toLowerCase()
    const roleLabel = useCallback((role: string | null) =>
        role ? (roleById.get(role)?.label ?? pretty(role)) : "", [roleById])

    // Search + subteam filter first; tab counts are computed over this set.
    const base = useMemo(() => rows.filter(m => {
        if (subteam !== "all" && groupKeyOf(m) !== subteam) return false
        if (!ql) return true
        return [m.name, m.display_name, m.email, roleLabel(m.role)]
            .some(v => v?.toLowerCase().includes(ql))
    }), [rows, subteam, ql, groupKeyOf, roleLabel])

    const visible = useMemo(() => base.filter(m => tab === "all" || statusOf(m) === tab), [base, tab])

    const groups = useMemo(() => {
        const byName = (a: MemberRow, b: MemberRow) => (a.name ?? "").localeCompare(b.name ?? "")
        const isLead = (m: MemberRow) => (m.role ? roleById.get(m.role)?.level === "lead" : false)
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
                rows: buckets.get(k)!.sort((a, b) => Number(isLead(b)) - Number(isLead(a)) || byName(a, b)),
            }))
        if (banned.length) out.push({ key: BANNED_GROUP, name: "Banned", rows: banned.sort(byName) })
        return out
    }, [visible, groupKeyOf, groupOrder, groupLabel, roleById])

    const subteamOptions = useMemo(() => {
        const present = new Set(rows.map(groupKeyOf))
        return [
            { value: "all", label: "All subteams" },
            ...groupOrder.filter(([k]) => present.has(k)).map(([value, label]) => ({ value, label })),
        ]
    }, [rows, groupKeyOf, groupOrder])

    const counts = useMemo(() => {
        const c = { approved: 0, pending: 0, banned: 0 }
        for (const m of rows) c[statusOf(m)]++
        return c
    }, [rows])

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

    const editingMember = editingFor ? rows.find(r => r.id === editingFor) : undefined
    const editingTagsMember = editingTagsFor ? rows.find(r => r.id === editingTagsFor) : undefined

    return (
        <div className="px-4 py-6 flex flex-col gap-4 h-full">
            <div className="rounded-[14px] border overflow-hidden theme-border theme-bg flex flex-col flex-1 min-h-0">
                <div className="flex flex-wrap items-center gap-4 px-6 py-5">
                    <Link
                        to="/control"
                        aria-label="Back to Control Panel"
                        className="md:hidden flex items-center justify-center w-9 h-9 -ml-2 -mr-2 rounded-lg theme-text opacity-60 hover:opacity-100 transition-opacity"
                    >
                        <ChevronLeft size={22} />
                    </Link>
                    <div className="flex flex-col gap-0.5 flex-1 min-w-0">
                        <h1 className="text-2xl font-bold theme-h1-color">Members</h1>
                        <span className="text-[13px] theme-subtext-color">
                            {counts.approved} approved · {counts.pending} pending · {counts.banned} banned
                        </span>
                    </div>
                    {hasChanges && (
                        <span className="text-[13px] theme-text-contrast">
                            {changes} unsaved change{changes > 1 ? "s" : ""}
                        </span>
                    )}
                    <button
                        onClick={handleReset}
                        disabled={!hasChanges || saving}
                        className="rounded-lg border px-3.5 py-2 text-sm theme-text theme-border transition-opacity hover:opacity-80 disabled:cursor-not-allowed"
                    >
                        Reset
                    </button>
                    <button
                        onClick={() => void handleSave()}
                        disabled={!hasChanges || saving}
                        className="rounded-lg px-[18px] py-[9px] text-sm font-semibold transition-opacity hover:opacity-90 disabled:opacity-45 disabled:cursor-not-allowed"
                        style={{ background: "var(--theme-text-contrast)", color: "var(--theme-bg)" }}
                    >
                        {saving ? "Saving…" : "Save"}
                    </button>
                </div>

                <div className="flex flex-wrap items-center gap-3 px-6 pb-4 border-b theme-border">
                    <div className="flex gap-1 p-1 rounded-[10px]" style={{ background: "var(--ag-grid-chrome-bg)" }}>
                        {TABS.map(([k, label]) => (
                            <button
                                key={k}
                                onClick={() => setTab(k)}
                                className="flex items-center gap-1.5 px-3 py-1.5 rounded-[7px] text-[13px] cursor-pointer"
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
                    <div className="w-[200px]">
                        <Dropdown
                            value={subteam}
                            options={subteamOptions}
                            onChange={setSubteam}
                            label="Subteam"
                            triggerClassName="rounded-lg border px-3 py-2 text-sm transition theme-bg theme-border theme-text"
                        />
                    </div>
                    <div className="flex-1" />
                    <input
                        value={query}
                        onChange={e => setQuery(e.target.value)}
                        placeholder="Search name, email, role…"
                        className="members-search w-full sm:w-[280px] rounded-lg border px-3 py-2 text-sm outline-none theme-border theme-text"
                        style={{ background: "var(--ag-grid-chrome-bg)" }}
                    />
                </div>

                {error && (
                    <p className="text-sm px-6 py-2 border-b theme-subtext-color theme-border"
                       style={{ background: "color-mix(in oklch, var(--theme-border) 40%, transparent)" }}>
                        {error}
                    </p>
                )}

                {/* Wide grid scrolls sideways on narrow screens; groups scroll vertically under a fixed header. */}
                <div className="flex-1 min-h-0 overflow-x-auto theme-scrollbar">
                    <div className="min-w-[960px] h-full flex flex-col">
                        <div
                            className="grid gap-4 px-6 py-2.5 text-xs font-semibold uppercase tracking-[.06em] theme-subtext-color"
                            style={{ gridTemplateColumns: GRID_COLS, background: "var(--ag-grid-header-bg)" }}
                        >
                            <span>Member</span><span>Email</span><span>Role</span><span>Grade</span><span>Status</span><span>Tags</span><span />
                        </div>
                        <div className="flex-1 min-h-0 overflow-y-auto theme-scrollbar">
                            {loading ? (
                                <div className="px-6 py-10 text-center text-sm theme-subtext-color">Loading members…</div>
                            ) : groups.length === 0 ? (
                                <div className="px-6 py-10 text-center text-sm theme-subtext-color">No members match these filters.</div>
                            ) : groups.map(g => (
                                <div key={g.key} className="flex flex-col">
                                    <div className="sticky top-0 z-[1] flex items-baseline gap-2.5 px-6 pt-3.5 pb-2 border-b theme-border theme-bg">
                                        <span className="text-[15px] font-semibold theme-h1-color">{g.name}</span>
                                        <span className="text-[13px] theme-subtext-color">{g.rows.length}</span>
                                    </div>
                                    {g.rows.map(m => (
                                        <MemberGridRow
                                            key={m.id}
                                            member={m}
                                            role={m.role ? roleById.get(m.role) : undefined}
                                            action={actionFor(m)}
                                            onEdit={canManage ? () => setEditingFor(m.id) : undefined}
                                            onEditTags={canEditTags ? () => setEditingTagsFor(m.id) : undefined}
                                        />
                                    ))}
                                </div>
                            ))}
                        </div>
                    </div>
                </div>
            </div>

            <style>{`
                .members-search::placeholder { color: var(--theme-subtext-color); opacity: .7; }
                .members-row:hover { background: var(--ag-grid-hover-bg); }
                .members-row:hover .members-tag-edit { opacity: 1; }
                .members-action:not(:disabled):hover { border-color: var(--theme-border); color: var(--theme-h1-color); }
            `}</style>

            {editingMember && (
                <EditMemberModal
                    member={editingMember}
                    catalog={catalog}
                    onClose={() => setEditingFor(null)}
                    onApply={patch => { patchRow(editingMember.id, patch); setEditingFor(null) }}
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

interface MemberGridRowProps {
    member: MemberRowState
    role: RoleCatalogEntry | undefined
    action: RowAction
    /** Opens the profile editor; absent for viewers who can't edit profiles (Leads). */
    onEdit?: () => void
    onEditTags?: () => void
}

function MemberGridRow({ member: m, role, action, onEdit, onEditTags }: MemberGridRowProps) {
    const name = m.name ?? m.display_name ?? m.email ?? "Unnamed"
    const firstName = name.split(" ")[0]
    const goesBy = !m.display_name ? "Hasn't finished onboarding"
        : m.display_name !== firstName ? `Goes by ${m.display_name}`
        : !m.email ? "Email hidden" : ""
    // Leads/members show their subteam plus a Lead badge; other roles show their label.
    const roleText = role ? (role.subteam ? role.label.replace(/ (Lead|Member)$/, "") : role.label)
        : m.role ? pretty(m.role) : "—"
    const isLead = role?.level === "lead"
    // A staged, unsaved moderation change is italicised until Save/Reset.
    const statusDirty = isDirty(m, PENDING)
    const Icon = action.icon

    return (
        <div
            className="members-row grid gap-4 items-center px-6 py-2.5"
            style={{
                gridTemplateColumns: GRID_COLS,
                borderBottom: "1px solid var(--ag-grid-row-border)",
                opacity: m.banned_at ? 0.6 : 1,
            }}
        >
            <button
                type="button"
                onClick={onEdit}
                disabled={!onEdit}
                title={onEdit ? "Edit member" : undefined}
                className="flex items-center gap-3 min-w-0 text-left enabled:cursor-pointer"
            >
                <span
                    className="w-8 h-8 rounded-full shrink-0 grid place-items-center text-xs font-semibold theme-h1-color"
                    style={{ background: "var(--theme-button-hover)" }}
                >
                    {initials(name)}
                </span>
                <span className="flex flex-col min-w-0">
                    <span className={`text-sm font-medium truncate theme-h1-color ${isDirty(m, EDITABLE) ? "italic" : ""}`}>{name}</span>
                    {goesBy && <span className="text-xs truncate theme-subtext-color">{goesBy}</span>}
                </span>
            </button>
            <span className="text-[13px] truncate theme-subtext-color">{m.email ?? "Hidden"}</span>
            <div className="flex items-center gap-2 min-w-0">
                <span className="text-sm truncate theme-text">{roleText}</span>
                {isLead && (
                    <span className="text-[11px] font-semibold px-1.5 py-0.5 rounded border theme-text-contrast"
                          style={{ borderColor: "var(--theme-text-contrast)" }}>
                        LEAD
                    </span>
                )}
            </div>
            <span className="text-sm whitespace-nowrap theme-text">{gradeLabel(m.grade, m.team_year)}</span>
            <span className={`text-sm theme-text ${statusDirty ? "italic" : ""}`}>{STATUS_LABEL[statusOf(m)]}</span>
            <div className="flex items-center gap-1 flex-wrap min-w-0">
                {m.tags.map(t => (
                    <span key={t} className="text-xs px-2 py-0.5 rounded truncate max-w-full" style={tagChip}>{t}</span>
                ))}
                {onEditTags && (
                    <button
                        onClick={onEditTags}
                        title="Edit tags"
                        className="members-tag-edit rounded p-0.5 theme-subtext-color opacity-0 focus:opacity-100 hover:opacity-70 transition-opacity"
                    >
                        <Tag size={13} />
                    </button>
                )}
            </div>
            <button
                onClick={action.onClick}
                disabled={action.disabled}
                title={action.reason ?? action.label}
                aria-label={action.label}
                className="members-action w-8 h-8 rounded-md border border-transparent grid place-items-center theme-subtext-color cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
            >
                <Icon size={14} />
            </button>
        </div>
    )
}

interface EditMemberModalProps {
    member: MemberRowState
    catalog: RoleCatalogEntry[]
    onClose: () => void
    /** Stages the edited fields on the row; they persist on Save like any other change. */
    onApply: (patch: Pick<MemberRow, EditableField>) => void
}

/** Profile editor for Captains/Mentors — replaces the old inline grid editing. */
function EditMemberModal({ member, catalog, onClose, onApply }: EditMemberModalProps) {
    const [draft, setDraft] = useState<Pick<MemberRow, EditableField>>({
        name: member.name, display_name: member.display_name, role: member.role,
        grade: member.grade, team_year: member.team_year,
    })
    const set = (patch: Partial<typeof draft>) => setDraft(d => ({ ...d, ...patch }))

    const inputClass = "w-full rounded-lg border px-3 py-2 text-sm outline-none theme-border theme-text theme-bg"
    const triggerClass = "rounded-lg border px-3 py-2 text-sm transition theme-bg theme-border theme-text"
    const roleOptions = catalog.map(c => ({ value: c.value, label: c.label }))
    const enumOptions = (vals: string[]) => vals.map(v => ({ value: v, label: v ? pretty(v) : "—" }))

    return (
        <div
            className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4"
            style={{ background: "rgba(0,0,0,0.5)" }}
            onClick={e => { if (e.target === e.currentTarget) onClose() }}
        >
            <div className="w-full max-w-sm rounded-2xl border p-5 flex flex-col gap-4 theme-bg theme-border">
                <div className="flex items-center gap-2">
                    <h2 className="text-sm font-semibold theme-text-contrast flex-1 truncate">
                        Edit — {member.name ?? member.display_name ?? member.email}
                    </h2>
                    <button onClick={onClose} className="theme-subtext-color hover:opacity-70 transition-opacity">
                        <X size={16} />
                    </button>
                </div>

                <label className="flex flex-col gap-1.5 text-xs theme-subtext-color">
                    Name
                    <input className={inputClass} value={draft.name ?? ""} onChange={e => set({ name: e.target.value })} />
                </label>
                <label className="flex flex-col gap-1.5 text-xs theme-subtext-color">
                    Display name
                    <input className={inputClass} value={draft.display_name ?? ""} onChange={e => set({ display_name: e.target.value })} />
                </label>
                <div className="flex flex-col gap-1.5 text-xs theme-subtext-color">
                    Role
                    <Dropdown value={draft.role ?? ""} options={roleOptions} onChange={v => set({ role: v })}
                              label="Role" placeholder="—" triggerClassName={triggerClass} />
                </div>
                <div className="grid grid-cols-2 gap-3">
                    <div className="flex flex-col gap-1.5 text-xs theme-subtext-color">
                        Grade
                        <Dropdown value={draft.grade ?? ""} options={enumOptions(GRADE_OPTIONS)} onChange={v => set({ grade: v })}
                                  label="Grade" triggerClassName={triggerClass} />
                    </div>
                    <div className="flex flex-col gap-1.5 text-xs theme-subtext-color">
                        Year
                        <Dropdown value={draft.team_year ?? ""} options={enumOptions(YEAR_OPTIONS)} onChange={v => set({ team_year: v })}
                                  label="Year" triggerClassName={triggerClass} />
                    </div>
                </div>

                <div className="flex justify-end gap-2">
                    <button onClick={onClose}
                            className="rounded-lg border px-3.5 py-1.5 text-sm theme-text theme-border hover:opacity-80 transition-opacity">
                        Cancel
                    </button>
                    <button
                        onClick={() => onApply({ ...draft, name: norm(draft.name), display_name: norm(draft.display_name) })}
                        className="rounded-lg px-4 py-1.5 text-sm font-semibold hover:opacity-90 transition-opacity"
                        style={{ background: "var(--theme-text-contrast)", color: "var(--theme-bg)" }}
                    >
                        Apply
                    </button>
                </div>

                <p className="text-xs theme-subtext-color">
                    Changes are staged — press Save on the roster to keep them.
                </p>
            </div>
        </div>
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
        <div
            className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4"
            style={{ background: "rgba(0,0,0,0.5)" }}
            onClick={e => { if (e.target === e.currentTarget) onClose() }}
        >
            <div
                className="w-full max-w-sm rounded-2xl border p-5 flex flex-col gap-4 backdrop-blur-sm theme-bg theme-border"
            >
                <div className="flex items-center gap-2">
                    <Tag size={16} className="theme-subtext-color" />
                    <h2 className="text-sm font-semibold theme-text-contrast flex-1">
                        Tags — {member.display_name ?? member.name}
                    </h2>
                    <button onClick={onClose} className="theme-subtext-color hover:opacity-70 transition-opacity">
                        <X size={16} />
                    </button>
                </div>

                <div className="flex flex-wrap gap-1.5 min-h-[32px]">
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
                                className="hover:opacity-60 transition-opacity disabled:opacity-30"
                            >
                                <X size={11} />
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
                        disabled={busy}
                        className="flex-1 rounded-lg border px-3 py-1.5 text-sm theme-text theme-border theme-bg outline-none focus:ring-1 disabled:opacity-50"
                        style={{ background: "color-mix(in oklch, var(--theme-border) 30%, var(--theme-bg))" }}
                    />
                    <button
                        onClick={() => void handleAdd()}
                        disabled={busy || !input.trim()}
                        className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-semibold transition-opacity hover:opacity-80 disabled:opacity-40 disabled:cursor-not-allowed"
                        style={{ background: "var(--theme-text-contrast)", color: "var(--theme-bg)" }}
                    >
                        <Plus size={14} />
                        Add
                    </button>
                </div>

                {tagError && (
                    <p className="text-xs" style={{ color: "#dc2626" }}>{tagError}</p>
                )}

                <p className="text-xs theme-subtext-color">
                    Tag changes save immediately and don't require pressing Save.
                </p>
            </div>
        </div>
    )
}
