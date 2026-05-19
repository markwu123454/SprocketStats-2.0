import { useEffect, useState, useRef } from "react"
import { ChevronRight, ChevronDown, Check } from "lucide-react"
import { ROLE_OPTIONS, GRADE_OPTIONS, TEAM_YEAR_OPTIONS, formatRole } from "@/lib/Roles"
import type { OnboardingPageProps } from "./OnboardingPageRouter"

/* ── Season wordmark ─────────────────────────────────────────── */
export function SeasonWordmark({ url, label }: { url: string; label: string }) {
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
            className="flex items-center theme-h1-color w-[min(480px,100%)] h-[94px]"
            dangerouslySetInnerHTML={{
                __html: svg.replace(/<svg /, '<svg style="height:100%;width:auto;max-width:100%;display:block;" '),
            }}
        />
    )
}

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
export function RoleDropdown({ value, onChange }: { value: string | null; onChange: (v: string) => void }) {
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
                <span>{value ? formatRole(value) : "Select your role…"}</span>
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
                    {ROLE_OPTIONS.map(opt => {
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

/* ── Shared form body (used by both Desktop and Mobile) ──────── */
export function OnboardingForm({
                                   displayName, setDisplayName,
                                   selectedRole, setSelectedRole,
                                   selectedGrade, setSelectedGrade,
                                   selectedTeamYear, setSelectedTeamYear,
                                   submitting, error, setError,
                                   needsSchoolInfo,
                                   handleSubmit, handleSignOut,
                               }: Omit<OnboardingPageProps, "season">) {
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
                        onChange={v => {
                            setSelectedRole(v)
                            if (["alumni", "mentor"].includes(v)) {
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

/* ════════════════════════════════════════════════════════════════
   OnboardingPageDesktop
   ════════════════════════════════════════════════════════════════ */
export default function OnboardingPageDesktop(props: OnboardingPageProps) {
    const { season } = props

    useEffect(() => {
        const html = document.documentElement
        const body = document.body
        const prev = {
            htmlOverflow:   html.style.overflow,
            bodyOverflow:   body.style.overflow,
            bodyOverscroll: body.style.overscrollBehavior,
            bodyHeight:     body.style.height,
        }
        html.style.overflow           = "hidden"
        body.style.overflow           = "hidden"
        body.style.overscrollBehavior = "none"
        body.style.height             = "100%"
        return () => {
            html.style.overflow           = prev.htmlOverflow
            body.style.overflow           = prev.bodyOverflow
            body.style.overscrollBehavior = prev.bodyOverscroll
            body.style.height             = prev.bodyHeight
        }
    }, [])

    return (
        <div
            style={{
                display: "grid",
                gridTemplateColumns: "1.05fr 0.95fr",
                height: "100vh",
            }}
        >
            {/* ══ LEFT — hero ══ */}
            <aside className="relative overflow-hidden theme-h1-color">
                <div className="absolute inset-0 theme-bg-page bg-center z-0" />
                <div
                    className="absolute inset-0 z-1"
                    style={{
                        background: `linear-gradient(180deg,
                            color-mix(in oklch, var(--theme-button-bg) 30%, transparent) 0%,
                            color-mix(in oklch, var(--theme-button-bg) 70%, transparent) 100%)`,
                    }}
                />
                <div className="absolute inset-0 flex flex-col items-start justify-end gap-[18px] p-11 z-2">
                    <span className="inline-block text-[11px] uppercase leading-none px-2.5 py-1 rounded-full font-mono tracking-[0.18em] theme-text-contrast border theme-border theme-bg backdrop-blur-sm">
                        {season?.phase ?? "SEASON"}
                    </span>
                    <span className="inline-block text-[10px] uppercase leading-none opacity-60 theme-h1-color font-mono tracking-[0.18em]">
                        Presented by HAAS
                    </span>
                    <div className="relative inline-flex">
                        <SeasonWordmark url={season?.wordmarkUrl ?? ""} label={season?.label ?? "SprocketStats"} />
                        <sup
                            aria-label="trademark"
                            className="absolute bottom-0 -right-3.5 text-[10px] leading-none theme-h1-color font-sans font-medium"
                        >
                            ™
                        </sup>
                    </div>
                    <p className="m-0 max-w-[32ch] opacity-[0.92] theme-h1-color font-sans text-base leading-normal">
                        Let's get your profile set up.
                    </p>
                </div>
            </aside>

            {/* ══ RIGHT — form ══ */}
            <section className="relative grid border-l theme-button-bg theme-border grid-rows-[auto_1fr] px-14 py-7 overflow-y-auto">
                <div className="flex items-center gap-2.5 theme-h1-color">
                    <div
                        className="size-9 shrink-0"
                        style={{
                            backgroundColor: "var(--theme-h1-color)",
                            mask: "url(/sprocket_logo_gear.svg) center/contain no-repeat",
                            WebkitMask: "url(/sprocket_logo_gear.svg) center/contain no-repeat",
                        }}
                    />
                    <span className="font-semibold text-[15px] tracking-[0.01em] leading-none theme-h1-color">
                        SprocketStats
                    </span>
                </div>

                <div className="self-center w-full max-w-[400px] mx-auto my-auto py-6">
                    <OnboardingForm {...props} />
                </div>
            </section>
        </div>
    )
}