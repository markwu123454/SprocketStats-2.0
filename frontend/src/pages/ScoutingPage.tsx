import { useEffect, useRef, useState } from "react"
import { AgGridReact } from "ag-grid-react"
import { ExternalLink } from "lucide-react"
import type { ColDef } from "ag-grid-community"

const LS_KEY = "label_studio_email_ack"

const API = import.meta.env.VITE_BACKEND_URL

interface SummaryRow {
    project_id: number
    project: string
    total_tasks: number
    labeled_tasks: number
    unlabeled_tasks: number
    pct_labeled: number
}

interface ContributionRow {
    project_id: number
    project: string
    user_id: number
    annotator: string
    annotations_done: number
    skipped: number
    avg_time_secs: number | null
}

interface LabelingResponse {
    summary: SummaryRow
    contributions: ContributionRow[]
}

const COL_DEFS: ColDef<ContributionRow>[] = [
    { field: "annotator",        headerName: "Name",             flex: 2, minWidth: 140 },
    { field: "annotations_done", headerName: "Annotations Done", flex: 1, minWidth: 130, type: "numericColumn" },
    {
        field: "avg_time_secs",
        headerName: "Avg Time",
        flex: 1,
        minWidth: 110,
        type: "numericColumn",
        valueFormatter: ({ value }) => value != null ? `${value}s` : "—",
    },
]

/**
 * Format a percentage with at least 1 decimal place and 2 significant non-zero digits.
 *
 * Examples:
 *   0        → "0.0%"
 *   100      → "100%"
 *   99.3456  → "99.3%"   (2 sig figs before decimal, 1 decimal)
 *   3.4567   → "3.5%"    (1 decimal gives 2 sig figs)
 *   0.3456   → "0.35%"   (2 decimals to get 2 sig non-zero figs)
 *   0.03456  → "0.035%"  (3 decimals to get 2 sig non-zero figs)
 */
function formatPct(value: number): string {
    if (value === 0)   return "0.0%"
    if (value >= 100)  return "100%"
    const abs = Math.abs(value)
    if (abs >= 1) {
        // 1+ % → 1 decimal place always gives ≥ 2 sig figs
        return value.toFixed(1) + "%"
    }
    // < 1%: find the first non-zero decimal digit position, then show one more
    const magnitude = Math.floor(Math.log10(abs)) // e.g. -2 for 0.034
    const decimals  = Math.max(1, -magnitude + 1)  // e.g. 3 for 0.034 → "0.034%"
    return value.toFixed(decimals) + "%"
}

