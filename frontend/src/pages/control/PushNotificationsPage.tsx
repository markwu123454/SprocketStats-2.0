import { useCallback, useEffect, useMemo, useState } from "react"
import { Link } from "react-router-dom"
import {
    ChevronLeft, ChevronRight, ChevronDown, Send, Search,
    CheckCircle2, AlertCircle, XCircle, Clock,
} from "lucide-react"
import { useIsMobile } from "../../lib/useIsMobile"
import RoleAudienceSelect, { type RoleMeta } from "@/components/RoleAudienceSelect"

const API = import.meta.env.VITE_BACKEND_URL

interface PushMessage {
    id: string
    title: string
    body: string
    target_roles: string[]
    sent_count: number
    delivered_count: number
    failed_count: number
    created_by_name: string | null
    created_at: string
}

interface DeliveryRow {
    id: string
    user_name: string | null
    status: "sent" | "delivered" | "partial" | "failed"
    updated_at: string
}

interface DeliveryDetails {
    summary: { delivered: number, partial: number, failed: number, pending: number }
    deliveries: DeliveryRow[]
}

/** "sent" means still pending within the receipt window; "partial" means
 *  some but not all of a user's devices got it; only "failed" is a true
 *  failure. */
function statusBadge(status: DeliveryRow["status"]) {
    if (status === "delivered") {
        return (
            <span
                className="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium theme-border shrink-0"
                style={{ color: "#16a34a", borderColor: "color-mix(in oklch, #16a34a 50%, transparent)" }}
            >
                <CheckCircle2 size={12} /> Delivered
            </span>
        )
    }
    if (status === "partial") {
        return (
            <span
                className="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium theme-border shrink-0"
                style={{ color: "#d97706", borderColor: "color-mix(in oklch, #d97706 50%, transparent)" }}
            >
                <AlertCircle size={12} /> Partial
            </span>
        )
    }
    if (status === "failed") {
        return (
            <span
                className="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium theme-border shrink-0"
                style={{ color: "#dc2626", borderColor: "color-mix(in oklch, #dc2626 50%, transparent)" }}
            >
                <XCircle size={12} /> Failed
            </span>
        )
    }
    return (
        <span className="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium theme-border theme-subtext-color shrink-0">
            <Clock size={12} /> Pending
        </span>
    )
}

/** Small at-a-glance pill for a message row in the history list. Surfaces the
 *  worst outcome first so failures are visible before you open anything. */
function listBadge(m: PushMessage) {
    if (m.failed_count > 0) {
        return { label: `${m.failed_count} failed`, color: "#dc2626" }
    }
    const pending = Math.max(0, m.sent_count - m.delivered_count)
    if (pending > 0) {
        return { label: `${pending} pending`, color: "#d97706" }
    }
    return { label: "All delivered", color: "#16a34a" }
}

interface FormState {
    title: string
    body: string
    target_roles: string[]
}

const EMPTY_FORM: FormState = { title: "", body: "", target_roles: [] }

/** "scouting_lead" → "Scouting Lead" */
function pretty(v: string): string {
    return v.split("_").map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(" ")
}

function formatRoles(roles: string[], roleLabels: Record<string, string>): string {
    if (roles.length === 0) return "Everyone"
    return roles.map(r => roleLabels[r] ?? pretty(r)).join(", ")
}

/** One collapsible bucket of recipients (Not delivered / Partial / Delivered).
 *  Collapsible everywhere; callers set `defaultOpen` so mobile can start with
 *  Delivered folded away and the failures on top. */
