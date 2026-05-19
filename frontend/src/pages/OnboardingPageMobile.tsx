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
        <div className="fixed inset-0 flex flex-col h-dvh max-h-dvh overflow-hidden overscroll-none">
            {/* ══ TOP 25% — condensed hero ══ */}
            <aside className="relative overflow-hidden theme-h1-color flex-[0_0_25%] min-h-0">
                <div className="absolute inset-0 theme-bg-page bg-center z-0" />
                <div
                    className="absolute inset-0 z-1"
                    style={{
                        background: `linear-gradient(180deg,
                            color-mix(in oklch, var(--theme-button-bg) 30%, transparent) 0%,
                            color-mix(in oklch, var(--theme-button-bg) 70%, transparent) 100%)`,
                    }}
                />
                <div className="absolute inset-0 flex flex-col items-start justify-end z-2 px-[18px] py-[14px] gap-1.5">
                    <span className="inline-block text-[11px] uppercase leading-none px-2.5 py-1 rounded-full border theme-text-contrast theme-border theme-bg font-mono tracking-[0.18em] backdrop-blur-sm">
                        {season?.phase ?? "SEASON"}
                    </span>
                    <span className="inline-block text-[10px] uppercase leading-none opacity-60 theme-h1-color font-mono tracking-[0.18em]">
                        Presented by HAAS
                    </span>
                    <div className="relative inline-flex scale-50 origin-bottom-left">
                        <SeasonWordmark url={season?.wordmarkUrl ?? ""} label={season?.label ?? "SprocketStats"} />
                        <sup
                            aria-label="trademark"
                            className="absolute bottom-0 -right-3.5 text-[10px] leading-none theme-h1-color font-sans font-medium"
                        >
                            ™
                        </sup>
                    </div>
                </div>
            </aside>

            {/* ══ BOTTOM 75% — scrollable form ══ */}
            <section
                className="relative theme-button-bg flex flex-col flex-[0_0_75%] border-t theme-border z-10 overflow-y-auto"
                style={{ padding: `24px 22px calc(22px + env(safe-area-inset-bottom, 0px))` }}
            >
                <div className="flex items-center gap-2.5 mb-5 theme-h1-color">
                    <div
                        className="size-7 shrink-0"
                        style={{
                            backgroundColor: "var(--theme-h1-color)",
                            mask: "url(/sprocket_logo_gear.svg) center/contain no-repeat",
                            WebkitMask: "url(/sprocket_logo_gear.svg) center/contain no-repeat",
                        }}
                    />
                    <span className="font-semibold text-[14px] tracking-[0.01em] leading-none theme-h1-color">
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