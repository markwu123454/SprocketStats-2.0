import { useCallback, useEffect, useMemo, useState } from "react"
import { useNavigate } from "react-router-dom"
import { Plus, Search, SlidersHorizontal } from "lucide-react"
import Button from "@/components/ui/Button"
import Dropdown from "@/components/ui/Dropdown"
import Notice from "@/components/ui/Notice"
import Skeleton from "@/components/ui/Skeleton"
import EmptyState from "@/components/ui/EmptyState"
import { useBootstrapped } from "@/contexts/bootstrapContext"
import { usePageHeader } from "@/contexts/pageHeaderContext"
import { focusRing, typeBadge } from "@/lib/uiClasses"

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

/** "Everyone", "CAD Lead, Captain", or "CAD Lead, Captain and 14 more" past three, so a card stays short. */
function formatRoles(roles: string[], roleLabels: Record<string, string>): string {
    if (roles.length === 0) return "Everyone"
    const names = roles.map(r => roleLabels[r] ?? pretty(r))
    return names.length <= 3 ? names.join(", ") : `${names.slice(0, 2).join(", ")} and ${names.length - 2} more`
}

type StatusFilter = "active" | "deactivated" | "all"
type TypeFilter = "any" | "required" | "optional"

const CONTROL = "rounded-lg border theme-outline theme-bg theme-text px-3 min-h-11 md:min-h-10 text-sm"

/**
 * Notices in the Control Panel: a grid of cards, newest first, under the same
 * controls as the task board: Active / Deactivated / All, search, and a
 * Filter row (type, audience). Each card shows who it's for and how many
 * have answered; it opens the notice's own page.
 */
export default function NotificationsPage() {
    usePageHeader("Notifications")
    const navigate = useNavigate()
    const [notifications, setNotifications] = useState<NotificationSummary[]>([])
    const [roleCatalog, setRoleCatalog] = useBootstrapped<{ value: string, label: string }[]>("roles", [])
    const roleLabels = useMemo<Record<string, string>>(() => Object.fromEntries(roleCatalog.map(c => [c.value, c.label])), [roleCatalog])
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState<string | null>(null)

    const [search, setSearch] = useState("")
    const [status, setStatus] = useState<StatusFilter>("active")
    const [filtersOpen, setFiltersOpen] = useState(false)
    const [type, setType] = useState<TypeFilter>("any")
    const [audience, setAudience] = useState("")

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
            if (rRes.ok) setRoleCatalog(await rRes.json() as { value: string, label: string }[])
        } catch {
            setError("Couldn't load notifications.")
        } finally {
            setLoading(false)
        }
    }, [setRoleCatalog])

    useEffect(() => { void load() }, [load])

    const counts: Record<StatusFilter, number> = {
        active: notifications.filter(n => n.active).length,
        deactivated: notifications.filter(n => !n.active).length,
        all: notifications.length,
    }

    const rows = useMemo(() => {
        const q = search.trim().toLowerCase()
        return notifications
            .filter(n => status === "all" ? true : status === "active" ? n.active : !n.active)
            .filter(n => type === "any" || (type === "required") === n.hard_block)
            // A notice for everyone reaches every audience.
            .filter(n => !audience || n.target_roles.length === 0 || n.target_roles.includes(audience))
            .filter(n => !q || n.title.toLowerCase().includes(q) || n.body.toLowerCase().includes(q))
            .sort((a, b) => +new Date(b.created_at) - +new Date(a.created_at))
    }, [notifications, search, status, type, audience])

    const activeFilters = (type !== "any" ? 1 : 0) + (audience ? 1 : 0)
    const statusOpts: { key: StatusFilter, label: string }[] = [
        { key: "active", label: "Active" },
        { key: "deactivated", label: "Deactivated" },
        { key: "all", label: "All" },
    ]

    return (
        <div className="px-4 md:px-6 py-4 md:py-6 pb-28 flex flex-col gap-4">
            <Button variant="fab" aria-label="New notice" onClick={() => navigate("/control/notifications/new")}>
                <Plus size={21} />
            </Button>

            {/* ── Controls ─────────────────────────────────────────── */}
            <div className="flex flex-wrap items-center gap-2 md:gap-3">
                <Segmented label="Show" value={status} onChange={setStatus}
                    options={statusOpts.map(o => ({ value: o.key, label: o.label, count: counts[o.key] }))} className="w-full md:w-auto" />
                <label className={`${CONTROL} flex-1 min-w-40 md:max-w-xs flex items-center gap-2 focus-within:ring-2 focus-within:ring-[var(--theme-text-contrast)]`}>
                    <Search size={16} className="shrink-0 theme-subtext-color" aria-hidden="true" />
                    <input type="search" value={search} onChange={e => setSearch(e.target.value)} placeholder="Search notices" aria-label="Search notices"
                        className="flex-1 min-w-0 bg-transparent outline-none text-base md:text-sm placeholder:text-[var(--theme-subtext-color)]" />
                </label>
                <button type="button" onClick={() => setFiltersOpen(v => !v)} aria-expanded={filtersOpen}
                    className={`${CONTROL} flex items-center gap-2 shrink-0 ${focusRing}`}
                    style={activeFilters > 0 ? { borderColor: "var(--theme-text-contrast)", color: "var(--theme-text-contrast)" } : undefined}>
                    <SlidersHorizontal size={16} aria-hidden="true" />
                    <span className="hidden sm:inline">Filter</span>
                    {activeFilters > 0 && <span className="text-xs font-bold">{activeFilters}</span>}
                </button>
            </div>

            {filtersOpen && (
                <div className="flex flex-wrap items-center gap-3 p-3 rounded-xl border theme-border theme-bg">
                    <Segmented label="Type" value={type} onChange={setType} options={[
                        { value: "any", label: "Any type" }, { value: "required", label: "Required" }, { value: "optional", label: "Optional" },
                    ]} />
                    <div className="w-full sm:w-56">
                        <Dropdown value={audience} onChange={setAudience} label="Audience" searchable triggerClassName={`${CONTROL} w-full`}
                            options={[{ value: "", label: "Any audience" }, ...roleCatalog]} />
                    </div>
                    {activeFilters > 0 && (
                        <Button variant="text" className="ml-auto" onClick={() => { setType("any"); setAudience("") }}>Clear</Button>
                    )}
                </div>
            )}

            {error && <Notice>{error} <Button variant="text" onClick={() => void load()}>Try again</Button></Notice>}

            {/* ── Notices ──────────────────────────────────────────── */}
            {loading ? (
                <div className="grid gap-3 grid-cols-[repeat(auto-fill,minmax(min(100%,320px),1fr))]" role="status" aria-label="Loading notifications">
                    {Array.from({ length: 4 }, (_, i) => <Skeleton key={i} className="h-32 w-full rounded-xl" />)}
                </div>
            ) : rows.length === 0 ? (
                <div className="rounded-xl border border-dashed theme-border theme-bg">
                    <EmptyState variant="screen" title={notifications.length === 0 ? "No notices yet" : "No notices match"}/>
                </div>
            ) : (
                <div className="grid gap-3 items-start grid-cols-[repeat(auto-fill,minmax(min(100%,320px),1fr))]">
                    {rows.map(n => <NoticeCard key={n.id} notice={n} roleLabels={roleLabels} onOpen={() => navigate(`/control/notifications/${n.id}`)} />)}
                </div>
            )}
        </div>
    )
}

