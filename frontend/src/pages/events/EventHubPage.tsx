import { useState } from "react"
import { useEventContext } from "@/contexts/eventContext"
import type { TBAMatch, ItineraryItem } from "@/lib/eventApi"

const TEAM_KEY = "frc3473"

const SISTER_TEAMS  = ["frc968", "frc3476", "frc5857", "frc7157"]
const NOTABLE_TEAMS = ["frc4414", "frc5199", "frc6995"]

const SERVICES = [
    { key: "tba"        as const, label: "The Blue Alliance", favicon: "https://www.thebluealliance.com/favicon.ico"  },
    { key: "statbotics" as const, label: "Statbotics",         favicon: "https://www.statbotics.io/favicon.ico"       },
    { key: "nexus"      as const, label: "FRC Nexus",          favicon: "https://frc.nexus/en/assets/images/icon.svg" },
    { key: "youtube"    as const, label: "YouTube",            favicon: "https://www.youtube.com/favicon.ico"         },
    { key: "twitch"     as const, label: "Twitch",             favicon: "https://www.twitch.tv/favicon.ico"           },
]

function getAlliance(m: TBAMatch, teamKey: string): "red" | "blue" | null {
    if (m.alliances.red.team_keys.includes(teamKey)) return "red"
    if (m.alliances.blue.team_keys.includes(teamKey)) return "blue"
    return null
}

function matchLabel(m: TBAMatch): string {
    if (m.comp_level === "qm") return `Qual ${m.match_number}`
    if (m.comp_level === "sf") return `Semi ${m.set_number}M${m.match_number}`
    if (m.comp_level === "f")  return `Final M${m.match_number}`
    return `${m.comp_level} ${m.match_number}`
}

function formatUnix(unix: number | null): string {
    if (!unix) return "TBD"
    return new Date(unix * 1000).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })
}

function formatIso(iso: string): string {
    return new Date(iso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })
}

function getTimelineSlice(items: ItineraryItem[]) {
    const now = Date.now()
    const passed   = items.filter(i => new Date(i.dt).getTime() <= now)
    const upcoming = items.filter(i => new Date(i.dt).getTime() > now)
    return { current: passed[passed.length - 1] ?? null, upcoming: upcoming.slice(0, 2) }
}

function nextMatchFor(matches: TBAMatch[], teamKey: string): TBAMatch | null {
    const now = Date.now() / 1000
    return matches
        .filter(m => getAlliance(m, teamKey) !== null && !m.actual_time)
        .filter(m => (m.predicted_time ?? m.scheduled_time ?? 0) > now - 600)
        .sort((a, b) => (a.predicted_time ?? a.scheduled_time ?? 0) - (b.predicted_time ?? b.scheduled_time ?? 0))
        [0] ?? null
}