function DeliverySection(
    { label, rows, defaultOpen }: { label: string, rows: DeliveryRow[], defaultOpen: boolean },
) {
    const [open, setOpen] = useState(defaultOpen)
    return (
        <div className="flex flex-col">
            <button
                onClick={() => setOpen(o => !o)}
                className="flex items-center justify-between gap-2 rounded-lg border px-3 py-2 theme-border theme-button-bg"
            >
                <span className="text-xs font-semibold uppercase tracking-widest theme-subtext-color">
                    {label} ({rows.length})
                </span>
                <ChevronDown
                    size={15}
                    className="theme-subtext-color transition-transform"
                    style={{ transform: open ? "rotate(180deg)" : "none" }}
                />
            </button>
            {open && rows.length > 0 && (
                <div className="flex flex-col">
                    {rows.map(d => (
                        <div
                            key={d.id}
                            className="flex items-center justify-between gap-3 border-x border-b px-3 py-2 theme-border last:rounded-b-lg"
                        >
                            <span className="text-sm theme-text truncate">{d.user_name ?? "Unknown user"}</span>
                            <div className="flex items-center gap-2 shrink-0">
                                {statusBadge(d.status)}
                                <span className="text-xs theme-subtext-color hidden sm:inline">
                                    {new Date(d.updated_at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}
                                </span>
                            </div>
                        </div>
                    ))}
                </div>
            )}
        </div>
    )
}

/**
 * The right-hand (desktop) / drilled-in (mobile) delivery view for a single
 * push. Fetches per-user receipts on mount — remount by keying on the message
 * id when the selection changes. Buckets are ordered failures-first, since the
 * whole reason to open a send is to find who didn't get it.
 */
function DeliveryDetail(
    { message, roleLabels }: { message: PushMessage, roleLabels: Record<string, string> },
) {
    const [data, setData] = useState<DeliveryDetails | null>(null)
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState<string | null>(null)
    const [search, setSearch] = useState("")

    const load = useCallback(async () => {
        setLoading(true)
        setError(null)
        try {
            const res = await fetch(`${API}/push/${message.id}/deliveries`, { credentials: "include" })
            if (!res.ok) throw new Error("deliveries")
            setData(await res.json() as DeliveryDetails)
        } catch {
            setError("Failed to load delivery details")
        } finally {
            setLoading(false)
        }
    }, [message.id])

    useEffect(() => { void load() }, [load])

    const q = search.trim().toLowerCase()
    const matches = (d: DeliveryRow) => !q || (d.user_name ?? "Unknown user").toLowerCase().includes(q)
    const notDelivered = data?.deliveries.filter(d => d.status === "sent" || d.status === "failed").filter(matches) ?? []
    const partial = data?.deliveries.filter(d => d.status === "partial").filter(matches) ?? []
    const delivered = data?.deliveries.filter(d => d.status === "delivered").filter(matches) ?? []

    return (
        <div className="flex flex-col gap-4 h-full overflow-y-auto theme-scrollbar">
            {/* header */}
            <div className="flex flex-col gap-2">
                <h2 className="text-lg font-semibold theme-h1-color">{message.title}</h2>
                <p className="text-sm theme-text whitespace-pre-wrap">{message.body}</p>
                <div className="flex flex-wrap gap-1.5 pt-1">
                    <span className="rounded-full border px-2.5 py-0.5 text-xs theme-border theme-subtext-color">
                        {formatRoles(message.target_roles, roleLabels)}
                    </span>
                    <span className="rounded-full border px-2.5 py-0.5 text-xs theme-border theme-subtext-color">
                        {message.created_by_name ?? "—"}
                    </span>
                    <span className="rounded-full border px-2.5 py-0.5 text-xs theme-border theme-subtext-color">
                        {new Date(message.created_at).toLocaleString()}
                    </span>
                </div>
                {data && (
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm pt-1">
                        <span className="font-medium" style={{ color: "#16a34a" }}>{data.summary.delivered} delivered</span>
                        <span className="theme-subtext-color">·</span>
                        <span className="font-medium" style={{ color: "#d97706" }}>{data.summary.partial} partial</span>
                        <span className="theme-subtext-color">·</span>
                        <span className="font-medium" style={{ color: "#dc2626" }}>{data.summary.failed} failed</span>
                        {data.summary.pending > 0 && (
                            <>
                                <span className="theme-subtext-color">·</span>
                                <span className="theme-subtext-color">{data.summary.pending} pending</span>
                            </>
                        )}
                    </div>
                )}
            </div>

            {loading && <p className="text-sm theme-subtext-color">Loading…</p>}

            {error && (
                <div className="flex flex-col gap-2">
                    <p className="text-sm px-3 py-2 rounded-lg border theme-subtext-color theme-border"
                       style={{ background: "color-mix(in oklch, var(--theme-border) 40%, transparent)" }}>
                        {error}
                    </p>
                    <button
                        onClick={() => void load()}
                        className="self-start rounded-lg border px-3 py-1.5 text-sm font-medium theme-text theme-border transition-opacity hover:opacity-80"
                    >
                        Retry
                    </button>
                </div>
            )}

            {data && (
                <>
                    <div className="flex items-center gap-2 rounded-lg border px-3 py-1.5 theme-border theme-bg">
                        <Search size={15} className="theme-subtext-color shrink-0" />
                        <input
                            value={search}
                            onChange={e => setSearch(e.target.value)}
                            placeholder="Search by name…"
                            className="w-full bg-transparent text-sm theme-text outline-none"
                        />
                    </div>
                    <div className="flex flex-col gap-3">
                        <DeliverySection label="Not delivered" rows={notDelivered} defaultOpen />
                        <DeliverySection label="Partial" rows={partial} defaultOpen />
                        <DeliverySection label="Delivered" rows={delivered} defaultOpen={false} />
                    </div>
                </>
            )}
        </div>
    )
}

/** A single row in the history list — shared by desktop rail and mobile list. */
function HistoryRow(
    { m, roleLabels, selected, onClick }:
    { m: PushMessage, roleLabels: Record<string, string>, selected: boolean, onClick: () => void },
) {
    const badge = listBadge(m)
    return (
        <button
            onClick={onClick}
            className="w-full text-left flex flex-col gap-1.5 px-4 py-3 border-b theme-border transition-colors"
            style={{
                borderLeft: selected ? "2px solid var(--theme-text-contrast)" : "2px solid transparent",
                background: selected ? "color-mix(in oklch, var(--theme-text-contrast) 8%, transparent)" : "transparent",
            }}
        >
            <div className="flex items-start justify-between gap-2.5">
                <span className="text-sm font-medium theme-text leading-snug">{m.title}</span>
                <span
                    className="shrink-0 rounded-full border px-2 py-0.5 text-[11px] font-medium"
                    style={{
                        color: badge.color,
                        borderColor: `color-mix(in oklch, ${badge.color} 45%, transparent)`,
                        background: `color-mix(in oklch, ${badge.color} 10%, transparent)`,
                    }}
                >
                    {badge.label}
                </span>
            </div>
            <div className="flex items-center justify-between gap-2">
                <span className="text-xs theme-subtext-color truncate">
                    {formatRoles(m.target_roles, roleLabels)} · {new Date(m.created_at).toLocaleDateString([], { month: "short", day: "numeric" })}
                </span>
                <ChevronRight size={16} className="theme-subtext-color shrink-0 md:hidden" />
            </div>
        </button>
    )
}

/**
 * Compose + send a one-off OS push notification, with a delivery-focused
 * history.
 *
 * Compose and History are tabs so the history gets the full page height. The
 * history is a master–detail split on desktop (message list on the left,
 * per-recipient delivery status on the right) and a drill-down on mobile
 * (list → tap → detail with a back button). Both surface who *didn't* get a
 * push without an overlay covering the workspace — buckets are ordered
 * Not-delivered → Partial → Delivered.
 *
 * Deliberately a standalone page hitting `/push`, not `/notifications`.
 */
export default function PushNotificationsPage() {
    const isMobile = useIsMobile()

    const [messages, setMessages] = useState<PushMessage[]>([])
    const [catalog, setCatalog] = useState<RoleMeta[]>([])
    const [roleLabels, setRoleLabels] = useState<Record<string, string>>({})
    const [loading, setLoading] = useState(true)
    const [loadError, setLoadError] = useState<string | null>(null)

    const [tab, setTab] = useState<"compose" | "history">("compose")

    const [form, setForm] = useState<FormState>(EMPTY_FORM)
    const [sending, setSending] = useState(false)
    const [sendError, setSendError] = useState<string | null>(null)
    const [sendSuccess, setSendSuccess] = useState<string | null>(null)

    // Selected message in the history split. On mobile a non-null selection is
    // the "drilled-in" detail screen; on desktop it's the right-hand pane.
    const [selectedId, setSelectedId] = useState<string | null>(null)

    const load = useCallback(async () => {
        setLoading(true)
        setLoadError(null)
        try {
            const [mRes, rRes] = await Promise.all([
                fetch(`${API}/push`, { credentials: "include" }),
                fetch(`${API}/auth/roles`, { credentials: "include" }),
            ])
            if (!mRes.ok) throw new Error("push")
            setMessages(await mRes.json() as PushMessage[])
            if (rRes.ok) {
                const cat = await rRes.json() as RoleMeta[]
                setCatalog(cat)
                setRoleLabels(Object.fromEntries(cat.map(c => [c.value, c.label])))
            }
        } catch {
            setLoadError("Failed to load push history")
        } finally {
            setLoading(false)
        }
    }, [])

    useEffect(() => { void load() }, [load])

    const sortedMessages = useMemo(
        () => [...messages].sort((a, b) => +new Date(b.created_at) - +new Date(a.created_at)),
        [messages],
    )

    // Keep a valid desktop selection; mobile starts on the list (null).
    useEffect(() => {
        if (isMobile) return
        if (tab !== "history") return
        if (!selectedId && sortedMessages.length > 0) setSelectedId(sortedMessages[0].id)
    }, [isMobile, tab, selectedId, sortedMessages])

    const selectedMessage = sortedMessages.find(m => m.id === selectedId) ?? null

    async function handleSend() {
        setSending(true)
        setSendError(null)
        setSendSuccess(null)
        try {
            const res = await fetch(`${API}/push`, {
                method: "POST",
                credentials: "include",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    title: form.title,
                    body: form.body,
                    target_roles: form.target_roles,
                }),
            })
            if (!res.ok) {
                const data = await res.json().catch(() => null) as { detail?: string } | null
                throw new Error(data?.detail ?? "Failed to send push")
            }
            const sent = await res.json() as PushMessage
            setSendSuccess(`Sent to ${sent.sent_count} device${sent.sent_count === 1 ? "" : "s"}`)
            setForm(EMPTY_FORM)
            await load()
            // Jump to the fresh send in the history so its delivery can be watched.
            setSelectedId(sent.id)
            setTab("history")
        } catch (e) {
            setSendError(e instanceof Error ? e.message : "Failed to send push")
        } finally {
            setSending(false)
        }
    }

    const tabButton = (key: "compose" | "history", label: string) => {
        const active = tab === key
        return (
            <button
                onClick={() => setTab(key)}
                className="pb-2.5 text-sm transition-colors"
                style={{
                    fontWeight: active ? 700 : 500,
                    color: active ? "var(--theme-text-contrast)" : "var(--theme-subtext-color)",
                    borderBottom: active ? "2px solid var(--theme-text-contrast)" : "2px solid transparent",
                    marginBottom: -1,
                }}
            >
                {label}
            </button>
        )
    }

    return (
        <div className="px-4 py-6 flex flex-col gap-5 h-full">
            <div className="flex items-center gap-2">
                <Link
                    to="/control"
                    aria-label="Back to Control Panel"
                    className="md:hidden flex items-center justify-center w-9 h-9 -ml-2 rounded-lg theme-text opacity-60 hover:opacity-100 transition-opacity"
                >
                    <ChevronLeft size={22} />
                </Link>
                <h1 className="text-2xl font-bold theme-h1-color">Push Notifications</h1>
            </div>

            {/* Tabs */}
            <div className="flex gap-6 border-b theme-border">
                {tabButton("compose", "Compose")}
                {tabButton("history", `History${messages.length ? ` · ${messages.length}` : ""}`)}
            </div>

            {/* ---------- COMPOSE ---------- */}
            {tab === "compose" && (
                <div className="flex flex-col gap-3 max-w-2xl">
                    <label className="flex flex-col gap-1 text-sm theme-text">
                        Title
                        <input
                            value={form.title}
                            onChange={e => setForm(prev => ({ ...prev, title: e.target.value }))}
                            className="rounded-lg border px-3 py-2 text-sm theme-border theme-bg theme-text"
                        />
                    </label>
                    <label className="flex flex-col gap-1 text-sm theme-text">
                        Body
                        <textarea
                            value={form.body}
                            onChange={e => setForm(prev => ({ ...prev, body: e.target.value }))}
                            rows={3}
                            className="rounded-lg border px-3 py-2 text-sm theme-border theme-bg theme-text resize-none"
                        />
                    </label>
                    <div className="flex flex-col gap-1.5">
                        <p className="text-sm theme-text">Send to</p>
                        <RoleAudienceSelect
                            catalog={catalog}
                            selected={form.target_roles}
                            onChange={roles => setForm(prev => ({ ...prev, target_roles: roles }))}
                        />
                    </div>

                    {sendError && (
                        <p className="text-sm px-3 py-2 rounded-lg border theme-subtext-color theme-border"
                           style={{ background: "color-mix(in oklch, var(--theme-border) 40%, transparent)" }}>
                            {sendError}
                        </p>
                    )}
                    {sendSuccess && (
                        <p className="text-sm px-3 py-2 rounded-lg border theme-text-contrast theme-border">
                            {sendSuccess}
                        </p>
                    )}

                    <div className="flex flex-wrap items-center gap-3 pt-1">
                        <p className="text-sm theme-subtext-color min-w-0">
                            Sending to <span className="font-semibold theme-text-contrast">{formatRoles(form.target_roles, roleLabels)}</span>
                        </p>
                        <button
                            onClick={() => void handleSend()}
                            disabled={sending || !form.title.trim() || !form.body.trim()}
                            className="ml-auto flex items-center gap-1.5 rounded-lg px-4 py-2 text-sm font-semibold transition-opacity hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed"
                            style={{ background: "var(--theme-text-contrast)", color: "var(--theme-bg)" }}
                        >
                            <Send size={16} />
                            {sending ? "Sending…" : "Send Push"}
                        </button>
                    </div>
                </div>
            )}

            {/* ---------- HISTORY ---------- */}
            {tab === "history" && (
                <div className="flex flex-col flex-1 min-h-0">
                    {loadError && (
                        <p className="text-sm px-3 py-2 mb-3 rounded-lg border theme-subtext-color theme-border"
                           style={{ background: "color-mix(in oklch, var(--theme-border) 40%, transparent)" }}>
                            {loadError}
                        </p>
                    )}

                    {loading ? (
                        <p className="text-sm theme-subtext-color px-1">Loading…</p>
                    ) : sortedMessages.length === 0 ? (
                        <p className="text-sm theme-subtext-color px-1">No pushes sent yet.</p>
                    ) : isMobile ? (
                        /* ---- Mobile: drill-down ---- */
                        selectedMessage ? (
                            <div className="flex flex-col flex-1 min-h-0 gap-3">
                                <button
                                    onClick={() => setSelectedId(null)}
                                    className="flex items-center gap-1 self-start text-sm font-medium theme-text-contrast"
                                >
                                    <ChevronLeft size={20} /> History
                                </button>
                                <div className="flex-1 min-h-0 rounded-xl border p-4 theme-border backdrop-blur-sm" style={{ background: "var(--theme-bg)" }}>
                                    <DeliveryDetail key={selectedMessage.id} message={selectedMessage} roleLabels={roleLabels} />
                                </div>
                            </div>
                        ) : (
                            <div className="flex flex-col flex-1 min-h-0 overflow-y-auto rounded-xl border theme-border theme-scrollbar backdrop-blur-sm" style={{ background: "var(--theme-bg)" }}>
                                {sortedMessages.map(m => (
                                    <HistoryRow
                                        key={m.id}
                                        m={m}
                                        roleLabels={roleLabels}
                                        selected={false}
                                        onClick={() => setSelectedId(m.id)}
                                    />
                                ))}
                            </div>
                        )
                    ) : (
                        /* ---- Desktop: master–detail split ---- */
                        <div className="flex flex-1 min-h-0 rounded-xl border overflow-hidden theme-border backdrop-blur-sm" style={{ background: "var(--theme-bg)" }}>
                            <div className="w-[340px] shrink-0 border-r overflow-y-auto theme-border theme-scrollbar">
                                {sortedMessages.map(m => (
                                    <HistoryRow
                                        key={m.id}
                                        m={m}
                                        roleLabels={roleLabels}
                                        selected={m.id === selectedId}
                                        onClick={() => setSelectedId(m.id)}
                                    />
                                ))}
                            </div>
                            <div className="flex-1 min-w-0 p-6">
                                {selectedMessage
                                    ? <DeliveryDetail key={selectedMessage.id} message={selectedMessage} roleLabels={roleLabels} />
                                    : <p className="text-sm theme-subtext-color">Select a push to see delivery details.</p>}
                            </div>
                        </div>
                    )}
                </div>
            )}
        </div>
    )
}
