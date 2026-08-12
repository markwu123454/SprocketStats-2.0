import { useEffect, useState } from "react"
import { useNavigate } from "react-router-dom"
import { useAuth } from "@/contexts/authContext"
import { useAppReady } from "@/contexts/appReadyContext"
import type { RoleCatalogEntry } from "@/lib/permissions"
import { useIsMobile } from "@/lib/useIsMobile"
import { useThemeSeasonInfo, type SeasonInfo } from "@/lib/seasonTheme"
// Temporarily unused -- subscribeToPush() call below is disabled.
// import { subscribeToPush } from "@/lib/push.ts"
import OnboardingPageDesktop from "./OnboardingPageDesktop"
import OnboardingPageMobile from "./OnboardingPageMobile"

const API = import.meta.env.VITE_BACKEND_URL

export type { SeasonInfo }

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
    roleCatalog: RoleCatalogEntry[]
    handleSubmit: (e: React.FormEvent) => void
    handleSignOut: () => void
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
    const [roleCatalog,      setRoleCatalog]      = useState<RoleCatalogEntry[]>([])

    // The role catalog (labels + school-info rule for every role) is owned by the
    // backend; fetch it for the picker since the user has no role yet.
    useEffect(() => {
        let cancelled = false
        fetch(`${API}/auth/roles`, { credentials: "include" })
            .then(r => (r.ok ? r.json() : []))
            .then((data: RoleCatalogEntry[]) => { if (!cancelled) setRoleCatalog(data) })
            .catch(() => {})
        return () => { cancelled = true }
    }, [])

    // Whether the chosen role requires grade/team-year, per the backend catalog.
    // Defaults to true until the catalog loads (a role can't be picked before then).
    const needsSchoolInfo =
        selectedRole !== null &&
        (roleCatalog.find(r => r.value === selectedRole)?.school_info_required ?? true)

    useEffect(() => { markReady() }, [markReady])

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
    }, [user, loading, displayName, navigate])

    async function handleSubmit(e: React.FormEvent) {
        e.preventDefault()
        const name = displayName.trim()
        if (!name)                                { setError("Please enter your name.");                    return }
        if (!selectedRole)                        { setError("Please select your role.");                   return }
        if (needsSchoolInfo && !selectedGrade)    { setError("Please select your grade.");                 return }
        if (needsSchoolInfo && !selectedTeamYear) { setError("Please select your year on Team Sprocket."); return }

        setSubmitting(true)
        setError(null)

        // Best-effort, using this click's user gesture -- browsers require the
        // permission prompt to originate from a direct interaction, and this is
        // the last click before the user lands on the dashboard. Never blocks
        // onboarding: unsupported browsers, a denied prompt, or any subscribe
        // failure are swallowed, since the user can still enable push later
        // from Settings.
        // Temporarily disabled -- button now just says "Continue".
        // try {
        //     await subscribeToPush()
        // } catch {
        //     // ignore
        // }

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
        roleCatalog,
        handleSubmit,
        handleSignOut,
    }

    return isMobile
        ? <OnboardingPageMobile  {...props} />
        : <OnboardingPageDesktop {...props} />
}