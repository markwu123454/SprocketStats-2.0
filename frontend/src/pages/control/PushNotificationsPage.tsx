import { useCallback, useEffect, useMemo, useState } from "react"
import { useNavigate, useParams } from "react-router-dom"
import { ChevronDown, Plus, Send, Search, CheckCircle2, AlertCircle, XCircle, Clock } from "lucide-react"
import { useBootstrapped } from "@/contexts/bootstrapContext"
import { usePageHeader } from "@/contexts/pageHeaderContext"
import RoleAudienceSelect, { type RoleMeta } from "@/components/RoleAudienceSelect"
import Button from "@/components/ui/Button"
import FormFooter from "@/components/ui/FormFooter"
import Notice from "@/components/ui/Notice"
import Skeleton from "@/components/ui/Skeleton"
import EmptyState from "@/components/ui/EmptyState"
import { useDiscardGuard, isDirtyVs } from "@/lib/useDiscardGuard"
import { fieldLabelClass, focusRing, inputClass, typeH2 } from "@/lib/uiClasses"

/*
 * Push notifications, in three pages that match Notifications:
 *  - /control/push       the sent pushes as cards, newest first, with search and a plus button
 *  - /control/push/new   the compose form; sending opens the new push's page
 *  - /control/push/:id   one push: its message, a delivery summary, and who did and didn't get it
 * Deliberately separate from Notifications: its own `/push` endpoints and history.
 */

const API = import.meta.env.VITE_BACKEND_URL

// Delivery-status colours: data identity with no matching role in the palette (success and
// warning have no tokens yet), so they stay literal. Failure uses the danger role.
const STATUS_OK = "#16a34a"
const STATUS_WARN = "#d97706"
const STATUS_FAIL = "var(--theme-danger)"
const CONTROL = "rounded-lg border theme-outline theme-bg theme-text px-3 min-h-11 md:min-h-10 text-sm"

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

/** "Everyone", or the role names; `short` cuts past three to "A, B and 13 more" for cards. */
function formatRoles(roles: string[], roleLabels: Record<string, string>, short = false): string {
    if (roles.length === 0) return "Everyone"
    const names = roles.map(r => roleLabels[r] ?? pretty(r))
    return short && names.length > 3 ? `${names.slice(0, 2).join(", ")} and ${names.length - 2} more` : names.join(", ")
}

function shortDate(iso: string): string {
    return new Date(iso).toLocaleDateString([], { month: "short", day: "numeric" })
}

/** The pushes and the role catalog, shared by all three pages. */
function usePushData() {
    const [messages, setMessages] = useState<PushMessage[] | null>(null)
    const [catalog, setCatalog] = useBootstrapped<RoleMeta[]>("roles", [])
    const roleLabels = useMemo<Record<string, string>>(() => Object.fromEntries(catalog.map(c => [c.value, c.label])), [catalog])
    const [error, setError] = useState<string | null>(null)

    const load = useCallback(async () => {
        setError(null)
        try {
            const [mRes, rRes] = await Promise.all([
                fetch(`${API}/push`, { credentials: "include" }),
                fetch(`${API}/auth/roles`, { credentials: "include" }),
            ])
            if (!mRes.ok) throw new Error("push")
            const list = await mRes.json() as PushMessage[]
            setMessages(list.sort((a, b) => +new Date(b.created_at) - +new Date(a.created_at)))
            if (rRes.ok) setCatalog(await rRes.json() as RoleMeta[])
        } catch {
            setError("Couldn't load push notifications.")
        }
    }, [setCatalog])

    useEffect(() => { void load() }, [load])
    return { messages, catalog, roleLabels, error, load }
}

/** The worst outcome of a send, for its card: failures first, then pending. */
function listBadge(m: PushMessage) {
    // Nobody in the audience had push on: nothing was sent.
    if (m.sent_count === 0) return { label: "No devices", color: "var(--theme-subtext-color)" }
    if (m.failed_count > 0) return { label: `${m.failed_count} failed`, color: STATUS_FAIL }
    const pending = Math.max(0, m.sent_count - m.delivered_count)
    if (pending > 0) return { label: `${pending} pending`, color: STATUS_WARN }
    return { label: "All delivered", color: STATUS_OK }
}

