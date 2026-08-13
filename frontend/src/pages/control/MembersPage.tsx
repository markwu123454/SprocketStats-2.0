import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useBootstrapped } from "@/contexts/bootstrapContext"
import { Link } from "react-router-dom"
import { ChevronLeft, Plus, Tag, X } from "lucide-react"
import { AgGridReact } from "ag-grid-react"
import type {
    CellClassParams,
    CellClassRules,
    ColDef,
    ICellRendererParams,
    RowClassParams,
    ValueFormatterParams,
} from "ag-grid-community"
import { useAuth } from "@/contexts/authContext"
import { can, canModerate, getPerm, type RoleCatalogEntry } from "@/lib/permissions"

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

/** Extra data ag-grid cell renderers need but that isn't part of a row. */
interface GridContext {
    currentUserId: string
    /** Whether this member's role is within the current user's approve/ban scope
     *  (Captains/Mentors: everyone; Leads: their own subteam's members + alumni). */
    canModerateRole: (role: string | null) => boolean
    onApprove: (id: string) => void
    onBan: (id: string) => void
    onUnban: (id: string) => void
    /** True for Captains, Mentors, and Leads — anyone with roster access. */
    canEditTags: boolean
    onEditTags: (id: string) => void
}

/** Fields the roster lets you edit; email stays read-only (OAuth identity). */
const EDITABLE = ["name", "display_name", "role", "grade", "team_year"] as const
type EditableField = (typeof EDITABLE)[number]

/** Fields staged like edits (dirty-tracked, reset/save together) but persisted
 *  through their own endpoints on Save rather than the bulk PUT. */
const PENDING = ["approved_by", "banned_at"] as const
type PendingField = (typeof PENDING)[number]

const ALL_TRACKED = [...EDITABLE, ...PENDING] as const

/** A grid row carries its original DB values so we can detect & revert edits. */
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

const enumFormatter = (p: ValueFormatterParams<MemberRowState, string | null>): string =>
    p.value ? pretty(p.value) : "—"

/** Tint + italicise any tracked cell whose value differs from the DB original. */
const DIRTY_RULES: CellClassRules<MemberRowState> = {
    "cell-dirty": (p: CellClassParams<MemberRowState, string | null>) => {
        const field = p.colDef.field as EditableField | PendingField | undefined
        if (!field || !p.data) return false
        return norm(p.data._orig[field]) !== norm(p.value)
    },
}

function snapshot(m: MemberRow): Pick<MemberRow, EditableField | PendingField> {
    return {
        name: m.name, display_name: m.display_name, role: m.role, grade: m.grade, team_year: m.team_year,
        approved_by: m.approved_by, banned_at: m.banned_at,
    }
}

const actionBtn = "rounded-md border px-2 py-0.5 text-xs font-medium theme-border transition-opacity hover:opacity-80 disabled:opacity-40 disabled:cursor-not-allowed"

/** "Approve" button; once approved (even only locally, pending Save) it's
 *  permanently disabled — approving can't be undone from this UI. The
 *  distinct "confirmed" look (greyed "Approved") only appears once the
 *  approval is actually saved — the surrounding cell-dirty class (italic +
 *  tinted background) is what signals a pending, unsaved approval. */
function ApprovedCellRenderer(p: ICellRendererParams<MemberRowState, string | null>) {
    const ctx = p.context as GridContext
    const data = p.data
    if (!data) return null

    if (data.approved_by) {
        const pending = norm(data._orig.approved_by) !== norm(data.approved_by)
        return (
            <button className={actionBtn} disabled style={pending ? undefined : { opacity: 0.5 }}>
                {pending ? "Approve" : "Approved"}
            </button>
        )
    }
    const isSelf = data.id === ctx.currentUserId
    const notOnboarded = !data.display_name
    const inScope = ctx.canModerateRole(data.role)
    return (
        <button
            className={actionBtn}
            disabled={isSelf || notOnboarded || !inScope}
            title={
                isSelf ? "You cannot approve yourself"
                : notOnboarded ? "Member hasn't finished onboarding"
                : !inScope ? "This member is outside your approval scope"
                : "Approve this member"
            }
            onClick={() => ctx.onApprove(data.id)}
        >
            Approve
        </button>
    )
}

/** "Ban" / "Banned" toggle button, driven by `banned_at`. Same deferred-look
 *  treatment as the Approved column: the red "Banned" style only appears once
 *  saved; a pending (unsaved) ban just relies on the cell-dirty styling. */