export default function EventHubPage() {
    const { info } = useEventContext()

    const matches    = info?.matches ?? []
    const rankings   = info?.rankings ?? null
    const rankEntry  = rankings?.rankings?.find(r => r.team_key === TEAM_KEY) ?? null
    const rankTotal  = rankings?.rankings?.length ?? 0
    const ourNext    = nextMatchFor(matches, TEAM_KEY)
    const timeline   = info?.itinerary?.length ? getTimelineSlice(info.itinerary) : null
    const links      = info?.links
    const hasLinks   = links && SERVICES.some(s => links[s.key])

    // Watch teams grouped by their next match — qual on left, robots+side in middle
    const attending = new Set(matches.flatMap(m => [
        ...m.alliances.red.team_keys,
        ...m.alliances.blue.team_keys,
    ]))
    const watchTeamEntries = [...SISTER_TEAMS, ...NOTABLE_TEAMS]
        .filter(t => attending.has(t))
        .map(t => ({ team: t, match: nextMatchFor(matches, t), isSister: SISTER_TEAMS.includes(t) }))

    // Group by match key (null = no upcoming match)
    const watchByMatch = watchTeamEntries.reduce<Map<string, typeof watchTeamEntries>>((acc, entry) => {
        const key = entry.match?.key ?? "__done__"
        if (!acc.has(key)) acc.set(key, [])
        acc.get(key)!.push(entry)
        return acc
    }, new Map())

    // Sort groups: matches first (by predicted time), then "done" group
    const watchGroups = [...watchByMatch.entries()]
        .sort(([ka, a], [kb, b]) => {
            if (ka === "__done__") return 1
            if (kb === "__done__") return -1
            const ta = a[0].match!
            const tb = b[0].match!
            return (ta.predicted_time ?? ta.scheduled_time ?? 0) - (tb.predicted_time ?? tb.scheduled_time ?? 0)
        })

    const cardBase = { background: "var(--theme-bg)", borderColor: "var(--theme-border)" }

    return (
        <div className="max-w-xl mx-auto px-4 py-5 flex flex-col gap-6 pb-8">

            {/* Day timeline */}
            <section>
                <SectionLabel>Today</SectionLabel>
                <div className="rounded-xl border overflow-hidden" style={cardBase}>
                    {timeline && (timeline.current || timeline.upcoming.length > 0) ? (
                        <>
                            {timeline.current && <TimelineRow item={timeline.current} isCurrent />}
                            {timeline.upcoming.map((item, i) => <TimelineRow key={i} item={item} />)}
                        </>
                    ) : (
                        <PlaceholderRow>Schedule not yet posted</PlaceholderRow>
                    )}
                </div>
            </section>

            {/* Our team */}
            <section className="flex flex-col gap-2">
                <SectionLabel>Our Team</SectionLabel>
                {rankEntry ? (
                    <div className="flex items-center gap-4 px-4 py-3 rounded-xl border" style={cardBase}>
                        <span className="text-sm font-semibold" style={{ color: "var(--theme-text)" }}>
                            Rank {rankEntry.rank} / {rankTotal}
                        </span>
                        <span className="text-sm" style={{ color: "var(--theme-subtext-color)" }}>
                            {rankEntry.record.wins}–{rankEntry.record.losses}–{rankEntry.record.ties}
                        </span>
                    </div>
                ) : (
                    <div className="flex items-center px-4 py-3 rounded-xl border" style={cardBase}>
                        <span className="text-sm" style={{ color: "var(--theme-subtext-color)" }}>Rankings not yet available</span>
                    </div>
                )}
                {ourNext ? (
                    <NextMatchCard match={ourNext} />
                ) : (
                    <div className="flex items-center px-4 py-3 rounded-xl border" style={cardBase}>
                        <span className="text-sm" style={{ color: "var(--theme-subtext-color)" }}>No upcoming match</span>
                    </div>
                )}
            </section>

            {/* Watch teams */}
            <section>
                <SectionLabel>Watch</SectionLabel>
                <div className="rounded-xl border overflow-hidden" style={cardBase}>
                    {watchGroups.length > 0 ? (
                        watchGroups.map(([matchKey, entries]) => (
                            <WatchRow key={matchKey} entries={entries} />
                        ))
                    ) : (
                        <PlaceholderRow>Match data not yet available</PlaceholderRow>
                    )}
                </div>
            </section>

            {/* Quick links */}
            <section>
                <SectionLabel>Links</SectionLabel>
                {hasLinks ? (
                    <div className="flex gap-3">
                        {SERVICES.map(({ key, label, favicon }) => {
                            const href = links![key]
                            if (!href) return null
                            return <LinkIcon key={key} label={label} favicon={favicon} href={href} />
                        })}
                    </div>
                ) : (
                    <div className="flex items-center px-4 py-3 rounded-xl border" style={cardBase}>
                        <span className="text-sm" style={{ color: "var(--theme-subtext-color)" }}>Links not yet available</span>
                    </div>
                )}
            </section>
        </div>
    )
}

function SectionLabel({ children }: { children: string }) {
    return (
        <p className="text-[11px] font-bold tracking-wider uppercase mb-3" style={{ color: "var(--theme-subtext-color)" }}>
            {children}
        </p>
    )
}

function PlaceholderRow({ children }: { children: string }) {
    return (
        <div className="px-4 py-3 text-sm" style={{ color: "var(--theme-subtext-color)" }}>
            {children}
        </div>
    )
}

function TimelineRow({ item, isCurrent }: { item: ItineraryItem; isCurrent?: boolean }) {
    return (
        <div
            className="flex items-start gap-3 px-4 py-3 border-b last:border-0"
            style={{
                borderColor: "var(--theme-border)",
                background: isCurrent ? "color-mix(in oklch, var(--theme-text-contrast) 8%, transparent)" : undefined,
            }}
        >
            <span
                className="text-xs font-mono w-14 shrink-0 pt-0.5"
                style={{ color: isCurrent ? "var(--theme-text-contrast)" : "var(--theme-subtext-color)" }}
            >
                {formatIso(item.dt)}
            </span>
            <div className="flex flex-col gap-0.5 min-w-0">
                <span className="text-sm font-medium" style={{ color: isCurrent ? "var(--theme-text-contrast)" : "var(--theme-text)" }}>
                    {item.label}
                </span>
                {item.detail && (
                    <span className="text-xs" style={{ color: "var(--theme-subtext-color)" }}>{item.detail}</span>
                )}
            </div>
            {isCurrent && (
                <span
                    className="ml-auto shrink-0 text-[10px] font-bold tracking-wide px-1.5 py-0.5 rounded"
                    style={{
                        background: "color-mix(in oklch, var(--theme-text-contrast) 15%, transparent)",
                        color: "var(--theme-text-contrast)",
                    }}
                >
                    NOW
                </span>
            )}
        </div>
    )
}

