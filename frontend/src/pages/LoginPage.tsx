import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/contexts/authContext.tsx";

/* ── Theme → season metadata map ────────────────────────────── */
const THEME_SEASONS: Record<string, { year: number; phase: string; label: string; dateRange: string }> = {
    "theme-2025": { year: 2025, phase: "REEFSCAPE",  label: "Reefscape",          dateRange: "2025 · DIVE" },
    "theme-2026": { year: 2026, phase: "REBUILT",    label: "Rebuilt",            dateRange: "2026 · AGE" },
    "theme-2027": { year: 2027, phase: "BIOCORE",    label: "Biocore",            dateRange: "2027 · CANOPY" },
};

function getActiveTheme(): string {
    for (const key of Object.keys(THEME_SEASONS)) {
        if (document.documentElement.classList.contains(key) || document.body.classList.contains(key)) {
            return key;
        }
    }
    return "theme-2027"; // fallback
}

/* ── Season info derived from active CSS theme ───────────────── */
interface SeasonInfo {
    phase: string;
    label: string;
    dateRange: string;
    wordmarkUrl: string;
}

function getSeasonFromTheme(): SeasonInfo {
    const themeKey = getActiveTheme();
    const meta = THEME_SEASONS[themeKey];
    return {
        phase:       meta.phase,
        label:       meta.label,
        dateRange:   meta.dateRange,
        wordmarkUrl: `/seasons/${meta.year}/wordmark.svg`,
    };
}

/* ── Time-based info for top-right display ───────────────────── */
interface TimeInfo {
    weekInfo?: string;
    dateRange: string;
}

function getTimeInfo(): TimeInfo {
    const now = new Date();
    const kickoff      = new Date(2027, 0, 9);
    const buildEnd     = new Date(2027, 2, 1);
    const compEnd      = new Date(2027, 3, 15);
    const preWorldsEnd = new Date(2027, 4, 1);
    const worldsEnd    = new Date(2027, 4, 8);

    const fmt   = (d: Date) => d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
    const range = (a: Date, b: Date) => `${fmt(a)} — ${fmt(b)}`;
    const wk    = (d: Date) => Math.floor((d.getTime() - kickoff.getTime()) / (1000 * 60 * 60 * 24 * 7)) + 1;
    const pad   = (n: number) => String(n).padStart(2, "0");

    if (now < kickoff)      return { dateRange: "Kickoff Jan 9" };
    if (now < buildEnd)     return { dateRange: range(kickoff, buildEnd),      weekInfo: `WK ${pad(wk(now))} / ${wk(buildEnd)}` };
    if (now < compEnd)      return { dateRange: range(buildEnd, compEnd),      weekInfo: `WK ${pad(wk(now))} / ${wk(compEnd)}` };
    if (now < preWorldsEnd) return { dateRange: range(compEnd, preWorldsEnd) };
    if (now < worldsEnd)    return { dateRange: range(preWorldsEnd, worldsEnd) };
    return                         { dateRange: "May 2027+" };
}

// Observe theme class changes on <html> or <body>
function useThemeSeasonInfo(): SeasonInfo | null {
    const [season, setSeason] = useState<SeasonInfo | null>(null);

    useEffect(() => {
        setSeason(getSeasonFromTheme());

        const observer = new MutationObserver(() => {
            setSeason(getSeasonFromTheme());
        });

        observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
        observer.observe(document.body,            { attributes: true, attributeFilter: ["class"] });

        return () => observer.disconnect();
    }, []);

    return season;
}

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

/* ── Google G mark — full-color, never themed ───────────────── */
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

/* ── Sprocket logo mark ──────────────────────────────────────── */
function Logo({ size = 26 }: { size?: number }) {
    return (
        <svg width={size} height={size} viewBox="0 0 64 64" fill="none" aria-hidden="true">
            <g fill="currentColor">
                {Array.from({ length: 8 }).map((_, i) => {
                    const a = (i * Math.PI * 2) / 8;
                    const x = 32 + Math.cos(a) * 26;
                    const y = 32 + Math.sin(a) * 26;
                    return (
                        <rect
                            key={i}
                            x={x - 4} y={y - 4}
                            width="8" height="8" rx="1.5"
                            transform={`rotate(${i * 45} ${x} ${y})`}
                        />
                    );
                })}
                <circle cx="32" cy="32" r="20" />
            </g>
            <circle cx="32" cy="32" r="7" fill="var(--theme-button-bg)" />
        </svg>
    );
}