function BannedCellRenderer(p: ICellRendererParams<MemberRowState, string | null>) {
    const ctx = p.context as GridContext
    const data = p.data
    if (!data) return null
    const isSelf = data.id === ctx.currentUserId
    const inScope = ctx.canModerateRole(data.role)

    if (data.banned_at) {
        const pending = norm(data._orig.banned_at) !== norm(data.banned_at)
        return (
            <button
                className={actionBtn}
                style={pending ? undefined : { color: "#dc2626", borderColor: "color-mix(in oklch, #dc2626 50%, transparent)" }}
                disabled={isSelf || !inScope}
                title={isSelf ? "You cannot unban yourself" : !inScope ? "This member is outside your moderation scope" : "Click to unban"}
                onClick={() => ctx.onUnban(data.id)}
            >
                Banned
            </button>
        )
    }
    return (
        <button
            className={actionBtn}
            disabled={isSelf || !inScope}
            title={isSelf ? "You cannot ban yourself" : !inScope ? "This member is outside your moderation scope" : "Ban this member"}
            onClick={() => ctx.onBan(data.id)}
        >
            Ban
        </button>
    )
}

function TagsCellRenderer(p: ICellRendererParams<MemberRowState, string[]>) {
    const ctx = p.context as GridContext
    const data = p.data
    if (!data) return null
    const tags = data.tags ?? []
    return (
        <div className="flex items-center gap-1 h-full overflow-hidden">
            {tags.slice(0, 3).map(t => (
                <span
                    key={t}
                    className="rounded px-1.5 py-0.5 text-xs font-medium truncate max-w-[80px]"
                    style={{ background: "color-mix(in oklch, var(--theme-text-contrast) 15%, transparent)", color: "var(--theme-text-contrast)" }}
                >
                    {t}
                </span>
            ))}
            {tags.length > 3 && (
                <span className="text-xs theme-subtext-color shrink-0">+{tags.length - 3}</span>
            )}
            {ctx.canEditTags && (
                <button
                    className="ml-auto shrink-0 rounded p-0.5 theme-subtext-color hover:opacity-70 transition-opacity"
                    onClick={() => ctx.onEditTags(data.id)}
                    title="Edit tags"
                >
                    <Tag size={13} />
                </button>
            )}
        </div>
    )
}

/**
 * Members control page — a full-width, editable roster for Captains and Mentors.
 *
 * Every column except email is editable inline (text boxes for names, dropdowns
 * for role/grade/year). Edited cells are highlighted until the change is saved or
 * reset. "Reset" reverts every row to its DB snapshot; "Save" persists only the
 * changed rows. The route guard and the `/members` endpoint both enforce
 * `control_panel.members` — this UI is cosmetic, the backend is the real boundary.
 */
