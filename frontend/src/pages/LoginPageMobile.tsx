import { useRef, useState } from "react";
import type { LoginPageProps } from "./LoginPageRouter";
import {
    BrandLockup,
    GoogleButton,
    HeroContent,
    LoginErrorNotice,
    SignInHeading,
    SponsorFooter,
} from "@/components/LoginShared";
import { useScrollLock } from "@/lib/useScrollLock";

/* ── Sheet geometry constants ────────────────────────────────── */
const CLAMP_PEEK     = 34;
const CLAMP_EXPANDED = 92;
const PEEK_HEIGHT    = 132;
const EXPAND_HEIGHT  = 320;

/* ════════════════════════════════════════════════════════════════
   LoginPageMobile — hero + draggable bottom sheet
   ════════════════════════════════════════════════════════════════ */
export default function LoginPageMobile({ season, timeInfo, loading, banned, pendingApproval, authError, signInWithGoogle }: LoginPageProps) {
    useScrollLock();

    const sheetRef  = useRef<HTMLElement>(null);
    const dragStart = useRef<{ y: number; h: number } | null>(null);
    const [sheetHeight, setSheetHeight] = useState(PEEK_HEIGHT);
    const [dragging,    setDragging]    = useState(false);

    const snapTo = (h: number) => { setSheetHeight(h); setDragging(false); };

    /* ── Drag handlers ───────────────────────────────────────── */
    const onPointerDown = (e: React.PointerEvent) => {
        (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
        dragStart.current = { y: e.clientY, h: sheetHeight };
        setDragging(true);
    };

    const onPointerMove = (e: React.PointerEvent) => {
        if (!dragStart.current) return;
        const delta = dragStart.current.y - e.clientY;
        const next  = Math.max(PEEK_HEIGHT, Math.min(EXPAND_HEIGHT, dragStart.current.h + delta));
        setSheetHeight(next);
    };

    const onPointerUp = (e: React.PointerEvent) => {
        if (!dragStart.current) return;
        const velocity = dragStart.current.y - e.clientY;
        const mid      = (PEEK_HEIGHT + EXPAND_HEIGHT) / 2;
        if (velocity > 50)       snapTo(EXPAND_HEIGHT);
        else if (velocity < -50) snapTo(PEEK_HEIGHT);
        else                     snapTo(sheetHeight > mid ? EXPAND_HEIGHT : PEEK_HEIGHT);
        dragStart.current = null;
    };

    /* ── Derived values ──────────────────────────────────────── */
    const dragProgress = Math.min(1, Math.max(0,
        (sheetHeight - PEEK_HEIGHT) / (EXPAND_HEIGHT - PEEK_HEIGHT)
    ));
    const reveal = dragProgress < 0.3
        ? 0
        : Math.pow((dragProgress - 0.3) / 0.7, 0.85);

    const btnClamp = CLAMP_PEEK + (CLAMP_EXPANDED - CLAMP_PEEK) * dragProgress;
    const expanded = sheetHeight > (PEEK_HEIGHT + EXPAND_HEIGHT) / 2;

    return (
        <>
            <style>{`
                .lpm-root {
                    display: flex;
                    flex-direction: column;
                    position: fixed;
                    top: 0; left: 0; right: 0; bottom: 0;
                    height: var(--real-vh, 100dvh);
                    max-height: var(--real-vh, 100dvh);
                    overflow: hidden;
                    overscroll-behavior: none;
                }
                .lpm-aside {
                    flex: 1 1 0;
                    min-height: 0;
                    position: relative;
                    overflow: hidden;
                }
                .lpm-bg-image,
                .lpm-bg-scrim {
                    position: fixed;
                    top: 0; left: 0; right: 0; bottom: 0;
                    height: var(--real-vh, 100dvh);
                }
                .lpm-sheet {
                    flex: 0 0 auto;
                    display: flex;
                    flex-direction: column;
                    justify-content: flex-end;
                    border-radius: 20px 20px 0 0;
                    border-top: 1px solid var(--theme-border);
                    padding: 0 24px;
                    z-index: 10;
                    overflow: hidden;
                    cursor: grab;
                    user-select: none;
                    position: relative;
                }
                .lpm-sheet:active { cursor: grabbing; }
                .lpm-drag-handle {
                    display: block;
                    position: absolute;
                    top: 12px;
                    left: 50%;
                    transform: translateX(-50%);
                    width: 36px;
                    height: 4px;
                    border-radius: 2px;
                    background: var(--theme-border);
                }
                .lpm-form-center {
                    position: relative;
                    width: 100%;
                    max-width: 360px;
                    margin: 0 auto;
                    display: flex;
                    flex-direction: column;
                }
                .lpm-reveal-head {
                    margin-bottom: 20px;
                }
                .lpm-reveal-foot {
                    position: absolute;
                    left: 0; right: 0;
                    bottom: 20px;
                }
                .lpm-reveal-foot > p { margin-top: 0; }
                .lpm-expand-only {
                    opacity: 0;
                    transform: translateY(8px);
                    transition: opacity 0.34s ease, transform 0.34s ease;
                    pointer-events: none;
                    will-change: opacity, transform;
                }
                .lpm-sheet[data-expanded="true"] .lpm-expand-only {
                    opacity: 1;
                    transform: translateY(0);
                    pointer-events: auto;
                }
                .lpm-sheet.lpm-dragging .lpm-expand-only {
                    opacity: var(--reveal, 0);
                    transform: translateY(calc((1 - var(--reveal, 0)) * 8px));
                    transition: none;
                }
                .lpm-divider {
                    display: flex;
                    align-items: center;
                    gap: 10px;
                    margin: 0;
                }
                .lpm-divider::before,
                .lpm-divider::after {
                    content: "";
                    flex: 1;
                    height: 1px;
                    background: var(--theme-border);
                    opacity: 0.5;
                }
            `}</style>

            <div className="lpm-root">
                {/* ══ TOP — hero ══ */}
                <aside className="lpm-aside theme-h1-color">
                    <div
                        className="lpm-bg-image bg-center"
                        style={{
                            backgroundImage: "var(--theme-bg-page)",
                            backgroundSize: "cover",
                            zIndex: 0,
                        }}
                    />
                    <div
                        className="lpm-bg-scrim z-1"
                        style={{
                            background: `linear-gradient(180deg,
                                color-mix(in oklch, var(--theme-button-bg) 30%, transparent) 0%,
                                color-mix(in oklch, var(--theme-button-bg) 70%, transparent) 100%)`,
                        }}
                    />

                    <HeroContent season={season} timeInfo={timeInfo} compact />
                </aside>

                {/* ══ BOTTOM — sheet ══ */}
                <section
                    ref={sheetRef as React.RefObject<HTMLElement>}
                    data-expanded={expanded ? "true" : "false"}
                    className={`lpm-sheet${dragging ? " lpm-dragging" : ""}`}
                    onPointerDown={onPointerDown}
                    onPointerMove={onPointerMove}
                    onPointerUp={onPointerUp}
                    onPointerCancel={onPointerUp}
                    style={{
                        background: "var(--theme-button-bg)",
                        height: `calc(${sheetHeight}px + env(safe-area-inset-bottom, 0px))`,
                        transition: dragging ? "none" : "height 0.38s cubic-bezier(0.32, 0.72, 0, 1)",
                        touchAction: "none",
                        ["--btn-clamp" as string]: `${btnClamp}px`,
                        ...(dragging ? { ["--reveal" as string]: reveal } : {}),
                    }}
                >
                    <div aria-hidden="true" className="lpm-drag-handle" />

                    <div
                        className="lpm-form-center"
                        style={{ paddingBottom: btnClamp }}
                    >
                        {/* Heading — fades in as sheet expands */}
                        <div className="lpm-reveal-head lpm-expand-only">
                            <div className="mb-4">
                                <BrandLockup size={32} />
                            </div>
                            <SignInHeading />
                        </div>

                        {/* Google button — always visible */}
                        <GoogleButton loading={loading} disabled={authError} onClick={signInWithGoogle} />

                        {/* Footer — fades in below the button as sheet expands, banned/
                            error notice (if any) fades in alongside it */}
                        <div className="lpm-reveal-foot lpm-expand-only">
                            {banned && (
                                <LoginErrorNotice>
                                    This account has been banned. Contact a captain or mentor if you think that's a mistake.
                                </LoginErrorNotice>
                            )}
                            {pendingApproval && (
                                <LoginErrorNotice>
                                    Your account is awaiting approval. Ask a captain or mentor to approve you, then sign in again.
                                </LoginErrorNotice>
                            )}
                            {authError && (
                                <LoginErrorNotice>
                                    Can't reach the server right now. Try again in a moment.
                                </LoginErrorNotice>
                            )}
                            <SponsorFooter />
                        </div>
                    </div>
                </section>
            </div>
        </>
    );
}
