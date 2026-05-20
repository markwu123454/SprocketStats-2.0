import { useEffect, useState } from "react"
import { AgGridReact } from "ag-grid-react"
import { ExternalLink } from "lucide-react"
import type { ColDef } from "ag-grid-community"

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
    const [summary, setSummary]             = useState<SummaryRow[]>([])
    const [contributions, setContributions] = useState<ContributionRow[]>([])
    const [loading, setLoading]             = useState(true)
    const [error, setError]                 = useState<string | null>(null)

    useEffect(() => {
        async function load() {
            try {
                const [summaryRes, contribRes] = await Promise.all([
                    fetch(`${API}/labeling/summary`,       { credentials: "include" }),
                    fetch(`${API}/labeling/contributions`, { credentials: "include" }),
                ])
                if (!summaryRes.ok || !contribRes.ok) throw new Error("Failed to load")
                const [summaryData, contribData] = await Promise.all([
                    summaryRes.json() as Promise<SummaryRow[]>,
                    contribRes.json() as Promise<ContributionRow[]>,
                ])
                setSummary(summaryData)
                setContributions(contribData)
            } catch {
                setError("Failed to load labeling data")
            } finally {
                setLoading(false)
            }
        }
        void load()
    }, [])

    const totalTasks   = summary.reduce((s, r) => s + Number(r.total_tasks),   0)
    const labeledTasks = summary.reduce((s, r) => s + Number(r.labeled_tasks), 0)
    const pct          = totalTasks > 0 ? (labeledTasks / totalTasks) * 100 : 0

    return (
        <div className="max-w-7xl mx-auto px-4 py-8 flex flex-col gap-8">
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

            {/* Label Studio link */}
            <a
                href="https://label-studio-shared-798068859905.us-west2.run.app/user/login/?token=7IKmZlpxScE59qRUTTLbrrAC5IQnUm4mRacqvZzc&next=/projects/7/data/%3Ftab%3D6%26labeling%3D1"
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center justify-center gap-3 rounded-xl border p-5 font-semibold text-lg transition-opacity hover:opacity-80 theme-text-contrast backdrop-blur-sm"
                style={{
                    background:   "color-mix(in oklch, var(--theme-button-bg) 80%, transparent)",
                    borderColor:  "var(--theme-border)",
                }}
            >
                <ExternalLink size={22} />
                Open Label Studio
            </a>

            {/* Contributions table */}
            {error ? (
                <p className="text-sm theme-subtext-color">{error}</p>
            ) : (
                <div
                    className="rounded-xl border overflow-hidden"
                    style={{ borderColor: "var(--theme-border)", height: "480px" }}
                >
                    <AgGridReact
                        rowData={contributions}
                        columnDefs={COL_DEFS}
                        loading={loading}
                        defaultColDef={{ sortable: true, resizable: true }}
                    />
                </div>
            )}
        </div>
    )
}