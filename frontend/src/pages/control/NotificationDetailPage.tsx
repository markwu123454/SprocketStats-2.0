import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { Link, useNavigate, useParams } from "react-router-dom"
import { ChevronLeft, Download, X } from "lucide-react"
import { AgGridReact } from "ag-grid-react"
import type { ColDef, ValueFormatterParams } from "ag-grid-community"

const API = import.meta.env.VITE_BACKEND_URL

interface NotificationFull {
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
    // Whether the current viewer may edit/deactivate this notice. Mirrors the
    // backend author-authority rule (a lead can't edit a captain's/mentor's
    // notice); the endpoint enforces it, this only hides the controls.
    can_edit: boolean
    created_at: string
    updated_at: string
}

interface NotificationDetail {
    notification: NotificationFull
    tally: { option: string, count: number }[]
    ack_count: number
    eligible_count: number
    responses: { id: string, display_name: string | null, email: string, response: string[], responded_at: string }[]
    non_responders: { id: string, display_name: string | null, email: string }[]
}

/** A single row in the combined responses/non-responders grid. */
interface ResponseRow {
    id: string
    display_name: string | null
    email: string
    status: "Responded" | "Not Responded"
    response: string
    responded_at: string | null
}

interface FormState {
    title: string
    body: string
    link: string
    hard_block: boolean
    target_roles: string[]
    response_options: string[]
    response_mode: "single" | "multi"
}