export default function MembersPage() {
    const { user } = useAuth()
    const gridRef = useRef<AgGridReact<MemberRowState>>(null)

    // Bootstrap pre-seeds — null means "not yet resolved", [] means "resolved but empty"
    const [bMembers] = useBootstrapped<MemberRow[] | null>("members", null)
    const [bTagMap]  = useBootstrapped<Record<string, string[]> | null>("tag_assignments", null)

    const [rows, setRows] = useState<MemberRowState[]>(() => {
        if (!bMembers) return []
        const tagMap = bTagMap ?? {}
        return bMembers.map(m => ({ ...m, tags: tagMap[m.id] ?? [], _orig: snapshot(m) }))
    })
    const [catalog, setCatalog]           = useState<RoleCatalogEntry[]>([])
    const [roleOptions, setRoleOptions]   = useState<string[]>([])
    const [roleLabels, setRoleLabels]     = useState<Record<string, string>>({})

    // Full management (inline profile/role editing) is Captains/Mentors only;
    // Leads reach this page to moderate their subteam but see it read-only.
    const canManage = can(user?.permissions, "control_panel.members")
    // Tag editing is available to anyone with roster access: Captains, Mentors,
    // and Leads (anyone with a can_moderate spec on their policy).
    const canEditTags = canManage || Boolean(getPerm(user?.permissions, "can_moderate"))
    const [editingTagsFor, setEditingTagsFor] = useState<string | null>(null)
    const [loading, setLoading]           = useState(bMembers === null)
    // True when bootstrap pre-populated rows at mount — skips the loading overlay
    // on the background refresh since data is already visible.
    const hadBootstrap = useRef(bMembers !== null)
    // Tracks whether the real load() has started; prevents bootstrap from overwriting fresh data.
    const loadStarted = useRef(false)
    const [saving, setSaving]             = useState(false)
    const [hasChanges, setHasChanges]     = useState(false)
    const [error, setError]               = useState<string | null>(null)

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
        if (!hadBootstrap.current) setLoading(true)
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
            if (rRes.ok) {
                const cat = await rRes.json() as RoleCatalogEntry[]
                setCatalog(cat)
                setRoleOptions(cat.map(c => c.value))
                setRoleLabels(Object.fromEntries(cat.map(c => [c.value, c.label])))
            }
            setRows(members.map(m => ({ ...m, tags: tagMap[m.id] ?? [], _orig: snapshot(m) })))
            setHasChanges(false)
        } catch {
            setError("Failed to load members")
        } finally {
            setLoading(false)
        }
    }, [])

    useEffect(() => { void load() }, [load])

    const recomputeDirty = useCallback(() => {
        const api = gridRef.current?.api
        if (!api) return
        let dirty = false
        api.forEachNode(n => {
            const d = n.data
            if (d && ALL_TRACKED.some(f => norm(d._orig[f]) !== norm(d[f]))) dirty = true
        })
        setHasChanges(dirty)
    }, [])

    /** Patch a single row's non-editable (server-authoritative) fields in place,
     *  then recompute dirty state — this bypasses ag-grid's cell editors, so
     *  `onCellValueChanged` never fires for it on its own. */
    const patchRow = useCallback((id: string, patch: Partial<MemberRowState>) => {
        const api = gridRef.current?.api
        if (!api) return
        const node = api.getRowNode(id)
        if (!node?.data) return
        node.setData({ ...node.data, ...patch })
        recomputeDirty()
    }, [recomputeDirty])

    // Approve/ban only stage a local change now — the actual API calls happen
    // in handleSave, alongside the rest of the pending edits, so Reset can
    // still discard them.
    const handleApprove = useCallback((id: string) => {
        if (!user) return
        patchRow(id, { approved_by: user.id })
    }, [patchRow, user])

    const handleBan = useCallback((id: string) => {
        patchRow(id, { banned_at: new Date().toISOString() })
    }, [patchRow])

    const handleUnban = useCallback((id: string) => {
        patchRow(id, { banned_at: null })
    }, [patchRow])

    const handleTagAdd = useCallback(async (userId: string, tag: string) => {
        await fetch(`${API}/tags/user/${userId}/${tag}`, { method: "POST", credentials: "include" })
        const api = gridRef.current?.api
        if (!api) return
        const node = api.getRowNode(userId)
        if (!node?.data) return
        const tags = [...(node.data.tags ?? [])]
        if (!tags.includes(tag)) {
            node.setData({ ...node.data, tags: [...tags, tag].sort() })
        }
    }, [])

    const handleTagRemove = useCallback(async (userId: string, tag: string) => {
        await fetch(`${API}/tags/user/${userId}/${tag}`, { method: "DELETE", credentials: "include" })
        const api = gridRef.current?.api
        if (!api) return
        const node = api.getRowNode(userId)
        if (!node?.data) return
        node.setData({ ...node.data, tags: (node.data.tags ?? []).filter(t => t !== tag) })
    }, [])

    const gridContext = useMemo<GridContext>(() => ({
        currentUserId: user?.id ?? "",
        canModerateRole: (role: string | null) => canModerate(user?.permissions, role, catalog),
        onApprove: handleApprove,
        onBan: handleBan,
        onUnban: handleUnban,
        canEditTags,
        onEditTags: setEditingTagsFor,
    }), [user?.id, user?.permissions, catalog, handleApprove, handleBan, handleUnban, canEditTags])

    const roleFormatter = useCallback(
        (p: ValueFormatterParams<MemberRowState, string | null>): string =>
            p.value ? (roleLabels[p.value] ?? pretty(p.value)) : "—",
        [roleLabels],
    )

    const columnDefs = useMemo<ColDef<MemberRowState>[]>(() => [
        { field: "name",         headerName: "Name",         editable: canManage, cellEditor: "agTextCellEditor", flex: 1.5, minWidth: 140, cellClassRules: DIRTY_RULES },
        { field: "display_name", headerName: "Display Name", editable: canManage, cellEditor: "agTextCellEditor", flex: 1.5, minWidth: 140, cellClassRules: DIRTY_RULES },
        {
            field: "email", headerName: "Email", editable: false, flex: 2, minWidth: 220, cellStyle: { opacity: 0.65 },
            valueFormatter: (p: ValueFormatterParams<MemberRowState, string | null>) => p.value ?? "Hidden",
        },
        {
            field: "role", headerName: "Role", editable: canManage,
            cellEditor: "agSelectCellEditor", cellEditorParams: { values: roleOptions },
            valueFormatter: roleFormatter, flex: 1.3, minWidth: 150, cellClassRules: DIRTY_RULES,
        },
        {
            field: "grade", headerName: "Grade", editable: canManage,
            cellEditor: "agSelectCellEditor", cellEditorParams: { values: GRADE_OPTIONS },
            valueFormatter: enumFormatter, flex: 1, minWidth: 120, cellClassRules: DIRTY_RULES,
        },
        {
            field: "team_year", headerName: "Year", editable: canManage,
            cellEditor: "agSelectCellEditor", cellEditorParams: { values: YEAR_OPTIONS },
            valueFormatter: enumFormatter, flex: 1, minWidth: 110, cellClassRules: DIRTY_RULES,
        },
        {
            field: "approved_by", headerName: "Approved", editable: false,
            cellRenderer: ApprovedCellRenderer, flex: 1, minWidth: 150, cellClassRules: DIRTY_RULES,
        },
        {
            field: "banned_at", headerName: "Banned", editable: false,
            cellRenderer: BannedCellRenderer, flex: 1, minWidth: 110, cellClassRules: DIRTY_RULES,
        },
        {
            field: "tags", headerName: "Tags", editable: false,
            cellRenderer: TagsCellRenderer, flex: 1.5, minWidth: 160, sortable: false,
        },
    ], [roleOptions, roleFormatter, canManage])

    const handleReset = useCallback(() => {
        const api = gridRef.current?.api
        if (!api) return
        api.stopEditing(true)
        api.forEachNode(n => {
            const d = n.data
            if (d) n.setData({ ...d, ...d._orig })
        })
        api.refreshCells({ force: true })
        setHasChanges(false)
    }, [])

    const handleSave = useCallback(async () => {
        const api = gridRef.current?.api
        if (!api) return
        api.stopEditing()

        const editableChanged: MemberRowState[] = []
        const approveChanged: MemberRowState[] = []
        const banChanged: MemberRowState[] = []
        api.forEachNode(n => {
            const d = n.data
            if (!d) return
            if (EDITABLE.some(f => norm(d._orig[f]) !== norm(d[f]))) editableChanged.push(d)
            if (norm(d._orig.approved_by) !== norm(d.approved_by)) approveChanged.push(d)
            if (norm(d._orig.banned_at) !== norm(d.banned_at)) banChanged.push(d)
        })
        if (!editableChanged.length && !approveChanged.length && !banChanged.length) {
            setHasChanges(false)
            return
        }

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
    }, [load])

    return (
        <div className="px-4 py-6 flex flex-col gap-4 h-full">
            <div className="flex items-center gap-2">
                <Link
                    to="/control"
                    aria-label="Back to Control Panel"
                    className="md:hidden flex items-center justify-center w-9 h-9 -ml-2 rounded-lg theme-text opacity-60 hover:opacity-100 transition-opacity"
                >
                    <ChevronLeft size={22} />
                </Link>
                <h1 className="text-2xl font-bold theme-h1-color">Members</h1>

                <div className="ml-auto flex items-center gap-2">
                    <button
                        onClick={handleReset}
                        disabled={!hasChanges || saving}
                        className="rounded-lg border px-4 py-1.5 text-sm font-medium theme-text theme-border transition-opacity hover:opacity-80 disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                        Reset
                    </button>
                    <button
                        onClick={() => void handleSave()}
                        disabled={!hasChanges || saving}
                        className="rounded-lg px-4 py-1.5 text-sm font-semibold transition-opacity hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed"
                        style={{ background: "var(--theme-text-contrast)", color: "var(--theme-bg)" }}
                    >
                        {saving ? "Saving…" : "Save"}
                    </button>
                </div>
            </div>

            {error && (
                <p className="text-sm px-3 py-2 rounded-lg border theme-subtext-color theme-border"
                   style={{ background: "color-mix(in oklch, var(--theme-border) 40%, transparent)" }}>
                    {error}
                </p>
            )}

            <div className="rounded-xl border overflow-hidden theme-border flex-1 min-h-0">
                <AgGridReact<MemberRowState>
                    ref={gridRef}
                    rowData={rows}
                    columnDefs={columnDefs}
                    context={gridContext}
                    loading={loading}
                    getRowId={({ data }) => data.id}
                    getRowClass={(p: RowClassParams<MemberRowState>) => p.data?.banned_at ? "row-banned" : undefined}
                    stopEditingWhenCellsLoseFocus={true}
                    onCellValueChanged={recomputeDirty}
                    defaultColDef={{ sortable: true, resizable: true, filter: true }}
                />
            </div>

            <style>{`
                .ag-cell.cell-dirty {
                    font-style: italic;
                    background: color-mix(in oklch, var(--theme-text-contrast) 18%, transparent);
                }
                .ag-row.row-banned {
                    opacity: 0.55;
                }
            `}</style>

            {editingTagsFor && (() => {
                const api = gridRef.current?.api
                const node = api?.getRowNode(editingTagsFor)
                const member = node?.data
                if (!member) return null
                return (
                    <TagsModal
                        member={member}
                        onClose={() => setEditingTagsFor(null)}
                        onAdd={handleTagAdd}
                        onRemove={handleTagRemove}
                    />
                )
            })()}
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
