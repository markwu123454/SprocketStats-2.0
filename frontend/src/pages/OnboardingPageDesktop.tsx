import type { OnboardingPageProps } from "./OnboardingPageRouter"
import {
    BrandLockup,
    OnboardingForm,
    OnboardingHero,
} from "@/components/OnboardingShared"
import { useScrollLock } from "@/lib/useScrollLock"

/* ════════════════════════════════════════════════════════════════
   OnboardingPageDesktop — split hero / form layout
   ════════════════════════════════════════════════════════════════ */
export default function OnboardingPageDesktop(props: OnboardingPageProps) {
    const { season } = props
    useScrollLock()

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
                <OnboardingHero season={season} />
            </aside>

            {/* ══ RIGHT — form ══ */}
            <section className="relative grid border-l theme-button-bg theme-border grid-rows-[auto_1fr] px-14 py-7 overflow-y-auto">
                <BrandLockup size={36} />

                <div className="self-center w-full max-w-[400px] mx-auto my-auto py-6">
                    <OnboardingForm {...props} />
                </div>
            </section>
        </div>
    )
}
