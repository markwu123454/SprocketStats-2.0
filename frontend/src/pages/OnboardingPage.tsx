import {useState, useEffect, useRef} from "react"
import {useNavigate} from "react-router-dom"
import {useAuth} from "@/contexts/authContext.tsx"
import {useAppReady} from "@/contexts/appReadyContext.tsx"
import {ChevronRight, ChevronDown, Check} from "lucide-react"

const API = import.meta.env.VITE_BACKEND_URL

/* ── Theme → season metadata map ────────────────────────────── */
const THEME_SEASONS: Record<string, { year: number; phase: string; label: string; dateRange: string }> = {
    "theme-2025": { year: 2025, phase: "REEFSCAPE",  label: "Reefscape",          dateRange: "2025 · DIVE" },
    "theme-2026": { year: 2026, phase: "REBUILT",    label: "Rebuilt",            dateRange: "2026 · AGE" },
    "theme-2027": { year: 2027, phase: "BIOCORE",    label: "Biocore",            dateRange: "2027 · CANOPY" },
}

function getActiveTheme(): string {
    for (const key of Object.keys(THEME_SEASONS)) {
        if (document.documentElement.classList.contains(key) || document.body.classList.contains(key)) {
            return key
        }
    }
    return "theme-2027" // fallback
}

interface SeasonInfo {
    phase: string
    label: string
    dateRange: string
    wordmarkUrl: string
}

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

function useThemeSeasonInfo(): SeasonInfo | null {
    const [season, setSeason] = useState<SeasonInfo | null>(null)

    useEffect(() => {
        setSeason(getSeasonFromTheme())

        const observer = new MutationObserver(() => {
            setSeason(getSeasonFromTheme())
        })

        observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] })
        observer.observe(document.body,            { attributes: true, attributeFilter: ["class"] })

        return () => observer.disconnect()
    }, [])

    return season
}

/* ── Season wordmark — fetched & inlined so currentColor works ─ */
function SeasonWordmark({ url, label }: { url: string; label: string }) {
    const [svg, setSvg] = useState<string | null>(null)

    useEffect(() => {
        if (!url) return
        let cancelled = false
        fetch(url)
            .then(r => r.text())
            .then(text => { if (!cancelled) setSvg(text) })
            .catch(() => {})
        return () => { cancelled = true }
    }, [url])

    if (!svg) return null

    return (
        <div
            role="img"
            aria-label={label}
            className="theme-h1-color"
            style={{
                width: "min(480px, 100%)",
                height: "94px",
                display: "flex",
                alignItems: "center",
            }}
            dangerouslySetInnerHTML={{
                __html: svg.replace(
                    /<svg /,
                    '<svg style="height:100%;width:auto;max-width:100%;display:block;" '
                ),
            }}
        />
    )
}

/* ── Role definitions ───────────────────────────────────────── */
const SUBGROUPS = [
    "CAD",
    "Manufacturing",
    "Programming",
    "Scouting",
    "Publicity",
    "Operations",
    "Outreach",
] as const

const STANDALONE_ROLES = [
    {value: "captain", label: "Captain"},
    {value: "mentor", label: "Mentor"},
    {value: "alumni", label: "Alumni"},
] as const

function toRoleValue(subgroup: string, tier: "member" | "lead"): string {
    return `${subgroup.toLowerCase()}_${tier}`
}

function formatRole(role: string): string {
    if (role === "captain" || role === "mentor" || role === "alumni") {
        return role.charAt(0).toUpperCase() + role.slice(1)
    }
    const [sub, tier] = role.split("_")
    return `${sub.charAt(0).toUpperCase() + sub.slice(1)} ${tier.charAt(0).toUpperCase() + tier.slice(1)}`
}

/* Flat option list for the dropdown — no categories, just stacked */
interface RoleOption { value: string; label: string }

const ROLE_OPTIONS: RoleOption[] = [
    ...SUBGROUPS.flatMap(sub =>
        (["member", "lead"] as const).map(tier => ({
            value: toRoleValue(sub, tier),
            label: `${sub} ${tier.charAt(0).toUpperCase() + tier.slice(1)}`,
        }))
    ),
    ...STANDALONE_ROLES.map(r => ({ value: r.value, label: r.label })),
]