function NextMatchCard({ match }: { match: TBAMatch }) {
    const alliance  = getAlliance(match, TEAM_KEY)!
    const partners  = match.alliances[alliance].team_keys.filter(k => k !== TEAM_KEY)
    const opponents = match.alliances[alliance === "red" ? "blue" : "red"].team_keys

    return (
        <div
            className="rounded-xl border-2 px-4 py-3 flex flex-col gap-3"
            style={{ background: "var(--theme-bg)", borderColor: alliance === "red" ? "#ef4444" : "#3b82f6" }}
        >
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                    <span className="text-xs font-bold px-2 py-0.5 rounded" style={{
                        background: alliance === "red" ? "#ef444422" : "#3b82f622",
                        color:      alliance === "red" ? "#ef4444"   : "#3b82f6",
                    }}>
                        {alliance.toUpperCase()}
                    </span>
                    <span className="text-sm font-bold" style={{ color: "var(--theme-text)" }}>{matchLabel(match)}</span>
                </div>
                <span className="text-sm" style={{ color: "var(--theme-subtext-color)" }}>
                    {formatUnix(match.predicted_time ?? match.scheduled_time)}
                </span>
            </div>
            <div className="grid grid-cols-2 gap-3 text-sm">
                <div>
                    <p className="text-[10px] font-bold tracking-wider uppercase mb-1.5" style={{ color: "var(--theme-subtext-color)" }}>Allies</p>
                    <p className="font-medium" style={{ color: "var(--theme-text-contrast)" }}>3473</p>
                    {partners.map(k => <p key={k} style={{ color: "var(--theme-subtext-color)" }}>{k.replace("frc", "")}</p>)}
                </div>
                <div>
                    <p className="text-[10px] font-bold tracking-wider uppercase mb-1.5" style={{ color: "var(--theme-subtext-color)" }}>Opponents</p>
                    {opponents.map(k => <p key={k} style={{ color: "var(--theme-subtext-color)" }}>{k.replace("frc", "")}</p>)}
                </div>
            </div>
        </div>
    )
}

type WatchEntry = { team: string; match: TBAMatch | null; isSister: boolean }

function WatchRow({ entries }: { entries: WatchEntry[] }) {
    const match = entries[0].match
    return (
        <div
            className="flex items-center gap-3 px-4 py-2.5 border-b last:border-0 text-sm"
            style={{ borderColor: "var(--theme-border)" }}
        >
            {/* Qual label */}
            <span className="w-14 shrink-0 font-medium" style={{ color: "var(--theme-text)" }}>
                {match ? matchLabel(match) : "Done"}
            </span>

            {/* Teams with side dot */}
            <div className="flex flex-wrap gap-x-3 gap-y-1 flex-1 min-w-0">
                {entries.map(({ team, isSister }) => {
                    const side = match ? getAlliance(match, team) : null
                    return (
                        <span key={team} className="flex items-center gap-1.5">
                            <span
                                className="w-1.5 h-1.5 rounded-full shrink-0"
                                style={{ background: side === "red" ? "#ef4444" : side === "blue" ? "#3b82f6" : "var(--theme-border)" }}
                            />
                            <span
                                className="font-medium"
                                style={{ color: isSister ? "var(--theme-text-contrast)" : "var(--theme-text)" }}
                            >
                                {team.replace("frc", "")}
                            </span>
                        </span>
                    )
                })}
            </div>

            {/* Time */}
            <span className="shrink-0" style={{ color: "var(--theme-subtext-color)" }}>
                {match ? formatUnix(match.predicted_time ?? match.scheduled_time) : "—"}
            </span>
        </div>
    )
}

function LinkIcon({ label, favicon, href }: { label: string; favicon: string; href: string }) {
    const [imgFailed, setImgFailed] = useState(false)
    return (
        <a
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={label}
            className="flex items-center justify-center w-14 h-14 rounded-2xl border transition-opacity hover:opacity-70"
            style={{ background: "var(--theme-bg)", borderColor: "var(--theme-border)" }}
        >
            {imgFailed ? (
                <span className="text-xs font-bold" style={{ color: "var(--theme-subtext-color)" }}>{label[0]}</span>
            ) : (
                <img src={favicon} alt={label} className="w-8 h-8 object-contain" onError={() => setImgFailed(true)} />
            )}
        </a>
    )
}
