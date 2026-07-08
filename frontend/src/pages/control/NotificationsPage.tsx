import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { Link, useNavigate } from "react-router-dom"
import { ChevronLeft, Download, Plus } from "lucide-react"
import { AgGridReact } from "ag-grid-react"
import type { ColDef, ValueFormatterParams } from "ag-grid-community"

const API = import.meta.env.VITE_BACKEND_URL

interface NotificationSummary {
    id: string
    title: string
    body: string
    link: string | null
    hard_block: boolean
    target_roles: string[]
    response_options: string[]
    response_mode: "single" | "multi"
    active: boolean
    created_by_name: string | null
    created_by_is_self: boolean
    created_at: string
    updated_at: string
    response_count: number
}

/** "scouting_lead" → "Scouting Lead" */
function pretty(v: string): string {
    return v.split("_").map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(" ")
}

function formatRoles(roles: string[], roleLabels: Record<string, string>): string {
    if (roles.length === 0) return "Everyone"
    return roles.map(r => roleLabels[r] ?? pretty(r)).join(", ")
}

/**
 * Notice list for the Control Panel. AG Grid virtualizes rows, so this scales
 * fine to hundreds of notices performance-wise -- the real risk as the list
 * grows is clutter, not speed. A quick-filter search box plus a "hide
 * deactivated" toggle (on by default) keep old/retired notices from burying
 * active ones, while staying newest-first sorted.
 */
export default function NotificationsPage() {
    const navigate = useNavigate()
    const gridRef = useRef<AgGridReact<NotificationSummary>>(null)
    const [notifications, setNotifications] = useState<NotificationSummary[]>([])
    const [roleLabels, setRoleLabels] = useState<Record<string, string>>({})
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState<string | null>(null)
    const [search, setSearch] = useState("")
    const [hideDeactivated, setHideDeactivated] = useState(true)

    const load = useCallback(async () => {
        setLoading(true)
        setError(null)
        try {
            const [nRes, rRes] = await Promise.all([
                fetch(`${API}/notifications`, { credentials: "include" }),
                fetch(`${API}/auth/roles`, { credentials: "include" }),
            ])
            if (!nRes.ok) throw new Error("notifications")
            setNotifications(await nRes.json() as NotificationSummary[])
            if (rRes.ok) {
                const catalog = await rRes.json() as { value: string, label: string }[]
                setRoleLabels(Object.fromEntries(catalog.map(c => [c.value, c.label])))
            }
        } catch {
            setError("Failed to load notifications")
        } finally {
            setLoading(false)
        }
    }, [])

    useEffect(() => { void load() }, [load])

    const rows = useMemo(
        () => hideDeactivated ? notifications.filter(n => n.active) : notifications,
        [notifications, hideDeactivated],
    )

    const deactivatedCount = useMemo(() => notifications.filter(n => !n.active).length, [notifications])

    const columnDefs = useMemo<ColDef<NotificationSummary>[]>(() => [
        { field: "title", headerName: "Title", flex: 2, minWidth: 160 },
        {
            field: "hard_block", headerName: "Type", flex: 1, minWidth: 90, cellDataType: "text",
            valueFormatter: (p: ValueFormatterParams<NotificationSummary, boolean>) => p.value ? "Hard" : "Soft",
        },
        {
            field: "target_roles", headerName: "Roles", flex: 1.6, minWidth: 160, cellDataType: "text",
            valueFormatter: (p: ValueFormatterParams<NotificationSummary, string[]>) => formatRoles(p.value ?? [], roleLabels),
        },
        {
            field: "active", headerName: "Status", flex: 1, minWidth: 90, cellDataType: "text",
            valueFormatter: (p: ValueFormatterParams<NotificationSummary, boolean>) => p.value ? "Active" : "Deactivated",
        },
        { field: "response_count", headerName: "Responses", flex: 1, minWidth: 100, type: "numericColumn" },
        {
            field: "created_by_name", headerName: "Created By", flex: 1.2, minWidth: 130, cellDataType: "text",
            valueFormatter: (p: ValueFormatterParams<NotificationSummary, string | null>) =>
                p.data?.created_by_is_self ? "You" : p.value ?? "—",
        },
        {
            field: "created_at", headerName: "Created", flex: 1.2, minWidth: 140,
            valueFormatter: (p: ValueFormatterParams<NotificationSummary, string>) =>
                p.value ? new Date(p.value).toLocaleString() : "",
        },
    ], [roleLabels])

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
                <h1 className="text-2xl font-bold theme-h1-color">Notifications</h1>

                <button
                    onClick={() => gridRef.current?.api.exportDataAsCsv({ fileName: "notifications.csv" })}
                    className="ml-auto flex items-center gap-1.5 rounded-lg border px-4 py-1.5 text-sm font-medium theme-text theme-border transition-opacity hover:opacity-80"
                >
                    <Download size={16} />
                    Export CSV
                </button>
                <button
                    onClick={() => navigate("/control/notifications/new")}
                    className="flex items-center gap-1.5 rounded-lg px-4 py-1.5 text-sm font-semibold transition-opacity hover:opacity-90"
                    style={{ background: "var(--theme-text-contrast)", color: "var(--theme-bg)" }}
                >
                    <Plus size={16} />
                    New Notice
                </button>
            </div>

            <div className="flex items-center gap-3">
                <input
                    value={search}
                    onChange={e => setSearch(e.target.value)}
                    placeholder="Search notices…"
                    className="flex-1 max-w-xs rounded-lg border px-3 py-1.5 text-sm theme-border theme-bg theme-text"
                />
                <label className="flex items-center gap-1.5 text-xs theme-subtext-color cursor-pointer whitespace-nowrap">
                    <input
                        type="checkbox"
                        checked={hideDeactivated}
                        onChange={e => setHideDeactivated(e.target.checked)}
                        className="h-3.5 w-3.5 accent-(--theme-text-contrast)"
                    />
                    Hide deactivated {deactivatedCount > 0 && `(${deactivatedCount})`}
                </label>
            </div>

            {error && (
                <p className="text-sm px-3 py-2 rounded-lg border theme-subtext-color theme-border"
                   style={{ background: "color-mix(in oklch, var(--theme-border) 40%, transparent)" }}>
                    {error}
                </p>
            )}

            <div className="rounded-xl border overflow-hidden theme-border flex-1 min-h-0">
                <AgGridReact<NotificationSummary>
                    ref={gridRef}
                    rowData={rows}
                    columnDefs={columnDefs}
                    loading={loading}
                    quickFilterText={search}
                    getRowId={({ data }) => data.id}
                    onRowClicked={(e) => e.data && navigate(`/control/notifications/${e.data.id}`)}
                    rowStyle={{ cursor: "pointer" }}
                    defaultColDef={{ sortable: true, resizable: true, filter: true }}
                />
            </div>
        </div>
    )
}
