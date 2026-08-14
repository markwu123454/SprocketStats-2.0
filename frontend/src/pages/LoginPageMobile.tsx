import { useLayoutEffect, useRef, useState } from "react";
import type { LoginPageProps } from "./LoginPageRouter";
import {
    BrandLockup,
    GoogleButton,
    HeroContent,
    LegalFooter,
    LegalFooterCompact,
    LoginNoticeBanner,
    SignInHeading,
    SponsorFooter,
} from "@/components/LoginShared";
import { useScrollLock } from "@/lib/useScrollLock";

/* ── Sheet geometry constants ────────────────────────────────────
   Baselines for a sheet showing no error notice. The peek state carries
   the compact legal line below the button, so it is taller than the
   button alone needs.

   An error notice sits in normal flow rather than in the expand-only
   reveal, so a rejected sign-in explains itself without the user having
   to discover the drag. Its height depends on how the message wraps, so
   it is measured at runtime and added to both baselines.

   The expanded clamp has to keep the in-flow stack clear of
   .lpm-reveal-foot, which is absolutely positioned and grows upward from
   the bottom. Worst case there is *no* error notice — that is when the
   button sits lowest relative to the footer.
   ──────────────────────────────────────────────────────────────── */
const CLAMP_PEEK     = 34;
const CLAMP_EXPANDED = 100;
const PEEK_HEIGHT    = 155;
const EXPAND_HEIGHT  = 350;

/* ════════════════════════════════════════════════════════════════
   LoginPageMobile — hero + draggable bottom sheet
   ════════════════════════════════════════════════════════════════ */
export default function LoginPageMobile({ season, timeInfo, loading, loginNotice, signingIn, signInWithGoogle }: LoginPageProps) {
    useScrollLock();

    const sheetRef  = useRef<HTMLElement>(null);
    const errorRef  = useRef<HTMLDivElement>(null);
    const dragStart = useRef<{ y: number; h: number } | null>(null);
    const [errorHeight, setErrorHeight] = useState(0);
    const [sheetHeight, setSheetHeight] = useState(PEEK_HEIGHT);
    const [dragging,    setDragging]    = useState(false);

    /* ── Error notice measurement ────────────────────────────────
       The notice slot is always mounted and collapses to zero height
       when there is nothing to say, so measuring it covers a notice
       appearing and clearing. Keyed on loginNotice: that's what changes,
       and the resize listener picks up a re-wrap on rotation.
       ────────────────────────────────────────────────────────────── */
    useLayoutEffect(() => {
        const measure = () => {
            const el = errorRef.current;
            if (el) setErrorHeight(el.offsetHeight);
        };
        measure();
        window.addEventListener("resize", measure);
        return () => window.removeEventListener("resize", measure);
    }, [loginNotice]);

    const peekHeight   = PEEK_HEIGHT   + errorHeight;
    const expandHeight = EXPAND_HEIGHT + errorHeight;
    const midHeight    = (peekHeight + expandHeight) / 2;

    const snapTo = (h: number) => { setSheetHeight(h); setDragging(false); };

    /* Re-settle the resting height when a notice appears or clears, so
       the sheet grows to fit it rather than clipping it. */
    useLayoutEffect(() => {
        if (dragging || dragStart.current) return;
        setSheetHeight(h => (h > midHeight ? expandHeight : peekHeight));
    }, [peekHeight, expandHeight, midHeight, dragging]);

    /* ── Drag handlers ───────────────────────────────────────── */
    const onPointerDown = (e: React.PointerEvent) => {
        (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
        dragStart.current = { y: e.clientY, h: sheetHeight };
        setDragging(true);
    };

    const onPointerMove = (e: React.PointerEvent) => {
        if (!dragStart.current) return;
        const delta = dragStart.current.y - e.clientY;
        const next  = Math.max(peekHeight, Math.min(expandHeight, dragStart.current.h + delta));
        setSheetHeight(next);
    };

    const onPointerUp = (e: React.PointerEvent) => {
        if (!dragStart.current) return;
        const velocity = dragStart.current.y - e.clientY;
        if (velocity > 50)       snapTo(expandHeight);
        else if (velocity < -50) snapTo(peekHeight);
        else                     snapTo(sheetHeight > midHeight ? expandHeight : peekHeight);
        dragStart.current = null;
    };

    /* ── Derived values ──────────────────────────────────────── */
    const dragProgress = Math.min(1, Math.max(0,
        (sheetHeight - peekHeight) / (expandHeight - peekHeight)
    ));
    const reveal = dragProgress < 0.3
        ? 0
        : Math.pow((dragProgress - 0.3) / 0.7, 0.85);

    const btnClamp = CLAMP_PEEK + (CLAMP_EXPANDED - CLAMP_PEEK) * dragProgress;
    const expanded = sheetHeight > midHeight;

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
                .lpm-reveal-foot > :first-child { margin-top: 0; }
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
                /* Inverse of .lpm-expand-only — the compact legal line shows
                   at peek and hands off to the full footer on expand. It stays
                   in flow either way so the button never shifts. */
                .lpm-peek-only {
                    opacity: 1;
                    transition: opacity 0.34s ease;
                    will-change: opacity;
                }
                .lpm-sheet[data-expanded="true"] .lpm-peek-only {
                    opacity: 0;
                    pointer-events: none;
                }
                .lpm-sheet.lpm-dragging .lpm-peek-only {
                    opacity: calc(1 - var(--reveal, 0));
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

                    <HeroContent season={season} timeInfo={timeInfo} compact/>
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
                        ...(dragging ? {["--reveal" as string]: reveal} : {}),
                    }}
                >
                    <div aria-hidden="true" className="lpm-drag-handle"/>

                    <div
                        className="lpm-form-center"
                        style={{
                            paddingBottom: btnClamp,
                            // Matches .lpm-sheet's height transition below — without
                            // this, the sheet's own height animates smoothly on
                            // release but this padding (which is what actually
                            // pushes the button/notices/peek-legal-line up or down)
                            // snaps instantly, since it's a plain inline style with
                            // no CSS transition of its own.
                            transition: dragging ? "none" : "padding-bottom 0.38s cubic-bezier(0.32, 0.72, 0, 1)",
                        }}
                    >
                        {/* Heading — fades in as sheet expands */}
                        <div className="lpm-reveal-head lpm-expand-only">
                            <div className="mb-4">
                                <BrandLockup size={32}/>
                            </div>
                            <SignInHeading/>
                        </div>

                        {/* Google button — always visible */}
                        <GoogleButton loading={loading || signingIn} disabled={loginNotice === "authError"}
                                      onClick={signInWithGoogle}/>

                        {/* Error notice — in normal flow, so a rejected sign-in is
                            visible in the peek state without discovering the drag.
                            flex-col keeps the notice margins out of the parent's
                            collapse, so the measured height is the real one. */}
                        <div ref={errorRef} className="flex flex-col">
                            <LoginNoticeBanner notice={loginNotice}/>
                        </div>

                        {/* Compact legal line — visible at peek, fades out as the
                            full footer below takes over */}
                        <div className="mt-3.5 lpm-peek-only">
                            <LegalFooterCompact/>
                        </div>

                        {/* Footer — fades in below the button as sheet expands */}
                        <div className="lpm-reveal-foot lpm-expand-only">
                            <LegalFooter/>
                            <SponsorFooter/>
                        </div>
                    </div>
                </section>
            </div>
        </>
    );
}
