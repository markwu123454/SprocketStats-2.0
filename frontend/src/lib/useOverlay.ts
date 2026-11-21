import {useEffect, useRef, useState, type KeyboardEvent, type RefObject} from "react"
import {isTopOverlay, lockScroll, pushOverlay, trapTab} from "./modalStack"

interface OverlayOptions {
    /** Esc while this is the topmost overlay. Omit for an overlay Esc can't close (a required notice). */
    onEscape?: () => void
    /** Focused on open. Otherwise the panel itself, unless a child already took focus (an autofocus input). */
    initialFocus?: RefObject<HTMLElement | null>
}

/**
 * Everything a modal surface (Sheet, Dialog) does while it is open, in one place:
 * registers on the overlay stack so only the topmost handles keys, locks page
 * scroll, moves focus in on open and back to the opener on close, traps Tab,
 * and calls `onEscape` on Esc. Spread the returned handler on the overlay's root:
 * it handles keys inside the panel and stops them reaching React parents, while a
 * document listener catches keys pressed with focus outside it.
 */
export function useOverlay(panelRef: RefObject<HTMLElement | null>, {onEscape, initialFocus}: OverlayOptions = {}) {
    const [token] = useState(() => Symbol("overlay"))
    // Read during the first render, before any child autofocus has moved focus.
    const [opener] = useState<Element | null>(() => document.activeElement)
    const onEscapeRef = useRef(onEscape)
    const initialFocusRef = useRef(initialFocus)
    useEffect(() => { onEscapeRef.current = onEscape })

    useEffect(() => {
        const unregister = pushOverlay(token)
        const unlock = lockScroll()
        const panel = panelRef.current
        const target = initialFocusRef.current?.current
        if (target) target.focus({preventScroll: true})
        else if (panel && !panel.contains(document.activeElement)) panel.focus({preventScroll: true})
        return () => {
            unregister()
            unlock()
            if (opener instanceof HTMLElement && opener !== document.body && document.contains(opener)) {
                opener.focus({preventScroll: true})
            }
        }
    }, [token, opener, panelRef])

    // Keys while focus is outside the panel (e.g. after clicking the scrim of something else).
    useEffect(() => {
        const onDocKey = (e: globalThis.KeyboardEvent) => {
            const panel = panelRef.current
            if (!panel || !isTopOverlay(token) || panel.contains(e.target as Node) || e.defaultPrevented) return
            if (e.key === "Escape") {
                e.preventDefault()
                onEscapeRef.current?.()
            } else trapTab(e, panel)
        }
        document.addEventListener("keydown", onDocKey)
        return () => document.removeEventListener("keydown", onDocKey)
    }, [token, panelRef])

    return (e: KeyboardEvent<HTMLElement>) => {
        // The portal's React parents must not see this: an overlay inside a Dropdown or clickable row stays self-contained.
        e.stopPropagation()
        const panel = panelRef.current
        if (!panel || !isTopOverlay(token)) return
        if (e.key === "Escape") {
            if (e.defaultPrevented) return
            e.preventDefault()
            onEscapeRef.current?.()
        } else trapTab(e, panel)
    }
}
