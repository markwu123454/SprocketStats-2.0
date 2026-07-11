import { useEffect, useMemo, useRef, useState } from "react"
import { ExternalLink } from "lucide-react"

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

type Sort = "count" | "time"

/**
 * Format a percentage with at least 1 decimal place and 2 significant non-zero digits.
 */
function formatPct(value: number): string {
    if (value === 0) return "0.0%"
    if (value >= 100) return "100%"
    const abs = Math.abs(value)
    if (abs >= 1) return value.toFixed(1) + "%"
    const magnitude = Math.floor(Math.log10(abs))
    const decimals = Math.max(1, -magnitude + 1)
    return value.toFixed(decimals) + "%"
}

/**
 * Labeling progress for scouting. A two-up hero pairs the completion ring with
 * the "Open Label Studio" call-to-action + sponsor, then contributions render
 * as a ranked leaderboard (sortable by volume or speed) to make labeling a bit
 * competitive. The email-acknowledgement modal on the CTA is unchanged.
 */
export default function ScoutingPage() {
    const [summary, setSummary] = useState<SummaryRow | null>(null)
    const [contributions, setContributions] = useState<ContributionRow[]>([])
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState<string | null>(null)
    const [modalOpen, setModalOpen] = useState(false)
    const [checked, setChecked] = useState(false)
    const [sort, setSort] = useState<Sort>("count")
    const backdropRef = useRef<HTMLDivElement>(null)

    function handleLabelStudioClick() {
        if (localStorage.getItem(LS_KEY) === "1") {
            window.open("https://app.humansignal.com/user/login/?next=/projects/260156/labeling/", "_blank", "noopener,noreferrer")
        } else {
            setChecked(false)
            setModalOpen(true)
        }
    }

    function handleContinue() {
        if (!checked) return
        localStorage.setItem(LS_KEY, "1")
        window.open("https://app.humansignal.com/user/signup/?token=umBrjqaJxKF9yuEhniBIWE3MAxShFCzvLmhc6gNK", "_blank", "noopener,noreferrer")
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

    const totalTasks = summary?.total_tasks ?? 0
    const labeledTasks = summary?.labeled_tasks ?? 0
    const pct = totalTasks > 0 ? (labeledTasks / totalTasks) * 100 : 0

    // Ring geometry (r = 52 → circumference ≈ 326.73).
    const R = 52
    const C = 2 * Math.PI * R
    const dashOffset = C * (1 - Math.min(100, Math.max(0, pct)) / 100)

    const ranked = useMemo(() => {
        const arr = [...contributions]
        if (sort === "count") {
            arr.sort((a, b) => b.annotations_done - a.annotations_done)
        } else {
            const key = (v: number | null) => (v == null ? Infinity : v)
            arr.sort((a, b) => key(a.avg_time_secs) - key(b.avg_time_secs))
        }
        return arr
    }, [contributions, sort])

    const rankStyle = (rank: number): React.CSSProperties => {
        const base: React.CSSProperties = {
            width: 26, height: 26, borderRadius: "9999px", display: "flex",
            alignItems: "center", justifyContent: "center", fontSize: 13, fontWeight: 800, flexShrink: 0,
        }
        if (rank === 1) return { ...base, background: "var(--theme-text-contrast)", color: "var(--theme-bg)" }
        if (rank === 2) return { ...base, border: "1px solid var(--theme-text-contrast)", color: "var(--theme-text-contrast)" }
        if (rank === 3) return { ...base, border: "1px solid var(--theme-border)", color: "var(--theme-subtext-color)" }
        return { ...base, color: "var(--theme-subtext-color)", fontWeight: 700 }
    }

    const sortPill = (key: Sort, label: string) => (
        <button
            onClick={() => setSort(key)}
            className="rounded-full border px-3 py-1 text-xs font-medium transition-colors theme-border"
            style={{
                color: sort === key ? "var(--theme-text-contrast)" : "var(--theme-subtext-color)",
                background: sort === key ? "color-mix(in oklch, var(--theme-text-contrast) 10%, transparent)" : "transparent",
                borderColor: sort === key ? "color-mix(in oklch, var(--theme-text-contrast) 45%, transparent)" : "var(--theme-border)",
            }}
        >
            {label}
        </button>
    )

    return (
        <div className="mx-auto px-4 py-8 flex flex-col gap-6 h-full">
            <h1 className="text-2xl font-bold theme-h1-color">Labeling Progress</h1>

            {/* Hero: completion ring + CTA */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                <div
                    className="rounded-xl border p-6 flex items-center gap-6 backdrop-blur-sm"
                    style={{ background: "var(--theme-bg)", borderColor: "var(--theme-border)" }}
                >
                    <div className="relative shrink-0" style={{ width: 128, height: 128 }}>
                        <svg width="128" height="128" viewBox="0 0 120 120" style={{ transform: "rotate(-90deg)" }}>
                            <circle cx="60" cy="60" r={R} fill="none"
                                    stroke="color-mix(in oklch, var(--theme-border) 80%, transparent)" strokeWidth="11" />
                            <circle cx="60" cy="60" r={R} fill="none"
                                    stroke="var(--theme-text-contrast)" strokeWidth="11" strokeLinecap="round"
                                    strokeDasharray={C} strokeDashoffset={loading ? C : dashOffset}
                                    style={{ transition: "stroke-dashoffset 700ms ease" }} />
                        </svg>
                        <div className="absolute inset-0 flex items-center justify-center">
                            <span className="text-2xl font-extrabold theme-text-contrast">{loading ? "—" : formatPct(pct)}</span>
                        </div>
                    </div>
                    <div className="flex flex-col gap-1 min-w-0">
                        <span className="text-xs font-semibold uppercase tracking-widest theme-subtext-color">Overall completion</span>
                        <span className="text-sm theme-subtext-color">
                            {loading ? "Loading…" : `${labeledTasks.toLocaleString()} / ${totalTasks.toLocaleString()} tasks labeled`}
                        </span>
                    </div>
                </div>

                <div className="rounded-xl border p-6 flex flex-col justify-center gap-3 theme-border backdrop-blur-sm"
                     style={{ background: "var(--theme-bg)" }}>
                    <button
                        onClick={handleLabelStudioClick}
                        className="w-full flex items-center justify-center gap-3 rounded-xl border p-4 font-semibold text-lg transition-opacity hover:opacity-80 theme-text-contrast backdrop-blur-sm"
                        style={{
                            background: "color-mix(in oklch, var(--theme-button-bg) 80%, transparent)",
                            borderColor: "var(--theme-border)",
                        }}
                    >
                        <ExternalLink size={22} />
                        Open Label Studio
                    </button>
                    <p className="text-xs theme-subtext-color text-center">
                        Sponsored by{" "}
                        <a href="https://humansignal.com" target="_blank" rel="noopener noreferrer"
                           className="underline underline-offset-2 hover:opacity-70 transition-opacity theme-text">
                            HumanSignal
                        </a>
                        , the team behind Label Studio
                    </p>
                </div>
            </div>

            {/* Leaderboard */}
            <div className="flex flex-col gap-3 flex-1 min-h-0">
                <div className="flex items-center gap-2">
                    <span className="text-xs font-semibold uppercase tracking-widest theme-subtext-color">Contributor leaderboard</span>
                    <div className="ml-auto flex gap-1.5">
                        {sortPill("count", "Most annotations")}
                        {sortPill("time", "Fastest")}
                    </div>
                </div>

                {error && (
                    <p className="text-sm px-3 py-2 rounded-lg border theme-subtext-color theme-border"
                       style={{ background: "color-mix(in oklch, var(--theme-border) 40%, transparent)" }}>
                        {error}
                    </p>
                )}

                <div className="flex flex-col gap-2 flex-1 min-h-0 overflow-y-auto theme-scrollbar">
                    {loading ? (
                        <p className="text-sm theme-subtext-color px-1">Loading…</p>
                    ) : ranked.length === 0 ? (
                        <p className="text-sm theme-subtext-color px-1">No contributions yet.</p>
                    ) : (
                        ranked.map((c, i) => {
                            const rank = i + 1
                            return (
                                <div
                                    key={`${c.project_id}-${c.user_id}`}
                                    className="flex items-center gap-3.5 rounded-xl border px-4 py-3 theme-border backdrop-blur-sm"
                                    style={{ background: rank === 1 ? "color-mix(in oklch, var(--theme-text-contrast) 8%, var(--theme-bg))" : "var(--theme-bg)" }}
                                >
                                    <span style={rankStyle(rank)}>{rank}</span>
                                    <span className="flex-1 min-w-0 truncate text-sm font-medium theme-text">{c.annotator}</span>
                                    <span
                                        className="text-sm font-bold shrink-0"
                                        style={{ color: rank === 1 ? "var(--theme-text-contrast)" : "var(--theme-h1-color)" }}
                                    >
                                        {c.annotations_done.toLocaleString()}
                                    </span>
                                    <span className="text-xs theme-subtext-color shrink-0 w-16 text-right">
                                        {c.avg_time_secs != null ? `${c.avg_time_secs}s avg` : "—"}
                                    </span>
                                </div>
                            )
                        })
                    )}
                </div>
            </div>

            {/* Email-acknowledgment modal (unchanged behavior) */}
            {modalOpen && (
                <div
                    ref={backdropRef}
                    className="fixed inset-0 z-50 flex items-center justify-center p-4"
                    style={{ background: "rgba(0,0,0,0.5)" }}
                    onClick={(e) => { if (e.target === backdropRef.current) setModalOpen(false) }}
                >
                    <div className="w-full max-w-md rounded-2xl border p-6 flex flex-col gap-4 backdrop-blur-sm theme-bg theme-border">
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
                                    background: "color-mix(in oklch, var(--theme-button-bg) 80%, transparent)",
                                    opacity: checked ? 1 : 0.35,
                                    cursor: checked ? "pointer" : "not-allowed",
                                }}
                            >
                                Continue →
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    )
}
