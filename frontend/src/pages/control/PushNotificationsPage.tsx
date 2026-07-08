import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { Link } from "react-router-dom"
import { ChevronLeft, Send } from "lucide-react"
import { AgGridReact } from "ag-grid-react"
import type { ColDef, ValueFormatterParams } from "ag-grid-community"

const API = import.meta.env.VITE_BACKEND_URL

interface PushMessage {
    id: string
    title: string
    body: string
    target_roles: string[]
    sent_count: number
    created_by_name: string | null
    created_at: string
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
        { field: "sent_count", headerName: "Devices", flex: 0.8, minWidth: 90, type: "numericColumn" },
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
                        loading={loading}
                        getRowId={({ data }) => data.id}
                        defaultColDef={{ sortable: true, resizable: true, filter: true }}
                    />
                </div>
            </div>
        </div>
    )
}
