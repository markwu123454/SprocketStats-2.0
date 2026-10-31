import { useState } from "react"
import { Link } from "react-router-dom"
import { ChevronRight } from "lucide-react"
import { useEventContext } from "@/contexts/eventContext"
import type { TBAMatch, ItineraryItem } from "@/lib/eventApi"
import { getAlliance, matchLabel, formatUnix, nextMatchFor, TEAM_KEY } from "@/lib/eventMatches"
import { tintColor } from "@/lib/taskFormat"
import { typeH2 } from "@/lib/uiClasses"

// FRC alliance red / blue are fixed by the game, not theme roles -- they must read
// the same in every season.
const ALLIANCE_RED  = "#ef4444"
const ALLIANCE_BLUE = "#3b82f6"

const SISTER_TEAMS  = ["frc968", "frc3476", "frc5857", "frc7157"]
const NOTABLE_TEAMS = ["frc4414", "frc5199", "frc6995"]

const SERVICES = [
    { key: "tba"        as const, label: "The Blue Alliance", favicon: "https://www.thebluealliance.com/favicon.ico"  },
    { key: "statbotics" as const, label: "Statbotics",         favicon: "https://www.statbotics.io/favicon.ico"       },
    { key: "nexus"      as const, label: "FRC Nexus",          favicon: "https://frc.nexus/en/assets/images/icon.svg" },
    { key: "youtube"    as const, label: "YouTube",            favicon: "https://www.youtube.com/favicon.ico"         },
    { key: "twitch"     as const, label: "Twitch",             favicon: "https://www.twitch.tv/favicon.ico"           },
]

function formatIso(iso: string): string {
    return new Date(iso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })
}

function getTimelineSlice(items: ItineraryItem[]) {
    const now = Date.now()
    const passed   = items.filter(i => new Date(i.dt).getTime() <= now)
    const upcoming = items.filter(i => new Date(i.dt).getTime() > now)
    return { current: passed[passed.length - 1] ?? null, upcoming: upcoming.slice(0, 2) }
}