// ── /control/push ───────────────────────────────────────────────────────────

export default function PushNotificationsPage() {
    usePageHeader("Push notifications")
    const navigate = useNavigate()
    const { messages, roleLabels, error, load } = usePushData()
    const [search, setSearch] = useState("")

    const q = search.trim().toLowerCase()
    const rows = (messages ?? []).filter(m => !q || m.title.toLowerCase().includes(q) || m.body.toLowerCase().includes(q))

    return (
        <div className="px-4 md:px-6 py-4 md:py-6 pb-28 flex flex-col gap-4">
            <Button variant="fab" aria-label="New push" onClick={() => navigate("/control/push/new")}>
                <Plus size={21} />
            </Button>

            <label className={`${CONTROL} w-full md:max-w-xs flex items-center gap-2 focus-within:ring-2 focus-within:ring-[var(--theme-text-contrast)]`}>
                <Search size={16} className="shrink-0 theme-subtext-color" aria-hidden="true" />
                <input type="search" value={search} onChange={e => setSearch(e.target.value)} placeholder="Search pushes" aria-label="Search pushes"
                    className="flex-1 min-w-0 bg-transparent outline-none text-base md:text-sm placeholder:text-[var(--theme-subtext-color)]" />
            </label>

            {error && <Notice>{error} <Button variant="text" onClick={() => void load()}>Try again</Button></Notice>}

            {messages === null && !error ? (
                <div className="grid gap-3 grid-cols-[repeat(auto-fill,minmax(min(100%,320px),1fr))]" role="status" aria-label="Loading push notifications">
                    {Array.from({ length: 4 }, (_, i) => <Skeleton key={i} className="h-32 w-full rounded-xl" />)}
                </div>
            ) : rows.length === 0 && !error ? (
                <div className="rounded-xl border border-dashed theme-border theme-bg">
                    <EmptyState variant="screen" title={messages?.length ? "No pushes match" : "No pushes sent yet"}/>
                </div>
            ) : (
                <div className="grid gap-3 items-start grid-cols-[repeat(auto-fill,minmax(min(100%,320px),1fr))]">
                    {rows.map(m => <PushCard key={m.id} message={m} roleLabels={roleLabels} onOpen={() => navigate(`/control/push/${m.id}`)} />)}
                </div>
            )}
        </div>
    )
}

function PushCard({ message: m, roleLabels, onOpen }: { message: PushMessage, roleLabels: Record<string, string>, onOpen: () => void }) {
    const badge = listBadge(m)
    // Out of delivered + failed, like the push's own page: `sent_count` is devices at send
    // time (banned members included), so it doesn't line up with the per-person tallies.
    const reached = m.delivered_count + m.failed_count
    const pct = reached > 0 ? Math.round((m.delivered_count / reached) * 100) : 0
    return (
        <button type="button" onClick={onOpen}
            className={`text-left flex flex-col gap-3 rounded-xl border p-4 theme-border theme-bg transition-colors hover:border-(--theme-outline) ${focusRing}`}>
            <div className="flex flex-col gap-1 min-w-0">
                <div className="flex items-start gap-2">
                    <span className="flex-1 min-w-0 text-sm font-semibold leading-snug theme-h1-color break-words">{m.title}</span>
                    <span className="shrink-0 rounded-full border px-2 py-0.5 text-xs font-medium"
                        style={{ color: badge.color, borderColor: `color-mix(in oklch, ${badge.color} 45%, transparent)`, background: `color-mix(in oklch, ${badge.color} 10%, transparent)` }}>
                        {badge.label}
                    </span>
                </div>
                <span className="text-sm theme-text line-clamp-1 break-words">{m.body}</span>
                <span className="text-xs theme-subtext-color">
                    To {formatRoles(m.target_roles, roleLabels, true)} · by {m.created_by_name ?? "someone"} · {shortDate(m.created_at)}
                </span>
            </div>
            {reached > 0 && (
                <div className="flex flex-col gap-1.5">
                    <div className="flex items-baseline justify-between gap-2 text-xs theme-subtext-color">
                        <span>{m.delivered_count} of {reached} delivered</span>
                        <span className="font-semibold theme-text-contrast">{pct}%</span>
                    </div>
                    <Bar pct={pct} />
                </div>
            )}
        </button>
    )
}

