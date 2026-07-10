import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { Link } from "react-router-dom"
import { ChevronLeft, Send, X, CheckCircle2, AlertCircle, XCircle, Clock } from "lucide-react"
import { AgGridReact } from "ag-grid-react"
import type { ColDef, ICellRendererParams, ValueFormatterParams } from "ag-grid-community"

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

/** Extra data the Devices cell renderer needs but that isn't part of a row. */
interface GridContext {
    onOpenDeliveries: (message: PushMessage) => void
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

/** Devices column cell -- a clickable "delivered / sent" pill that opens the
 *  delivery-details modal for that message. Nothing to inspect at 0 sends. */
function DevicesCellRenderer(p: ICellRendererParams<PushMessage, number>) {
    const data = p.data
    if (!data) return null
    if (data.sent_count === 0) return <span className="theme-subtext-color">0</span>

    const ctx = p.context as GridContext
    return (
        <button
            onClick={() => ctx.onOpenDeliveries(data)}
            className="rounded-full border px-2.5 py-0.5 text-xs font-medium theme-border theme-text transition-opacity hover:opacity-80"
        >
            {data.delivered_count} / {data.sent_count}
        </button>
    )
}

/**
 * Delivery-details modal for one push message -- fetches per-user receipt
 * status on open (a user with several devices is one row, "delivered" if any
 * of them got it). Follows `NotificationGate`'s overlay pattern (dark
 * backdrop, centered rounded panel) but is dismissible via the X button or
 * backdrop click, since this is informational rather than something the user
 * must respond to.
 */
function DeliveryDetailsModal({ message, onClose }: { message: PushMessage, onClose: () => void }) {
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

    // Substring, case-insensitive match on name -- same quick-filter behavior
    // as the responses grid's search box on the notice detail page.
    const q = search.trim().toLowerCase()
    const matches = (d: DeliveryRow) => !q || (d.user_name ?? "Unknown user").toLowerCase().includes(q)
    const delivered = data?.deliveries.filter(d => d.status === "delivered").filter(matches) ?? []
    const partial = data?.deliveries.filter(d => d.status === "partial").filter(matches) ?? []
    const notDelivered = data?.deliveries.filter(d => d.status === "sent" || d.status === "failed").filter(matches) ?? []

    return (
        <div
            className="fixed inset-0 z-[100] flex items-center justify-center p-4"
            style={{ background: "rgba(0,0,0,0.6)" }}
            onClick={onClose}
        >
            <div
                className="w-full max-w-md max-h-[85vh] rounded-2xl border p-6 flex flex-col gap-4 backdrop-blur-sm theme-bg theme-border"
                onClick={e => e.stopPropagation()}
            >
                <div className="flex items-start justify-between gap-3">
                    <div className="flex flex-col gap-1 min-w-0">
                        <h2 className="text-lg font-semibold theme-text-contrast truncate">{message.title}</h2>
                        {data && (
                            <p className="text-sm theme-subtext-color">
                                {data.summary.delivered} delivered · {data.summary.partial} partial · {data.summary.failed} failed · {data.summary.pending} pending
                            </p>
                        )}
                    </div>
                    <button
                        onClick={onClose}
                        aria-label="Close"
                        className="shrink-0 theme-subtext-color transition-opacity hover:opacity-70"
                    >
                        <X size={18} />
                    </button>
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
                    <div className="flex flex-col gap-4 overflow-y-auto">
                        <input
                            value={search}
                            onChange={e => setSearch(e.target.value)}
                            placeholder="Search by name…"
                            className="rounded-lg border px-3 py-1.5 text-sm theme-border theme-bg theme-text"
                        />

                        <div className="flex flex-col gap-2">
                            <h3 className="text-xs font-semibold uppercase tracking-widest theme-subtext-color">
                                Delivered ({delivered.length})
                            </h3>
                            {delivered.length === 0 ? (
                                <p className="text-sm theme-subtext-color">None yet</p>
                            ) : (
                                <div className="flex flex-col gap-2">
                                    {delivered.map(d => (
                                        <div key={d.id} className="flex items-center justify-between gap-3 rounded-lg border px-3 py-2 theme-border">
                                            <span className="text-sm theme-text truncate">{d.user_name ?? "Unknown user"}</span>
                                            <div className="flex flex-col items-end gap-1 shrink-0">
                                                {statusBadge(d.status)}
                                                <span className="text-xs theme-subtext-color">{new Date(d.updated_at).toLocaleString()}</span>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>

                        <div className="flex flex-col gap-2">
                            <h3 className="text-xs font-semibold uppercase tracking-widest theme-subtext-color">
                                Partially Delivered ({partial.length})
                            </h3>
                            {partial.length === 0 ? (
                                <p className="text-sm theme-subtext-color">None</p>
                            ) : (
                                <div className="flex flex-col gap-2">
                                    {partial.map(d => (
                                        <div key={d.id} className="flex items-center justify-between gap-3 rounded-lg border px-3 py-2 theme-border">
                                            <span className="text-sm theme-text truncate">{d.user_name ?? "Unknown user"}</span>
                                            <div className="flex flex-col items-end gap-1 shrink-0">
                                                {statusBadge(d.status)}
                                                <span className="text-xs theme-subtext-color">{new Date(d.updated_at).toLocaleString()}</span>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>

                        <div className="flex flex-col gap-2">
                            <h3 className="text-xs font-semibold uppercase tracking-widest theme-subtext-color">
                                Not Delivered ({notDelivered.length})
                            </h3>
                            {notDelivered.length === 0 ? (
                                <p className="text-sm theme-subtext-color">None</p>
                            ) : (
                                <div className="flex flex-col gap-2">
                                    {notDelivered.map(d => (
                                        <div key={d.id} className="flex items-center justify-between gap-3 rounded-lg border px-3 py-2 theme-border">
                                            <span className="text-sm theme-text truncate">{d.user_name ?? "Unknown user"}</span>
                                            {statusBadge(d.status)}
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>
                    </div>
                )}
            </div>
        </div>
    )
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

/**
 * Compose + send a one-off OS push notification, with a history of past sends.
 *
 * Deliberately a standalone page hitting `/push`, not `/notifications` -- this
 * never creates a dashboard notice (no `NotificationGate` modal), and creating
 * a dashboard notice on the Notifications page never sends a push. The two
 * features share only the device-level subscription (opted into once, in
 * Settings), not each other's content or delivery path.
 */
export default function PushNotificationsPage() {
    const gridRef = useRef<AgGridReact<PushMessage>>(null)
    const [messages, setMessages] = useState<PushMessage[]>([])
    const [roleOptions, setRoleOptions] = useState<string[]>([])
    const [roleLabels, setRoleLabels] = useState<Record<string, string>>({})
    const [loading, setLoading] = useState(true)
    const [loadError, setLoadError] = useState<string | null>(null)

    const [form, setForm] = useState<FormState>(EMPTY_FORM)
    const [sending, setSending] = useState(false)
    const [sendError, setSendError] = useState<string | null>(null)
    const [sendSuccess, setSendSuccess] = useState<string | null>(null)

    const [deliveryModalMessage, setDeliveryModalMessage] = useState<PushMessage | null>(null)
    const gridContext = useMemo<GridContext>(() => ({
        onOpenDeliveries: setDeliveryModalMessage,
    }), [])

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
                const catalog = await rRes.json() as { value: string, label: string }[]
                setRoleOptions(catalog.map(c => c.value))
                setRoleLabels(Object.fromEntries(catalog.map(c => [c.value, c.label])))
            }
        } catch {
            setLoadError("Failed to load push history")
        } finally {
            setLoading(false)
        }
    }, [])

    useEffect(() => { void load() }, [load])

    // Empty target_roles means "everyone"; a role is checked when the set is
    // empty (nothing excluded yet) or explicitly listed.
    const roleChecked = useMemo(() => {
        if (form.target_roles.length === 0) return new Set(roleOptions)
        return new Set(form.target_roles)
    }, [form.target_roles, roleOptions])

    function toggleRole(role: string) {
        setForm(prev => {
            const current = prev.target_roles.length === 0 ? new Set(roleOptions) : new Set(prev.target_roles)
            if (current.has(role)) current.delete(role)
            else current.add(role)
            const allChecked = roleOptions.every(r => current.has(r))
            return { ...prev, target_roles: allChecked ? [] : [...current] }
        })
    }

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
        } catch (e) {
            setSendError(e instanceof Error ? e.message : "Failed to send push")
        } finally {
            setSending(false)
        }
    }

    const columnDefs = useMemo<ColDef<PushMessage>[]>(() => [
        { field: "title", headerName: "Title", flex: 1.6, minWidth: 160 },
        {
            field: "target_roles", headerName: "Roles", flex: 1.6, minWidth: 160, cellDataType: "text",
            valueFormatter: (p: ValueFormatterParams<PushMessage, string[]>) => formatRoles(p.value ?? [], roleLabels),
        },
        {
            field: "sent_count", headerName: "Devices", flex: 0.8, minWidth: 90, type: "numericColumn",
            cellRenderer: DevicesCellRenderer,
        },
        {
            field: "created_by_name", headerName: "Sent By", flex: 1.1, minWidth: 130, cellDataType: "text",
            valueFormatter: (p: ValueFormatterParams<PushMessage, string | null>) => p.value ?? "—",
        },
        {
            field: "created_at", headerName: "Sent At", flex: 1.2, minWidth: 140,
            valueFormatter: (p: ValueFormatterParams<PushMessage, string>) =>
                p.value ? new Date(p.value).toLocaleString() : "",
        },
    ], [roleLabels])

    return (
        <div className="px-4 py-6 flex flex-col gap-6 h-full">
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

            {/* Compose */}
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
                    <div className="flex flex-wrap gap-x-4 gap-y-1.5">
                        {roleOptions.map(role => (
                            <label key={role} className="flex items-center gap-1.5 text-xs theme-subtext-color cursor-pointer">
                                <input
                                    type="checkbox"
                                    checked={roleChecked.has(role)}
                                    onChange={() => toggleRole(role)}
                                    className="h-3.5 w-3.5 accent-(--theme-text-contrast)"
                                />
                                {roleLabels[role] ?? pretty(role)}
                            </label>
                        ))}
                    </div>
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

                <div className="flex gap-2 pt-1">
                    <button
                        onClick={() => void handleSend()}
                        disabled={sending || !form.title.trim() || !form.body.trim()}
                        className="flex items-center gap-1.5 rounded-lg px-4 py-2 text-sm font-semibold transition-opacity hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed"
                        style={{ background: "var(--theme-text-contrast)", color: "var(--theme-bg)" }}
                    >
                        <Send size={16} />
                        {sending ? "Sending…" : "Send Push"}
                    </button>
                </div>
            </div>

            {/* History */}
            <div className="flex flex-col gap-3 flex-1 min-h-0">
                <h2 className="text-xs font-semibold uppercase tracking-widest theme-subtext-color px-1">History</h2>

                {loadError && (
                    <p className="text-sm px-3 py-2 rounded-lg border theme-subtext-color theme-border"
                       style={{ background: "color-mix(in oklch, var(--theme-border) 40%, transparent)" }}>
                        {loadError}
                    </p>
                )}

                <div className="rounded-xl border overflow-hidden theme-border flex-1 min-h-48">
                    <AgGridReact<PushMessage>
                        ref={gridRef}
                        rowData={messages}
                        columnDefs={columnDefs}
                        context={gridContext}
                        loading={loading}
                        getRowId={({ data }) => data.id}
                        defaultColDef={{ sortable: true, resizable: true, filter: true }}
                    />
                </div>
            </div>

            {deliveryModalMessage && (
                <DeliveryDetailsModal
                    message={deliveryModalMessage}
                    onClose={() => setDeliveryModalMessage(null)}
                />
            )}
        </div>
    )
}
