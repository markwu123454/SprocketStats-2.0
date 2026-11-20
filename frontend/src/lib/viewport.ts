/**
 * The visual viewport (the part of the page actually on screen), mirrored into
 * two CSS variables on <html>:
 *
 *   --real-vh  its height, which shrinks while a phone keyboard is open
 *   --vv-top   how far it has slid down the page
 *
 * On iOS an open keyboard shrinks the visual viewport, and Safari slides it down
 * to reveal a focused field that the keyboard would cover. Anything
 * `position: fixed` stays pinned to the page, not to what is on screen, so a
 * sheet placed with `top: 0` slides up with the page and leaves a blank gap above
 * the keyboard. Overlays pin themselves with `visibleAreaStyle` instead.
 */

type ViewportWindow = Pick<Window, "innerHeight" | "addEventListener" | "removeEventListener" | "document" | "visualViewport">

/** Write both variables from the current visual viewport. */
export function syncViewportVars(win: ViewportWindow = window): void {
    const vv = win.visualViewport
    const style = win.document.documentElement.style
    style.setProperty("--real-vh", `${vv?.height ?? win.innerHeight}px`)
    // iOS reports a brief negative offset while rubber-banding at the top.
    style.setProperty("--vv-top", `${Math.max(0, vv?.offsetTop ?? 0)}px`)
}

/** Keep both variables current: the viewport resizes when the keyboard opens and scrolls when Safari slides it. */
export function watchViewport(win: ViewportWindow = window): () => void {
    const sync = () => syncViewportVars(win)
    sync()
    win.visualViewport?.addEventListener("resize", sync)
    win.visualViewport?.addEventListener("scroll", sync)
    win.addEventListener("resize", sync)
    return () => {
        win.visualViewport?.removeEventListener("resize", sync)
        win.visualViewport?.removeEventListener("scroll", sync)
        win.removeEventListener("resize", sync)
    }
}

/** Inline style that keeps a `fixed` overlay over exactly what is on screen. Pair it with `inset-x-0`, not `inset-0`/`top-0`. */
export const visibleAreaStyle = {top: "var(--vv-top, 0px)", height: "var(--real-vh, 100dvh)"} as const
