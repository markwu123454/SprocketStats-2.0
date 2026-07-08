import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { Link } from "react-router-dom"
import { ChevronLeft } from "lucide-react"
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

const API = import.meta.env.VITE_BACKEND_URL

interface MemberRow {
    id: string
    email: string
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
}

/** Extra data ag-grid cell renderers need but that isn't part of a row. */
interface GridContext {
    currentUserId: string
    onApprove: (id: string) => void
    onBan: (id: string) => void
    onUnban: (id: string) => void
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
    return (
        <button
            className={actionBtn}
            disabled={isSelf || notOnboarded}
            title={isSelf ? "You cannot approve yourself" : notOnboarded ? "Member hasn't finished onboarding" : "Approve this member"}
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

    if (data.banned_at) {
        const pending = norm(data._orig.banned_at) !== norm(data.banned_at)
        return (
            <button
                className={actionBtn}
                style={pending ? undefined : { color: "#dc2626", borderColor: "color-mix(in oklch, #dc2626 50%, transparent)" }}
                disabled={isSelf}
                title={isSelf ? "You cannot unban yourself" : "Click to unban"}
                onClick={() => ctx.onUnban(data.id)}
            >
                Banned
            </button>
        )
    }
    return (
        <button
            className={actionBtn}
            disabled={isSelf}
            title={isSelf ? "You cannot ban yourself" : "Ban this member"}
            onClick={() => ctx.onBan(data.id)}
        >
            Ban
        </button>
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
    const [rows, setRows]                 = useState<MemberRowState[]>([])
    const [roleOptions, setRoleOptions]   = useState<string[]>([])
    const [roleLabels, setRoleLabels]     = useState<Record<string, string>>({})
    const [loading, setLoading]           = useState(true)
    const [saving, setSaving]             = useState(false)
    const [hasChanges, setHasChanges]     = useState(false)
    const [error, setError]               = useState<string | null>(null)

    const load = useCallback(async () => {
        setLoading(true)
        setError(null)
        try {
            const [mRes, rRes] = await Promise.all([
                fetch(`${API}/members`, { credentials: "include" }),
                fetch(`${API}/auth/roles`, { credentials: "include" }),
            ])
            if (!mRes.ok) throw new Error("members")
            const members = await mRes.json() as MemberRow[]
            if (rRes.ok) {
                const catalog = await rRes.json() as { value: string, label: string }[]
                setRoleOptions(catalog.map(c => c.value))
                setRoleLabels(Object.fromEntries(catalog.map(c => [c.value, c.label])))
            }
            setRows(members.map(m => ({ ...m, _orig: snapshot(m) })))
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

    const gridContext = useMemo<GridContext>(() => ({
        currentUserId: user?.id ?? "",
        onApprove: handleApprove,
        onBan: handleBan,
        onUnban: handleUnban,
    }), [user?.id, handleApprove, handleBan, handleUnban])

    const roleFormatter = useCallback(
        (p: ValueFormatterParams<MemberRowState, string | null>): string =>
            p.value ? (roleLabels[p.value] ?? pretty(p.value)) : "—",
        [roleLabels],
    )

    const columnDefs = useMemo<ColDef<MemberRowState>[]>(() => [
        { field: "name",         headerName: "Name",         editable: true, cellEditor: "agTextCellEditor", flex: 1.5, minWidth: 140, cellClassRules: DIRTY_RULES },
        { field: "display_name", headerName: "Display Name", editable: true, cellEditor: "agTextCellEditor", flex: 1.5, minWidth: 140, cellClassRules: DIRTY_RULES },
        { field: "email",        headerName: "Email",        editable: false, flex: 2, minWidth: 220, cellStyle: { opacity: 0.65 } },
        {
            field: "role", headerName: "Role", editable: true,
            cellEditor: "agSelectCellEditor", cellEditorParams: { values: roleOptions },
            valueFormatter: roleFormatter, flex: 1.3, minWidth: 150, cellClassRules: DIRTY_RULES,
        },
        {
            field: "grade", headerName: "Grade", editable: true,
            cellEditor: "agSelectCellEditor", cellEditorParams: { values: GRADE_OPTIONS },
            valueFormatter: enumFormatter, flex: 1, minWidth: 120, cellClassRules: DIRTY_RULES,
        },
        {
            field: "team_year", headerName: "Year", editable: true,
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
    ], [roleOptions, roleFormatter])

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
        </div>
    )
}