export default function EventHubPage() {
    const { info, archived, hiddenTabs, description } = useEventContext()
    const compHidden = hiddenTabs.includes("comp")
    // "Today" is a slice of the itinerary, so it hides along with that tab.
    const itineraryHidden = hiddenTabs.includes("itinerary")

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
    const playedCount = matches.filter(m => getAlliance(m, TEAM_KEY) !== null && (!!m.actual_time || m.alliances.red.score >= 0)).length

    return (
        <div className="max-w-xl mx-auto px-4 py-5 flex flex-col gap-6 pb-8">

            {/* Intro text an editor wrote for this event */}
            {description && (
                <section className="rounded-xl border px-4 py-3" style={cardBase}>
                    <p className="text-sm leading-relaxed whitespace-pre-wrap" style={{ color: "var(--theme-text)" }}>
                        {description}
                    </p>
                </section>
            )}

            {/* Day timeline (live only) */}
            {!archived && !itineraryHidden && <section className="rounded-xl border overflow-hidden" style={cardBase}>
                <SectionLabel>Today</SectionLabel>
                <div className="border-t" style={cardBase}>
                    {timeline && (timeline.current || timeline.upcoming.length > 0) ? (
                        <>
                            {timeline.current && <TimelineRow item={timeline.current} isCurrent />}
                            {timeline.upcoming.map((item, i) => <TimelineRow key={i} item={item} />)}
                        </>
                    ) : (
                        <PlaceholderRow>Schedule not yet posted</PlaceholderRow>
                    )}
                </div>
            </section>}

            {/* Our team -- competition info, so it goes wherever Comp does
                (hidden by an editor, or a non-TBA event like outreach). */}
            {!compHidden && <section className="flex flex-col rounded-xl border overflow-hidden" style={cardBase}>
                <SectionLabel>{archived ? "Final Result" : "Our Team"}</SectionLabel>
                {rankEntry ? (
                    <div className="flex items-center gap-4 px-4 py-3 border-t" style={cardBase}>
                        <span className="text-sm font-semibold" style={{ color: "var(--theme-text)" }}>
                            Rank {rankEntry.rank} / {rankTotal}
                        </span>
                        <span className="text-sm" style={{ color: "var(--theme-subtext-color)" }}>
                            {rankEntry.record.wins}–{rankEntry.record.losses}–{rankEntry.record.ties}
                        </span>
                    </div>
                ) : (
                    <div className="flex items-center px-4 py-3 border-t" style={cardBase}>
                        <span className="text-sm" style={{ color: "var(--theme-subtext-color)" }}>
                            {archived ? "No rankings were posted" : "Rankings not yet available"}
                        </span>
                    </div>
                )}
                {archived ? (
                    <Link
                        to="comp"
                        className="flex items-center justify-between gap-3 px-4 py-3 min-h-11 border-t transition-colors hover:border-(--theme-text-contrast)"
                        style={cardBase}
                    >
                        <span className="text-sm" style={{ color: "var(--theme-text)" }}>
                            {playedCount > 0 ? `${playedCount} match result${playedCount === 1 ? "" : "s"}` : "Match results"}
                        </span>
                        <ChevronRight size={16} className="theme-subtext-color" />
                    </Link>
                ) : ourNext ? (
                    <div className="p-3 border-t" style={cardBase}><NextMatchCard match={ourNext} /></div>
                ) : (
                    <div className="flex items-center px-4 py-3 border-t" style={cardBase}>
                        <span className="text-sm" style={{ color: "var(--theme-subtext-color)" }}>No upcoming match</span>
                    </div>
                )}
            </section>}

            {/* Watch teams (live only -- grouped by each team's next match) */}
            {!archived && !compHidden && <section className="rounded-xl border overflow-hidden" style={cardBase}>
                <SectionLabel>Watch</SectionLabel>
                <div className="border-t" style={cardBase}>
                    {watchGroups.length > 0 ? (
                        watchGroups.map(([matchKey, entries]) => (
                            <WatchRow key={matchKey} entries={entries} />
                        ))
                    ) : (
                        <PlaceholderRow>Match data not yet available</PlaceholderRow>
                    )}
                </div>
            </section>}

            {/* Quick links -- all competition services, so the "not yet
                available" placeholder is only worth showing for a competition. */}
            {(hasLinks || !compHidden) && <section className="rounded-xl border overflow-hidden" style={cardBase}>
                <SectionLabel>Links</SectionLabel>
                {hasLinks ? (
                    <div className="flex gap-3 px-4 pb-4">
                        {SERVICES.map(({ key, label, favicon }) => {
                            const href = links![key]
                            if (!href) return null
                            return <LinkIcon key={key} label={label} favicon={favicon} href={href} />
                        })}
                    </div>
                ) : (
                    <div className="flex items-center px-4 py-3 border-t" style={cardBase}>
                        <span className="text-sm" style={{ color: "var(--theme-subtext-color)" }}>Links not yet available</span>
                    </div>
                )}
            </section>}
        </div>
    )
}

function SectionLabel({ children }: { children: string }) {
    return (
        <h2 className={`${typeH2} theme-subtext-color px-4 pt-3 pb-2`}>{children}</h2>
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
                    className="ml-auto shrink-0 text-xs font-bold tracking-wide px-1.5 py-0.5 rounded-full"
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
            style={{ background: "var(--theme-bg)", borderColor: alliance === "red" ? ALLIANCE_RED : ALLIANCE_BLUE }}
        >
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                    <span className="text-xs font-bold px-2 py-0.5 rounded-full" style={{
                        background: tintColor(alliance === "red" ? ALLIANCE_RED : ALLIANCE_BLUE, 13),
                        color:      alliance === "red" ? ALLIANCE_RED : ALLIANCE_BLUE,
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
                    <p className={`${typeH2} theme-subtext-color mb-1.5`}>Allies</p>
                    <p className="font-medium" style={{ color: "var(--theme-text-contrast)" }}>3473</p>
                    {partners.map(k => <p key={k} style={{ color: "var(--theme-subtext-color)" }}>{k.replace("frc", "")}</p>)}
                </div>
                <div>
                    <p className={`${typeH2} theme-subtext-color mb-1.5`}>Opponents</p>
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
                                style={{ background: side === "red" ? ALLIANCE_RED : side === "blue" ? ALLIANCE_BLUE : "var(--theme-border)" }}
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
