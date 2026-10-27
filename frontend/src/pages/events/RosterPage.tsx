import { useCallback, useMemo, useState } from "react"
import { AgGridReact } from "ag-grid-react"
import type { ColDef, ICellRendererParams, SizeColumnsToFitGridStrategy } from "ag-grid-community"
import { Check, Pencil, Phone } from "lucide-react"
import { useEventContext } from "@/contexts/eventContext"
import { useOnboardedUser } from "@/contexts/authContext"
import { useBootstrapped } from "@/contexts/bootstrapContext"
import { can } from "@/lib/permissions"
import { updateRosterMember, type RosterMember } from "@/lib/eventApi"
import {
    checkInRolesOf, defaultCheckInRole, eventDayLabel, eventDays, findByHubKey, unionRosterDays,
    type CheckinRole, type EventEntry,
} from "@/lib/events"
import { ROSTER_ROLES, rosterRoleLabel, type RosterRole } from "@/lib/rosterRoles"
import { DANGER_RED, tintColor } from "@/lib/taskFormat"
import Dropdown from "@/components/ui/Dropdown"
import DayChips from "@/components/events/DayChips"

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]

const ROLE_ORDER = ROSTER_ROLES.map(r => r.value)

// The event's own roles first, in the order an editor listed them; anything
// else (older chaperone/captain/lead entries, a role since removed) after,
// in the legacy order.
function eventRoleSort(eventRoles: CheckinRole[]) {
    return (a: string, b: string): number => {
        const ai = eventRoles.findIndex(r => r.key === a)
        const bi = eventRoles.findIndex(r => r.key === b)
        if (ai !== -1 && bi !== -1) return ai - bi
        if (ai !== -1) return -1
        if (bi !== -1) return 1
        return roleSort(a, b)
    }
}

function roleSort(a: string, b: string): number {
    const ai = ROLE_ORDER.indexOf(a as RosterRole)
    const bi = ROLE_ORDER.indexOf(b as RosterRole)
    if (ai !== -1 && bi !== -1) return ai - bi
    if (ai !== -1) return -1
    if (bi !== -1) return 1
    return a.localeCompare(b)
}