// ── /control/push/new ───────────────────────────────────────────────────────

export function PushComposePage() {
    usePageHeader("New push", { back: { to: "/control/push", label: "Push notifications" } })
    const navigate = useNavigate()
    const { catalog, roleLabels } = usePushData()
    const [form, setForm] = useState<FormState>(EMPTY_FORM)
    const confirmDiscard = useDiscardGuard(isDirtyVs(form, EMPTY_FORM))
    const [sending, setSending] = useState(false)
    const [error, setError] = useState<string | null>(null)

    async function handleSend() {
        setSending(true)
        setError(null)
        try {
            const res = await fetch(`${API}/push`, {
                method: "POST",
                credentials: "include",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(form),
            })
            if (!res.ok) {
                const data = await res.json().catch(() => null) as { detail?: string } | null
                throw new Error(data?.detail ?? "Couldn't send the push.")
            }
            const sent = await res.json() as PushMessage
            setForm(EMPTY_FORM)
            // Straight to its delivery page, so you can watch it land.
            navigate(`/control/push/${sent.id}`, { replace: true })
        } catch (e) {
            setError(e instanceof Error ? e.message : "Couldn't send the push.")
            setSending(false)
        }
    }

    return (
        <div className="px-4 md:px-6 py-4 md:py-6 flex flex-col gap-4">
            <div className="w-full max-w-2xl flex flex-col gap-4 rounded-xl border p-5 theme-border theme-bg">
                <label className={`flex flex-col gap-1 ${fieldLabelClass}`}>
                    Title
                    <input value={form.title} onChange={e => setForm(prev => ({ ...prev, title: e.target.value }))} className={`w-full ${inputClass}`} />
                </label>
                <label className={`flex flex-col gap-1 ${fieldLabelClass}`}>
                    Body
                    <textarea value={form.body} onChange={e => setForm(prev => ({ ...prev, body: e.target.value }))} rows={3} className={`w-full resize-none ${inputClass}`} />
                </label>
                <div className="border-t theme-border" />
                <div className="flex flex-col gap-2">
                    <p className={fieldLabelClass}>Send to</p>
                    <RoleAudienceSelect catalog={catalog} selected={form.target_roles} onChange={roles => setForm(prev => ({ ...prev, target_roles: roles }))} />
                </div>

                {error && <Notice>{error}</Notice>}

                <FormFooter className="-mx-5 -mb-5 rounded-b-xl">
                    <p className="text-sm theme-subtext-color min-w-0">
                        To <span className="font-semibold theme-text-contrast">{formatRoles(form.target_roles, roleLabels, true)}</span>
                    </p>
                    <Button variant="outlined" size="footer" className="ml-auto" onClick={() => void confirmDiscard().then(ok => { if (ok) navigate("/control/push") })}>
                        Cancel
                    </Button>
                    <Button size="footer" onClick={() => void handleSend()} disabled={sending || !form.title.trim() || !form.body.trim()}>
                        <Send size={16} />
                        {sending ? "Sending…" : "Send push"}
                    </Button>
                </FormFooter>
            </div>
        </div>
    )
}

// ── /control/push/:id ───────────────────────────────────────────────────────

