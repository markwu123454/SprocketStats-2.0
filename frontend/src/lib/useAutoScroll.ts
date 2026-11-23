import { type RefObject, useEffect } from "react"

// A column on the TV that holds more than fits scrolls itself, so nothing on
// it stays hidden: slowly down, a pause at the bottom, back to the top, a pause.
// Touching or scrolling it hands it over to the person for a while.
const PX_PER_SECOND = 28
const PAUSE_MS = 4000
const HANDS_OFF_MS = 20000
// With reduced motion, jump a page at a time instead of gliding.
const PAGE_MS = 8000

export function useAutoScroll(ref: RefObject<HTMLElement | null>, enabled: boolean) {
    useEffect(() => {
        const el = ref.current
        if (!el || !enabled) return
        const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches
        let raf = 0
        let last = performance.now()
        let resumeAt = last + PAUSE_MS
        let pos = el.scrollTop

        const handsOff = () => { resumeAt = performance.now() + HANDS_OFF_MS }
        el.addEventListener("pointerdown", handsOff)
        el.addEventListener("wheel", handsOff, { passive: true })
        el.addEventListener("touchstart", handsOff, { passive: true })

        const step = (t: number) => {
            // Capped, so a frame after the screen slept doesn't leap.
            const dt = Math.min(t - last, 100)
            last = t
            const max = el.scrollHeight - el.clientHeight
            if (max <= 1) {
                pos = 0
            } else if (t < resumeAt) {
                pos = el.scrollTop
            } else if (pos >= max - 1) {
                // Rested at the bottom: back to the top, and rest there.
                pos = 0
                el.scrollTo({ top: 0, behavior: reduced ? "auto" : "smooth" })
                resumeAt = t + PAUSE_MS
            } else if (reduced) {
                pos = Math.min(max, pos + el.clientHeight * 0.9)
                el.scrollTop = pos
                resumeAt = t + PAGE_MS
            } else {
                pos = Math.min(max, pos + (dt / 1000) * PX_PER_SECOND)
                el.scrollTop = pos
                if (pos >= max - 1) resumeAt = t + PAUSE_MS
            }
            raf = requestAnimationFrame(step)
        }
        raf = requestAnimationFrame(step)
        return () => {
            cancelAnimationFrame(raf)
            el.removeEventListener("pointerdown", handsOff)
            el.removeEventListener("wheel", handsOff)
            el.removeEventListener("touchstart", handsOff)
        }
    }, [ref, enabled])
}