function NoticeCard({ notice: n, roleLabels, onOpen }: { notice: NotificationSummary, roleLabels: Record<string, string>, onOpen: () => void }) {
    const pct = n.eligible_count > 0 ? Math.round((n.response_count / n.eligible_count) * 100) : 0
    const author = n.created_by_is_self ? "you" : n.created_by_name ?? "someone"
    const date = new Date(n.created_at).toLocaleDateString([], { month: "short", day: "numeric" })
    return (
        <button type="button" onClick={onOpen}
            className={`text-left flex flex-col gap-3 rounded-xl border p-4 theme-border theme-bg transition-colors hover:border-(--theme-outline) ${focusRing}`}
            style={{ opacity: n.active ? 1 : 0.65 }}>
            <div className="flex flex-col gap-1 min-w-0">
                <div className="flex items-start gap-2">
                    <span className="flex-1 min-w-0 text-sm font-semibold leading-snug theme-h1-color break-words">{n.title}</span>
                    {n.hard_block && <Pill accent>Required</Pill>}
                    {!n.active && <Pill>Deactivated</Pill>}
                </div>
                <span className="text-xs theme-subtext-color">For {formatRoles(n.target_roles, roleLabels)} · by {author} · {date}</span>
            </div>
            <div className="flex flex-col gap-1.5">
                <div className="flex items-baseline justify-between gap-2 text-xs theme-subtext-color">
                    <span>{n.response_count} of {n.eligible_count} answered</span>
                    <span className="font-semibold theme-text-contrast">{pct}%</span>
                </div>
                <div className="h-1.5 w-full rounded-full overflow-hidden" style={{ background: "color-mix(in oklch, var(--theme-border) 80%, transparent)" }}>
                    <div className="h-full rounded-full" style={{ width: `${pct}%`, background: "var(--theme-text-contrast)" }} />
                </div>
            </div>
        </button>
    )
}

function Pill({ accent = false, children }: { accent?: boolean, children: string }) {
    return (
        <span className={`shrink-0 rounded-full border px-2 py-0.5 uppercase ${typeBadge}`}
            style={accent
                ? { color: "var(--theme-text-contrast)", borderColor: "color-mix(in oklch, var(--theme-text-contrast) 55%, transparent)" }
                : { color: "var(--theme-subtext-color)", borderColor: "var(--theme-border)" }}>
            {children}
        </span>
    )
}

/** A pill group of mutually exclusive choices, optionally with counts. */
function Segmented<T extends string>({ label, value, onChange, options, className = "" }: {
    label: string; value: T; onChange: (v: T) => void; options: { value: T, label: string, count?: number }[]; className?: string
}) {
    return (
        <div role="radiogroup" aria-label={label} className={`flex gap-1 p-1 rounded-xl border theme-border ${className}`} style={{ background: "var(--theme-button-bg)" }}>
            {options.map(o => {
                const active = value === o.value
                return (
                    <button key={o.value} type="button" role="radio" aria-checked={active} onClick={() => onChange(o.value)}
                        className={`flex-1 md:flex-none min-h-9 px-3.5 rounded-lg text-sm font-semibold whitespace-nowrap ${focusRing}`}
                        style={{
                            background: active ? "var(--theme-bg)" : "transparent",
                            color: active ? "var(--theme-text-contrast)" : "var(--theme-subtext-color)",
                            boxShadow: active ? "0 0 0 1px var(--theme-border)" : "none",
                        }}>
                        {o.label}{o.count !== undefined && <span className="font-normal opacity-80"> {o.count}</span>}
                    </button>
                )
            })}
        </div>
    )
}
