import { useState } from "react"
import { useEventContext } from "@/contexts/eventContext"
import type { TBAMatch, TBARankEntry } from "@/lib/eventApi"

const TEAM_KEY     = "frc3473"
const TEAM_NUM     = "3473"

const SISTER_TEAMS  = ["frc968", "frc3476", "frc5857", "frc7157"]
const NOTABLE_TEAMS = ["frc4414", "frc5199", "frc6995"]
const WATCH_TEAMS   = [...SISTER_TEAMS, ...NOTABLE_TEAMS]

// ── helpers ────────────────────────────────────────────────────────────────────

function alliance(m: TBAMatch, key: string): "red" | "blue" | null {
    if (m.alliances.red.team_keys.includes(key))  return "red"
    if (m.alliances.blue.team_keys.includes(key)) return "blue"
    return null
}

function matchLabel(m: TBAMatch): string {
    if (m.comp_level === "qm") return `Q${m.match_number}`
    if (m.comp_level === "sf") return `SF${m.set_number}M${m.match_number}`
    if (m.comp_level === "f")  return `FM${m.match_number}`
    return `${m.comp_level}${m.match_number}`
}

function fmtUnix(unix: number | null): string {
    if (!unix) return "TBD"
    return new Date(unix * 1000).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })
}

// Nexus maps team status strings to display labels + colors
const NEXUS_STATUS_MAP: [RegExp, string, string][] = [
    [/on.?field/i,      "In Match",       "#22c55e"],
    [/queued|queueing/i,"Queueing",       "#f59e0b"],
    [/on.?deck/i,       "On Deck",        "#f59e0b"],
    [/practice/i,       "Practice Field", "#3b82f6"],
    [/pit/i,            "In Pit",         "var(--theme-subtext-color)"],
    [/build/i,          "Building Pit",   "var(--theme-subtext-color)"],
    [/pack/i,           "Packing Up",     "var(--theme-subtext-color)"],
]

function parseNexusStatus(raw: string | null | undefined): { label: string; color: string } {
    if (raw) {
        for (const [re, label, color] of NEXUS_STATUS_MAP) {
            if (re.test(raw)) return { label, color }
        }
    }
    return { label: "In Pit", color: "var(--theme-subtext-color)" }
}

// ── main component ─────────────────────────────────────────────────────────────