/* ════════════════════════════════════════════════════════════════
   LoginPage — Layout 02 "Split Hero"
   ════════════════════════════════════════════════════════════════ */
export default function LoginPage() {
    const { user, loading, signInWithGoogle } = useAuth();
    const navigate = useNavigate();
    const season = useThemeSeasonInfo();
    const [timeInfo] = useState<TimeInfo>(() => getTimeInfo());

    useEffect(() => {
        if (!loading && user) navigate("/dashboard", { replace: true });
    }, [user, loading, navigate]);

    return (
        <div className="grid h-screen" style={{ gridTemplateColumns: "1.05fr 0.95fr" }}>

            {/* ══ LEFT — split-art ══ */}
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
                    className="absolute inset-0 flex flex-col items-start justify-end gap-[18px] p-[44px]"
                    style={{ zIndex: 2 }}
                >
                    <span
                        className="inline-block text-[11px] uppercase leading-none px-[10px] py-[4px] rounded-full"
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

                    {/* Season wordmark — inlined SVG so fill="currentColor" inherits --theme-h1-color */}
                    <SeasonWordmark
                        url={season?.wordmarkUrl ?? ""}
                        label={season?.label ?? "SprocketStats"}
                    />

                    <p
                        className="m-0 max-w-[32ch] opacity-[0.92]"
                        style={{
                            fontFamily: "'Space Grotesk', 'Inter', sans-serif",
                            fontSize: "16px",
                            lineHeight: 1.5,
                            color: "var(--theme-h1-color)",
                        }}
                    >
                        Forty-thousand teams.<br />
                        One season of measurement.<br />
                        One workspace.
                    </p>
                </div>

                <div
                    className="absolute top-[44px] right-[44px] flex flex-col items-end gap-[6px] text-[11px]"
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

            {/* ══ RIGHT — split-form ══ */}
            <section
                className="relative grid"
                style={{
                    background: "var(--theme-button-bg)",
                    borderLeft: "1px solid var(--theme-border)",
                    gridTemplateRows: "auto 1fr auto",
                    padding: "28px 56px",
                }}
            >
                <div
                    className="flex items-center gap-[10px] pb-[8px]"
                    style={{ color: "var(--theme-h1-color)" }}
                >
                    <Logo size={26} />
                    <span
                        className="font-semibold text-[15px]"
                        style={{ letterSpacing: "0.01em" }}
                    >
                        SprocketStats
                    </span>
                </div>

                <div className="self-center w-full max-w-[360px] mx-auto">
                    <h1
                        className="m-0 mb-[6px] font-semibold"
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
                        className="m-0 mb-[26px] text-[14px]"
                        style={{ color: "var(--theme-subtext-color)" }}
                    >
                        Pick up where your team left off. SprocketStats uses your team's Google account.
                    </p>

                    <button
                        onClick={signInWithGoogle}
                        disabled={loading}
                        type="button"
                        className="w-full grid items-center gap-[12px] px-[18px] cursor-pointer disabled:opacity-50"
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
                        onMouseDown={e => (e.currentTarget.style.transform = "translateY(1px)")}
                        onMouseUp={e => (e.currentTarget.style.transform = "")}
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

                    <p
                        className="mt-[14px] mb-0 text-center text-[12px] leading-[1.5]"
                        style={{ color: "var(--theme-subtext-color)" }}
                    >
                        By continuing you agree to our{" "}
                        <a
                            href="#"
                            className="no-underline font-medium hover:underline"
                            style={{ color: "var(--theme-text-contrast)" }}
                        >
                            Terms
                        </a>
                        {" "}and{" "}
                        <a
                            href="#"
                            className="no-underline font-medium hover:underline"
                            style={{ color: "var(--theme-text-contrast)" }}
                        >
                            Privacy Policy
                        </a>.
                    </p>
                </div>

                <footer
                    className="flex items-center justify-center gap-2.5 text-[13px]"
                    style={{ color: "var(--theme-subtext-color)" }}
                >
                    <span>New to SprocketStats?</span>
                    <a
                        href="#"
                        className="no-underline font-semibold hover:underline"
                        style={{ color: "var(--theme-text-contrast)" }}
                    >
                        Onboard your team →
                    </a>
                </footer>
            </section>
        </div>
    );
}