/* ── Grade / team-year options ───────────────────────────────── */
const GRADE_OPTIONS = [
    { value: "freshman",  label: "Freshman"  },
    { value: "sophomore", label: "Sophomore" },
    { value: "junior",    label: "Junior"    },
    { value: "senior",    label: "Senior"    },
]

const TEAM_YEAR_OPTIONS = [
    { value: "year_1", label: "Year 1" },
    { value: "year_2", label: "Year 2" },
    { value: "year_3", label: "Year 3" },
    { value: "year_4", label: "Year 4" },
]

/* ── Generic simple dropdown ─────────────────────────────────── */
interface SimpleOption { value: string; label: string }

function SimpleDropdown({
                            value,
                            onChange,
                            placeholder,
                            options,
                        }: {
    value: string | null
    onChange: (v: string) => void
    placeholder: string
    options: SimpleOption[]
}) {
    const [open, setOpen] = useState(false)
    const [dropUp, setDropUp] = useState(false)
    const rootRef = useRef<HTMLDivElement>(null)
    const btnRef = useRef<HTMLButtonElement>(null)

    const MENU_MAX = 180

    useEffect(() => {
        if (!open) return
        const onDoc = (e: MouseEvent) => {
            if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false)
        }
        const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false) }
        document.addEventListener("mousedown", onDoc)
        document.addEventListener("keydown", onKey)
        return () => {
            document.removeEventListener("mousedown", onDoc)
            document.removeEventListener("keydown", onKey)
        }
    }, [open])

    function handleToggle() {
        setOpen(prev => {
            const next = !prev
            if (next && btnRef.current) {
                const rect = btnRef.current.getBoundingClientRect()
                const below = window.innerHeight - rect.bottom
                const above = rect.top
                setDropUp(below < MENU_MAX && above > below)
            }
            return next
        })
    }

    const selected = options.find(o => o.value === value)

    return (
        <div ref={rootRef} style={{ position: "relative" }}>
            <button
                ref={btnRef}
                type="button"
                onClick={handleToggle}
                aria-haspopup="listbox"
                aria-expanded={open}
                className={[
                    "w-full flex items-center justify-between rounded-lg border px-3 py-2.5 text-sm outline-none focus:ring-2 transition theme-bg theme-border",
                    selected ? "theme-text" : "theme-subtext-color",
                ].join(" ")}
            >
                <span>{selected ? selected.label : placeholder}</span>
                <ChevronDown
                    size={16}
                    className="theme-subtext-color shrink-0"
                    style={{ transition: "transform .18s ease", transform: open ? "rotate(180deg)" : "none" }}
                />
            </button>

            {open && (
                <div
                    role="listbox"
                    className="absolute left-0 right-0 z-50 rounded-lg border overflow-y-auto theme-bg theme-border theme-scrollbar"
                    style={{
                        maxHeight: MENU_MAX,
                        boxShadow: "0 12px 32px -10px rgba(0,0,0,.45)",
                        ...(dropUp ? { bottom: "calc(100% + 8px)" } : { top: "calc(100% + 8px)" }),
                    }}
                >
                    {options.map(opt => {
                        const active = value === opt.value
                        return (
                            <button
                                key={opt.value}
                                type="button"
                                role="option"
                                aria-selected={active}
                                onClick={() => { onChange(opt.value); setOpen(false) }}
                                className={[
                                    "w-full flex items-center justify-between px-3 py-2 text-sm text-left transition-colors theme-text",
                                    active ? "theme-button-hover" : "theme-bg hover:theme-button-hover",
                                ].join(" ")}
                            >
                                <span>{opt.label}</span>
                                {active && <Check size={15} className="theme-text-contrast shrink-0" />}
                            </button>
                        )
                    })}
                </div>
            )}
        </div>
    )
}

