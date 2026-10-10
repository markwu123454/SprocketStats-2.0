import { useCallback, useMemo, useState } from "react"
import { AgGridReact } from "ag-grid-react"
import type { ColDef, ICellRendererParams, SizeColumnsToFitGridStrategy } from "ag-grid-community"
import { Pencil, Phone } from "lucide-react"
import { useEventContext } from "@/contexts/eventContext"
import { useOnboardedUser } from "@/contexts/authContext"
import { can } from "@/lib/permissions"
import { updateRosterRole, type RosterMember } from "@/lib/eventApi"
import { ASSIGNABLE_ROLES, ROSTER_ROLES, rosterRoleLabel, type AssignableRole, type RosterRole } from "@/lib/rosterRoles"
import { DANGER_RED, tintColor } from "@/lib/taskFormat"
import Dropdown from "@/components/ui/Dropdown"

const ROLE_ORDER = ROSTER_ROLES.map(r => r.value)

function roleSort(a: string, b: string): number {
    const ai = ROLE_ORDER.indexOf(a as RosterRole)
    const bi = ROLE_ORDER.indexOf(b as RosterRole)
    if (ai !== -1 && bi !== -1) return ai - bi
    if (ai !== -1) return -1
    if (bi !== -1) return 1
    return a.localeCompare(b)
}

function PhoneCell({ value }: { value: string | null }) {
    if (!value) return <span style={{ color: "var(--theme-subtext-color)" }}>—</span>
    return (
        <a
            href={`tel:${value}`}
            className="inline-flex items-center gap-1 transition-opacity hover:opacity-70"
            style={{ color: "var(--theme-text-contrast)" }}
        >
            <Phone size={12} />
            {value}
        </a>
    )
}

// Plain function (not a closure over component state) so it can live in the
// memoized columnDefs without ever going stale -- the row to edit arrives
// via `cellRendererParams.onEdit`, not a captured variable.
interface ActionsCellParams extends ICellRendererParams<RosterMember> {
    onEdit: (member: RosterMember) => void
}

function ActionsCell({ data, onEdit }: ActionsCellParams) {
    if (!data?.user_id) return null
    return (
        <button
            type="button"
            onClick={() => onEdit(data)}
            aria-label={`Change role for ${data.display_name}`}
            className="inline-flex items-center justify-center w-9 h-9 rounded-lg theme-subtext-color opacity-50 hover:opacity-100 transition-opacity outline-none focus:ring-2"
        >
            <Pencil size={14} />
        </button>
    )
}

const AUTO_SIZE_STRATEGY: SizeColumnsToFitGridStrategy = { type: "fitGridWidth" }

const DEFAULT_COL_DEF: ColDef = {
    flex: 1,
    resizable: true,
    suppressMovable: true,
}

const primaryButtonClass =
    "theme-bg border theme-border theme-text-contrast rounded-xl text-sm font-semibold h-11 px-4 " +
    "inline-flex items-center justify-center gap-2 outline-none focus:ring-2 transition-opacity " +
    "disabled:opacity-40 disabled:cursor-not-allowed"

const ghostButtonClass =
    "h-11 px-2 rounded-lg text-sm theme-subtext-color hover:underline outline-none focus:ring-2 " +
    "disabled:opacity-40 disabled:cursor-not-allowed"

function NoRosterOverlay() {
    return <span style={{ color: "var(--theme-subtext-color)" }}>Roster not yet posted.</span>
}

interface EditingState {
    userId: string
    name: string
    role: AssignableRole
}

