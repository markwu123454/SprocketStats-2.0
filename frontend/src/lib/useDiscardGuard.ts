/**
 * "Discard changes?" for every way a dirty form can be left (design-system/forms.md rule 7).
 *
 *  - `confirmDiscard()` is for the form's own Cancel / close controls.
 *  - While dirty the hook also guards a browser tab close (`beforeunload`), in-app link
 *    navigation (a capture-phase click listener: the app uses BrowserRouter, which has no
 *    `useBlocker`), and the enclosing `Sheet` (scrim, Esc, close button, handle, drag).
 *  - Prompts are de-duplicated: while one is open every caller shares its answer, and the
 *    document listeners are installed once however many guards are dirty.
 *
 * Browser Back is NOT guarded: BrowserRouter exposes no reliable way to cancel a popstate.
 */
import {createContext, useCallback, useContext, useEffect, useLayoutEffect, useRef, useState} from "react"
import {confirmDialog} from "./confirmDialog"

/** True when two snapshots differ (JSON equality; the forms hold plain data). */
export function isDirtyVs(current: unknown, initial: unknown): boolean {
    return JSON.stringify(current) !== JSON.stringify(initial)
}

/**
 * True once `current` differs from what it was on the form's first render (the values it opened with).
 * For a form that is remounted per record, call it after all the form's state hooks.
 */
export function useIsDirty(current: unknown): boolean {
    const [opened] = useState(current)
    return isDirtyVs(current, opened)
}

let inFlight: Promise<boolean> | null = null

/** Ask "Discard changes?". Concurrent callers share one dialog and one answer. */
export function askDiscard(): Promise<boolean> {
    if (inFlight) return inFlight
    const p = confirmDialog({title: "Discard changes?", body: "Your edits will be lost.", confirmLabel: "Discard", danger: true})
    inFlight = p
    const clear = () => { if (inFlight === p) inFlight = null }
    p.then(clear, clear)
    return p
}

// ── Document-level guards, shared by every dirty form ───────────────────────
const activeGuards = new Set<symbol>()
let bypass = false

function onBeforeUnload(e: BeforeUnloadEvent) {
    e.preventDefault()
    e.returnValue = ""
}

/** Which link clicks to hold back: plain left-clicks on same-origin links that change the page. */
export function shouldGuardClick(e: MouseEvent, anchor: HTMLAnchorElement | null, loc: Location = window.location): boolean {
    if (bypass || e.defaultPrevented || e.button !== 0) return false
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return false
    if (!anchor) return false
    if (anchor.target && anchor.target !== "_self") return false
    if (anchor.hasAttribute("download")) return false
    let url: URL
    try { url = new URL(anchor.href, loc.href) } catch { return false }
    if (url.origin !== loc.origin) return false // leaving the app: beforeunload covers it
    return url.pathname !== loc.pathname || url.search !== loc.search
}

function onClickCapture(e: MouseEvent) {
    const anchor = (e.target as Element | null)?.closest?.("a[href]") as HTMLAnchorElement | null
    if (!shouldGuardClick(e, anchor)) return
    e.preventDefault()
    e.stopPropagation()
    void askDiscard().then(ok => {
        if (!ok || !anchor) return
        bypass = true
        try { anchor.click() } finally { bypass = false }
    })
}

function addGuard(token: symbol) {
    if (activeGuards.size === 0) {
        window.addEventListener("beforeunload", onBeforeUnload)
        document.addEventListener("click", onClickCapture, true)
    }
    activeGuards.add(token)
}

function removeGuard(token: symbol) {
    activeGuards.delete(token)
    if (activeGuards.size === 0) {
        window.removeEventListener("beforeunload", onBeforeUnload)
        document.removeEventListener("click", onClickCapture, true)
    }
}

/** Resolves true when no guarded form is dirty; otherwise asks once. For controls outside the form that replace it (another row's edit button). */
export function confirmAnyDiscard(): Promise<boolean> {
    return activeGuards.size > 0 ? askDiscard() : Promise.resolve(true)
}

/** Provided by `Sheet`: a form inside a sheet registers here so every sheet dismissal asks first. */
export const SheetDirtyContext = createContext<(() => () => void) | null>(null)

/**
 * `dirty` = the form's values differ from the values it opened with.
 * Returns `confirmDiscard()`: resolves true at once when clean, otherwise asks "Discard changes?".
 * Call it before a Cancel / close handler, and run the handler only on true.
 */
export function useDiscardGuard(dirty: boolean): () => Promise<boolean> {
    const dirtyRef = useRef(dirty)
    const registerWithSheet = useContext(SheetDirtyContext)

    useLayoutEffect(() => { dirtyRef.current = dirty })

    useEffect(() => {
        if (!dirty) return
        const token = Symbol("discard-guard")
        addGuard(token)
        const releaseSheet = registerWithSheet?.()
        return () => {
            removeGuard(token)
            releaseSheet?.()
        }
    }, [dirty, registerWithSheet])

    return useCallback(() => (dirtyRef.current ? askDiscard() : Promise.resolve(true)), [])
}
