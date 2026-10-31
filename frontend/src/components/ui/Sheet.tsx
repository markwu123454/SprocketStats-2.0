import {useCallback, useEffect, useId, useRef, useState, type KeyboardEvent, type PointerEvent, type ReactNode} from "react"
import {createPortal} from "react-dom"
import {X} from "lucide-react"
import Button from "@/components/ui/Button"
import {focusRing, typeTitle} from "@/lib/uiClasses"
import {SheetDirtyContext, askDiscard} from "@/lib/useDiscardGuard"
import {isTopOverlay, lockScroll, prefersReducedMotion, pushOverlay, trapTab} from "@/lib/modalStack"

interface SheetProps {
    title: string
    onClose: () => void
    children: ReactNode
    /** Rendered outside the scroller, pinned to the bottom (normally a <FormFooter safeArea>). */
    footer?: ReactNode
    /** "form": up to 92% of the visible height; also a centred dialog from md. "menu": up to 60%, mobile only. */
    kind?: "form" | "menu"
    /** Keep the title for assistive tech but don't show it. */
    labelledByTitleHidden?: boolean
    /** REPLACES the scroller's default padding (`px-4 md:px-6 pt-2 pb-4`). */
    className?: string
    /** Unsaved edits: every user-initiated dismissal first asks "Discard changes?". Forms inside can also call `useDiscardGuard(dirty)`. */
    dirty?: boolean
}

const EASE_SHEET = "cubic-bezier(0.32, 0.72, 0, 1)"
const EASE_EXIT = "cubic-bezier(0.4, 0, 1, 1)"
const isMobileNow = () => window.innerWidth < 768

/**
 * Drag sheet below md, centred dialog from md up (design-system/modals.md).
 * Portals to body at z-50. Only the header and handle drag. Dismissal always runs the
 * exit animation and then calls `onClose`; if the parent unmounts it directly the
 * sheet closes at once (focus and scroll lock are still restored).
 */
