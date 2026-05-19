import { useEffect } from "react"
import { SeasonWordmark, OnboardingForm } from "./OnboardingPageDesktop"
import type { OnboardingPageProps } from "./OnboardingPageRouter"

/* ════════════════════════════════════════════════════════════════
   OnboardingPageMobile
   25% hero banner / 75% scrollable form
   ════════════════════════════════════════════════════════════════ */
export default function OnboardingPageMobile(props: OnboardingPageProps) {
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
                display: "flex",
                flexDirection: "column",
                position: "fixed",
                top: 0, left: 0, right: 0, bottom: 0,
                height: "100dvh",
                maxHeight: "100dvh",
                overflow: "hidden",
                overscrollBehavior: "none",
            }}
        >
            {/* ══ TOP 25% — condensed hero ══ */}
            <aside
                className="relative overflow-hidden theme-h1-color"
                style={{ flex: "0 0 25%", minHeight: 0 }}
            >
                <div
                    className="absolute inset-0 theme-bg-page"
                    style={{ backgroundPosition: "center", zIndex: 0 }}
                />
                <div
                    className="absolute inset-0"
                    style={{
                        zIndex: 1,
                        background: `linear-gradient(180deg,
                            color-mix(in oklch, var(--theme-button-bg) 30%, transparent) 0%,
                            color-mix(in oklch, var(--theme-button-bg) 70%, transparent) 100%)`,
                    }}
                />
                <div
                    className="absolute inset-0 flex flex-col items-start justify-end"
                    style={{ zIndex: 2, padding: "14px 18px", gap: 6 }}
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
                    <span
                        className="inline-block text-[10px] uppercase leading-none opacity-60 theme-h1-color"
                        style={{ fontFamily: "'JetBrains Mono', ui-monospace, monospace", letterSpacing: "0.18em" }}
                    >
                        Presented by HAAS
                    </span>
                    <div style={{ position: "relative", display: "inline-flex", transform: "scale(0.5)", transformOrigin: "left bottom" }}>
                        <SeasonWordmark url={season?.wordmarkUrl ?? ""} label={season?.label ?? "SprocketStats"} />
                        <sup
                            aria-label="trademark"
                            className="theme-h1-color"
                            style={{ position: "absolute", bottom: 0, right: "-14px", fontSize: "10px", lineHeight: 1, fontFamily: "'Inter', sans-serif", fontWeight: 500 }}
                        >
                            ™
                        </sup>
                    </div>
                </div>
            </aside>

            {/* ══ BOTTOM 75% — scrollable form ══ */}
            <section
                className="relative theme-button-bg"
                style={{
                    flex: "0 0 75%",
                    display: "flex",
                    flexDirection: "column",
                    borderTop: "1px solid var(--theme-border)",
                    padding: `24px 22px calc(22px + env(safe-area-inset-bottom, 0px))`,
                    zIndex: 10,
                    overflowY: "auto",
                }}
            >
                <div className="flex items-center gap-2.5 mb-5 theme-h1-color">
                    <div
                        style={{
                            width: 28, height: 28, flexShrink: 0,
                            backgroundColor: "var(--theme-h1-color)",
                            mask: "url(/sprocket_logo_gear.svg) center/contain no-repeat",
                            WebkitMask: "url(/sprocket_logo_gear.svg) center/contain no-repeat",
                        }}
                    />
                    <span className="font-semibold text-[14px] theme-h1-color" style={{ letterSpacing: "0.01em", lineHeight: 1 }}>
                        SprocketStats
                    </span>
                </div>

                <div className="w-full max-w-[400px] mx-auto">
                    <OnboardingForm {...props} />
                </div>
            </section>
        </div>
    )
}