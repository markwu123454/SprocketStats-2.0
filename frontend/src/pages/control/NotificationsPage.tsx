import { useCallback, useEffect, useMemo, useState } from "react"
import { Link, useNavigate } from "react-router-dom"
import { ChevronLeft, Download, Plus, Search } from "lucide-react"

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
    eligible_count: number
}

/** "scouting_lead" → "Scouting Lead" */
function pretty(v: string): string {
    return v.split("_").map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(" ")
}

function formatRoles(roles: string[], roleLabels: Record<string, string>): string {
    if (roles.length === 0) return "Everyone"
    return roles.map(r => roleLabels[r] ?? pretty(r)).join(", ")
}

type StatusFilter = "active" | "deactivated" | "all"

/** Client-side CSV of the currently-shown notices (replaces AG Grid's
 *  built-in export now that the list is a card gallery). */
function exportCsv(rows: NotificationSummary[], roleLabels: Record<string, string>) {
    const header = ["Title", "Type", "Roles", "Status", "Responses", "Created By", "Created"]
    const body = rows.map(n => [
        n.title,
        n.hard_block ? "Hard" : "Soft",
        formatRoles(n.target_roles, roleLabels),
        n.active ? "Active" : "Deactivated",
        String(n.response_count),
        n.created_by_is_self ? "You" : n.created_by_name ?? "—",
        new Date(n.created_at).toLocaleString(),
    ])
    const esc = (v: string) => `"${v.replace(/"/g, '""')}"`
    const csv = [header, ...body].map(r => r.map(esc).join(",")).join("\n")
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }))
    const a = document.createElement("a")
    a.href = url
    a.download = "notifications.csv"
    a.click()
    URL.revokeObjectURL(url)
}

/**
 * Notice list for the Control Panel — a scannable card gallery with a
 * persistent filter rail, rather than a dense grid. Each card surfaces type,
 * audience, author and response count at a glance so the notices needing
 * attention stand out; the rail filters by status / type / audience and a
 * search box, keeping retired notices from burying active ones. Newest-first.
 */
