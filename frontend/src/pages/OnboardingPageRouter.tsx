import { useEffect, useState } from "react"
import { useNavigate } from "react-router-dom"
import { useAuth } from "@/contexts/authContext.tsx"
import { useAppReady } from "@/contexts/appReadyContext.tsx"
import { ROLES_WITHOUT_SCHOOL_INFO } from "@/lib/Roles"
import OnboardingPageDesktop from "./OnboardingPageDesktop"
import OnboardingPageMobile from "./OnboardingPageMobile"

const API = import.meta.env.VITE_BACKEND_URL

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

export interface OnboardingPageProps {
    season: SeasonInfo | null
    displayName: string
    setDisplayName: (v: string) => void
    selectedRole: string | null
    setSelectedRole: (v: string | null) => void
    selectedGrade: string | null
    setSelectedGrade: (v: string | null) => void
    selectedTeamYear: string | null
    setSelectedTeamYear: (v: string | null) => void
    submitting: boolean
    error: string | null
    setError: (v: string | null) => void
    needsSchoolInfo: boolean
    handleSubmit: (e: React.FormEvent) => void
    handleSignOut: () => void
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

/* ── Hooks ───────────────────────────────────────────────────── */
function useThemeSeasonInfo(): SeasonInfo | null {
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

function useIsMobile(): boolean {
    const [isMobile, setIsMobile] = useState(() => window.innerWidth < 768)

    useEffect(() => {
        const handler = () => setIsMobile(window.innerWidth < 768)
        window.addEventListener("resize", handler)
        return () => window.removeEventListener("resize", handler)
    }, [])

    return isMobile
}

/* ── Router ──────────────────────────────────────────────────── */
export default function OnboardingPageRouter() {
    const { user, loading, refreshUser, logout } = useAuth()
    const navigate  = useNavigate()
    const markReady = useAppReady()
    const season    = useThemeSeasonInfo()
    const isMobile  = useIsMobile()

    const [displayName,      setDisplayName]     = useState("")
    const [selectedRole,     setSelectedRole]     = useState<string | null>(null)
    const [selectedGrade,    setSelectedGrade]    = useState<string | null>(null)
    const [selectedTeamYear, setSelectedTeamYear] = useState<string | null>(null)
    const [submitting,       setSubmitting]       = useState(false)
    const [error,            setError]            = useState<string | null>(null)

    const needsSchoolInfo = selectedRole !== null && !ROLES_WITHOUT_SCHOOL_INFO.has(selectedRole)

    useEffect(() => { markReady() }, [])

    useEffect(() => {
        if (!loading) {
            if (!user) {
                navigate("/", { replace: true })
            } else if (user.onboarding_complete) {
                navigate("/dashboard", { replace: true })
            } else if (user.given_name && !displayName) {
                setDisplayName(user.given_name)
            }
        }
    }, [user, loading])

    async function handleSubmit(e: React.FormEvent) {
        e.preventDefault()
        const name = displayName.trim()
        if (!name)                                { setError("Please enter your name.");                    return }
        if (!selectedRole)                        { setError("Please select your role.");                   return }
        if (needsSchoolInfo && !selectedGrade)    { setError("Please select your grade.");                 return }
        if (needsSchoolInfo && !selectedTeamYear) { setError("Please select your year on Team Sprocket."); return }

        setSubmitting(true)
        setError(null)
        try {
            const res = await fetch(`${API}/auth/onboarding`, {
                method: "POST",
                credentials: "include",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    display_name: name,
                    role:      selectedRole,
                    grade:     needsSchoolInfo ? selectedGrade     : null,
                    team_year: needsSchoolInfo ? selectedTeamYear  : null,
                }),
            })
            if (!res.ok) {
                const data = await res.json().catch(() => ({}))
                throw new Error(data?.detail ?? "Something went wrong")
            }
            await refreshUser()
            navigate("/dashboard", { replace: true })
        } catch (err: unknown) {
            setError(err instanceof Error ? err.message : "Something went wrong")
        } finally {
            setSubmitting(false)
        }
    }

    async function handleSignOut() {
        await logout()
        navigate("/", { replace: true })
    }

    if (loading) return null

    const props: OnboardingPageProps = {
        season,
        displayName,      setDisplayName,
        selectedRole,     setSelectedRole,
        selectedGrade,    setSelectedGrade,
        selectedTeamYear, setSelectedTeamYear,
        submitting,
        error,            setError,
        needsSchoolInfo,
        handleSubmit,
        handleSignOut,
    }

    return isMobile
        ? <OnboardingPageMobile  {...props} />
        : <OnboardingPageDesktop {...props} />
}