const EMPTY_FORM: FormState = {
    title: "", body: "", link: "", hard_block: false, target_roles: [], response_options: [], response_mode: "single",
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
 * Full-page create / edit / stats view for one notice -- a dedicated route
 * (rather than a modal) so there's room for a real data grid once responses
 * run into the hundreds, not just a handful.
 */
export default function NotificationDetailPage({ isNew = false }: { isNew?: boolean }) {
    const { id } = useParams<{ id: string }>()
    const navigate = useNavigate()
    const gridRef = useRef<AgGridReact<ResponseRow>>(null)

    const [roleOptions, setRoleOptions] = useState<string[]>([])
    const [roleLabels, setRoleLabels] = useState<Record<string, string>>({})
    const [detail, setDetail] = useState<NotificationDetail | null>(null)
    const [detailLoading, setDetailLoading] = useState(!isNew)
    const [editing, setEditing] = useState(isNew)
    const [form, setForm] = useState<FormState>(EMPTY_FORM)
    const [optionDraft, setOptionDraft] = useState("")
    const [saving, setSaving] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const [gridSearch, setGridSearch] = useState("")

    useEffect(() => {
        void (async () => {
            const res = await fetch(`${API}/auth/roles`, { credentials: "include" })
            if (res.ok) {
                const catalog = await res.json() as { value: string, label: string }[]
                setRoleOptions(catalog.map(c => c.value))
                setRoleLabels(Object.fromEntries(catalog.map(c => [c.value, c.label])))
            }
        })()
    }, [])

    const loadDetail = useCallback(async () => {
        if (!id) return
        setDetailLoading(true)
        try {
            const res = await fetch(`${API}/notifications/${id}`, { credentials: "include" })
            if (!res.ok) throw new Error("detail")
            const data = await res.json() as NotificationDetail
            setDetail(data)
            setForm({
                title: data.notification.title,
                body: data.notification.body,
                link: data.notification.link ?? "",
                hard_block: data.notification.hard_block,
                target_roles: data.notification.target_roles,
                response_options: data.notification.response_options,
                response_mode: data.notification.response_mode,
            })
        } catch {
            setError("Failed to load notice")
        } finally {
            setDetailLoading(false)
        }
    }, [id])

    useEffect(() => { if (!isNew) void loadDetail() }, [isNew, loadDetail])

    // A role is "included" when target_roles is empty (means everyone) or
    // explicitly listed -- saving always writes the explicit checked set unless
    // every role is checked, in which case it's normalized back to [] so
    // newly-added roles are automatically included.
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

    function addOption() {
        const v = optionDraft.trim()
        if (!v || form.response_options.includes(v)) return
        setForm(prev => ({ ...prev, response_options: [...prev.response_options, v] }))
        setOptionDraft("")
    }

    function removeOption(option: string) {
        setForm(prev => ({ ...prev, response_options: prev.response_options.filter(o => o !== option) }))
    }

    async function handleSave() {
        setSaving(true)
        setError(null)
        try {
            const body = {
                title: form.title,
                body: form.body,
                link: form.link.trim() || null,
                hard_block: form.hard_block,
                target_roles: form.target_roles,
                response_options: form.response_options,
                response_mode: form.response_mode,
            }
            const res = await fetch(
                isNew ? `${API}/notifications` : `${API}/notifications/${id}`,
                {
                    method: isNew ? "POST" : "PUT",
                    credentials: "include",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify(body),
                },
            )
            if (!res.ok) {
                const data = await res.json().catch(() => null) as { detail?: string } | null
                throw new Error(data?.detail ?? "Failed to save notice")
            }
            if (isNew) {
                const created = await res.json() as NotificationFull
                navigate(`/control/notifications/${created.id}`, { replace: true })
            } else {
                await loadDetail()
                setEditing(false)
            }
        } catch (e) {
            setError(e instanceof Error ? e.message : "Failed to save notice")
        } finally {
            setSaving(false)
        }
    }

    async function handleDeactivate() {
        if (!id) return
        setSaving(true)
        try {
            const res = await fetch(`${API}/notifications/${id}/deactivate`, { method: "POST", credentials: "include" })
            if (!res.ok) throw new Error("deactivate")
            await loadDetail()
        } catch {
            setError("Failed to deactivate notice")
        } finally {
            setSaving(false)
        }
    }

    // One sortable/filterable grid instead of two plain scrolling lists --
    // this is what actually holds up once a notice has hundreds of eligible
    // people, where AG Grid's virtualization + built-in quick filter matter.
    const gridRows = useMemo<ResponseRow[]>(() => {
        if (!detail) return []
        const responded: ResponseRow[] = detail.responses.map(r => ({
            id: r.id, display_name: r.display_name, email: r.email, status: "Responded",
            response: r.response.length > 0 ? r.response.join(", ") : "Acknowledged",
            responded_at: r.responded_at,
        }))
        const notResponded: ResponseRow[] = detail.non_responders.map(r => ({
            id: r.id, display_name: r.display_name, email: r.email, status: "Not Responded",
            response: "", responded_at: null,
        }))
        return [...responded, ...notResponded]
    }, [detail])

    const gridColumnDefs = useMemo<ColDef<ResponseRow>[]>(() => [
        { field: "display_name", headerName: "Name", flex: 1.3, minWidth: 140, valueFormatter: p => p.value ?? "—" },
        { field: "email", headerName: "Email", flex: 1.6, minWidth: 180 },
        { field: "status", headerName: "Status", flex: 1, minWidth: 120 },
        { field: "response", headerName: "Response", flex: 1.3, minWidth: 140, valueFormatter: p => p.value || "—" },
        {
            field: "responded_at", headerName: "Responded At", flex: 1.3, minWidth: 160,
            valueFormatter: (p: ValueFormatterParams<ResponseRow, string | null>) =>
                p.value ? new Date(p.value).toLocaleString() : "—",
        },
    ], [])

    const showForm = isNew || editing
    const showDetail = !isNew && !editing && detail

    return (
        <div className="px-4 py-6 flex flex-col gap-4 h-full">
            <div className="flex items-center gap-2">
                <Link
                    to="/control/notifications"
                    aria-label="Back to Notifications"
                    className="flex items-center justify-center w-9 h-9 -ml-2 rounded-lg theme-text opacity-60 hover:opacity-100 transition-opacity"
                >
                    <ChevronLeft size={22} />
                </Link>
                <h1 className="text-2xl font-bold theme-h1-color">
                    {isNew ? "New Notice" : editing ? "Edit Notice" : detail?.notification.title ?? "Notice"}
                </h1>
            </div>

            {error && (
                <p className="text-sm px-3 py-2 rounded-lg border theme-subtext-color theme-border"
                   style={{ background: "color-mix(in oklch, var(--theme-border) 40%, transparent)" }}>
                    {error}
                </p>
            )}

            {!isNew && detailLoading && <p className="text-sm theme-subtext-color">Loading…</p>}

            {showDetail && (
                <div className="flex flex-col gap-4 flex-1 min-h-0">
                    <div className="flex flex-col gap-4 max-w-2xl">
                        <p className="text-sm theme-subtext-color whitespace-pre-wrap">{detail.notification.body}</p>
                        {detail.notification.link && (
                            <a href={detail.notification.link} target="_blank" rel="noopener noreferrer"
                               className="text-sm underline underline-offset-2 theme-text">
                                {detail.notification.link}
                            </a>
                        )}

                        <div className="flex flex-wrap gap-4 text-sm theme-subtext-color">
                            <span>{detail.notification.hard_block ? "Hard block" : "Soft"}</span>
                            <span>{formatRoles(detail.notification.target_roles, roleLabels)}</span>
                            <span>{detail.notification.active ? "Active" : "Deactivated"}</span>
                            <span>By {detail.notification.created_by_is_self ? "You" : detail.notification.created_by_name ?? "—"}</span>
                        </div>

                        <div className="flex flex-col gap-2">
                            <p className="text-sm font-medium theme-text">
                                {detail.responses.length} / {detail.eligible_count} responded
                            </p>
                            {detail.notification.response_options.length > 0 ? (
                                detail.tally.map(t => {
                                    const pct = detail.eligible_count > 0 ? (t.count / detail.eligible_count) * 100 : 0
                                    return (
                                        <div key={t.option} className="flex flex-col gap-1">
                                            <div className="flex justify-between text-xs theme-subtext-color">
                                                <span>{t.option}</span>
                                                <span>{t.count}</span>
                                            </div>
                                            <div className="w-full rounded-full overflow-hidden h-2"
                                                 style={{ background: "color-mix(in oklch, var(--theme-border) 80%, transparent)" }}>
                                                <div className="h-full rounded-full" style={{ width: `${pct}%`, background: "var(--theme-text-contrast)" }} />
                                            </div>
                                        </div>
                                    )
                                })
                            ) : (
                                <p className="text-xs theme-subtext-color">{detail.ack_count} acknowledged</p>
                            )}
                        </div>

                        {detail.notification.can_edit && (
                            <div className="flex gap-2 pt-1">
                                <button
                                    onClick={() => setEditing(true)}
                                    className="rounded-lg border px-4 py-2 text-sm font-medium theme-text theme-border transition-opacity hover:opacity-80"
                                >
                                    Edit
                                </button>
                                {detail.notification.active && (
                                    <button
                                        onClick={() => void handleDeactivate()}
                                        disabled={saving}
                                        className="rounded-lg border px-4 py-2 text-sm font-medium transition-opacity hover:opacity-80 disabled:opacity-40"
                                        style={{ color: "#dc2626", borderColor: "color-mix(in oklch, #dc2626 50%, transparent)" }}
                                    >
                                        Deactivate
                                    </button>
                                )}
                            </div>
                        )}
                    </div>

                    <div className="flex items-center gap-3">
                        <input
                            value={gridSearch}
                            onChange={e => setGridSearch(e.target.value)}
                            placeholder="Search by name or email…"
                            className="flex-1 max-w-xs rounded-lg border px-3 py-1.5 text-sm theme-border theme-bg theme-text"
                        />
                        <button
                            onClick={() => gridRef.current?.api.exportDataAsCsv({
                                fileName: `${detail.notification.title.replace(/[^a-z0-9]+/gi, "-")}-responses.csv`,
                            })}
                            className="ml-auto flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm font-medium theme-text theme-border transition-opacity hover:opacity-80"
                        >
                            <Download size={14} />
                            Export CSV
                        </button>
                    </div>

                    <div className="rounded-xl border overflow-hidden theme-border flex-1 min-h-0">
                        <AgGridReact<ResponseRow>
                            ref={gridRef}
                            rowData={gridRows}
                            columnDefs={gridColumnDefs}
                            quickFilterText={gridSearch}
                            getRowId={({ data }) => data.id}
                            defaultColDef={{ sortable: true, resizable: true, filter: true }}
                        />
                    </div>
                </div>
            )}

            {showForm && (
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
                    <label className="flex flex-col gap-1 text-sm theme-text">
                        Link (optional, e.g. a Google Form)
                        <input
                            value={form.link}
                            onChange={e => setForm(prev => ({ ...prev, link: e.target.value }))}
                            placeholder="https://forms.gle/…"
                            className="rounded-lg border px-3 py-2 text-sm theme-border theme-bg theme-text"
                        />
                    </label>

                    <label className="flex items-center gap-2 text-sm theme-text cursor-pointer">
                        <input
                            type="checkbox"
                            checked={form.hard_block}
                            onChange={e => setForm(prev => ({ ...prev, hard_block: e.target.checked }))}
                            className="h-4 w-4 accent-(--theme-text-contrast)"
                        />
                        Hard block (must respond to dismiss, no "Later")
                    </label>

                    <div className="flex flex-col gap-1.5">
                        <p className="text-sm theme-text">Applies to</p>
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

                    <div className="flex flex-col gap-1.5">
                        <p className="text-sm theme-text">Response options (leave empty for a plain "Got it")</p>
                        <div className="flex flex-wrap gap-2">
                            {form.response_options.map(o => (
                                <span key={o} className="flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs theme-border theme-text">
                                    {o}
                                    <button onClick={() => removeOption(o)} className="theme-subtext-color hover:opacity-70">
                                        <X size={12} />
                                    </button>
                                </span>
                            ))}
                        </div>
                        <div className="flex gap-2">
                            <input
                                value={optionDraft}
                                onChange={e => setOptionDraft(e.target.value)}
                                onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); addOption() } }}
                                placeholder="Add an option, e.g. Coming"
                                className="flex-1 rounded-lg border px-3 py-1.5 text-sm theme-border theme-bg theme-text"
                            />
                            <button onClick={addOption} className="rounded-lg border px-3 py-1.5 text-sm theme-border theme-text hover:opacity-80">
                                Add
                            </button>
                        </div>
                        {form.response_options.length > 0 && (
                            <label className="flex items-center gap-2 text-xs theme-subtext-color cursor-pointer mt-1">
                                <input
                                    type="checkbox"
                                    checked={form.response_mode === "multi"}
                                    onChange={e => setForm(prev => ({ ...prev, response_mode: e.target.checked ? "multi" : "single" }))}
                                    className="h-3.5 w-3.5 accent-(--theme-text-contrast)"
                                />
                                Allow selecting multiple options
                            </label>
                        )}
                    </div>

                    <div className="flex gap-2 pt-1">
                        {!isNew && (
                            <button
                                onClick={() => setEditing(false)}
                                className="rounded-lg border px-4 py-2 text-sm font-medium theme-subtext-color theme-border transition-opacity hover:opacity-70"
                            >
                                Cancel
                            </button>
                        )}
                        <button
                            onClick={() => void handleSave()}
                            disabled={saving || !form.title.trim() || !form.body.trim()}
                            className="rounded-lg px-4 py-2 text-sm font-semibold transition-opacity hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed"
                            style={{ background: "var(--theme-text-contrast)", color: "var(--theme-bg)" }}
                        >
                            {saving ? "Saving…" : "Save"}
                        </button>
                    </div>
                </div>
            )}
        </div>
    )
}