/* ── Role dropdown component ─────────────────────────────────── */
function RoleDropdown({
                          value,
                          onChange,
                      }: {
    value: string | null
    onChange: (v: string) => void
}) {
    const [open, setOpen] = useState(false)
    const [dropUp, setDropUp] = useState(false)
    const rootRef = useRef<HTMLDivElement>(null)
    const btnRef = useRef<HTMLButtonElement>(null)

    const MENU_MAX = 220

    useEffect(() => {
        if (!open) return
        const onDoc = (e: MouseEvent) => {
            if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
                setOpen(false)
            }
        }
        const onKey = (e: KeyboardEvent) => {
            if (e.key === "Escape") setOpen(false)
        }
        document.addEventListener("mousedown", onDoc)
        document.addEventListener("keydown", onKey)
        return () => {
            document.removeEventListener("mousedown", onDoc)
            document.removeEventListener("keydown", onKey)
        }
    }, [open])

    // Decide whether to open upward: if the space below the trigger
    // is smaller than the space above (and too small for the menu),
    // flip it up so it never pushes the panel into overflow.
    function handleToggle() {
        setOpen(prev => {
            const next = !prev
            if (next && btnRef.current) {
                const rect = btnRef.current.getBoundingClientRect()
                const below = window.innerHeight - rect.bottom
                const above = rect.top
                setDropUp(below < MENU_MAX && above > below)
            }
            return next
        })
    }

    return (
        <div ref={rootRef} style={{ position: "relative" }}>
            <button
                ref={btnRef}
                type="button"
                onClick={handleToggle}
                aria-haspopup="listbox"
                aria-expanded={open}
                className={[
                    "w-full flex items-center justify-between rounded-lg border px-3 py-2.5 text-sm outline-none focus:ring-2 transition theme-bg theme-border",
                    value ? "theme-text" : "theme-subtext-color",
                ].join(" ")}
            >
                <span>{value ? formatRole(value) : "Select your role…"}</span>
                <ChevronDown
                    size={16}
                    className="theme-subtext-color shrink-0"
                    style={{
                        transition: "transform .18s ease",
                        transform: open ? "rotate(180deg)" : "none",
                    }}
                />
            </button>

            {open && (
                <div
                    role="listbox"
                    className="absolute left-0 right-0 z-50 rounded-lg border overflow-y-auto theme-bg theme-border theme-scrollbar"
                    style={{
                        maxHeight: MENU_MAX,
                        boxShadow: "0 12px 32px -10px rgba(0,0,0,.45)",
                        ...(dropUp
                            ? { bottom: "calc(100% + 8px)" }
                            : { top: "calc(100% + 8px)" }),
                    }}
                >
                    {ROLE_OPTIONS.map(opt => {
                        const active = value === opt.value
                        return (
                            <button
                                key={opt.value}
                                type="button"
                                role="option"
                                aria-selected={active}
                                onClick={() => {
                                    onChange(opt.value)
                                    setOpen(false)
                                }}
                                className={[
                                    "w-full flex items-center justify-between px-3 py-2 text-sm text-left transition-colors theme-text",
                                    active ? "theme-button-hover" : "theme-bg hover:theme-button-hover",
                                ].join(" ")}
                            >
                                <span>{opt.label}</span>
                                {active && (
                                    <Check
                                        size={15}
                                        className="theme-text-contrast shrink-0"
                                    />
                                )}
                            </button>
                        )
                    })}
                </div>
            )}
        </div>
    )
}

/* ════════════════════════════════════════════════════════════════
   OnboardingPage — split-hero layout matching LoginPage
   ════════════════════════════════════════════════════════════════ */
const ROLES_WITHOUT_SCHOOL_INFO = new Set(["alumni", "mentor"])