export default function CompPage() {
    const { info, loading } = useEventContext()

    // epa: our own scouting metric, not yet wired — will arrive via /update when implemented
    const [epa] = useState<number | null>(null)

    const matches   = info?.matches ?? []
    const rankings  = info?.rankings?.rankings ?? []
    const nexus     = info?.nexus ?? null

    // Nexus status: teamStatuses is a map of team number → status string
    const teamStatuses = (nexus?.status as Record<string, unknown> | null)?.teamStatuses as Record<string, string> | undefined
    const rawStatus    = teamStatuses?.[TEAM_NUM]
    const robotStatus  = parseNexusStatus(rawStatus)

    const inspection   = nexus?.inspection?.[TEAM_NUM]
    const inspected    = (inspection as { inspected?: boolean } | undefined)?.inspected
    const nowQueuing   = nexus?.status?.nowQueuing

    // Determine queueing from nowQueuing if nexus teamStatuses unavailable
    const isQueueing = !rawStatus && (() => {
        if (!nowQueuing) return false
        return matches.some(m => alliance(m, TEAM_KEY) !== null && !m.actual_time && matchLabel(m) === nowQueuing)
    })()
    const displayStatus = isQueueing ? { label: "Queueing", color: "#f59e0b" } : robotStatus

    // Next unplayed match for our team
    const nowSec    = Date.now() / 1000
    const ourMatches = matches
        .filter(m => alliance(m, TEAM_KEY) !== null)
        .sort((a, b) => (a.predicted_time ?? a.scheduled_time ?? 0) - (b.predicted_time ?? b.scheduled_time ?? 0))
    const nextMatch  = ourMatches.find(m => !m.actual_time && (m.predicted_time ?? m.scheduled_time ?? 0) > nowSec - 600)

    // Past 2: most recently played
    const pastMatches = ourMatches
        .filter(m => !!m.actual_time)
        .slice(-2)
        .reverse()

    // Next 5 upcoming
    const upcomingMatches = ourMatches
        .filter(m => !m.actual_time)
        .slice(0, 5)

    // Our ranking entry
    const ourRank = rankings.find(r => r.team_key === TEAM_KEY)

    // Watch teams from rankings, sorted by rank
    const watchRankings = WATCH_TEAMS
        .map(t => rankings.find(r => r.team_key === t))
        .filter((r): r is TBARankEntry => !!r)
        .sort((a, b) => a.rank - b.rank)

    if (loading && !info) {
        return <PageState>Loading…</PageState>
    }

    return (
        <div className="max-w-2xl mx-auto px-4 py-4 flex flex-col gap-6 pb-8">

            {/* ── Robot Status ────────────────────────────────────── */}
            <Section label="Robot">
                <div
                    className="rounded-xl border overflow-hidden"
                    style={{ background: "var(--theme-bg)", borderColor: "var(--theme-border)" }}
                >
                    {/* Status + inspection row */}
                    <div className="flex items-center gap-4 px-4 py-3 border-b" style={{ borderColor: "var(--theme-border)" }}>
                        <div className="flex items-center gap-2 flex-1">
                            <div className="w-2 h-2 rounded-full shrink-0" style={{ background: displayStatus.color }} />
                            <span className="text-sm font-semibold" style={{ color: displayStatus.color }}>
                                {displayStatus.label}
                            </span>
                        </div>
                        {inspected !== undefined && (
                            <span
                                className="text-xs font-medium px-2 py-0.5 rounded"
                                style={{
                                    background: inspected ? "#22c55e22" : "#ef444422",
                                    color:      inspected ? "#22c55e"   : "#ef4444",
                                }}
                            >
                                {inspected ? "✓ Inspected" : "✗ Not Inspected"}
                            </span>
                        )}
                        {nowQueuing && (
                            <span className="text-xs" style={{ color: "var(--theme-subtext-color)" }}>
                                Queuing: {nowQueuing}
                            </span>
                        )}
                    </div>

                    {/* Next match */}
                    {nextMatch ? (
                        <NextMatchRow match={nextMatch} />
                    ) : (
                        <div className="px-4 py-3 text-sm" style={{ color: "var(--theme-subtext-color)" }}>
                            No upcoming matches.
                        </div>
                    )}
                </div>
            </Section>

            {/* ── Rankings ────────────────────────────────────────── */}
            <Section label="Rankings">
                <div
                    className="rounded-xl border overflow-hidden"
                    style={{ background: "var(--theme-bg)", borderColor: "var(--theme-border)" }}
                >
                    {/* Our team + EPA */}
                    {ourRank && (
                        <div className="flex items-center gap-4 px-4 py-3 border-b" style={{ borderColor: "var(--theme-border)" }}>
                            <span className="text-sm font-bold w-8 shrink-0" style={{ color: "var(--theme-text-contrast)" }}>
                                #{ourRank.rank}
                            </span>
                            <span className="text-sm font-semibold flex-1" style={{ color: "var(--theme-text-contrast)" }}>
                                3473
                            </span>
                            <span className="text-xs tabular-nums" style={{ color: "var(--theme-subtext-color)" }}>
                                {ourRank.record.wins}–{ourRank.record.losses}–{ourRank.record.ties}
                            </span>
                            <span className="text-xs tabular-nums w-12 text-right" style={{ color: "var(--theme-subtext-color)" }}>
                                {ourRank.sort_orders[0] !== undefined ? `${ourRank.sort_orders[0]} RP` : ""}
                            </span>
                            {epa !== null && (
                                <span
                                    className="text-xs font-semibold tabular-nums px-2 py-0.5 rounded"
                                    style={{
                                        background: "color-mix(in oklch, var(--theme-text-contrast) 12%, transparent)",
                                        color: "var(--theme-text-contrast)",
                                    }}
                                >
                                    {epa.toFixed(1)} EPA
                                </span>
                            )}
                        </div>
                    )}

                    {/* Watch teams */}
                    {watchRankings.length > 0 ? (
                        watchRankings.map(r => {
                            const isSister = SISTER_TEAMS.includes(r.team_key)
                            return (
                                <div
                                    key={r.team_key}
                                    className="flex items-center gap-4 px-4 py-2.5 border-b last:border-0 text-sm"
                                    style={{ borderColor: "var(--theme-border)" }}
                                >
                                    <span className="tabular-nums w-8 shrink-0" style={{ color: "var(--theme-subtext-color)" }}>
                                        #{r.rank}
                                    </span>
                                    <span
                                        className="font-medium flex-1"
                                        style={{ color: isSister ? "var(--theme-text-contrast)" : "var(--theme-text)" }}
                                    >
                                        {r.team_key.replace("frc", "")}
                                    </span>
                                    <span className="tabular-nums" style={{ color: "var(--theme-subtext-color)" }}>
                                        {r.record.wins}–{r.record.losses}–{r.record.ties}
                                    </span>
                                    <span className="tabular-nums w-12 text-right" style={{ color: "var(--theme-subtext-color)" }}>
                                        {r.sort_orders[0] !== undefined ? `${r.sort_orders[0]} RP` : ""}
                                    </span>
                                </div>
                            )
                        })
                    ) : !ourRank ? (
                        <div className="px-4 py-3 text-sm" style={{ color: "var(--theme-subtext-color)" }}>
                            Rankings not yet posted.
                        </div>
                    ) : null}
                </div>
            </Section>

            {/* ── Matches ─────────────────────────────────────────── */}
            <Section label="Matches">
                {pastMatches.length === 0 && upcomingMatches.length === 0 ? (
                    <div className="text-sm text-center py-8" style={{ color: "var(--theme-subtext-color)" }}>
                        Schedule not yet posted.
                    </div>
                ) : (
                    <div className="flex flex-col gap-2">
                        {pastMatches.map(m => <MatchCard key={m.key} match={m} isPast />)}
                        {upcomingMatches.map(m => <MatchCard key={m.key} match={m} isPast={false} isNext={m.key === nextMatch?.key} />)}
                    </div>
                )}
            </Section>

            {/* ── Scouting Intel placeholder ───────────────────────── */}
            <div className="pt-4 border-t" style={{ borderColor: "var(--theme-border)" }}>
                <p className="text-[11px] font-bold tracking-wider uppercase mb-4" style={{ color: "var(--theme-subtext-color)" }}>
                    Scouting Intel
                </p>
                <p className="text-sm text-center py-6" style={{ color: "var(--theme-subtext-color)" }}>
                    Scouting pipeline coming soon.
                </p>
            </div>
        </div>
    )
}