export default function RosterPage() {
    const { eventKey, info, updateInfo } = useEventContext()
    const user = useOnboardedUser()
    const canEdit = can(user.permissions, "events.edit")

    const [editing, setEditing] = useState<EditingState | null>(null)
    const [saving, setSaving] = useState(false)
    const [error, setError] = useState<string | null>(null)

    // Stable across renders (no deps) so the memoized columnDefs below never
    // has to recompute just because this component re-rendered.
    const openEditor = useCallback((member: RosterMember) => {
        if (!member.user_id) return
        // The picker only offers the four assignable roles. An older
        // chaperone/captain/lead entry's current role isn't one of them --
        // open with "attending" preselected rather than an empty/invalid
        // value, since there's nothing valid to preselect in that case.
        const isAssignable = ASSIGNABLE_ROLES.some(r => r.value === member.role)
        const role: AssignableRole = isAssignable ? (member.role as AssignableRole) : "attending"
        setEditing({ userId: member.user_id, name: member.display_name, role })
        setError(null)
    }, [])

    function closeEditor() {
        setEditing(null)
        setError(null)
    }

    function saveEditor() {
        if (!editing) return
        setSaving(true)
        setError(null)
        updateRosterRole(eventKey, editing.userId, editing.role)
            .then(res => {
                updateInfo({ roster: res.roster })
                setSaving(false)
                setEditing(null)
            })
            .catch((err: unknown) => {
                setSaving(false)
                // Only surface the backend's own message for a 4xx (e.g.
                // "member not found") -- a raw "HTTP 500" isn't actionable.
                const status = (err as { status?: number } | null)?.status
                const detail = err instanceof Error ? err.message : null
                setError(status && status >= 400 && status < 500 && detail ? detail : "Couldn't update role. Try again.")
            })
    }

    // AG Grid's own menu isn't portaled -- it renders as an absolutely
    // positioned child of the cell, inside the grid's scrollable (overflow)
    // viewport, so an in-cell Dropdown's popover would get clipped by row
    // height / grid bounds. A pencil button opening a small panel above the
    // grid avoids that entirely.
    const colDefs = useMemo<ColDef<RosterMember>[]>(() => {
        const base: ColDef<RosterMember>[] = [
            {
                field: "display_name",
                headerName: "Name",
                sortable: true,
                filter: true,
            },
            {
                field: "role",
                headerName: "Role",
                sortable: true,
                filter: true,
                valueFormatter: p => rosterRoleLabel(p.value ?? ""),
                comparator: (a, b) => roleSort(a, b),
            },
            {
                field: "phone",
                headerName: "Phone",
                sortable: true,
                cellRenderer: PhoneCell,
                comparator: (a: string | null, b: string | null) => {
                    if (a && !b) return -1
                    if (!a && b) return 1
                    return 0
                },
            },
        ]
        if (!canEdit) return base
        return [
            ...base,
            {
                colId: "actions",
                headerName: "",
                sortable: false,
                filter: false,
                resizable: false,
                flex: 0,
                width: 56,
                cellRenderer: ActionsCell,
                cellRendererParams: { onEdit: openEditor },
            },
        ]
    }, [canEdit, openEditor])

    return (
        <div className="h-full px-4 py-4 flex flex-col gap-3">
            {editing && (
                <div className="rounded-xl border p-4 flex flex-col gap-3" style={{ background: "var(--theme-bg)", borderColor: "var(--theme-border)" }}>
                    <p className="text-sm font-semibold theme-text truncate">Change role — {editing.name}</p>

                    {error && (
                        <p
                            role="alert"
                            className="text-xs rounded-lg px-3 py-2"
                            style={{
                                color: DANGER_RED,
                                background: tintColor(DANGER_RED, 10),
                                border: `1px solid ${tintColor(DANGER_RED, 40)}`,
                            }}
                        >
                            {error}
                        </p>
                    )}

                    <div className="flex flex-col sm:flex-row sm:items-center gap-3">
                        <Dropdown
                            value={editing.role}
                            options={ASSIGNABLE_ROLES}
                            onChange={v => setEditing(e => e ? { ...e, role: v as AssignableRole } : e)}
                            disabled={saving}
                            className="sm:max-w-xs sm:flex-1"
                            triggerClassName="rounded-lg border px-3 py-2.5 text-sm outline-none focus:ring-2 transition theme-bg theme-border theme-text"
                        />
                        <div className="flex items-center gap-3">
                            <button type="button" onClick={saveEditor} disabled={saving} className={primaryButtonClass}>
                                {saving ? "Saving…" : "Save"}
                            </button>
                            <button type="button" onClick={closeEditor} disabled={saving} className={ghostButtonClass}>
                                Cancel
                            </button>
                        </div>
                    </div>
                </div>
            )}

            <div className="rounded-xl overflow-hidden border theme-border flex-1 min-h-0">
                <AgGridReact
                    rowData={info?.roster ?? []}
                    columnDefs={colDefs}
                    defaultColDef={DEFAULT_COL_DEF}
                    autoSizeStrategy={AUTO_SIZE_STRATEGY}
                    noRowsOverlayComponent={NoRosterOverlay}
                    initialState={{
                        sort: { sortModel: [{ colId: "role", sort: "asc" }] },
                    }}
                    suppressCellFocus
                    domLayout="normal"
                />
            </div>
        </div>
    )
}