export function PushDetailPage() {
    const { id } = useParams<{ id: string }>()
    const { messages, roleLabels, error: listError, load: loadList } = usePushData()
    const message = messages?.find(m => m.id === id) ?? null
    usePageHeader(message?.title ?? (messages && !message ? "Push not found" : "Push"), { back: { to: "/control/push", label: "Push notifications" } })

    const [data, setData] = useState<DeliveryDetails | null>(null)
    const [error, setError] = useState<string | null>(null)
    const [search, setSearch] = useState("")

    const load = useCallback(async () => {
        if (!id) return
        setError(null)
        try {
            const res = await fetch(`${API}/push/${id}/deliveries`, { credentials: "include" })
            if (!res.ok) throw new Error("deliveries")
            setData(await res.json() as DeliveryDetails)
        } catch {
            setError("Couldn't load who got it.")
        }
    }, [id])

    useEffect(() => { void load() }, [load])

    const q = search.trim().toLowerCase()
    const matches = (d: DeliveryRow) => !q || (d.user_name ?? "Unknown user").toLowerCase().includes(q)
    const notDelivered = data?.deliveries.filter(d => d.status === "sent" || d.status === "failed").filter(matches) ?? []
    const partial = data?.deliveries.filter(d => d.status === "partial").filter(matches) ?? []
    const delivered = data?.deliveries.filter(d => d.status === "delivered").filter(matches) ?? []
    const total = data ? data.summary.delivered + data.summary.partial + data.summary.failed + data.summary.pending : 0
    const pct = total > 0 && data ? Math.round((data.summary.delivered / total) * 100) : 0

    if (messages && !message) {
        return (
            <div className="px-4 md:px-6 py-6">
                <div className="rounded-xl border border-dashed theme-border theme-bg max-w-3xl">
                    <EmptyState variant="screen" title="Push not found">It may have been removed.</EmptyState>
                </div>
            </div>
        )
    }

    return (
        <div className="px-4 md:px-6 py-4 md:py-6 flex flex-col gap-4 w-full max-w-3xl">
            {listError && <Notice>{listError} <Button variant="text" onClick={() => void loadList()}>Try again</Button></Notice>}

            {/* Delivery first: the reason to open a push is to see whether it landed. */}
            <section aria-label="Delivery" className="rounded-xl border theme-border theme-bg p-5 flex flex-col gap-3">
                {!data && !error ? <Skeleton className="h-14 w-full" /> : data && (
                    <>
                        <div className="flex flex-wrap items-end gap-x-6 gap-y-2">
                            <span className="text-5xl font-extrabold leading-none theme-text-contrast">{pct}%</span>
                            <span className="text-sm pb-1 flex flex-wrap gap-x-2">
                                <span style={{ color: STATUS_OK }}>{data.summary.delivered} delivered</span>
                                <span className="theme-subtext-color">·</span>
                                <span style={{ color: STATUS_WARN }}>{data.summary.partial} partial</span>
                                <span className="theme-subtext-color">·</span>
                                <span style={{ color: STATUS_FAIL }}>{data.summary.failed} failed</span>
                                {data.summary.pending > 0 && <><span className="theme-subtext-color">·</span><span className="theme-subtext-color">{data.summary.pending} pending</span></>}
                            </span>
                        </div>
                        <Bar pct={pct} thick />
                    </>
                )}
                {error && <Notice>{error} <Button variant="text" onClick={() => void load()}>Try again</Button></Notice>}
            </section>

            <section aria-label="Message" className="rounded-xl border theme-border theme-bg p-5 flex flex-col gap-3">
                {message ? (
                    <>
                        <p className="text-sm theme-text whitespace-pre-wrap break-words">{message.body}</p>
                        <p className="text-xs theme-subtext-color border-t theme-border pt-3">
                            To {formatRoles(message.target_roles, roleLabels)} · by {message.created_by_name ?? "someone"} · {new Date(message.created_at).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}
                        </p>
                    </>
                ) : <Skeleton className="h-12 w-full" />}
            </section>

            {data && data.deliveries.length > 0 && (
                <section aria-label="Recipients" className="flex flex-col gap-3">
                    <label className={`${CONTROL} w-full md:max-w-xs flex items-center gap-2 focus-within:ring-2 focus-within:ring-[var(--theme-text-contrast)]`}>
                        <Search size={16} className="shrink-0 theme-subtext-color" aria-hidden="true" />
                        <input type="search" value={search} onChange={e => setSearch(e.target.value)} placeholder="Search by name" aria-label="Search recipients"
                            className="flex-1 min-w-0 bg-transparent outline-none text-base md:text-sm placeholder:text-[var(--theme-subtext-color)]" />
                    </label>
                    {/* Failures first: finding who didn't get it is why you're here. */}
                    <DeliverySection label="Not delivered" rows={notDelivered} defaultOpen />
                    <DeliverySection label="Partial" rows={partial} defaultOpen />
                    <DeliverySection label="Delivered" rows={delivered} defaultOpen={false} />
                </section>
            )}
            {data && data.deliveries.length === 0 && (
                <p className="text-sm theme-subtext-color">Nobody it went to has push turned on, so nothing was sent.</p>
            )}
        </div>
    )
}