export default function NotificationsPage() {
    const navigate = useNavigate()
    const [notifications, setNotifications] = useState<NotificationSummary[]>([])
    const [roleOptions, setRoleOptions] = useState<string[]>([])
    const [roleLabels, setRoleLabels] = useState<Record<string, string>>({})
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState<string | null>(null)

    const [search, setSearch] = useState("")
    const [status, setStatus] = useState<StatusFilter>("active")
    const [types, setTypes] = useState<Set<"hard" | "soft">>(new Set())
    const [audiences, setAudiences] = useState<Set<string>>(new Set())

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
                setRoleOptions(catalog.map(c => c.value))
                setRoleLabels(Object.fromEntries(catalog.map(c => [c.value, c.label])))
            }
        } catch {
            setError("Failed to load notifications")
        } finally {
            setLoading(false)
        }
    }, [])

    useEffect(() => { void load() }, [load])

    const counts = useMemo(() => ({
        active: notifications.filter(n => n.active).length,
        deactivated: notifications.filter(n => !n.active).length,
        all: notifications.length,
    }), [notifications])

    const rows = useMemo(() => {
        const q = search.trim().toLowerCase()
        return notifications
            .filter(n => status === "all" ? true : status === "active" ? n.active : !n.active)
            .filter(n => types.size === 0 || types.has(n.hard_block ? "hard" : "soft"))
            .filter(n => {
                if (audiences.size === 0) return true
                if (n.target_roles.length === 0) return true // everyone reaches all audiences
                return n.target_roles.some(r => audiences.has(r))
            })
            .filter(n => !q || n.title.toLowerCase().includes(q) || n.body.toLowerCase().includes(q))
            .sort((a, b) => +new Date(b.created_at) - +new Date(a.created_at))
    }, [notifications, search, status, types, audiences])

    function toggle<T>(set: Set<T>, v: T, apply: (s: Set<T>) => void) {
        const next = new Set(set)
        if (next.has(v)) next.delete(v)
        else next.add(v)
        apply(next)
    }

    const statusOpts: { key: StatusFilter, label: string, count: number }[] = [
        { key: "active", label: "Active", count: counts.active },
        { key: "deactivated", label: "Deactivated", count: counts.deactivated },
        { key: "all", label: "All", count: counts.all },
    ]

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
                <span className="text-sm theme-subtext-color">{rows.length} shown</span>

                <button
                    onClick={() => exportCsv(rows, roleLabels)}
                    className="ml-auto flex items-center gap-1.5 rounded-lg border px-4 py-1.5 text-sm font-medium theme-text theme-border transition-opacity hover:opacity-80"
                >
                    <Download size={16} />
                    <span className="hidden sm:inline">Export CSV</span>
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

            {error && (
                <p className="text-sm px-3 py-2 rounded-lg border theme-subtext-color theme-border"
                   style={{ background: "color-mix(in oklch, var(--theme-border) 40%, transparent)" }}>
                    {error}
                </p>
            )}

            <div className="flex flex-col md:flex-row gap-4 flex-1 min-h-0">
                {/* Filter rail */}
                <aside className="flex flex-col gap-5 md:w-56 md:shrink-0 rounded-xl border p-4 theme-border backdrop-blur-sm h-fit"
                       style={{ background: "var(--theme-bg)" }}>
                    <div className="flex items-center gap-2 rounded-lg border px-3 py-1.5 theme-border theme-bg">
                        <Search size={15} className="theme-subtext-color shrink-0" />
                        <input
                            value={search}
                            onChange={e => setSearch(e.target.value)}
                            placeholder="Search…"
                            className="w-full bg-transparent text-sm theme-text outline-none"
                        />
                    </div>

                    <div className="flex flex-col gap-2">
                        <p className="text-xs font-semibold uppercase tracking-widest theme-subtext-color">Status</p>
                        <div className="flex flex-wrap md:flex-col gap-1.5">
                            {statusOpts.map(o => (
                                <button
                                    key={o.key}
                                    onClick={() => setStatus(o.key)}
                                    className="text-left text-sm transition-colors"
                                    style={{
                                        color: status === o.key ? "var(--theme-text-contrast)" : "var(--theme-subtext-color)",
                                        fontWeight: status === o.key ? 600 : 400,
                                    }}
                                >
                                    {status === o.key ? "● " : "○ "}{o.label} <span className="opacity-60">{o.count}</span>
                                </button>
                            ))}
                        </div>
                    </div>

                    <div className="flex flex-col gap-2">
                        <p className="text-xs font-semibold uppercase tracking-widest theme-subtext-color">Type</p>
                        <div className="flex flex-wrap md:flex-col gap-1.5">
                            {(["hard", "soft"] as const).map(t => (
                                <label key={t} className="flex items-center gap-1.5 text-sm theme-subtext-color cursor-pointer">
                                    <input
                                        type="checkbox"
                                        checked={types.has(t)}
                                        onChange={() => toggle(types, t, setTypes)}
                                        className="h-3.5 w-3.5 accent-(--theme-text-contrast)"
                                    />
                                    {t === "hard" ? "Hard block" : "Soft"}
                                </label>
                            ))}
                        </div>
                    </div>

                    {roleOptions.length > 0 && (
                        <div className="flex flex-col gap-2">
                            <p className="text-xs font-semibold uppercase tracking-widest theme-subtext-color">Audience</p>
                            <div className="flex flex-wrap md:flex-col gap-1.5">
                                {roleOptions.map(r => (
                                    <label key={r} className="flex items-center gap-1.5 text-sm theme-subtext-color cursor-pointer">
                                        <input
                                            type="checkbox"
                                            checked={audiences.has(r)}
                                            onChange={() => toggle(audiences, r, setAudiences)}
                                            className="h-3.5 w-3.5 accent-(--theme-text-contrast)"
                                        />
                                        {roleLabels[r] ?? pretty(r)}
                                    </label>
                                ))}
                            </div>
                        </div>
                    )}
                </aside>

                {/* Card gallery */}
                <div className="flex-1 min-h-0 overflow-y-auto theme-scrollbar">
                    {loading ? (
                        <p className="text-sm theme-subtext-color px-1">Loading…</p>
                    ) : rows.length === 0 ? (
                        <div className="rounded-xl border border-dashed p-10 text-center text-sm theme-subtext-color theme-border backdrop-blur-sm"
                             style={{ background: "var(--theme-bg)" }}>
                            No notices match these filters.
                        </div>
                    ) : (
                        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 auto-rows-min">
                            {rows.map(n => (
                                <button
                                    key={n.id}
                                    onClick={() => navigate(`/control/notifications/${n.id}`)}
                                    className="text-left flex flex-col gap-2.5 rounded-xl border p-4 theme-border backdrop-blur-sm transition-opacity hover:opacity-90"
                                    style={{ background: "var(--theme-bg)", opacity: n.active ? 1 : 0.6 }}
                                >
                                    <div className="flex items-start justify-between gap-2.5">
                                        <span className="text-sm font-semibold theme-h1-color leading-snug">{n.title}</span>
                                        <span
                                            className="shrink-0 rounded-md border px-1.5 py-0.5 text-[10px] font-bold tracking-wide"
                                            style={n.hard_block
                                                ? { color: "var(--theme-text-contrast)", borderColor: "color-mix(in oklch, var(--theme-text-contrast) 55%, transparent)" }
                                                : { color: "var(--theme-subtext-color)", borderColor: "var(--theme-border)" }}
                                        >
                                            {n.hard_block ? "HARD" : "SOFT"}
                                        </span>
                                    </div>
                                    <span className="text-xs theme-subtext-color">
                                        {formatRoles(n.target_roles, roleLabels)} · by {n.created_by_is_self ? "You" : n.created_by_name ?? "—"} · {new Date(n.created_at).toLocaleDateString([], { month: "short", day: "numeric" })}
                                    </span>
                                    {(() => {
                                        const pct = n.eligible_count > 0 ? Math.round((n.response_count / n.eligible_count) * 100) : 0
                                        return (
                                            <div className="flex flex-col gap-1 pt-0.5">
                                                <div className="flex items-center justify-between gap-2 text-xs theme-subtext-color">
                                                    <span>{n.response_count} / {n.eligible_count} responded{!n.active ? " · Deactivated" : ""}</span>
                                                    <span className="font-semibold theme-text-contrast">{pct}%</span>
                                                </div>
                                                <div className="h-1.5 w-full rounded-full overflow-hidden"
                                                     style={{ background: "color-mix(in oklch, var(--theme-border) 80%, transparent)" }}>
                                                    <div className="h-full rounded-full"
                                                         style={{ width: `${pct}%`, background: "var(--theme-text-contrast)" }} />
                                                </div>
                                            </div>
                                        )
                                    })()}
                                </button>
                            ))}
                        </div>
                    )}
                </div>
            </div>
        </div>
    )
}