export default function ScoutingPage() {
    const [summary, setSummary]             = useState<SummaryRow | null>(null)
    const [contributions, setContributions] = useState<ContributionRow[]>([])
    const [loading, setLoading]             = useState(true)
    const [error, setError]                 = useState<string | null>(null)
    const [modalOpen, setModalOpen]         = useState(false)
    const [checked, setChecked]             = useState(false)
    const backdropRef                       = useRef<HTMLDivElement>(null)

    function handleLabelStudioClick() {
        if (localStorage.getItem(LS_KEY) === "1") {
            window.open("https://app.humansignal.com/user/login/?next=/projects/260156/labeling/"
                , "_blank", "noopener,noreferrer")
        } else {
            setChecked(false)
            setModalOpen(true)
        }
    }

    function handleContinue() {
        if (!checked) return
        localStorage.setItem(LS_KEY, "1")
        window.open("https://app.humansignal.com/user/signup/?token=umBrjqaJxKF9yuEhniBIWE3MAxShFCzvLmhc6gNK"
            , "_blank", "noopener,noreferrer")
        setModalOpen(false)
    }

    useEffect(() => {
        async function load() {
            try {
                const res = await fetch(`${API}/labeling`, { credentials: "include" })
                if (!res.ok) throw new Error("Failed to load")
                const data = await res.json() as LabelingResponse
                setSummary(data.summary)
                setContributions(data.contributions)
            } catch {
                setError("Failed to load labeling data")
            } finally {
                setLoading(false)
            }
        }
        void load()
    }, [])

    const totalTasks   = summary?.total_tasks   ?? 0
    const labeledTasks = summary?.labeled_tasks ?? 0
    const pct          = totalTasks > 0 ? (labeledTasks / totalTasks) * 100 : 0

    return (
        <div className="mx-auto px-4 py-8 flex flex-col gap-8 h-full">
            <h1 className="text-2xl font-bold theme-h1-color">Labeling Progress</h1>

            {/* Progress bar */}
            <div
                className="rounded-xl border p-6 flex flex-col gap-3 backdrop-blur-sm"
                style={{ background: "var(--theme-bg)", borderColor: "var(--theme-border)" }}
            >
                <div className="flex items-end justify-between">
                    <p className="text-sm font-medium theme-text opacity-70">Overall Completion</p>
                    <p className="text-3xl font-bold theme-text-contrast">{loading ? "—" : formatPct(pct)}</p>
                </div>
                <div
                    className="w-full rounded-full overflow-hidden"
                    style={{ height: "20px", background: "color-mix(in oklch, var(--theme-border) 80%, transparent)" }}
                >
                    <div
                        className="h-full rounded-full transition-all duration-700"
                        style={{ width: loading ? "0%" : `${pct}%`, background: "var(--theme-text-contrast)" }}
                    />
                </div>
                <p className="text-sm theme-subtext-color">
                    {loading ? "Loading…" : `${labeledTasks.toLocaleString()} / ${totalTasks.toLocaleString()} tasks labeled`}
                </p>
            </div>

            {/* Label Studio button + sponsor + modal */}
            <div className="flex flex-col items-center gap-1.5">
                <button
                    onClick={handleLabelStudioClick}
                    className="w-full flex items-center justify-center gap-3 rounded-xl border p-5 font-semibold text-lg transition-opacity hover:opacity-80 theme-text-contrast backdrop-blur-sm"
                    style={{
                        background:  "color-mix(in oklch, var(--theme-button-bg) 80%, transparent)",
                        borderColor: "var(--theme-border)",
                    }}
                >
                    <ExternalLink size={22} />
                    Open Label Studio
                </button>
                <p className="text-xs theme-subtext-color">
                    Sponsored by{" "}
                    <a
                        href="https://humansignal.com"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="underline underline-offset-2 hover:opacity-70 transition-opacity theme-text"
                    >
                        HumanSignal
                    </a>
                    , the team behind Label Studio
                </p>
            </div>

            {/* Email-acknowledgment modal */}
            {modalOpen && (
                <div
                    ref={backdropRef}
                    className="fixed inset-0 z-50 flex items-center justify-center p-4"
                    style={{ background: "rgba(0,0,0,0.5)" }}
                    onClick={(e) => { if (e.target === backdropRef.current) setModalOpen(false) }}
                >
                    <div
                        className="w-full max-w-md rounded-2xl border p-6 flex flex-col gap-4 backdrop-blur-sm theme-bg theme-border"
                    >
                        <div className="flex items-center gap-2">
                            <ExternalLink size={18} className="theme-subtext-color" />
                            <h2 className="text-base font-semibold theme-text-contrast">Before you continue</h2>
                        </div>

                        <p className="text-sm theme-subtext-color leading-relaxed">
                            Label Studio tracks your contributions by email. Make sure you sign
                            in with the <span className="theme-text font-medium">same email</span> you
                            used to register here, using a different one will disconnect your
                            annotations from your account.
                        </p>

                        <label className="flex items-start gap-3 cursor-pointer">
                            <input
                                type="checkbox"
                                checked={checked}
                                onChange={(e) => setChecked(e.target.checked)}
                                className="mt-0.5 h-4 w-4 shrink-0 cursor-pointer accent-(--theme-text-contrast)"
                            />
                            <span className="text-sm theme-text leading-snug">
                                I'll use the same email I registered with on this platform.
                            </span>
                        </label>

                        <div className="flex gap-2 pt-1">
                            <button
                                onClick={() => setModalOpen(false)}
                                className="flex-1 rounded-lg border px-4 py-2 text-sm font-medium transition-opacity hover:opacity-70 theme-subtext-color theme-border"
                            >
                                Cancel
                            </button>
                            <button
                                onClick={handleContinue}
                                disabled={!checked}
                                className="flex-1 rounded-lg border px-4 py-2 text-sm font-semibold transition-opacity theme-text-contrast theme-border"
                                style={{
                                    background:  "color-mix(in oklch, var(--theme-button-bg) 80%, transparent)",
                                    opacity:     checked ? 1 : 0.35,
                                    cursor:      checked ? "pointer" : "not-allowed",
                                }}
                            >
                                Continue →
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Contributions table */}
            <div className="flex flex-col gap-2 flex-1 min-h-0">
                {error && (
                    <p className="text-sm px-3 py-2 rounded-lg border theme-subtext-color theme-border"
                       style={{ background: "color-mix(in oklch, var(--theme-border) 40%, transparent)" }}>
                        {error}
                    </p>
                )}
                <div className="rounded-xl border overflow-hidden theme-border flex-1 min-h-0">
                    <AgGridReact
                        rowData={contributions}
                        columnDefs={COL_DEFS}
                        loading={loading}
                        defaultColDef={{ sortable: true, resizable: true }}
                    />
                </div>
            </div>
        </div>
    )
}