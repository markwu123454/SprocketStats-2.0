import { useEffect, useState } from "react";
import type { LoginPageProps } from "./LoginPageRouter";
import {useTheme} from "@/contexts/themeProvider.tsx";

/* ── Season wordmark — fetched & inlined so currentColor works ─ */
function SeasonWordmark({ url, label }: { url: string; label: string }) {
    const [svg, setSvg] = useState<string | null>(null);

    useEffect(() => {
        if (!url) return;
        let cancelled = false;
        fetch(url)
            .then(r => r.text())
            .then(text => { if (!cancelled) setSvg(text); })
            .catch(() => {});
        return () => { cancelled = true; };
    }, [url]);

    if (!svg) return null;

    return (
        <div
            role="img"
            aria-label={label}
            className="flex items-center theme-h1-color w-[min(480px,100%)] h-[94px]"
            dangerouslySetInnerHTML={{
                __html: svg.replace(
                    /<svg /,
                    '<svg style="height:100%;width:auto;max-width:100%;display:block;" '
                ),
            }}
        />
    );
}

/* ── Google G mark ───────────────────────────────────────────── */
function GoogleG() {
    return (
        <svg width={18} height={18} viewBox="0 0 18 18" aria-hidden="true">
            <path fill="#4285F4" d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844a4.14 4.14 0 0 1-1.796 2.717v2.258h2.908c1.702-1.567 2.684-3.874 2.684-6.615z" />
            <path fill="#34A853" d="M9 18c2.43 0 4.467-.806 5.956-2.18l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 0 0 9 18z" />
            <path fill="#FBBC05" d="M3.964 10.71A5.41 5.41 0 0 1 3.682 9c0-.593.102-1.17.282-1.71V4.958H.957A8.996 8.996 0 0 0 0 9c0 1.452.348 2.827.957 4.042l3.007-2.332z" />
            <path fill="#EA4335" d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 0 0 .957 4.958L3.964 7.29C4.672 5.163 6.656 3.58 9 3.58z" />
        </svg>
    );
}

/* ════════════════════════════════════════════════════════════════
   LoginPageDesktop
   ════════════════════════════════════════════════════════════════ */
