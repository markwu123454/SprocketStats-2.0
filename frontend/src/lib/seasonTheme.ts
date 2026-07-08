import { useEffect, useState } from "react"

/* ── Theme → season metadata map ────────────────────────────── */
const THEME_SEASONS: Record<string, { year: number; phase: string; label: string; dateRange: string }> = {
    "theme-2025": { year: 2025, phase: "REEFSCAPE", label: "Reefscape", dateRange: "2025 · DIVE"   },
    "theme-2026": { year: 2026, phase: "REBUILT",   label: "Rebuilt",   dateRange: "2026 · AGE"    },
    "theme-2027": { year: 2027, phase: "BIOCORE",   label: "Biocore",   dateRange: "2027 · CANOPY" },
}

function getActiveTheme(): string {
    for (const key of Object.keys(THEME_SEASONS)) {
        if (document.documentElement.classList.contains(key) || document.body.classList.contains(key)) {
            return key
        }
    }
    return "theme-2027"
}

/* ── Types ───────────────────────────────────────────────────── */
export interface SeasonInfo {
    phase: string
    label: string
    dateRange: string
    wordmarkUrl: string
}

/* ── Helpers ─────────────────────────────────────────────────── */
function getSeasonFromTheme(): SeasonInfo {
    const themeKey = getActiveTheme()
    const meta = THEME_SEASONS[themeKey]
    return {
        phase:       meta.phase,
        label:       meta.label,
        dateRange:   meta.dateRange,
        wordmarkUrl: `/seasons/${meta.year}/wordmark.svg`,
    }
}

/**
 * Track the active season's metadata, derived from the theme class on
 * `<html>`/`<body>`. Shared so the login/onboarding routers agree on the
 * same source of truth instead of each re-deriving it.
 */
export function useThemeSeasonInfo(): SeasonInfo | null {
    const [season, setSeason] = useState<SeasonInfo | null>(null)

    useEffect(() => {
        setSeason(getSeasonFromTheme())
        const observer = new MutationObserver(() => setSeason(getSeasonFromTheme()))
        observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] })
        observer.observe(document.body,            { attributes: true, attributeFilter: ["class"] })
        return () => observer.disconnect()
    }, [])

    return season
}