/** One collapsible group of recipients (Not delivered / Partial / Delivered). */
function DeliverySection({ label, rows, defaultOpen }: { label: string, rows: DeliveryRow[], defaultOpen: boolean }) {
    const [open, setOpen] = useState(defaultOpen)
    return (
        <div className="rounded-xl border theme-border theme-bg overflow-hidden">
            <button onClick={() => setOpen(o => !o)} aria-expanded={open}
                className={`w-full flex items-center justify-between gap-2 px-4 min-h-11 ${focusRing}`}>
                <span className={`${typeH2} theme-subtext-color`}>{label} · {rows.length}</span>
                <ChevronDown size={16} className="theme-subtext-color transition-transform" style={{ transform: open ? "rotate(180deg)" : "none" }} />
            </button>
            {open && rows.length > 0 && (
                <div className="flex flex-col border-t theme-border">
                    {rows.map(d => (
                        <div key={d.id} className="flex items-center justify-between gap-3 px-4 py-2.5 border-b last:border-b-0 theme-border">
                            <span className="text-sm theme-text truncate">{d.user_name ?? "Unknown user"}</span>
                            <div className="flex items-center gap-2 shrink-0">
                                <StatusBadge status={d.status} />
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

/** "sent" means still pending within the receipt window; "partial" means some but not all
 *  of a user's devices got it; "failed" means a send error *or* no receipt within 10 minutes:
 *  the device may still have shown it, and a late receipt flips it to delivered. */
function StatusBadge({ status }: { status: DeliveryRow["status"] }) {
    const look = {
        delivered: { color: STATUS_OK, icon: <CheckCircle2 size={14} />, label: "Delivered", title: undefined },
        partial: { color: STATUS_WARN, icon: <AlertCircle size={14} />, label: "Partial", title: undefined },
        failed: { color: STATUS_FAIL, icon: <XCircle size={14} />, label: "Failed", title: "Send error, or no delivery receipt yet. The device may still have shown it." },
        sent: { color: "var(--theme-subtext-color)", icon: <Clock size={14} />, label: "Pending", title: undefined },
    }[status]
    return (
        <span className="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium shrink-0" title={look.title}
            style={{ color: look.color, borderColor: `color-mix(in oklch, ${look.color} 50%, transparent)` }}>
            {look.icon} {look.label}
        </span>
    )
}

function Bar({ pct, thick = false }: { pct: number, thick?: boolean }) {
    return (
        <div className={`w-full rounded-full overflow-hidden ${thick ? "h-2" : "h-1.5"}`} style={{ background: "color-mix(in oklch, var(--theme-border) 80%, transparent)" }}>
            <div className="h-full rounded-full" style={{ width: `${pct}%`, background: "var(--theme-text-contrast)" }} />
        </div>
    )
}