// ── sub-components ─────────────────────────────────────────────────────────────

function Section({ label, children }: { label: string; children: React.ReactNode }) {
    return (
        <section>
            <p className="text-[11px] font-bold tracking-wider uppercase mb-3" style={{ color: "var(--theme-subtext-color)" }}>
                {label}
            </p>
            {children}
        </section>
    )
}

function NextMatchRow({ match }: { match: TBAMatch }) {
    const side      = alliance(match, TEAM_KEY)!
    const ourAlliance = match.alliances[side]
    const oppAlliance = match.alliances[side === "red" ? "blue" : "red"]

    return (
        <div className="flex items-center gap-3 px-4 py-3 text-sm">
            <div className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: side === "red" ? "#ef4444" : "#3b82f6" }} />
            <span className="font-semibold w-10 shrink-0" style={{ color: "var(--theme-text)" }}>
                {matchLabel(match)}
            </span>
            <div className="flex-1 flex gap-1 flex-wrap">
                {ourAlliance.team_keys.map(k => (
                    <span
                        key={k}
                        className="text-xs font-medium"
                        style={{ color: k === TEAM_KEY ? "var(--theme-text-contrast)" : "var(--theme-text)" }}
                    >
                        {k.replace("frc", "")}
                    </span>
                ))}
                <span className="text-xs opacity-30 mx-0.5" style={{ color: "var(--theme-subtext-color)" }}>vs</span>
                {oppAlliance.team_keys.map(k => (
                    <span key={k} className="text-xs" style={{ color: "var(--theme-subtext-color)" }}>
                        {k.replace("frc", "")}
                    </span>
                ))}
            </div>
            <span className="text-xs shrink-0 tabular-nums" style={{ color: "var(--theme-subtext-color)" }}>
                {fmtUnix(match.predicted_time ?? match.scheduled_time)}
            </span>
        </div>
    )
}

