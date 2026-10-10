import type { TBAMatch } from "@/lib/eventApi"

// Our own team's TBA key -- shared by every page that needs to pick "our"
// alliance/matches out of an event's match list (EventHubPage, CompPage,
// the dashboard's active-event card).
export const TEAM_KEY = "frc3473"

export function getAlliance(m: TBAMatch, teamKey: string): "red" | "blue" | null {
    if (m.alliances.red.team_keys.includes(teamKey)) return "red"
    if (m.alliances.blue.team_keys.includes(teamKey)) return "blue"
    return null
}

export function matchLabel(m: TBAMatch): string {
    if (m.comp_level === "qm") return `Qual ${m.match_number}`
    if (m.comp_level === "sf") return `Semi ${m.set_number}M${m.match_number}`
    if (m.comp_level === "f")  return `Final M${m.match_number}`
    return `${m.comp_level} ${m.match_number}`
}

export function formatUnix(unix: number | null): string {
    if (!unix) return "TBD"
    return new Date(unix * 1000).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })
}

export function nextMatchFor(matches: TBAMatch[], teamKey: string): TBAMatch | null {
    const now = Date.now() / 1000
    const sorted = matches
        .filter(m => getAlliance(m, teamKey) !== null && !m.actual_time)
        .filter(m => (m.predicted_time ?? m.scheduled_time ?? 0) > now - 600)
        .sort((a, b) => (a.predicted_time ?? a.scheduled_time ?? 0) - (b.predicted_time ?? b.scheduled_time ?? 0))
    return sorted[0] ?? null
}