export default function LoginPageDesktop({ season, timeInfo, loading, signInWithGoogle }: LoginPageProps) {
    const { isDark } = useTheme()

    // Lock document scroll while mounted
    useEffect(() => {
        const html = document.documentElement;
        const body = document.body;
        const prev = {
            htmlOverflow:   html.style.overflow,
            bodyOverflow:   body.style.overflow,
            bodyOverscroll: body.style.overscrollBehavior,
            bodyHeight:     body.style.height,
        };
        html.style.overflow           = "hidden";
        body.style.overflow           = "hidden";
        body.style.overscrollBehavior = "none";
        body.style.height             = "100%";
        return () => {
            html.style.overflow           = prev.htmlOverflow;
            body.style.overflow           = prev.bodyOverflow;
            body.style.overscrollBehavior = prev.bodyOverscroll;
            body.style.height             = prev.bodyHeight;
        };
    }, []);

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

                <div className="absolute inset-0 flex flex-col items-start justify-end gap-[18px] p-11 z-2">
                    <span className="inline-block text-[11px] uppercase leading-none px-2.5 py-1 rounded-full font-mono tracking-[0.18em] theme-text-contrast border theme-border theme-bg backdrop-blur-sm">
                        {season?.phase ?? "SEASON"}
                    </span>

                    <span className="inline-block text-[10px] uppercase leading-none font-mono tracking-[0.18em] theme-h1-color opacity-60">
                        Presented by HAAS
                    </span>

                    <div className="relative inline-flex">
                        <SeasonWordmark
                            url={season?.wordmarkUrl ?? ""}
                            label={season?.label ?? "SprocketStats"}
                        />
                        <sup
                            aria-label="trademark"
                            className="absolute bottom-0 -right-3.5 text-[10px] leading-none theme-h1-color font-sans font-medium"
                        >
                            TM
                        </sup>
                    </div>

                    <p className="m-0 max-w-[32ch] opacity-[0.92] font-sans text-base leading-normal theme-h1-color">
                        Lets go Team Sprocket!
                    </p>
                </div>

                {/* Time badge */}
                <div className="absolute top-11 right-11 flex flex-col items-end gap-1.5 text-[11px] z-2 font-mono tracking-[0.14em] theme-text-contrast">
                    {timeInfo.weekInfo  && <span>{timeInfo.weekInfo}</span>}
                    {timeInfo.dateRange && <span>{timeInfo.dateRange}</span>}
                </div>
            </aside>

            {/* ══ RIGHT — form panel ══ */}
            <section className="relative grid theme-button-bg border-l theme-border grid-rows-[auto_1fr_auto] px-14 py-7">
                {/* Brand lockup */}
                <div className="flex items-center gap-2.5">
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

                {/* Form */}
                <div className="self-center w-full max-w-[360px] mx-auto">
                    <div className="mb-[26px]">
                        <h1 className="m-0 mb-1.5 font-semibold font-sans theme-h1-color text-[32px] tracking-[-0.01em]">
                            Sign in
                        </h1>
                        <p className="m-0 mt-1.5 text-[14px] theme-subtext-color">
                            Sign in with your school email.
                        </p>
                    </div>

                    <button
                        onClick={signInWithGoogle}
                        disabled={loading}
                        type="button"
                        className="w-full grid items-center gap-3 px-[18px] h-[52px] rounded-xl font-sans font-semibold text-[15px] leading-none tracking-[0.005em] bg-white hover:bg-[#f7f7f7] active:translate-y-px text-[#1f1f1f] shadow-[0_6px_18px_-8px_rgba(0,0,0,.25)] cursor-pointer disabled:opacity-50"
                        style={{
                            gridTemplateColumns: "auto 1fr auto",
                            border: "1px solid color-mix(in oklch, #1a1a1a 12%, transparent)",
                            boxShadow: "0 6px 18px -8px rgba(0,0,0,.25)",
                            transition: "background .15s, border-color .15s, transform .12s, box-shadow .15s",
                        }}
                        onMouseEnter={e => (e.currentTarget.style.background = "#f7f7f7")}
                        onMouseLeave={e => (e.currentTarget.style.background = "#ffffff")}
                        onMouseDown={e  => (e.currentTarget.style.transform  = "translateY(1px)")}
                        onMouseUp={e    => (e.currentTarget.style.transform  = "")}
                    >
                        <span className="flex items-center justify-center flex-none rounded-full size-7">
                            <GoogleG />
                        </span>
                        <span className="justify-self-start text-left">
                            {loading ? "Signing in…" : "Continue with Google"}
                        </span>
                        <span className="flex items-center opacity-60" aria-hidden="true">
                            <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
                                <path
                                    d="M3 8h10M9 4l4 4-4 4"
                                    stroke="currentColor"
                                    strokeWidth="1.5"
                                    strokeLinecap="round"
                                    strokeLinejoin="round"
                                />
                            </svg>
                        </span>
                    </button>

                    <p className="mt-3 mb-0 text-[12px] leading-[1.6] theme-subtext-color opacity-70 text-center">
                        SprocketStats is sponsored by{" "}
                        <a href="https://humansignal.com/"
                           target="_blank"
                           rel="noopener noreferrer"
                           className="opacity-100 inline-flex items-center gap-1 align-middle"
                        >
                            <img
                                src={isDark ? "/human_signal_dark_logo.png" : "/human_signal_light_logo.png"}
                                alt="HumanSignal"
                                className="h-4 w-auto inline-block"
                            />
                            <span className="theme-h1-color font-medium">HumanSignal</span>
                        </a>
                    </p>
                </div>
            </section>
        </div>
    );
}