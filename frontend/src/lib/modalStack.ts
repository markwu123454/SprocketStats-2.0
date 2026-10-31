/**
 * Shared bookkeeping for overlay surfaces (Sheet, ConfirmDialog): a stack so only the
 * topmost handles Esc and Tab, a nesting-safe scroll lock, and focus helpers.
 */

const stack: symbol[] = []

/** Register an overlay; returns a function that unregisters it. */
export function pushOverlay(token: symbol): () => void {
    stack.push(token)
    return () => {
        const i = stack.indexOf(token)
        if (i >= 0) stack.splice(i, 1)
    }
}

export function isTopOverlay(token: symbol): boolean {
    return stack[stack.length - 1] === token
}

let lockCount = 0
let prevOverflow = ""

/** Lock page scroll; nested locks share one counter and the original overflow is restored by the last release. */
export function lockScroll(): () => void {
    if (lockCount === 0) {
        prevOverflow = document.body.style.overflow
        document.body.style.overflow = "hidden"
    }
    lockCount++
    let released = false
    return () => {
        if (released) return
        released = true
        lockCount--
        if (lockCount === 0) document.body.style.overflow = prevOverflow
    }
}

const FOCUSABLE =
    'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

function focusables(container: HTMLElement): HTMLElement[] {
    return Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE))
        .filter(el => el.getClientRects().length > 0 && getComputedStyle(el).visibility !== "hidden")
}

/** Keydown-based Tab cycle inside `container`. Call from the topmost overlay's keydown handler. */
export function trapTab(e: {key: string, shiftKey: boolean, preventDefault: () => void}, container: HTMLElement) {
    if (e.key !== "Tab") return
    const items = focusables(container)
    if (items.length === 0) {
        e.preventDefault()
        container.focus()
        return
    }
    const first = items[0]
    const last = items[items.length - 1]
    const active = document.activeElement as HTMLElement | null
    if (!active || !container.contains(active) || active === container) {
        e.preventDefault();
        (e.shiftKey ? last : first).focus()
    } else if (e.shiftKey && active === first) {
        e.preventDefault()
        last.focus()
    } else if (!e.shiftKey && active === last) {
        e.preventDefault()
        first.focus()
    }
}

export function prefersReducedMotion(): boolean {
    return typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true
}
