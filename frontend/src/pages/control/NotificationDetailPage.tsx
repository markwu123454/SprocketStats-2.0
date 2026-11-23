import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useNavigate, useParams } from "react-router-dom"
import { Download, X } from "lucide-react"
import { AgGridReact } from "ag-grid-react"
import type { ColDef, ValueFormatterParams } from "ag-grid-community"
import "@/lib/agGrid"
import { useBootstrapped } from "@/contexts/bootstrapContext"
import { usePageHeader } from "@/contexts/pageHeaderContext"
import RoleAudienceSelect, { type RoleMeta } from "@/components/RoleAudienceSelect"
import Checkbox from "@/components/ui/Checkbox"
import Button from "@/components/ui/Button"
import FormFooter from "@/components/ui/FormFooter"
import Notice from "@/components/ui/Notice"
import Skeleton from "@/components/ui/Skeleton"
import { isDirtyVs, useDiscardGuard } from "@/lib/useDiscardGuard"
import { confirmDialog } from "@/lib/confirmDialog"
import { fieldLabelClass, focusRing, inputClass, typeH2 } from "@/lib/uiClasses"

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
    responses: { id: string, display_name: string | null, email: string | null, response: string[], responded_at: string }[]
    non_responders: { id: string, display_name: string | null, email: string | null }[]
}