export default function Sheet({title, onClose, children, footer, kind = "form", labelledByTitleHidden = false, className, dirty = false}: SheetProps) {
    const titleId = useId()
    const panelRef = useRef<HTMLDivElement>(null)
    const scrimRef = useRef<HTMLDivElement>(null)
    const closing = useRef(false)
    const timers = useRef<number[]>([])
    const drag = useRef<{startY: number, pointerId: number, active: boolean, samples: {y: number, t: number}[]} | null>(null)
    const onCloseRef = useRef(onClose)
    const [token] = useState(() => Symbol("sheet"))
    // Read during the first render, before any child autofocus has moved focus.
    const [opener] = useState<Element | null>(() => document.activeElement)

    const dirtyRef = useRef(dirty)
    const childDirty = useRef(0)
    const prompting = useRef(false)
    const mounted = useRef(true)
    useEffect(() => { onCloseRef.current = onClose; dirtyRef.current = dirty })
    useEffect(() => {
        mounted.current = true
        return () => { mounted.current = false }
    }, [])
    // A form inside the sheet reports its own dirtiness here (see useDiscardGuard).
    const registerChildDirty = useCallback(() => {
        childDirty.current++
        let released = false
        return () => { if (!released) { released = true; childDirty.current-- } }
    }, [])

    const dismiss = useCallback(() => {
        if (closing.current) return
        closing.current = true
        const panel = panelRef.current
        const scrim = scrimRef.current
        const reduced = prefersReducedMotion()
        if (panel) {
            panel.style.animation = "none"
            panel.style.transition = reduced ? "none" : `transform 200ms ${EASE_EXIT}, opacity 200ms ${EASE_EXIT}`
            void panel.offsetHeight
            if (isMobileNow()) {
                panel.style.transform = "translateY(100%)"
            } else {
                panel.style.transform = "scale(0.95)"
                panel.style.opacity = "0"
            }
        }
        if (scrim) {
            scrim.style.animation = "none"
            scrim.style.transition = reduced ? "none" : `opacity 200ms ${EASE_EXIT}`
            scrim.style.opacity = "0"
        }
        // A timer, not transitionend, so onClose fires even when motion is reduced or the transition is skipped.
        timers.current.push(window.setTimeout(() => onCloseRef.current(), reduced ? 0 : 200))
    }, [])

    /** Every user-initiated dismissal goes through here: clean closes at once, dirty asks first. */
    const requestClose = useCallback(async (onDeclined?: () => void) => {
        if (closing.current || prompting.current) return
        if (!dirtyRef.current && childDirty.current === 0) { dismiss(); return }
        prompting.current = true
        let discard = false
        try { discard = await askDiscard() } finally { prompting.current = false }
        if (!mounted.current || closing.current) return
        if (discard) dismiss()
        else onDeclined?.()
    }, [dismiss])

    // Open: register on the overlay stack, lock scroll, move focus in. Close: undo all three.
    useEffect(() => {
        const unregister = pushOverlay(token)
        const unlock = lockScroll()
        const panel = panelRef.current
        // A child that autofocuses (Dropdown search) has already claimed focus; otherwise take it.
        if (panel && !panel.contains(document.activeElement)) panel.focus({preventScroll: true})
        const pending = timers.current
        return () => {
            unregister()
            unlock()
            pending.forEach(window.clearTimeout)
            if (opener instanceof HTMLElement && opener !== document.body && document.contains(opener)) {
                opener.focus({preventScroll: true})
            }
        }
    }, [token, opener])

    // Keys while focus is outside every sheet (e.g. after clicking the scrim of something else).
    useEffect(() => {
        const onDocKey = (e: globalThis.KeyboardEvent) => {
            const panel = panelRef.current
            if (!panel || !isTopOverlay(token) || panel.contains(e.target as Node) || e.defaultPrevented) return
            if (e.key === "Escape") { e.preventDefault(); void requestClose() }
            else trapTab(e, panel)
        }
        document.addEventListener("keydown", onDocKey)
        return () => document.removeEventListener("keydown", onDocKey)
    }, [token, requestClose])

    const onRootKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
        // The portal's React parents must not see this: a Sheet inside a Dropdown or clickable row stays self-contained.
        e.stopPropagation()
        const panel = panelRef.current
        if (!panel || !isTopOverlay(token)) return
        if (e.key === "Escape" && !e.defaultPrevented) {
            e.preventDefault()
            void requestClose()
        } else {
            trapTab(e, panel)
        }
    }

    // ── Drag (header and handle only) ──────────────────────────────────────
    const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
        if (!isMobileNow() || closing.current || prompting.current) return
        if (e.pointerType === "mouse" && e.button !== 0) return
        if ((e.target as HTMLElement).closest("[data-no-drag]")) return
        drag.current = {startY: e.clientY, pointerId: e.pointerId, active: false, samples: [{y: e.clientY, t: e.timeStamp}]}
    }

    const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
        const d = drag.current
        const panel = panelRef.current
        if (!d || !panel || e.pointerId !== d.pointerId) return
        const dy = e.clientY - d.startY
        if (!d.active) {
            if (Math.abs(dy) < 4) return
            d.active = true
            // Capture only once it is a real drag, so a plain tap still reaches the handle button's click.
            e.currentTarget.setPointerCapture(e.pointerId)
            panel.style.animation = "none"
            panel.style.transition = "none"
        }
        const offset = Math.max(0, dy)
        panel.style.transform = `translateY(${offset}px)`
        if (scrimRef.current) {
            scrimRef.current.style.animation = "none"
            scrimRef.current.style.opacity = String(1 - Math.min(1, offset / (panel.offsetHeight || 1)))
        }
        d.samples.push({y: e.clientY, t: e.timeStamp})
        while (d.samples.length > 2 && e.timeStamp - d.samples[0].t > 100) d.samples.shift()
    }

    const endDrag = (e: PointerEvent<HTMLDivElement>, cancelled: boolean) => {
        const d = drag.current
        const panel = panelRef.current
        drag.current = null
        if (!d || !d.active || !panel) return
        if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId)
        const offset = Math.max(0, e.clientY - d.startY)
        const first = d.samples[0]
        const last = d.samples[d.samples.length - 1]
        const velocity = last.t > first.t ? (last.y - first.y) / (last.t - first.t) : 0
        const settleBack = () => {
            panel.style.transition = `transform 340ms ${EASE_SHEET}`
            panel.style.transform = "translateY(0)"
            const scrim = scrimRef.current
            if (scrim) {
                scrim.style.transition = `opacity 340ms ${EASE_SHEET}`
                scrim.style.opacity = "1"
            }
            timers.current.push(window.setTimeout(() => {
                // Back at rest: no transform at all, so nothing inside gets a transformed containing block.
                panel.style.transform = ""
                panel.style.transition = ""
                if (scrim) { scrim.style.transition = ""; scrim.style.opacity = ""; scrim.style.animation = "" }
            }, 340))
        }
        if (!cancelled && (offset > panel.offsetHeight * 0.25 || velocity > 0.5)) {
            // Dirty: the sheet waits where it was dropped, and settles back if the user keeps editing.
            void requestClose(settleBack)
            return
        }
        settleBack()
    }

    const maxHeight = `calc(var(--real-vh, 100dvh) * ${kind === "menu" ? 0.6 : 0.92})`

    return createPortal(
        <SheetDirtyContext.Provider value={registerChildDirty}>
        <div
            className="fixed inset-x-0 top-0 z-50 flex items-end md:items-center justify-center md:p-4"
            style={{height: "var(--real-vh, 100dvh)"}}
            // click and keydown stop here so React parents (a clickable row, a Dropdown) never see them. mousedown is
            // left alone: stopping it would also hide it from document-level outside-click listeners.
            onClick={e => e.stopPropagation()}
            onKeyDown={onRootKeyDown}
        >
            <div ref={scrimRef} className="absolute inset-0 bg-black/50 sds-scrim-enter" aria-hidden="true" onClick={() => void requestClose()}/>
            <div
                ref={panelRef}
                role="dialog"
                aria-modal="true"
                aria-labelledby={titleId}
                tabIndex={-1}
                className="sds-sheet-enter relative w-full md:max-w-lg flex flex-col overflow-hidden theme-bg theme-border border border-b-0 md:border-b rounded-t-2xl md:rounded-2xl shadow-lg outline-none"
                style={{maxHeight}}
            >
                <div
                    className="shrink-0 border-b theme-border touch-none md:touch-auto select-none"
                    onPointerDown={onPointerDown}
                    onPointerMove={onPointerMove}
                    onPointerUp={e => endDrag(e, false)}
                    onPointerCancel={e => endDrag(e, true)}
                >
                    <button
                        type="button"
                        aria-label="Close sheet"
                        onClick={() => void requestClose()}
                        className={`md:hidden flex w-full h-12 items-center justify-center rounded-lg ${focusRing}`}
                    >
                        <span className="block w-8 h-1 rounded-full bg-[var(--theme-outline)]"/>
                    </button>
                    <div className={`flex items-center gap-2 pl-4 md:pl-6 pr-2 md:pr-4 md:pt-2 ${labelledByTitleHidden ? "justify-end" : ""}`}>
                        <h2 id={titleId} className={labelledByTitleHidden ? "sr-only" : `flex-1 min-w-0 truncate theme-h1-color ${typeTitle}`}>{title}</h2>
                        <Button variant="icon" data-no-drag aria-label="Close" onClick={() => void requestClose()}><X size={18}/></Button>
                    </div>
                </div>
                <div data-sheet-scroller className={`flex-1 min-h-0 overflow-y-auto overscroll-contain theme-scrollbar scroll-pb-20 ${className ?? "px-4 md:px-6 pt-2 pb-4"}`}>
                    {children}
                </div>
                {footer
                    ? <div className="shrink-0">{footer}</div>
                    : <div className="shrink-0 md:hidden" style={{height: "env(safe-area-inset-bottom)"}} aria-hidden="true"/>}
            </div>
        </div>
        </SheetDirtyContext.Provider>,
        document.body,
    )
}
