import { useEffect, useRef, useState } from "react"
import { ChevronRight, ChevronDown, Check } from "lucide-react"
import { GRADE_OPTIONS, TEAM_YEAR_OPTIONS } from "@/lib/Roles"
import type { OnboardingPageProps, SeasonInfo } from "@/pages/OnboardingPageRouter"
import { SeasonWordmark, BrandLockup, useScrollLock } from "./LoginShared"

/* ════════════════════════════════════════════════════════════════
   Shared onboarding building blocks
   ----------------------------------------------------------------
   Used by BOTH OnboardingPageDesktop and OnboardingPageMobile. The
   page files own only their layout; the pieces below own the actual
   content so the two surfaces can never drift apart.

   SeasonWordmark / BrandLockup / useScrollLock are byte-identical to
   their login counterparts, so they're reused from LoginShared and
   re-exported here to give the pages a single import source.
   ════════════════════════════════════════════════════════════════ */

export { BrandLockup, useScrollLock }

/* ── SimpleDropdown ──────────────────────────────────────────── */
interface SimpleOption { value: string; label: string }

export function SimpleDropdown({
                                   value, onChange, placeholder, options,
                               }: {
    value: string | null
    onChange: (v: string) => void
    placeholder: string
    options: SimpleOption[]
}) {
    const [open,   setOpen]   = useState(false)
    const [dropUp, setDropUp] = useState(false)
    const rootRef = useRef<HTMLDivElement>(null)
    const btnRef  = useRef<HTMLButtonElement>(null)
    const MENU_MAX = 180

    useEffect(() => {
        if (!open) return
        const onDoc = (e: MouseEvent) => {
            if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false)
        }
        const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false) }
        document.addEventListener("mousedown", onDoc)
        document.addEventListener("keydown",   onKey)
        return () => {
            document.removeEventListener("mousedown", onDoc)
            document.removeEventListener("keydown",   onKey)
        }
    }, [open])

    function handleToggle() {
        setOpen(prev => {
            const next = !prev
            if (next && btnRef.current) {
                const rect  = btnRef.current.getBoundingClientRect()
                const below = window.innerHeight - rect.bottom
                setDropUp(below < MENU_MAX && rect.top > below)
            }
            return next
        })
    }

    const selected = options.find(o => o.value === value)

    return (
        <div ref={rootRef} className="relative">
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

/* ── RoleDropdown ────────────────────────────────────────────── */
/**
 * Role picker dropdown. Options are supplied by the caller (sourced from the
 * backend `GET /roles` catalog) rather than a hardcoded frontend list, so the
 * displayed label and available roles always match the backend policy map.
 */
export function RoleDropdown({
                                 value, onChange, options,
                             }: {
    value: string | null
    onChange: (v: string) => void
    options: SimpleOption[]
}) {
    const [open,   setOpen]   = useState(false)
    const [dropUp, setDropUp] = useState(false)
    const rootRef = useRef<HTMLDivElement>(null)
    const btnRef  = useRef<HTMLButtonElement>(null)
    const MENU_MAX = 220

    useEffect(() => {
        if (!open) return
        const onDoc = (e: MouseEvent) => {
            if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false)
        }
        const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false) }
        document.addEventListener("mousedown", onDoc)
        document.addEventListener("keydown",   onKey)
        return () => {
            document.removeEventListener("mousedown", onDoc)
            document.removeEventListener("keydown",   onKey)
        }
    }, [open])

    function handleToggle() {
        setOpen(prev => {
            const next = !prev
            if (next && btnRef.current) {
                const rect  = btnRef.current.getBoundingClientRect()
                const below = window.innerHeight - rect.bottom
                setDropUp(below < MENU_MAX && rect.top > below)
            }
            return next
        })
    }

    return (
        <div ref={rootRef} className="relative">
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
                <span>{value ? (options.find(o => o.value === value)?.label ?? value) : "Select your role…"}</span>
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

/* ── Hero content (season badge, wordmark, tagline) ──────────── */
/**
 * The onboarding hero content block. `compact` drives the mobile variant:
 * tighter padding/gaps, a half-scale wordmark, and no tagline.
 */
export function OnboardingHero({
                                   season,
                                   compact = false,
                               }: {
    season: SeasonInfo | null
    compact?: boolean
}) {
    const pad = compact ? "px-[18px] py-[14px] gap-1.5" : "p-11 gap-[18px]"

    return (
        <div className={`absolute inset-0 flex flex-col items-start justify-end z-2 ${pad}`}>
            <span className="inline-block text-[11px] uppercase leading-none px-2.5 py-1 rounded-full font-mono tracking-[0.18em] theme-text-contrast border theme-border theme-bg backdrop-blur-sm">
                {season?.phase ?? "SEASON"}
            </span>
            <span className="inline-block text-[10px] uppercase leading-none opacity-60 theme-h1-color font-mono tracking-[0.18em]">
                Presented by HAAS
            </span>
            <div className={`relative inline-flex${compact ? " scale-50 origin-bottom-left" : ""}`}>
                <SeasonWordmark url={season?.wordmarkUrl ?? ""} label={season?.label ?? "SprocketStats"} />
                <sup
                    aria-label="trademark"
                    className="absolute bottom-0 -right-3.5 text-[10px] leading-none theme-h1-color font-sans font-medium"
                >
                    ™
                </sup>
            </div>
            {!compact && (
                <p className="m-0 max-w-[32ch] opacity-[0.92] theme-h1-color font-sans text-base leading-normal">
                    Let's get your profile set up.
                </p>
            )}
        </div>
    )
}

/* ── Shared form body (used by both Desktop and Mobile) ──────── */
/**
 * Onboarding form shared by the desktop and mobile layouts. Drives the role
 * dropdown and the conditional school-info fields from the backend-supplied
 * `roleCatalog`, so which roles exist and which require grade/team-year come
 * from the single source of truth rather than hardcoded frontend lists.
 */
export function OnboardingForm({
                                   displayName, setDisplayName,
                                   selectedRole, setSelectedRole,
                                   selectedGrade, setSelectedGrade,
                                   selectedTeamYear, setSelectedTeamYear,
                                   submitting, error, setError,
                                   needsSchoolInfo,
                                   roleCatalog,
                                   handleSubmit, handleSignOut,
                               }: Omit<OnboardingPageProps, "season">) {
    const roleOptions = roleCatalog.map(r => ({ value: r.value, label: r.label }))
    return (
        <>
            <div className="mb-6">
                <h1 className="m-0 mb-1.5 font-semibold font-sans theme-h1-color text-[32px] tracking-[-0.01em]">
                    Welcome aboard
                </h1>
                <p className="m-0 text-[14px] theme-subtext-color">
                    Let's set up your profile before we get started.
                </p>
            </div>

            <form onSubmit={handleSubmit} className="flex flex-col gap-5">
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

                <div className="flex flex-col gap-2">
                    <label className="text-sm font-semibold theme-h1-color">
                        What's your role on Team Sprocket?
                    </label>
                    <RoleDropdown
                        value={selectedRole}
                        options={roleOptions}
                        onChange={v => {
                            setSelectedRole(v)
                            // Roles that don't require school info can't keep stale grade/year.
                            if (!roleCatalog.find(r => r.value === v)?.school_info_required) {
                                setSelectedGrade(null)
                                setSelectedTeamYear(null)
                            }
                            setError(null)
                        }}
                    />
                </div>

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
                    className="w-full flex items-center justify-center gap-2 mt-1 h-[52px] rounded-xl border font-semibold text-sm transition-opacity disabled:opacity-40 theme-bg theme-border theme-text-contrast"
                >
                    {submitting ? "Saving…" : "Get Started"}
                    {!submitting && <ChevronRight size={16} />}
                </button>
            </form>

            <button
                type="button"
                onClick={handleSignOut}
                className="w-full mt-4 text-sm theme-subtext-color hover:theme-text transition-colors text-center"
            >
                Sign out and go back
            </button>
        </>
    )
}
