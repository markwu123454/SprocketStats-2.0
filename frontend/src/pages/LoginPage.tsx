import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/contexts/authContext.tsx";
import {useAppReady} from "@/contexts/appReadyContext.tsx";

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

/* ════════════════════════════════════════════════════════════════
   LoginPage — Layout 02 "Split Hero"
   ════════════════════════════════════════════════════════════════ */
export default function LoginPage() {
    const { user, loading, signInWithGoogle } = useAuth();
    const navigate = useNavigate();
    const season = useThemeSeasonInfo();
    const [timeInfo] = useState<TimeInfo>(() => getTimeInfo());
    const markReady = useAppReady()

    // ── Bottom sheet drag (mobile only) ──────────────────────────
    // Geometry (mobile): the Google button is the anchor. Its
    // distance from the sheet bottom (the "clamp") interpolates from
    // CLAMP_PEEK → CLAMP_EXPANDED as the sheet opens. In the peek
    // state the button sits low (small clamp) so there's no dead
    // space beneath it; as you expand, it rises to make room for the
    // terms/footer that fade into the widened clamp zone below it.
    // The heading fades into the space revealed above. The button's
    // motion is tied 1:1 to drag/snap progress, so it tracks the
    // sheet smoothly with no jump.
    const CLAMP_PEEK     = 34;   // peek: button sits low, near bottom
    const CLAMP_EXPANDED = 92;   // expanded: room for terms/footer
    const PEEK_HEIGHT    = 132;  // handle + button + small clamp
    const EXPAND_HEIGHT  = 320;  // adds room above for the heading
    const sheetRef    = useRef<HTMLElement>(null);
    const dragStart   = useRef<{ y: number; h: number } | null>(null);
    const [sheetHeight, setSheetHeight] = useState<number>(PEEK_HEIGHT);
    const [dragging,    setDragging]    = useState(false);

    const isMobile = () => typeof window !== "undefined" && window.innerWidth < 768;
    const snapTo   = (h: number) => { setSheetHeight(h); setDragging(false); };

    useEffect(() => {
        const t = setTimeout(() => markReady(), 500)
        return () => clearTimeout(t)
    }, [])

    // Track whether we're in mobile view reactively
    const [isMobileView, setIsMobileView] = useState(() => isMobile());
    useEffect(() => {
        const handler = () => setIsMobileView(window.innerWidth < 768);
        window.addEventListener("resize", handler);
        return () => window.removeEventListener("resize", handler);
    }, []);

    // Lock document scroll while this full-screen page is mounted so
    // the body can't rubber-band / scroll behind the fixed root
    // (the "scrolls up to reveal Kickoff" bug on mobile Safari).
    useEffect(() => {
        const html = document.documentElement;
        const body = document.body;
        const prev = {
            htmlOverflow: html.style.overflow,
            bodyOverflow: body.style.overflow,
            bodyOverscroll: body.style.overscrollBehavior,
            bodyHeight: body.style.height,
        };
        html.style.overflow = "hidden";
        body.style.overflow = "hidden";
        body.style.overscrollBehavior = "none";
        body.style.height = "100%";
        return () => {
            html.style.overflow = prev.htmlOverflow;
            body.style.overflow = prev.bodyOverflow;
            body.style.overscrollBehavior = prev.bodyOverscroll;
            body.style.height = prev.bodyHeight;
        };
    }, []);

    const onPointerDown = (e: React.PointerEvent) => {
        if (!isMobile()) return;
        (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
        dragStart.current = { y: e.clientY, h: sheetHeight };
        setDragging(true);
    };

    const onPointerMove = (e: React.PointerEvent) => {
        if (!dragStart.current || !isMobile()) return;
        const delta = dragStart.current.y - e.clientY;
        const next  = Math.max(PEEK_HEIGHT, Math.min(EXPAND_HEIGHT, dragStart.current.h + delta));
        setSheetHeight(next);
    };

    const onPointerUp = (e: React.PointerEvent) => {
        if (!dragStart.current || !isMobile()) return;
        const velocity = dragStart.current.y - e.clientY;
        const mid      = (PEEK_HEIGHT + EXPAND_HEIGHT) / 2;
        if (velocity > 50)       snapTo(EXPAND_HEIGHT);
        else if (velocity < -50) snapTo(PEEK_HEIGHT);
        else                     snapTo(sheetHeight > mid ? EXPAND_HEIGHT : PEEK_HEIGHT);
        dragStart.current = null;
    };

    useEffect(() => {
        if (!loading && user) navigate("/dashboard", { replace: true });
    }, [user, loading, navigate]);

    // Continuous 0→1 fade value, used only while the finger is down
    // so the text tracks the drag. Eased so it stays hidden through
    // the first bit of travel, then fades in over the rest.
    const dragProgress = Math.min(1, Math.max(0,
        (sheetHeight - PEEK_HEIGHT) / (EXPAND_HEIGHT - PEEK_HEIGHT)
    ));
    const reveal = dragProgress < 0.3
        ? 0
        : Math.pow((dragProgress - 0.3) / 0.7, 0.85);

    // Live button clamp: interpolates CLAMP_PEEK → CLAMP_EXPANDED
    // linearly with the sheet so the button glides down toward the
    // bottom as you collapse and rises as you expand. On desktop it
    // is irrelevant (mobile-only CSS), so just hold the peek value.
    const btnClamp = isMobileView
        ? CLAMP_PEEK + (CLAMP_EXPANDED - CLAMP_PEEK) * dragProgress
        : CLAMP_PEEK;

    // Resting state: at/above the midpoint counts as expanded. When
    // not dragging, the CSS transition smooths the opacity change so
    // there are no jumps; the text never affects layout because it's
    // absolutely overlaid relative to the (stable) button.
    const expanded =
        !isMobileView || sheetHeight > (PEEK_HEIGHT + EXPAND_HEIGHT) / 2;

    return (
        <div
            className="login-root grid"
            style={{
                gridTemplateColumns: "1.05fr 0.95fr",
                height: "var(--real-vh, 100dvh)",
            }}
        >
            <style>{`
                @media (min-width: 768px) {
                    .login-root {
                        grid-template-columns: 1.05fr 0.95fr !important;
                        grid-template-rows: 1fr !important;
                    }
                    .login-aside {
                        position: relative !important;
                        height: auto !important;
                    }
                    .login-section {
                        position: relative !important;
                        border-radius: 0 !important;
                        border-left: 1px solid var(--theme-border) !important;
                        border-top: none !important;
                        margin-top: 0 !important;
                        padding: 28px 56px !important;
                    }
                    /* Desktop: standalone logo top-left (row 1),
                       form centered in the 1fr track. The in-form
                       logo copy is hidden here (mobile-only). */
                    .login-logo-row {
                        display: flex !important;
                    }
                    .login-inform-logo {
                        display: none !important;
                    }
                    /* Desktop keeps the original stacked form: heading
                       block, button, then terms/footer — all in normal
                       flow, vertically centred. */
                    .login-reveal-head {
                        margin-bottom: 26px !important;
                    }
                    .login-reveal-head > p {
                        margin-top: 6px !important;
                    }
                }
                @media (max-width: 767px) {
                    .login-root {
                        display: flex !important;
                        flex-direction: column !important;
                        /* Pin to the *visual* viewport. position:fixed
                           + dvh means the document has nothing taller
                           than the screen to scroll, and the dynamic
                           viewport unit excludes the browser toolbar,
                           so the sheet can't be pushed behind it. */
                        position: fixed !important;
                        top: 0 !important;
                        left: 0 !important;
                        right: 0 !important;
                        bottom: 0 !important;
                        height: var(--real-vh, 100dvh) !important;
                        max-height: var(--real-vh, 100dvh) !important;
                        overflow: hidden !important;
                        overscroll-behavior: none !important;
                    }
                    .login-aside {
                        flex: 1 1 0 !important;
                        min-height: 0 !important;
                    }
                    /* Background pinned to the viewport — does not move
                       when the bottom sheet expands/collapses. */
                    .login-bg-image,
                    .login-bg-scrim {
                        position: fixed !important;
                        top: 0 !important;
                        left: 0 !important;
                        right: 0 !important;
                        bottom: 0 !important;
                        height: var(--real-vh, 100dvh) !important;
                    }
                    /* Sheet becomes a bottom-anchored flex column.
                       No flexible grid track → content height is
                       stable, so fading text never reflows. */
                    .login-section {
                        flex: 0 0 auto !important;
                        display: flex !important;
                        flex-direction: column !important;
                        justify-content: flex-end !important;
                        border-radius: 20px 20px 0 0 !important;
                        border-left: none !important;
                        border-top: 1px solid var(--theme-border) !important;
                        padding: 0 24px !important;
                        margin-top: 0 !important;
                        z-index: 10 !important;
                        overflow: hidden !important;
                        cursor: grab !important;
                        user-select: none !important;
                    }
                    .login-section:active {
                        cursor: grabbing !important;
                    }
                    .login-drag-handle {
                        display: block !important;
                        position: absolute !important;
                        top: 12px !important;
                        left: 50% !important;
                        transform: translateX(-50%) !important;
                        margin: 0 !important;
                    }
                    /* Mobile: standalone logo hidden; the in-form copy
                       (inside .login-reveal-head) is used so it reveals
                       and hides with the sign-in prompt. */
                    .login-logo-row {
                        display: none !important;
                    }
                    .login-inform-logo {
                        display: flex !important;
                    }
                    .login-time-badge {
                        top: 20px !important;
                        right: 20px !important;
                    }
                    .login-hero-content {
                        padding: 20px !important;
                    }
                    /* Form column. The button is the only in-flow
                       child; its distance from the sheet bottom (the
                       clamp) is driven by --btn-clamp. It transitions
                       on snap so the button glides, and tracks the
                       finger directly while dragging. */
                    .login-form-center {
                        position: relative !important;
                        width: 100% !important;
                        max-width: 360px !important;
                        margin: 0 auto !important;
                        padding: 0 0 var(--btn-clamp, 92px) !important;
                        transition: padding-bottom 0.38s cubic-bezier(0.32, 0.72, 0, 1) !important;
                    }
                    .login-section .login-reveal-head {
                        position: absolute !important;
                        left: 0 !important;
                        right: 0 !important;
                        bottom: calc(var(--btn-clamp, 92px) + 52px) !important;
                        margin-bottom: 20px !important;
                        transition: bottom 0.38s cubic-bezier(0.32, 0.72, 0, 1) !important;
                    }
                    .login-section .login-reveal-foot {
                        position: absolute !important;
                        left: 0 !important;
                        right: 0 !important;
                        top: calc(100% - var(--btn-clamp, 92px) + 14px) !important;
                        transition: top 0.38s cubic-bezier(0.32, 0.72, 0, 1) !important;
                    }
                    .login-section .login-reveal-foot > p {
                        margin-top: 0 !important;
                    }
                    /* While actively dragging, the clamp tracks the
                       finger 1:1 — no transition lag. */
                    .login-section.login-dragging .login-form-center,
                    .login-section.login-dragging .login-reveal-head,
                    .login-section.login-dragging .login-reveal-foot {
                        transition: none !important;
                    }
                    /* Smooth fade — two resting states, CSS transition
                       between them. No per-frame JS, no layout change. */
                    .login-section .login-expand-only {
                        opacity: 0;
                        transform: translateY(8px);
                        transition: opacity 0.34s ease, transform 0.34s ease;
                        pointer-events: none;
                        will-change: opacity, transform;
                    }
                    .login-section[data-expanded="true"] .login-expand-only {
                        opacity: 1;
                        transform: translateY(0);
                        pointer-events: auto;
                    }
                    /* While actively dragging, track the finger with a
                       continuous reveal value (set inline via --reveal)
                       instead of the snap transition. */
                    .login-section.login-dragging .login-expand-only {
                        opacity: var(--reveal, 0);
                        transform: translateY(calc((1 - var(--reveal, 0)) * 8px));
                        transition: none;
                    }
                }
            `}</style>

            {/* ══ LEFT / TOP — split-art ══ */}
            <aside
                className="login-aside relative overflow-hidden"
                style={{ color: "var(--theme-h1-color)" }}
            >
                <div
                    className="login-bg-image absolute inset-0"
                    style={{
                        backgroundImage: "var(--theme-bg-page)",
                        backgroundSize: "cover",
                        backgroundPosition: "center",
                        zIndex: 0,
                    }}
                />

                <div
                    className="login-bg-scrim absolute inset-0"
                    style={{
                        zIndex: 1,
                        background: `linear-gradient(180deg,
                            color-mix(in oklch, var(--theme-button-bg) 30%, transparent) 0%,
                            color-mix(in oklch, var(--theme-button-bg) 70%, transparent) 100%)`,
                    }}
                />

                <div
                    className="login-hero-content absolute inset-0 flex flex-col items-start justify-end gap-[18px] p-11"
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

                    {/* Presented by label + season wordmark */}
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

                    {/* Wordmark wrapper — relative so TM sits at bottom-right */}
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

                <div
                    className="login-time-badge absolute top-11 right-11 flex flex-col items-end gap-1.5 text-[11px]"
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

            {/* ══ RIGHT / BOTTOM — split-form ══ */}
            <section
                ref={sheetRef as React.RefObject<HTMLElement>}
                data-expanded={expanded ? "true" : "false"}
                className={`login-section relative grid${dragging ? " login-dragging" : ""}`}
                onPointerDown={onPointerDown}
                onPointerMove={onPointerMove}
                onPointerUp={onPointerUp}
                onPointerCancel={onPointerUp}
                style={{
                    background: "var(--theme-button-bg)",
                    borderLeft: "1px solid var(--theme-border)",
                    gridTemplateRows: "auto 1fr auto",
                    padding: "28px 56px",
                    ["--btn-clamp" as string]: `${btnClamp}px`,
                    ...(dragging ? { ["--reveal" as string]: reveal } : {}),
                    // mobile sheet overrides applied via inline style + JS
                    ...(isMobileView ? {
                        // sheet height + home-indicator safe area, so
                        // the button keeps its clamp gap *above* the
                        // gesture bar rather than sitting on top of it
                        height: `calc(${sheetHeight}px + env(safe-area-inset-bottom, 0px))`,
                        transition: dragging ? "none" : "height 0.38s cubic-bezier(0.32, 0.72, 0, 1)",
                        touchAction: "none",
                    } : {}),
                }}
            >
                {/* drag handle — mobile only */}
                <div
                    aria-hidden="true"
                    style={{
                        display: "none",
                        width: 36,
                        height: 4,
                        borderRadius: 2,
                        background: "var(--theme-border)",
                        margin: "0 auto 16px",
                    }}
                    className="login-drag-handle"
                />
                {/* Standalone brand lockup — desktop only, pinned
                    top-left of the panel (grid row 1). Hidden on
                    mobile, where the in-form copy is used instead. */}
                <div className="login-logo-row flex items-center gap-2.5 theme-h1-color">
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
                        className="font-semibold text-[15px] theme-h1-color"
                        style={{ letterSpacing: "0.01em", lineHeight: 1 }}
                    >
                        SprocketStats
                    </span>
                </div>
                <div className="login-form-center self-center w-full max-w-[360px] mx-auto">
                    <div className="login-reveal-head login-expand-only">
                        {/* Brand lockup — mobile only; sits directly
                            above the heading so it reveals/hides with
                            the "Sign in" prompt as the sheet expands. */}
                        <div className="login-inform-logo flex items-center gap-2.5 mb-4 theme-h1-color">
                            <div
                                style={{
                                    width: 32,
                                    height: 32,
                                    flexShrink: 0,
                                    backgroundColor: "var(--theme-h1-color)",
                                    mask: "url(/sprocket_logo_gear.svg) center/contain no-repeat",
                                    WebkitMask: "url(/sprocket_logo_gear.svg) center/contain no-repeat",
                                }}
                            />
                            <span
                                className="font-semibold text-[15px] theme-h1-color"
                                style={{
                                    letterSpacing: "0.01em",
                                    lineHeight: 1,
                                }}
                            >
                                SprocketStats
                            </span>
                        </div>
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
                            style={{ color: "var(--theme-subtext-color)" }}
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

                    {/*<div className="login-reveal-foot login-expand-only">
                        <p
                            className="mt-3.5 mb-0 text-center text-[12px] leading-normal"
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
                    </div>*/}
                </div>
            </section>
        </div>
    );
}