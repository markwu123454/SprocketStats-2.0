/**
 * The page's height and the part of it actually on screen, mirrored into CSS
 * variables on <html>:
 *
 *   --app-vh   the page's height (the layout viewport), which a phone keyboard
 *              doesn't change. The app shell is this tall.
 *   --real-vh  the on-screen height (the visual viewport), which shrinks while a
 *              phone keyboard is open
 *   --vv-top   how far the on-screen area has slid down the page
 *
 * On iOS an open keyboard doesn't resize the page: it shrinks the visual
 * viewport, and Safari slides it down to reveal a focused field the keyboard
 * would cover. So the shell stays the page's full height (--app-vh) and slides
 * with it, the usual way a web page moves for the keyboard. Sizing the shell to
 * the on-screen height instead left it shorter than the page, so the slide
 * showed blank page under it.
 *
 * Overlays are the opposite: anything `position: fixed` stays pinned to the
 * page, not to what's on screen, so a sheet placed with `top: 0` slides up with
 * the page. Overlays pin themselves to the on-screen area with `visibleAreaStyle`.
 */

type ViewportWindow = Pick<Window, "innerHeight" | "addEventListener" | "removeEventListener" | "document" | "visualViewport">

/** Write the variables from the current layout and visual viewports. */
export function syncViewportVars(win: ViewportWindow = window): void {
    const vv = win.visualViewport
    const style = win.document.documentElement.style
    style.setProperty("--app-vh", `${win.innerHeight}px`)
    style.setProperty("--real-vh", `${vv?.height ?? win.innerHeight}px`)
    // iOS reports a brief negative offset while rubber-banding at the top.
    style.setProperty("--vv-top", `${Math.max(0, vv?.offsetTop ?? 0)}px`)
}

/** Keep the variables current: the viewport resizes when the keyboard opens and scrolls when Safari slides it. */
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
