import type { LoginPageProps } from "./LoginPageRouter";
import {
    BrandLockup,
    GoogleButton,
    HeroContent,
    LegalFooter,
    LoginNoticeBanner,
    SignInHeading,
    SponsorFooter,
} from "@/components/LoginShared";
import { useScrollLock } from "@/lib/useScrollLock";

/* ════════════════════════════════════════════════════════════════
   LoginPageDesktop — split hero / form layout
   ════════════════════════════════════════════════════════════════ */
export default function LoginPageDesktop({ season, timeInfo, loading, loginNotice, signingIn, signInWithGoogle }: LoginPageProps) {
    useScrollLock();

    return (
        <div
            style={{
                display: "grid",
                gridTemplateColumns: "1.05fr 0.95fr",
                height: "var(--real-vh, 100dvh)",
            }}
        >
            {/* ══ LEFT — hero panel ══ */}
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

                <HeroContent season={season} timeInfo={timeInfo} />
            </aside>

            {/* ══ RIGHT — form panel ══ */}
            <section className="relative grid theme-button-bg border-l theme-border grid-rows-[auto_1fr_auto] px-14 py-7">
                <BrandLockup size={36} />

                <div className="self-center w-full max-w-[360px] mx-auto">
                    <div className="mb-[26px]">
                        <SignInHeading />
                    </div>

                    <GoogleButton loading={loading || signingIn} disabled={loginNotice === "authError"} onClick={signInWithGoogle} />

                    <LoginNoticeBanner notice={loginNotice} />

                    <SponsorFooter />
                </div>

                <div className="w-full max-w-[420px] mx-auto self-end">
                    <LegalFooter />
                </div>
            </section>
        </div>
    );
}
