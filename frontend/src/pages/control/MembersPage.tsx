import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { Link } from "react-router-dom"
import { ChevronLeft } from "lucide-react"
import { AgGridReact } from "ag-grid-react"
import type {
    CellClassParams,
    CellClassRules,
    ColDef,
    ValueFormatterParams,
} from "ag-grid-community"

const API = import.meta.env.VITE_BACKEND_URL

interface MemberRow {
    id: string
    email: string
    name: string | null
    display_name: string | null
    role: string | null
    grade: string | null
    team_year: string | null
}

/** Fields the roster lets you edit; email stays read-only (OAuth identity). */
const EDITABLE = ["name", "display_name", "role", "grade", "team_year"] as const
type EditableField = (typeof EDITABLE)[number]

/** A grid row carries its original DB values so we can detect & revert edits. */
interface MemberRowState extends MemberRow {
    _orig: Pick<MemberRow, EditableField>
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

/** Tint + italicise any editable cell whose value differs from the DB original. */
const DIRTY_RULES: CellClassRules<MemberRowState> = {
    "cell-dirty": (p: CellClassParams<MemberRowState, string | null>) => {
        const field = p.colDef.field as EditableField | undefined
        if (!field || !p.data) return false
        return norm(p.data._orig[field]) !== norm(p.value)
    },
}

function snapshot(m: MemberRow): Pick<MemberRow, EditableField> {
    return { name: m.name, display_name: m.display_name, role: m.role, grade: m.grade, team_year: m.team_year }
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
    ], [roleOptions, roleFormatter])

    const recomputeDirty = useCallback(() => {
        const api = gridRef.current?.api
        if (!api) return
        let dirty = false
        api.forEachNode(n => {
            const d = n.data
            if (d && EDITABLE.some(f => norm(d._orig[f]) !== norm(d[f]))) dirty = true
        })
        setHasChanges(dirty)
    }, [])

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

        const changed: MemberRowState[] = []
        api.forEachNode(n => {
            const d = n.data
            if (d && EDITABLE.some(f => norm(d._orig[f]) !== norm(d[f]))) changed.push(d)
        })
        if (changed.length === 0) { setHasChanges(false); return }

        setSaving(true)
        setError(null)
        try {
            const res = await fetch(`${API}/members`, {
                method: "PUT",
                credentials: "include",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(changed.map(d => ({
                    id: d.id,
                    name: d.name,
                    display_name: d.display_name,
                    role: d.role,
                    grade: norm(d.grade),
                    team_year: norm(d.team_year),
                }))),
            })
            if (!res.ok) throw new Error("save")
            // New baseline: fold current values into each row's original snapshot.
            api.forEachNode(n => {
                const d = n.data
                if (d) n.setData({ ...d, _orig: snapshot(d) })
            })
            api.refreshCells({ force: true })
            setHasChanges(false)
        } catch {
            setError("Failed to save changes")
        } finally {
            setSaving(false)
        }
    }, [])

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
                    loading={loading}
                    getRowId={({ data }) => data.id}
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
            `}</style>
        </div>
    )
}