export default function OnboardingPage() {
    const {user, loading, refreshUser, logout} = useAuth()
    const navigate = useNavigate()
    const markReady = useAppReady()
    const season = useThemeSeasonInfo()

    const [displayName, setDisplayName] = useState("")
    const [selectedRole, setSelectedRole] = useState<string | null>(null)
    const [selectedGrade, setSelectedGrade] = useState<string | null>(null)
    const [selectedTeamYear, setSelectedTeamYear] = useState<string | null>(null)
    const [submitting, setSubmitting] = useState(false)
    const [error, setError] = useState<string | null>(null)

    const needsSchoolInfo = selectedRole !== null && !ROLES_WITHOUT_SCHOOL_INFO.has(selectedRole)

    useEffect(() => {
        markReady()
    }, [])

    // Lock document scroll while this full-screen page is mounted so
    // the body can't rubber-band / scroll behind the fixed root.
    useEffect(() => {
        const html = document.documentElement
        const body = document.body
        const prev = {
            htmlOverflow: html.style.overflow,
            bodyOverflow: body.style.overflow,
            bodyOverscroll: body.style.overscrollBehavior,
            bodyHeight: body.style.height,
        }
        html.style.overflow = "hidden"
        body.style.overflow = "hidden"
        body.style.overscrollBehavior = "none"
        body.style.height = "100%"
        return () => {
            html.style.overflow = prev.htmlOverflow
            body.style.overflow = prev.bodyOverflow
            body.style.overscrollBehavior = prev.bodyOverscroll
            body.style.height = prev.bodyHeight
        }
    }, [])

    useEffect(() => {
        if (!loading) {
            if (!user) {
                navigate("/", {replace: true})
            } else if (user.onboarding_complete) {
                navigate("/dashboard", {replace: true})
            } else if (user.given_name && !displayName) {
                setDisplayName(user.given_name)
            }
        }
    }, [user, loading])

    async function handleSubmit(e: React.FormEvent) {
        e.preventDefault()
        const name = displayName.trim()
        if (!name) {
            setError("Please enter your name.")
            return
        }
        if (!selectedRole) {
            setError("Please select your role.")
            return
        }
        if (needsSchoolInfo && !selectedGrade) {
            setError("Please select your grade.")
            return
        }
        if (needsSchoolInfo && !selectedTeamYear) {
            setError("Please select your year on Team Sprocket.")
            return
        }
        setSubmitting(true)
        setError(null)
        try {
            const res = await fetch(`${API}/auth/onboarding`, {
                method: "POST",
                credentials: "include",
                headers: {"Content-Type": "application/json"},
                body: JSON.stringify({
                    display_name: name,
                    role: selectedRole,
                    grade: needsSchoolInfo ? selectedGrade : null,
                    team_year: needsSchoolInfo ? selectedTeamYear : null,
                }),
            })
            if (!res.ok) {
                const data = await res.json().catch(() => ({}))
                throw new Error(data?.detail ?? "Something went wrong")
            }
            await refreshUser()
            navigate("/dashboard", {replace: true})
        } catch (err: unknown) {
            setError(err instanceof Error ? err.message : "Something went wrong")
        } finally {
            setSubmitting(false)
        }
    }

    if (loading) return null

    return (
        <div
            className="onb-root grid"
            style={{
                gridTemplateColumns: "1.05fr 0.95fr",
                height: "100vh",
            }}
        >
            <style>{`
                @media (min-width: 768px) {
                    .onb-root {
                        grid-template-columns: 1.05fr 0.95fr !important;
                        grid-template-rows: 1fr !important;
                    }
                    .onb-aside {
                        position: relative !important;
                        height: auto !important;
                    }
                    .onb-section {
                        position: relative !important;
                        border-radius: 0 !important;
                        border-left: 1px solid var(--theme-border) !important;
                        border-top: none !important;
                        margin-top: 0 !important;
                        padding: 28px 56px !important;
                        overflow-y: auto !important;
                    }
                }
                @media (max-width: 767px) {
                    .onb-root {
                        display: flex !important;
                        flex-direction: column !important;
                        position: fixed !important;
                        top: 0 !important;
                        left: 0 !important;
                        right: 0 !important;
                        bottom: 0 !important;
                        height: 100dvh !important;
                        max-height: 100dvh !important;
                        overflow: hidden !important;
                        overscroll-behavior: none !important;
                    }
                    /* Top 25% — background art, condensed text */
                    .onb-aside {
                        flex: 0 0 25% !important;
                        height: 25% !important;
                        min-height: 0 !important;
                    }
                    .onb-bg-image,
                    .onb-bg-scrim {
                        position: absolute !important;
                        inset: 0 !important;
                    }
                    /* Bottom 75% — the form panel, flush straight
                       boundary against the art (no rounded sheet). */
                    .onb-section {
                        flex: 0 0 75% !important;
                        height: 75% !important;
                        display: flex !important;
                        flex-direction: column !important;
                        border-radius: 0 !important;
                        border-left: none !important;
                        border-top: 1px solid var(--theme-border) !important;
                        padding: 24px 22px calc(22px + env(safe-area-inset-bottom, 0px)) !important;
                        margin-top: 0 !important;
                        z-index: 10 !important;
                        overflow-y: auto !important;
                    }
                    .onb-hero-content {
                        padding: 14px 18px !important;
                        gap: 6px !important;
                    }
                    .onb-hero-tagline {
                        display: none !important;
                    }
                    .onb-wordmark-wrap {
                        transform: scale(0.5) !important;
                        transform-origin: left bottom !important;
                    }
                    .onb-logo-row {
                        display: flex !important;
                    }
                }
            `}</style>

            {/* ══ LEFT / TOP — split-art ══ */}
            <aside className="onb-aside relative overflow-hidden theme-h1-color">
                <div
                    className="onb-bg-image absolute inset-0 theme-bg-page"
                    style={{
                        backgroundPosition: "center",
                        zIndex: 0,
                    }}
                />

                <div
                    className="onb-bg-scrim absolute inset-0"
                    style={{
                        zIndex: 1,
                        background: `linear-gradient(180deg,
                            color-mix(in oklch, var(--theme-button-bg) 30%, transparent) 0%,
                            color-mix(in oklch, var(--theme-button-bg) 70%, transparent) 100%)`,
                    }}
                />

                <div
                    className="onb-hero-content absolute inset-0 flex flex-col items-start justify-end gap-[18px] p-11"
                    style={{ zIndex: 2 }}
                >
                    <span
                        className="inline-block text-[11px] uppercase leading-none px-2.5 py-1 rounded-full border theme-text-contrast theme-border theme-bg"
                        style={{
                            fontFamily: "'JetBrains Mono', ui-monospace, monospace",
                            letterSpacing: "0.18em",
                            backdropFilter: "blur(8px)",
                            WebkitBackdropFilter: "blur(8px)",
                        }}
                    >
                        {season?.phase ?? "SEASON"}
                    </span>

                    {/* Presented by label + season wordmark */}
                    <span
                        className="inline-block text-[10px] uppercase leading-none opacity-60 theme-h1-color"
                        style={{
                            fontFamily: "'JetBrains Mono', ui-monospace, monospace",
                            letterSpacing: "0.18em",
                        }}
                    >
                        Presented by HAAS
                    </span>

                    {/* Wordmark wrapper — relative so TM sits at bottom-right */}
                    <div className="onb-wordmark-wrap" style={{ position: "relative", display: "inline-flex" }}>
                        <SeasonWordmark
                            url={season?.wordmarkUrl ?? ""}
                            label={season?.label ?? "SprocketStats"}
                        />
                        <sup
                            aria-label="trademark"
                            className="theme-h1-color"
                            style={{
                                position: "absolute",
                                bottom: 0,
                                right: "-14px",
                                fontSize: "10px",
                                lineHeight: 1,
                                fontFamily: "'Inter', sans-serif",
                                fontWeight: 500,
                            }}
                        >
                            ™
                        </sup>
                    </div>

                    <p
                        className="onb-hero-tagline m-0 max-w-[32ch] opacity-[0.92] theme-h1-color"
                        style={{
                            fontFamily: "'Space Grotesk', 'Inter', sans-serif",
                            fontSize: "16px",
                            lineHeight: 1.5,
                        }}
                    >
                        Let's get your profile set up.
                    </p>
                </div>
            </aside>

            {/* ══ RIGHT / BOTTOM — form ══ */}
            <section
                className="onb-section relative border-l theme-button-bg theme-border"
                style={{
                    padding: "28px 56px",
                }}
            >
                {/* Logo row */}
                <div className="onb-logo-row flex items-center gap-2.5 theme-h1-color">
                    <div
                        style={{
                            width: 36,
                            height: 36,
                            flexShrink: 0,
                            backgroundColor: "var(--theme-h1-color)",
                            mask: "url(/sprocket_logo_gear.svg) center/contain no-repeat",
                            WebkitMask: "url(/sprocket_logo_gear.svg) center/contain no-repeat",
                        }}
                    />
                    <span
                        className="font-semibold text-[15px] theme-h1-color"
                        style={{
                            letterSpacing: "0.01em",
                            lineHeight: 1,
                        }}
                    >
                        SprocketStats
                    </span>
                </div>

                <div className="self-center w-full max-w-[400px] mx-auto my-auto py-6">
                    <div className="mb-6">
                        <h1
                            className="m-0 mb-1.5 font-semibold theme-h1-color"
                            style={{
                                fontFamily: "'Space Grotesk', 'Inter', sans-serif",
                                fontSize: "32px",
                                letterSpacing: "-0.01em",
                            }}
                        >
                            Welcome aboard
                        </h1>
                        <p className="m-0 text-[14px] theme-subtext-color">
                            Let's set up your profile before we get started.
                        </p>
                    </div>

                    <form onSubmit={handleSubmit} className="flex flex-col gap-5">
                        {/* Name input */}
                        <div className="flex flex-col gap-2">
                            <label className="text-sm font-semibold theme-h1-color">
                                What should we call you?
                            </label>
                            <input
                                type="text"
                                value={displayName}
                                onChange={e => setDisplayName(e.target.value)}
                                placeholder="Your name"
                                maxLength={64}
                                className="w-full rounded-lg border px-3 py-2.5 text-sm outline-none focus:ring-2 transition theme-bg theme-border theme-text"
                            />
                        </div>

                        {/* Role dropdown */}
                        <div className="flex flex-col gap-2">
                            <label className="text-sm font-semibold theme-h1-color">
                                What's your role on Team Sprocket?
                            </label>
                            <RoleDropdown
                                value={selectedRole}
                                onChange={v => {
                                    setSelectedRole(v)
                                    if (ROLES_WITHOUT_SCHOOL_INFO.has(v)) {
                                        setSelectedGrade(null)
                                        setSelectedTeamYear(null)
                                    }
                                    setError(null)
                                }}
                            />
                        </div>

                        {/* Grade dropdown — hidden for alumni / mentor */}
                        {needsSchoolInfo && (
                            <div className="flex flex-col gap-2">
                                <label className="text-sm font-semibold theme-h1-color">
                                    What grade are you in?
                                </label>
                                <SimpleDropdown
                                    value={selectedGrade}
                                    onChange={v => { setSelectedGrade(v); setError(null) }}
                                    placeholder="Select your grade…"
                                    options={GRADE_OPTIONS}
                                />
                            </div>
                        )}

                        {/* Team year dropdown — hidden for alumni / mentor */}
                        {needsSchoolInfo && (
                            <div className="flex flex-col gap-2">
                                <label className="text-sm font-semibold theme-h1-color">
                                    What year are you on Team Sprocket?
                                </label>
                                <SimpleDropdown
                                    value={selectedTeamYear}
                                    onChange={v => { setSelectedTeamYear(v); setError(null) }}
                                    placeholder="Select your year…"
                                    options={TEAM_YEAR_OPTIONS}
                                />
                            </div>
                        )}

                        {error && (
                            <p className="text-sm text-red-500 text-center -mt-1">{error}</p>
                        )}

                        <button
                            type="submit"
                            disabled={
                                submitting ||
                                !selectedRole ||
                                !displayName.trim() ||
                                (needsSchoolInfo && (!selectedGrade || !selectedTeamYear))
                            }
                            className="w-full flex items-center justify-center gap-2 mt-1 rounded-xl border font-semibold text-sm transition-opacity disabled:opacity-40 theme-bg theme-border theme-text-contrast"
                            style={{ height: "52px" }}
                        >
                            {submitting ? "Saving…" : "Get Started"}
                            {!submitting && <ChevronRight size={16}/>}
                        </button>
                    </form>

                    <button
                        type="button"
                        onClick={async () => { await logout(); navigate("/", {replace: true}) }}
                        className="w-full mt-4 text-sm theme-subtext-color hover:theme-text transition-colors text-center"
                    >
                        Sign out and go back
                    </button>
                </div>
            </section>
        </div>
    )
}

export {formatRole}