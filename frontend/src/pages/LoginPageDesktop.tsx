import { useEffect, useState } from "react";
import type { LoginPageProps } from "./LoginPageRouter";

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
            style={{
                width: "min(480px, 100%)",
                height: "94px",
                color: "var(--theme-h1-color)",
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
        html.style.overflow          = "hidden";
        body.style.overflow          = "hidden";
        body.style.overscrollBehavior = "none";
        body.style.height            = "100%";
        return () => {
            html.style.overflow          = prev.htmlOverflow;
            body.style.overflow          = prev.bodyOverflow;
            body.style.overscrollBehavior = prev.bodyOverscroll;
            body.style.height            = prev.bodyHeight;
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
            <aside
                className="relative overflow-hidden"
                style={{ color: "var(--theme-h1-color)" }}
            >
                <div
                    className="absolute inset-0"
                    style={{
                        backgroundImage: "var(--theme-bg-page)",
                        backgroundSize: "cover",
                        backgroundPosition: "center",
                        zIndex: 0,
                    }}
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
                    className="absolute inset-0 flex flex-col items-start justify-end gap-[18px] p-11"
                    style={{ zIndex: 2 }}
                >
                    <span
                        className="inline-block text-[11px] uppercase leading-none px-2.5 py-1 rounded-full"
                        style={{
                            fontFamily: "'JetBrains Mono', ui-monospace, monospace",
                            letterSpacing: "0.18em",
                            color: "var(--theme-text-contrast)",
                            border: "1px solid var(--theme-border)",
                            background: "var(--theme-bg)",
                            backdropFilter: "blur(8px)",
                            WebkitBackdropFilter: "blur(8px)",
                        }}
                    >
                        {season?.phase ?? "SEASON"}
                    </span>

                    <span
                        className="inline-block text-[10px] uppercase leading-none"
                        style={{
                            fontFamily: "'JetBrains Mono', ui-monospace, monospace",
                            letterSpacing: "0.18em",
                            color: "var(--theme-h1-color)",
                            opacity: 0.6,
                        }}
                    >
                        Presented by HAAS
                    </span>

                    <div style={{ position: "relative", display: "inline-flex" }}>
                        <SeasonWordmark
                            url={season?.wordmarkUrl ?? ""}
                            label={season?.label ?? "SprocketStats"}
                        />
                        <sup
                            aria-label="trademark"
                            style={{
                                position: "absolute",
                                bottom: 0,
                                right: "-14px",
                                fontSize: "10px",
                                lineHeight: 1,
                                color: "var(--theme-h1-color)",
                                fontFamily: "'Inter', sans-serif",
                                fontWeight: 500,
                            }}
                        >
                            ™
                        </sup>
                    </div>

                    <p
                        className="m-0 max-w-[32ch] opacity-[0.92]"
                        style={{
                            fontFamily: "'Space Grotesk', 'Inter', sans-serif",
                            fontSize: "16px",
                            lineHeight: 1.5,
                            color: "var(--theme-h1-color)",
                        }}
                    >
                        Lets go Team Sprocket!
                    </p>
                </div>

                {/* Time badge */}
                <div
                    className="absolute top-11 right-11 flex flex-col items-end gap-1.5 text-[11px]"
                    style={{
                        zIndex: 2,
                        fontFamily: "'JetBrains Mono', monospace",
                        letterSpacing: "0.14em",
                        color: "var(--theme-text-contrast)",
                    }}
                >
                    {timeInfo.weekInfo  && <span>{timeInfo.weekInfo}</span>}
                    {timeInfo.dateRange && <span>{timeInfo.dateRange}</span>}
                </div>
            </aside>

            {/* ══ RIGHT — form panel ══ */}
            <section
                className="relative grid"
                style={{
                    background: "var(--theme-button-bg)",
                    borderLeft: "1px solid var(--theme-border)",
                    gridTemplateRows: "auto 1fr auto",
                    padding: "28px 56px",
                }}
            >
                {/* Brand lockup */}
                <div className="flex items-center gap-2.5">
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
                        className="font-semibold text-[15px]"
                        style={{
                            letterSpacing: "0.01em",
                            lineHeight: 1,
                            color: "var(--theme-h1-color)",
                        }}
                    >
                        SprocketStats
                    </span>
                </div>

                {/* Form */}
                <div className="self-center w-full max-w-[360px] mx-auto">
                    <div style={{ marginBottom: 26 }}>
                        <h1
                            className="m-0 mb-1.5 font-semibold"
                            style={{
                                fontFamily: "'Space Grotesk', 'Inter', sans-serif",
                                fontSize: "32px",
                                letterSpacing: "-0.01em",
                                color: "var(--theme-h1-color)",
                            }}
                        >
                            Sign in
                        </h1>
                        <p
                            className="m-0 text-[14px]"
                            style={{ color: "var(--theme-subtext-color)", marginTop: 6 }}
                        >
                            Sign in with your school email.
                        </p>
                    </div>

                    <button
                        onClick={signInWithGoogle}
                        disabled={loading}
                        type="button"
                        className="w-full grid items-center gap-3 px-[18px] cursor-pointer disabled:opacity-50"
                        style={{
                            height: "52px",
                            borderRadius: "12px",
                            gridTemplateColumns: "auto 1fr auto",
                            font: "600 15px/1 'Inter', sans-serif",
                            letterSpacing: "0.005em",
                            background: "#ffffff",
                            border: "1px solid color-mix(in oklch, #1a1a1a 12%, transparent)",
                            color: "#1f1f1f",
                            boxShadow: "0 6px 18px -8px rgba(0,0,0,.25)",
                            transition: "background .15s, border-color .15s, transform .12s, box-shadow .15s",
                        }}
                        onMouseEnter={e => (e.currentTarget.style.background = "#f7f7f7")}
                        onMouseLeave={e => (e.currentTarget.style.background = "#ffffff")}
                        onMouseDown={e  => (e.currentTarget.style.transform  = "translateY(1px)")}
                        onMouseUp={e    => (e.currentTarget.style.transform  = "")}
                    >
                        <span
                            className="flex items-center justify-center flex-none"
                            style={{ width: 28, height: 28, borderRadius: "50%", background: "transparent" }}
                        >
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
                </div>
            </section>
        </div>
    );
}