interface ResponseRow {
    id: string
    display_name: string | null
    // Null for Mentors — the backend never sends their email.
    email: string | null
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

/** The form values a saved notice opens with. */
function formFromNotification(n: NotificationFull): FormState {
    return {
        title: n.title,
        body: n.body,
        link: n.link ?? "",
        hard_block: n.hard_block,
        target_roles: n.target_roles,
        response_options: n.response_options,
        response_mode: n.response_mode,
    }
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
 * Overview answers "how's this landing?" without scrolling past a giant grid.
 * Each tab carries its own actions: Export CSV on Responses, Deactivate at the
 * bottom of Settings. `isNew` renders just the form.
 */
export default function NotificationDetailPage({ isNew = false }: { isNew?: boolean }) {
    const { id } = useParams<{ id: string }>()
    const navigate = useNavigate()
    const gridRef = useRef<AgGridReact<ResponseRow>>(null)

    const [catalog, setCatalog] = useBootstrapped<RoleMeta[]>("roles", [])
    const roleLabels = useMemo<Record<string, string>>(() => Object.fromEntries(catalog.map(c => [c.value, c.label])), [catalog])
    const [detail, setDetail] = useState<NotificationDetail | null>(null)
    const [detailLoading, setDetailLoading] = useState(!isNew)
    const [tab, setTab] = useState<Tab>(isNew ? "settings" : "overview")
    const [form, setForm] = useState<FormState>(EMPTY_FORM)
    const [optionDraft, setOptionDraft] = useState("")
    const [saving, setSaving] = useState(false)
    const [error, setError] = useState<string | null>(null)
    // Dirty = the form differs from what it opened with (empty for a new notice, the saved notice otherwise).
    // A save reloads `detail`, so the snapshot catches up and the guard releases itself.
    const initialForm = useMemo<FormState | null>(
        () => (isNew ? EMPTY_FORM : detail ? formFromNotification(detail.notification) : null),
        [isNew, detail],
    )
    const confirmDiscard = useDiscardGuard(initialForm !== null && isDirtyVs(form, initialForm))
    const [gridSearch, setGridSearch] = useState("")

    useEffect(() => {
        void (async () => {
            const res = await fetch(`${API}/auth/roles`, { credentials: "include" })
            if (res.ok) {
                const cat = await res.json() as RoleMeta[]
                setCatalog(cat)
            }
        })()
    }, [setCatalog])

    const loadDetail = useCallback(async () => {
        if (!id) return
        setDetailLoading(true)
        try {
            const res = await fetch(`${API}/notifications/${id}`, { credentials: "include" })
            if (!res.ok) throw new Error("detail")
            const data = await res.json() as NotificationDetail
            setDetail(data)
            setForm(formFromNotification(data.notification))
        } catch {
            setError("Couldn't load notice")
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
                throw new Error(data?.detail ?? "Couldn't save notice")
            }
            if (isNew) {
                const created = await res.json() as NotificationFull
                navigate(`/control/notifications/${created.id}`, { replace: true })
            } else {
                await loadDetail()
                setTab("overview")
            }
        } catch (e) {
            setError(e instanceof Error ? e.message : "Couldn't save notice")
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
            setError("Couldn't deactivate notice")
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
        { field: "email", headerName: "Email", flex: 1.6, minWidth: 180, valueFormatter: p => p.value ?? "Hidden" },
        { field: "status", headerName: "Status", flex: 1, minWidth: 120 },
        { field: "response", headerName: "Response", flex: 1.3, minWidth: 140, valueFormatter: p => p.value || "—" },
        {
            field: "responded_at", headerName: "Responded At", flex: 1.3, minWidth: 160,
            valueFormatter: (p: ValueFormatterParams<ResponseRow, string | null>) =>
                p.value ? new Date(p.value).toLocaleString() : "—",
        },
    ], [])

    // The title, its Active badge and the way back live in the app's top bar.
    const headerNotice = detail?.notification
    usePageHeader(isNew ? "New notice" : (headerNotice?.title ?? "Notice"), {
        back: { to: "/control/notifications", label: "Notifications" },
        badge: !isNew && headerNotice
            ? { label: headerNotice.active ? "Active" : "Deactivated", tone: headerNotice.active ? "accent" : "muted" }
            : undefined,
    })

    // ---------- New notice: form only ----------
    if (isNew) {
        return (
            <div className="px-4 md:px-6 py-6 flex flex-col gap-4 h-full mx-auto w-full max-w-2xl">
                {error && <Notice>{error}</Notice>}
                <NoticeForm
                    isNew form={form} setForm={setForm} catalog={catalog} optionDraft={optionDraft}
                    setOptionDraft={setOptionDraft} addOption={addOption} removeOption={removeOption}
                    saving={saving} onSave={handleSave}
                    onCancel={() => void confirmDiscard().then(ok => { if (ok) navigate("/control/notifications") })}
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
        <div className="px-4 md:px-6 py-4 md:py-6 flex flex-col gap-4 h-full">
            {error && <Notice onDismiss={() => setError(null)}>{error}</Notice>}

            {detailLoading && !detail && (
                <div className="flex flex-col gap-3 max-w-3xl" role="status" aria-label="Loading notice">
                    <Skeleton className="h-10 w-full" />
                    <Skeleton className="h-32 w-full" />
                </div>
            )}

            {detail && n && (
                <>
                    {/* Tabs only: each tab carries its own actions. */}
                    <div role="tablist" className="flex gap-6 border-b theme-border">
                        {([["overview", "Overview"], ["responses", `Responses · ${responded}`]] as const).map(([k, label]) => (
                            <TabButton key={k} active={tab === k} label={label} onClick={() => setTab(k)} />
                        ))}
                        {canEdit && <TabButton active={tab === "settings"} label="Settings" onClick={() => setTab("settings")} />}
                    </div>

                    {/* Overview: how it's landing, then what it says. */}
                    {tab === "overview" && (
                        <div className="flex flex-col gap-4 w-full max-w-3xl">
                            <section aria-label="Response rate" className="rounded-xl border theme-border theme-bg p-5 flex flex-col gap-3">
                                <div className="flex flex-wrap items-end gap-x-6 gap-y-2">
                                    <span className="text-5xl font-extrabold leading-none theme-text-contrast">{ratePct}%</span>
                                    <span className="text-sm theme-subtext-color pb-1">
                                        {responded} of {eligible} answered · {Math.max(0, eligible - responded)} waiting
                                    </span>
                                </div>
                                <Bar pct={ratePct} />
                            </section>

                            <section aria-label="Message" className="rounded-xl border theme-border theme-bg p-5 flex flex-col gap-3">
                                <p className="text-sm theme-text whitespace-pre-wrap break-words">{n.body}</p>
                                {n.link && (
                                    <a href={n.link} target="_blank" rel="noopener noreferrer"
                                       className={`self-start text-sm underline underline-offset-2 theme-text-contrast break-all ${focusRing}`}>
                                        {n.link}
                                    </a>
                                )}
                                <p className="text-xs theme-subtext-color border-t theme-border pt-3">
                                    {[
                                        n.hard_block ? "Required: members answer before using the app" : "Optional",
                                        `For ${formatRoles(n.target_roles, roleLabels)}`,
                                        n.response_options.length > 0 ? (n.response_mode === "multi" ? "Pick any" : "Pick one") : "Got it to acknowledge",
                                        `By ${n.created_by_is_self ? "you" : n.created_by_name ?? "someone"}`,
                                    ].join(" · ")}
                                </p>
                            </section>

                            <section aria-label="Answers" className="rounded-xl border theme-border theme-bg p-5 flex flex-col gap-3">
                                <h2 className={`${typeH2} theme-subtext-color`}>{n.response_options.length > 0 ? "Answers" : "Acknowledged"}</h2>
                                {n.response_options.length > 0 ? detail.tally.map(t => (
                                    <div key={t.option} className="flex flex-col gap-1">
                                        <div className="flex justify-between gap-3 text-sm theme-text">
                                            <span className="min-w-0 break-words">{t.option}</span>
                                            <span className="theme-subtext-color shrink-0">{t.count}</span>
                                        </div>
                                        <Bar pct={eligible > 0 ? (t.count / eligible) * 100 : 0} thin />
                                    </div>
                                )) : (
                                    <p className="text-sm theme-subtext-color">{detail.ack_count} of {eligible} have tapped Got it.</p>
                                )}
                            </section>
                        </div>
                    )}

                    {/* Responses: everyone it went to, with search and export. */}
                    {tab === "responses" && (
                        <div className="flex flex-col gap-3 flex-1 min-h-[420px]">
                            <div className="flex flex-wrap items-center gap-2">
                                <input
                                    type="search"
                                    value={gridSearch}
                                    onChange={e => setGridSearch(e.target.value)}
                                    placeholder="Search by name or email"
                                    aria-label="Search responses"
                                    className={`flex-1 min-w-40 max-w-xs ${inputClass}`}
                                />
                                <Button
                                    variant="outlined"
                                    className="ml-auto"
                                    onClick={() => gridRef.current?.api.exportDataAsCsv({
                                        fileName: `${n.title.replace(/[^a-z0-9]+/gi, "-")}-responses.csv`,
                                    })}
                                >
                                    <Download size={16} /> Export CSV
                                </Button>
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

                    {/* Settings: the form, then deactivating it. */}
                    {tab === "settings" && canEdit && (
                        <div className="flex flex-col gap-4 w-full max-w-2xl">
                            <NoticeForm
                                isNew={false} form={form} setForm={setForm} catalog={catalog} optionDraft={optionDraft}
                                setOptionDraft={setOptionDraft} addOption={addOption} removeOption={removeOption}
                                saving={saving} onSave={handleSave}
                                onCancel={() => void confirmDiscard().then(ok => {
                                    if (!ok) return
                                    // Discarding means the edits are gone, not just hidden behind another tab.
                                    if (initialForm) setForm(initialForm)
                                    setTab("overview")
                                })}
                            />
                            {n.active && (
                                <section aria-label="Deactivate" className="rounded-xl border theme-border theme-bg p-5 flex flex-wrap items-center gap-3">
                                    <div className="flex-1 min-w-48">
                                        <p className="text-sm font-semibold theme-h1-color">Deactivate this notice</p>
                                        <p className="text-xs theme-subtext-color">Members stop seeing it. Answers so far are kept.</p>
                                    </div>
                                    <Button variant="dangerOutlined" disabled={saving} onClick={() => void confirmDialog({
                                        title: "Deactivate this notice?", body: "Members stop seeing it. You can't turn it back on.", confirmLabel: "Deactivate", danger: true,
                                    }).then(ok => { if (ok) void handleDeactivate() })}>
                                        Deactivate
                                    </Button>
                                </section>
                            )}
                        </div>
                    )}
                </>
            )}
        </div>
    )
}

function Bar({ pct, thin = false }: { pct: number, thin?: boolean }) {
    return (
        <div className={`w-full rounded-full overflow-hidden ${thin ? "h-1.5" : "h-2"}`} style={{ background: "color-mix(in oklch, var(--theme-border) 80%, transparent)" }}>
            <div className="h-full rounded-full" style={{ width: `${pct}%`, background: "var(--theme-text-contrast)" }} />
        </div>
    )
}

function TabButton({ active, label, onClick }: { active: boolean, label: string, onClick: () => void }) {
    return (
        <button
            onClick={onClick}
            className={`min-h-11 flex items-end pb-2.5 text-sm transition-colors ${active ? "font-bold theme-h1-color" : "font-medium theme-h1-color opacity-70 hover:opacity-100"} ${focusRing}`}
            style={{
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
        <div className="flex flex-col gap-4 rounded-xl border p-5 max-w-2xl w-full theme-border theme-bg">
            <label className={`flex flex-col gap-1 ${fieldLabelClass}`}>
                Title
                <input
                    value={form.title}
                    onChange={e => setForm(prev => ({ ...prev, title: e.target.value }))}
                    className={`w-full ${inputClass}`}
                />
            </label>
            <label className={`flex flex-col gap-1 ${fieldLabelClass}`}>
                Body
                <textarea
                    value={form.body}
                    onChange={e => setForm(prev => ({ ...prev, body: e.target.value }))}
                    rows={3}
                    className={`w-full resize-none ${inputClass}`}
                />
            </label>
            <label className={`flex flex-col gap-1 ${fieldLabelClass}`}>
                Link (optional, e.g. a Google Form)
                <input
                    value={form.link}
                    onChange={e => setForm(prev => ({ ...prev, link: e.target.value }))}
                    placeholder="https://forms.gle/…"
                    className={`w-full ${inputClass}`}
                />
            </label>

            <label className="flex items-center gap-2 text-sm theme-text cursor-pointer">
                <Checkbox
                    checked={form.hard_block}
                    onChange={() => setForm(prev => ({ ...prev, hard_block: !prev.hard_block }))}
                />
                Required (members answer before using the app; no "Later")
            </label>

            <div className="border-t theme-border" />

            <div className="flex flex-col gap-2">
                <p className={fieldLabelClass}>Response options (leave empty for a plain "Got it")</p>
                <div className="flex flex-wrap gap-2">
                    {form.response_options.map(o => (
                        <span key={o} className="flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs theme-border theme-text">
                            {o}
                            <button onClick={() => removeOption(o)} aria-label={`Remove option ${o}`} className={`rounded-full theme-subtext-color hover:opacity-70 ${focusRing}`}>
                                <X size={14} />
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
                        className={`flex-1 min-w-0 ${inputClass}`}
                    />
                    <Button variant="outlined" onClick={addOption}>
                        Add
                    </Button>
                </div>
                {form.response_options.length > 0 && (
                    <label className="flex items-center gap-2 text-sm theme-subtext-color cursor-pointer mt-1">
                        <Checkbox
                            checked={form.response_mode === "multi"}
                            onChange={() => setForm(prev => ({ ...prev, response_mode: prev.response_mode === "multi" ? "single" : "multi" }))}
                        />
                        Allow selecting multiple options
                    </label>
                )}
            </div>

            <div className="border-t theme-border" />

            <div className="flex flex-col gap-2">
                <p className={fieldLabelClass}>Applies to</p>
                <RoleAudienceSelect
                    catalog={catalog}
                    selected={form.target_roles}
                    onChange={roles => setForm(prev => ({ ...prev, target_roles: roles }))}
                />
            </div>

            <FormFooter className="-mx-5 -mb-5 rounded-b-xl">
                <Button variant="outlined" size="footer" className="ml-auto" onClick={onCancel}>
                    Cancel
                </Button>
                <Button
                    size="footer"
                    onClick={() => void onSave()}
                    disabled={saving || !form.title.trim() || !form.body.trim()}
                >
                    {saving ? "Saving…" : isNew ? "Create notice" : "Save"}
                </Button>
            </FormFooter>
        </div>
    )
}