// Narrow header for a day column, e.g. "Thu 19" -- built from the string's
// own local parts (never `new Date(str)`), same reasoning as `eventDayLabel`.
function shortDayHeader(day: string): string {
    const [y, m, d] = day.split("-").map(Number)
    const date = new Date(y, m - 1, d)
    return `${WEEKDAYS[date.getDay()]} ${date.getDate()}`
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

// `data.days === null` (hand-added / older entry, never recorded) shows the
// same muted "—" the Phone column uses. An empty array or a day not in it is
// just an empty cell -- color is never the only signal either way, since the
// check icon always carries its own accessible name. The cell's own
// `cellStyle` strips AG Grid's default left-aligned padding/layout (see the
// day colDef below); this wrapper is what actually centers the content
// inside the now-unpadded, flex cell, both for the icon and the "—".
interface DayCheckCellParams extends ICellRendererParams<RosterMember> {
    day: string
}

function DayCheckCell({ data, day }: DayCheckCellParams) {
    if (!data) return null
    if (data.days == null) {
        return (
            <span className="flex h-full w-full items-center justify-center" style={{ color: "var(--theme-subtext-color)" }}>
                —
            </span>
        )
    }
    if (!data.days.includes(day)) return null
    return (
        <span className="flex h-full w-full items-center justify-center">
            <Check size={18} strokeWidth={2.5} className="theme-text-contrast" aria-label={`Attending ${eventDayLabel(day)}`} />
        </span>
    )
}

// Plain function (not a closure over component state) so it can live in the
// memoized columnDefs without ever going stale -- the row to edit and the
// viewer's standing arrive via `cellRendererParams`, not captured variables.
interface ActionsCellParams extends ICellRendererParams<RosterMember> {
    onEdit: (member: RosterMember) => void
    canEdit: boolean
    currentUserId: string
}

function ActionsCell({ data, onEdit, canEdit, currentUserId }: ActionsCellParams) {
    if (!data?.user_id) return null
    const isSelf = data.user_id === currentUserId
    if (!canEdit && !isSelf) return null
    return (
        <span className="flex h-full w-full items-center justify-center">
            <button
                type="button"
                onClick={() => onEdit(data)}
                aria-label={canEdit ? `Edit ${data.display_name}` : "Change your days"}
                className="inline-flex items-center justify-center w-9 h-9 rounded-lg theme-subtext-color opacity-50 hover:opacity-100 transition-opacity outline-none focus:ring-2"
            >
                <Pencil size={14} />
            </button>
        </span>
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

function sameDaySet(a: string[], b: string[]): boolean {
    if (a.length !== b.length) return false
    const set = new Set(a)
    return b.every(d => set.has(d))
}

interface EditingState {
    userId: string
    name: string
    role: string
    initialRole: string
    days: string[]
    initialDays: string[]
}

export default function RosterPage() {
    const { eventKey, info, updateInfo } = useEventContext()
    const user = useOnboardedUser()
    const canEdit = can(user.permissions, "events.edit")
    const [rawEvents] = useBootstrapped<EventEntry[]>("events", [])

    const [editing, setEditing] = useState<EditingState | null>(null)
    const [saving, setSaving] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const [daysError, setDaysError] = useState<string | null>(null)

    const roster = info?.roster ?? []

    // The event's own schedule entry is the source of truth for its day
    // list. When there's none to be found (schedule not loaded, or this
    // event isn't on it), fall back to whatever days the roster itself
    // already has recorded -- still empty (and no day columns at all) when
    // nobody has any days on file.
    const scheduleEntry = findByHubKey(rawEvents, eventKey)
    const eventDayList = useMemo(
        () => (scheduleEntry ? eventDays(scheduleEntry) : unionRosterDays(info?.roster ?? [])),
        [scheduleEntry, info?.roster]
    )
    const eventRoles = useMemo(() => checkInRolesOf(scheduleEntry), [scheduleEntry])

    // Stable across renders (no deps) so the memoized columnDefs below never
    // has to recompute just because this component re-rendered.
    const openEditor = useCallback((member: RosterMember) => {
        if (!member.user_id) return
        if (!canEdit && member.user_id !== user.id) return
        // The role picker only offers the four assignable roles. An older
        // chaperone/captain/lead entry's current role isn't one of them --
        // preselect "attending" rather than an empty/invalid value.
        const isAssignable = eventRoles.some(r => r.key === member.role)
        const role = isAssignable ? member.role : defaultCheckInRole(scheduleEntry)
        // A null `days` (hand-added / older entry) starts with none
        // selected -- unlike the check-in form, this reflects what's
        // actually on file rather than assuming full attendance.
        const initialDays = member.days ?? []
        setEditing({ userId: member.user_id, name: member.display_name, role, initialRole: role, days: initialDays, initialDays })
        setError(null)
        setDaysError(null)
    }, [canEdit, user.id, eventRoles, scheduleEntry])

    function closeEditor() {
        setEditing(null)
        setError(null)
        setDaysError(null)
    }

    function toggleEditingDay(day: string) {
        setEditing(e => e ? { ...e, days: e.days.includes(day) ? e.days.filter(d => d !== day) : [...e.days, day] } : e)
        setDaysError(null)
    }

    function saveEditor() {
        if (!editing) return
        if (eventDayList.length > 0 && editing.days.length === 0) {
            setDaysError("Pick at least one day.")
            return
        }

        const patch: { role?: string; days?: string[] } = {}
        if (canEdit && editing.role !== editing.initialRole) patch.role = editing.role
        if (!sameDaySet(editing.days, editing.initialDays)) patch.days = [...editing.days].sort()

        if (Object.keys(patch).length === 0) {
            closeEditor()
            return
        }

        setSaving(true)
        setError(null)
        updateRosterMember(eventKey, editing.userId, patch)
            .then(res => {
                updateInfo({ roster: res.roster })
                setSaving(false)
                setEditing(null)
                setDaysError(null)
            })
            .catch((err: unknown) => {
                setSaving(false)
                // Only surface the backend's own message for a 4xx (e.g.
                // "member not found") -- a raw "HTTP 500" isn't actionable.
                const status = (err as { status?: number } | null)?.status
                const detail = err instanceof Error ? err.message : null
                setError(status && status >= 400 && status < 500 && detail ? detail : "Couldn't update. Try again.")
            })
    }

    // AG Grid's own menu isn't portaled -- it renders as an absolutely
    // positioned child of the cell, inside the grid's scrollable (overflow)
    // viewport, so an in-cell Dropdown's popover would get clipped by row
    // height / grid bounds. A pencil button opening a small panel above the
    // grid avoids that entirely.
    const colDefs = useMemo<ColDef<RosterMember>[]>(() => {
        const dayCols: ColDef<RosterMember>[] = eventDayList.map(day => ({
            colId: `day:${day}`,
            headerName: shortDayHeader(day),
            headerClass: "day-col-header",
            width: 72,
            minWidth: 72,
            flex: 0,
            resizable: false,
            // AG Grid cells are left-aligned with horizontal padding by
            // default (see `cellHorizontalPadding` in agGridTheme.ts) --
            // strip that and lay the cell out as a flex box itself so the
            // renderer's own centering wrapper has a true full-height,
            // full-width, unpadded box to center within.
            cellStyle: { padding: 0, display: "flex", alignItems: "center", justifyContent: "center" },
            cellRenderer: DayCheckCell,
            cellRendererParams: { day },
        }))

        return [
            {
                field: "display_name",
                headerName: "Name",
                sortable: true,
                filter: true,
                minWidth: 140,
            },
            {
                field: "role",
                headerName: "Role",
                sortable: true,
                filter: true,
                minWidth: 110,
                valueFormatter: p => eventRoles.find(r => r.key === p.value)?.label ?? rosterRoleLabel(p.value ?? ""),
                comparator: eventRoleSort(eventRoles),
            },
            ...dayCols,
            {
                field: "phone",
                headerName: "Phone",
                sortable: true,
                minWidth: 120,
                cellRenderer: PhoneCell,
                comparator: (a: string | null, b: string | null) => {
                    if (a && !b) return -1
                    if (!a && b) return 1
                    return 0
                },
            },
            {
                colId: "actions",
                headerName: "",
                sortable: false,
                filter: false,
                resizable: false,
                flex: 0,
                width: 56,
                cellStyle: { padding: 0, display: "flex", alignItems: "center", justifyContent: "center" },
                cellRenderer: ActionsCell,
                cellRendererParams: { onEdit: openEditor, canEdit, currentUserId: user.id },
            },
        ]
    }, [eventDayList, canEdit, openEditor, user.id, eventRoles])

    const panelTitle = editing ? (canEdit ? `Edit ${editing.name}` : "Your days") : ""

    return (
        <div className="h-full px-4 py-4 flex flex-col gap-3">
            {editing && (
                <div className="rounded-xl border p-4 flex flex-col gap-3" style={{ background: "var(--theme-bg)", borderColor: "var(--theme-border)" }}>
                    <p className="text-sm font-semibold theme-text truncate">{panelTitle}</p>

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

                    {canEdit && (
                        // Dropdown's trigger doesn't take an id/aria-label of its own --
                        // role="group" + aria-labelledby is the documented way to
                        // associate the "Role" label with it instead.
                        <div className="flex flex-col gap-1 sm:max-w-xs" role="group" aria-labelledby="roster-role-label">
                            <label id="roster-role-label" className="text-sm font-semibold theme-text">Role</label>
                            <Dropdown
                                value={editing.role}
                                options={eventRoles.map(r => ({ value: r.key, label: r.label }))}
                                onChange={v => setEditing(e => e ? { ...e, role: v } : e)}
                                disabled={saving}
                                triggerClassName="rounded-lg border px-3 py-2.5 text-sm outline-none focus:ring-2 transition theme-bg theme-border theme-text"
                            />
                        </div>
                    )}

                    {eventDayList.length > 0 && (
                        <DayChips
                            label={canEdit ? "Days" : "Your days"}
                            days={eventDayList}
                            selected={editing.days}
                            onToggle={toggleEditingDay}
                            disabled={saving}
                            error={daysError}
                        />
                    )}

                    <div className="flex items-center gap-3">
                        <button type="button" onClick={saveEditor} disabled={saving} className={primaryButtonClass}>
                            {saving ? "Saving…" : "Save"}
                        </button>
                        <button type="button" onClick={closeEditor} disabled={saving} className={ghostButtonClass}>
                            Cancel
                        </button>
                    </div>
                </div>
            )}

            <div className="rounded-xl overflow-hidden border theme-border flex-1 min-h-0">
                <AgGridReact
                    rowData={roster}
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
