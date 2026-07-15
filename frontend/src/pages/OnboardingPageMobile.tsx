import type { OnboardingPageProps } from "./OnboardingPageRouter"
import {
    BrandLockup,
    OnboardingForm,
    OnboardingHero,
} from "@/components/OnboardingShared"
import { useScrollLock } from "@/lib/useScrollLock"

/* ════════════════════════════════════════════════════════════════
   OnboardingPageMobile
   25% hero banner / 75% scrollable form
   ════════════════════════════════════════════════════════════════ */
export default function OnboardingPageMobile(props: OnboardingPageProps) {
    const { season } = props
    useScrollLock()

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
                <OnboardingHero season={season} compact />
            </aside>

            {/* ══ BOTTOM 75% — scrollable form ══ */}
            <section
                className="relative theme-button-bg flex flex-col flex-[0_0_75%] border-t theme-border z-10 overflow-y-auto"
                style={{ padding: `24px 22px calc(22px + env(safe-area-inset-bottom, 0px))` }}
            >
                <div className="mb-5">
                    <BrandLockup size={28} />
                </div>

                <div className="w-full max-w-[400px] mx-auto">
                    <OnboardingForm {...props} />
                </div>
            </section>
        </div>
    )
}
