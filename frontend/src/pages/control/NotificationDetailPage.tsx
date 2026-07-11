import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { Link, useNavigate, useParams } from "react-router-dom"
import { ChevronLeft, Download, X } from "lucide-react"
import { AgGridReact } from "ag-grid-react"
import type { ColDef, ValueFormatterParams } from "ag-grid-community"
import RoleAudienceSelect, { type RoleMeta } from "@/components/RoleAudienceSelect"

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

type Tab = "overview" | "responses" | "settings"

/** "scouting_lead" → "Scouting Lead" */
function pretty(v: string): string {
    return v.split("_").map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(" ")
}

function formatRoles(roles: string[], roleLabels: Record<string, string>): string {
    if (roles.length === 0) return "Everyone"
    return roles.map(r => roleLabels[r] ?? pretty(r)).join(", ")
}

/**
 * Full-page create / edit / stats view for one notice, organized as tabs —
 * Overview (the message + a big response-rate readout and answer breakdown),
 * Responses (the searchable/exportable AG Grid, kept because it's what holds
 * up at hundreds of eligible people), and Settings (the edit form). Landing on
 * Overview answers "how's this landing?" without scrolling past a giant grid;
 * actions live in the header so they're always in reach. `isNew` renders just
 * the form.
 */
export default function NotificationDetailPage({ isNew = false }: { isNew?: boolean }) {
    const { id } = useParams<{ id: string }>()
    const navigate = useNavigate()
    const gridRef = useRef<AgGridReact<ResponseRow>>(null)

    const [catalog, setCatalog] = useState<RoleMeta[]>([])
    const [roleLabels, setRoleLabels] = useState<Record<string, string>>({})
    const [detail, setDetail] = useState<NotificationDetail | null>(null)
    const [detailLoading, setDetailLoading] = useState(!isNew)
    const [tab, setTab] = useState<Tab>(isNew ? "settings" : "overview")
    const [form, setForm] = useState<FormState>(EMPTY_FORM)
    const [optionDraft, setOptionDraft] = useState("")
    const [saving, setSaving] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const [gridSearch, setGridSearch] = useState("")

    useEffect(() => {
        void (async () => {
            const res = await fetch(`${API}/auth/roles`, { credentials: "include" })
            if (res.ok) {
                const cat = await res.json() as RoleMeta[]
                setCatalog(cat)
                setRoleLabels(Object.fromEntries(cat.map(c => [c.value, c.label])))
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
                setTab("overview")
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

    // ---------- New notice: form only ----------
    if (isNew) {
        return (
            <div className="px-4 py-6 flex flex-col gap-4 h-full">
                <div className="flex items-center gap-2">
                    <Link to="/control/notifications" aria-label="Back to Notifications"
                          className="flex items-center justify-center w-9 h-9 -ml-2 rounded-lg theme-text opacity-60 hover:opacity-100 transition-opacity">
                        <ChevronLeft size={22} />
                    </Link>
                    <h1 className="text-2xl font-bold theme-h1-color">New Notice</h1>
                </div>
                {error && (
                    <p className="text-sm px-3 py-2 rounded-lg border theme-subtext-color theme-border"
                       style={{ background: "color-mix(in oklch, var(--theme-border) 40%, transparent)" }}>{error}</p>
                )}
                <NoticeForm
                    isNew form={form} setForm={setForm} catalog={catalog} optionDraft={optionDraft}
                    setOptionDraft={setOptionDraft} addOption={addOption} removeOption={removeOption}
                    saving={saving} onSave={handleSave} onCancel={() => navigate("/control/notifications")}
                />
            </div>
        )
    }

    const n = detail?.notification
    const eligible = detail?.eligible_count ?? 0
    const responded = detail?.responses.length ?? 0
    const ratePct = eligible > 0 ? Math.round((responded / eligible) * 100) : 0
    const canEdit = !!n?.can_edit

    return (
        <div className="px-4 py-6 flex flex-col gap-4 h-full">
            {/* Header */}
            <div className="flex items-center gap-2 flex-wrap">
                <Link to="/control/notifications" aria-label="Back to Notifications"
                      className="flex items-center justify-center w-9 h-9 -ml-2 rounded-lg theme-text opacity-60 hover:opacity-100 transition-opacity">
                    <ChevronLeft size={22} />
                </Link>
                <h1 className="text-2xl font-bold theme-h1-color">{n?.title ?? "Notice"}</h1>
                {n && (
                    <span
                        className="rounded-full border px-2.5 py-0.5 text-[11px] font-bold tracking-wide"
                        style={n.active
                            ? { color: "var(--theme-text-contrast)", borderColor: "color-mix(in oklch, var(--theme-text-contrast) 50%, transparent)" }
                            : { color: "var(--theme-subtext-color)", borderColor: "var(--theme-border)" }}
                    >
                        {n.active ? "ACTIVE" : "DEACTIVATED"}
                    </span>
                )}
                {n && (
                    <div className="ml-auto flex items-center gap-2">
                        <button
                            onClick={() => gridRef.current?.api.exportDataAsCsv({
                                fileName: `${n.title.replace(/[^a-z0-9]+/gi, "-")}-responses.csv`,
                            })}
                            className="flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm font-medium theme-text theme-border transition-opacity hover:opacity-80"
                        >
                            <Download size={14} /> <span className="hidden sm:inline">Export CSV</span>
                        </button>
                        {canEdit && n.active && (
                            <button
                                onClick={() => void handleDeactivate()}
                                disabled={saving}
                                className="rounded-lg border px-3 py-1.5 text-sm font-medium transition-opacity hover:opacity-80 disabled:opacity-40"
                                style={{ color: "#dc2626", borderColor: "color-mix(in oklch, #dc2626 50%, transparent)" }}
                            >
                                Deactivate
                            </button>
                        )}
                    </div>
                )}
            </div>

            {error && (
                <p className="text-sm px-3 py-2 rounded-lg border theme-subtext-color theme-border"
                   style={{ background: "color-mix(in oklch, var(--theme-border) 40%, transparent)" }}>{error}</p>
            )}

            {detailLoading && <p className="text-sm theme-subtext-color">Loading…</p>}

            {detail && n && (
                <>
                    {/* Tabs */}
                    <div className="flex gap-6 border-b theme-border">
                        {([["overview", "Overview"], ["responses", `Responses · ${responded}`]] as const).map(([k, label]) => (
                            <TabButton key={k} active={tab === k} label={label} onClick={() => setTab(k)} />
                        ))}
                        {canEdit && <TabButton active={tab === "settings"} label="Settings" onClick={() => setTab("settings")} />}
                    </div>

                    {/* Overview */}
                    {tab === "overview" && (
                        <div className="flex flex-col lg:flex-row gap-5 flex-1 min-h-0 overflow-y-auto theme-scrollbar">
                            <div className="flex flex-col gap-4 flex-1 min-w-0">
                                <div className="rounded-xl border p-4 theme-border backdrop-blur-sm"
                                     style={{ background: "var(--theme-bg)" }}>
                                    <p className="text-sm theme-text whitespace-pre-wrap">{n.body}</p>
                                    {n.link && (
                                        <a href={n.link} target="_blank" rel="noopener noreferrer"
                                           className="inline-block mt-2.5 text-sm underline underline-offset-2 theme-text-contrast">
                                            {n.link}
                                        </a>
                                    )}
                                </div>
                                <div className="flex flex-wrap gap-2">
                                    {[
                                        n.hard_block ? "Hard block · must respond" : "Soft",
                                        formatRoles(n.target_roles, roleLabels),
                                        `By ${n.created_by_is_self ? "You" : n.created_by_name ?? "—"}`,
                                        n.response_options.length > 0 ? (n.response_mode === "multi" ? "Multi-select" : "Single-select") : "Acknowledgement",
                                    ].map((m, i) => (
                                        <span key={i} className="rounded-full border px-3 py-1 text-xs theme-border theme-subtext-color">{m}</span>
                                    ))}
                                </div>
                                <div className="rounded-xl border p-4 flex flex-col gap-3 theme-border backdrop-blur-sm" style={{ background: "var(--theme-bg)" }}>
                                    <p className="text-xs font-semibold uppercase tracking-widest theme-subtext-color">
                                        {n.response_options.length > 0 ? "Answer breakdown" : "Acknowledgements"}
                                    </p>
                                    {n.response_options.length > 0 ? (
                                        detail.tally.map(t => {
                                            const pct = eligible > 0 ? (t.count / eligible) * 100 : 0
                                            return (
                                                <div key={t.option} className="flex flex-col gap-1">
                                                    <div className="flex justify-between text-sm theme-text">
                                                        <span>{t.option}</span>
                                                        <span className="theme-subtext-color">{t.count}</span>
                                                    </div>
                                                    <div className="w-full rounded-full overflow-hidden h-2"
                                                         style={{ background: "color-mix(in oklch, var(--theme-border) 80%, transparent)" }}>
                                                        <div className="h-full rounded-full" style={{ width: `${pct}%`, background: "var(--theme-text-contrast)" }} />
                                                    </div>
                                                </div>
                                            )
                                        })
                                    ) : (
                                        <p className="text-sm theme-subtext-color">{detail.ack_count} acknowledged</p>
                                    )}
                                </div>
                            </div>

                            <div className="flex flex-col gap-3 lg:w-72 lg:shrink-0">
                                <div className="rounded-xl border p-5 flex flex-col items-center gap-2 text-center theme-border backdrop-blur-sm"
                                     style={{ background: "var(--theme-bg)" }}>
                                    <span className="text-xs font-semibold uppercase tracking-widest theme-subtext-color">Response rate</span>
                                    <span className="text-5xl font-extrabold leading-none theme-text-contrast">{ratePct}%</span>
                                    <span className="text-sm theme-subtext-color">{responded} of {eligible} eligible</span>
                                    <div className="w-full rounded-full overflow-hidden h-2 mt-1"
                                         style={{ background: "color-mix(in oklch, var(--theme-border) 80%, transparent)" }}>
                                        <div className="h-full rounded-full" style={{ width: `${ratePct}%`, background: "var(--theme-text-contrast)" }} />
                                    </div>
                                </div>
                                <div className="rounded-xl border p-4 flex items-center justify-between theme-border backdrop-blur-sm" style={{ background: "var(--theme-bg)" }}>
                                    <span className="text-sm theme-text">Awaiting response</span>
                                    <span className="text-xl font-bold theme-h1-color">{Math.max(0, eligible - responded)}</span>
                                </div>
                                {canEdit && (
                                    <button
                                        onClick={() => setTab("settings")}
                                        className="rounded-xl border px-4 py-3 text-sm font-medium theme-text theme-border backdrop-blur-sm transition-opacity hover:opacity-80"
                                        style={{ background: "var(--theme-bg)" }}
                                    >
                                        Edit notice
                                    </button>
                                )}
                            </div>
                        </div>
                    )}

                    {/* Responses */}
                    {tab === "responses" && (
                        <div className="flex flex-col gap-3 flex-1 min-h-0">
                            <input
                                value={gridSearch}
                                onChange={e => setGridSearch(e.target.value)}
                                placeholder="Search by name or email…"
                                className="max-w-xs rounded-lg border px-3 py-1.5 text-sm theme-border theme-bg theme-text"
                            />
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

                    {/* Settings */}
                    {tab === "settings" && canEdit && (
                        <div className="flex-1 min-h-0 overflow-y-auto theme-scrollbar">
                            <NoticeForm
                                isNew={false} form={form} setForm={setForm} catalog={catalog} optionDraft={optionDraft}
                                setOptionDraft={setOptionDraft} addOption={addOption} removeOption={removeOption}
                                saving={saving} onSave={handleSave} onCancel={() => setTab("overview")}
                            />
                        </div>
                    )}
                </>
            )}
        </div>
    )
}

function TabButton({ active, label, onClick }: { active: boolean, label: string, onClick: () => void }) {
    return (
        <button
            onClick={onClick}
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

/** The create/edit form, extracted so both the New route and the Settings tab
 *  render the identical fields. */
function NoticeForm(props: {
    isNew: boolean
    form: FormState
    setForm: React.Dispatch<React.SetStateAction<FormState>>
    catalog: RoleMeta[]
    optionDraft: string
    setOptionDraft: (v: string) => void
    addOption: () => void
    removeOption: (o: string) => void
    saving: boolean
    onSave: () => void
    onCancel: () => void
}) {
    const {
        isNew, form, setForm, catalog,
        optionDraft, setOptionDraft, addOption, removeOption, saving, onSave, onCancel,
    } = props
    return (
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
                <RoleAudienceSelect
                    catalog={catalog}
                    selected={form.target_roles}
                    onChange={roles => setForm(prev => ({ ...prev, target_roles: roles }))}
                />
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
                <button
                    onClick={onCancel}
                    className="rounded-lg border px-4 py-2 text-sm font-medium theme-subtext-color theme-border transition-opacity hover:opacity-70"
                >
                    Cancel
                </button>
                <button
                    onClick={() => void onSave()}
                    disabled={saving || !form.title.trim() || !form.body.trim()}
                    className="rounded-lg px-4 py-2 text-sm font-semibold transition-opacity hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed"
                    style={{ background: "var(--theme-text-contrast)", color: "var(--theme-bg)" }}
                >
                    {saving ? "Saving…" : isNew ? "Create notice" : "Save"}
                </button>
            </div>
        </div>
    )
}
