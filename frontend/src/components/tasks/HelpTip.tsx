import { useEffect, useRef, useState } from "react"

/**
 * Small "?" next to a form label. Hovering (desktop) or tapping (mobile)
 * shows a one-line explanation of the field; tapping again, or anywhere
 * else, hides it.
 */
export default function HelpTip({ text }: { text: string }) {
    const [hovered, setHovered] = useState(false)
    const [pinned, setPinned] = useState(false)
    const [alignRight, setAlignRight] = useState(false)
    const ref = useRef<HTMLSpanElement>(null)
    const open = hovered || pinned

    useEffect(() => {
        if (!pinned) return
        function onDocPointerDown(e: PointerEvent) {
            if (!ref.current?.contains(e.target as Node)) setPinned(false)
        }
        document.addEventListener("pointerdown", onDocPointerDown)
        return () => document.removeEventListener("pointerdown", onDocPointerDown)
    }, [pinned])

    // Open toward whichever side has room, so a tip on a right-hand field
    // doesn't run off a phone screen.
    function measure() {
        const rect = ref.current?.getBoundingClientRect()
        if (rect) setAlignRight(rect.left > window.innerWidth / 2)
    }

    return (
        <span
            ref={ref}
            style={{ position: "relative", display: "inline-flex", verticalAlign: "middle" }}
            onMouseEnter={() => { measure(); setHovered(true) }}
            onMouseLeave={() => setHovered(false)}
        >
            <button
                type="button"
                aria-label="What is this?"
                aria-expanded={open}
                onClick={e => { e.preventDefault(); e.stopPropagation(); measure(); setPinned(v => !v) }}
                style={{
                    font: "inherit", width: 15, height: 15, borderRadius: "50%", padding: 0, cursor: "help",
                    display: "grid", placeItems: "center", fontSize: 10, fontWeight: 700, lineHeight: 1,
                    letterSpacing: 0, textTransform: "none",
                    border: "1px solid var(--theme-border)", background: "transparent",
                    color: open ? "var(--theme-text-contrast)" : "var(--theme-subtext-color)",
                }}
            >
                ?
            </button>
            {open && (
                <span
                    role="tooltip"
                    style={{
                        position: "absolute", top: "calc(100% + 6px)", zIndex: 50, width: 220,
                        ...(alignRight ? { right: -4 } : { left: -4 }),
                        border: "1px solid var(--theme-border)", borderRadius: 8, background: "var(--theme-bg)",
                        padding: "8px 10px", boxShadow: "0 12px 28px rgba(0,0,0,0.5)",
                        fontSize: 12, fontWeight: 400, lineHeight: 1.45, letterSpacing: 0, textTransform: "none",
                        color: "var(--theme-text)", whiteSpace: "normal",
                    }}
                >
                    {text}
                </span>
            )}
        </span>
    )
}