function MatchCard({ match, isPast, isNext }: { match: TBAMatch; isPast: boolean; isNext?: boolean }) {
    const ourSide = alliance(match, TEAM_KEY)
    const red     = match.alliances.red
    const blue    = match.alliances.blue

    const winner  = match.winning_alliance as "red" | "blue" | "" | undefined
    const redWon  = isPast && winner === "red"
    const blueWon = isPast && winner === "blue"

    return (
        <div
            className="rounded-xl border overflow-hidden"
            style={{
                background:  "var(--theme-bg)",
                borderColor: isNext ? (ourSide === "red" ? "#ef4444" : "#3b82f6") : "var(--theme-border)",
                borderWidth:  isNext ? "2px" : "1px",
            }}
        >
            {/* Header row */}
            <div
                className="flex items-center gap-3 px-3 py-2 border-b text-xs"
                style={{ borderColor: "var(--theme-border)", background: "color-mix(in oklch, var(--theme-bg) 70%, var(--theme-border))" }}
            >
                <span className="font-bold" style={{ color: "var(--theme-text)" }}>{matchLabel(match)}</span>
                {isPast ? (
                    <>
                        <span className="ml-auto" style={{ color: "var(--theme-subtext-color)" }}>
                            {fmtUnix(match.actual_time)}
                        </span>
                        {ourSide && winner && (
                            <span
                                className="font-bold px-1.5 py-0.5 rounded"
                                style={{
                                    background: winner === ourSide ? "#22c55e22" : "#ef444422",
                                    color:      winner === ourSide ? "#22c55e"   : "#ef4444",
                                }}
                            >
                                {winner === ourSide ? "W" : "L"}
                            </span>
                        )}
                    </>
                ) : (
                    <span className="ml-auto" style={{ color: "var(--theme-subtext-color)" }}>
                        {fmtUnix(match.predicted_time ?? match.scheduled_time)}
                    </span>
                )}
            </div>

            {/* Red alliance */}
            <AllianceRow
                color="red"
                teams={red.team_keys}
                score={isPast ? red.score : null}
                won={redWon}
                highlightKey={ourSide === "red" ? TEAM_KEY : null}
            />

            {/* Blue alliance */}
            <AllianceRow
                color="blue"
                teams={blue.team_keys}
                score={isPast ? blue.score : null}
                won={blueWon}
                highlightKey={ourSide === "blue" ? TEAM_KEY : null}
            />
        </div>
    )
}

function AllianceRow({
    color, teams, score, won, highlightKey,
}: {
    color: "red" | "blue"
    teams: string[]
    score: number | null
    won: boolean
    highlightKey: string | null
}) {
    const bg      = color === "red" ? "#ef444408" : "#3b82f608"
    const accent  = color === "red" ? "#ef4444"   : "#3b82f6"

    return (
        <div
            className="flex items-center gap-2 px-3 py-2 border-b last:border-0 text-sm"
            style={{ background: won ? (color === "red" ? "#ef444414" : "#3b82f614") : bg, borderColor: "var(--theme-border)" }}
        >
            <div className="w-1 self-stretch rounded-full shrink-0" style={{ background: accent }} />
            <div className="flex gap-2 flex-1 flex-wrap">
                {teams.map(k => (
                    <span
                        key={k}
                        className="font-medium tabular-nums"
                        style={{ color: k === highlightKey ? "var(--theme-text-contrast)" : "var(--theme-text)" }}
                    >
                        {k.replace("frc", "")}
                    </span>
                ))}
            </div>
            {score !== null ? (
                <span className="font-bold tabular-nums text-base" style={{ color: won ? accent : "var(--theme-text)" }}>
                    {score}
                </span>
            ) : (
                <span className="tabular-nums text-xs" style={{ color: "var(--theme-subtext-color)" }}>—</span>
            )}
        </div>
    )
}

function PageState({ children }: { children: string }) {
    return (
        <div className="flex items-center justify-center py-16">
            <span className="text-sm" style={{ color: "var(--theme-subtext-color)" }}>{children}</span>
        </div>
    )
}
