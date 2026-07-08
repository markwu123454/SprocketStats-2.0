import { useEffect, useRef } from "react"

// ─── Time-wheel model: 5-minute slots from 6:00 AM to 11:55 PM ───────────────
const WHEEL_START = 6 * 60
const WHEEL_STEP = 5
const WHEEL_END = 23 * 60 + 55
const ITEM_H = 44

interface TimeSlot {
    big: string
    ampm: string
    mins: number
    hhmm: string
}

const TIME_SLOTS: TimeSlot[] = (() => {
    const slots: TimeSlot[] = []
    for (let mins = WHEEL_START; mins <= WHEEL_END; mins += WHEEL_STEP) {
        const h24 = Math.floor(mins / 60)
        const m = mins % 60
        const ampm = h24 < 12 ? "AM" : "PM"
        const h12 = h24 % 12 === 0 ? 12 : h24 % 12
        slots.push({
            big: `${h12}:${String(m).padStart(2, "0")}`,
            ampm,
            mins,
            hhmm: `${String(h24).padStart(2, "0")}:${String(m).padStart(2, "0")}`,
        })
    }
    return slots
})()

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n))
const idxToPos = (i: number) => 4 - i * ITEM_H

function hhmmToIdx(hhmm: string): number {
    const [h, m] = hhmm.split(":").map(Number)
    const mins = h * 60 + m
    return clamp(Math.round((mins - WHEEL_START) / WHEEL_STEP), 0, TIME_SLOTS.length - 1)
}

const fieldStyle = { background: "color-mix(in oklch, var(--theme-button-bg) 60%, transparent)", borderColor: "var(--theme-border)" }

/**
 * Drag-to-set time picker: 5-minute slots from 6:00 AM to 11:55 PM, with
 * momentum scrolling (pointer drag or wheel) that snaps to the nearest slot.
 * Shared by every page that needs a start/end time input (AttendancePage's
 * clock in/out, the admin Meeting Hours editor) so their physics never drift.
 */
export function TimeWheel({ label, value, onChange }: { label: string, value: string, onChange: (v: string) => void }) {
    const wheelRef = useRef<HTMLDivElement>(null)
    const stackRef = useRef<HTMLDivElement>(null)
    const posRef = useRef(hhmmToIdx(value))
    const velRef = useRef(0)
    const rafRef = useRef(0)
    const runningRef = useRef(false)
    const interactingRef = useRef(false)
    const dragRef = useRef<{ lastY: number, lastT: number } | null>(null)
    const lastEmitRef = useRef(value)
    const onChangeRef = useRef(onChange)
    onChangeRef.current = onChange

    // Keep the wheel in sync when the value is changed from outside (but never mid-interaction).
    useEffect(() => {
        if (interactingRef.current) return
        posRef.current = hhmmToIdx(value)
        lastEmitRef.current = value
        if (stackRef.current) stackRef.current.style.transform = `translateY(${idxToPos(posRef.current)}px)`
    }, [value])

    useEffect(() => {
        const el = wheelRef.current
        const stack = stackRef.current
        if (!el || !stack) return

        const apply = () => { stack.style.transform = `translateY(${idxToPos(posRef.current)}px)` }
        apply()

        const setPos = (p: number) => {
            p = clamp(p, 0, TIME_SLOTS.length - 1)
            posRef.current = p
            apply()
            const hhmm = TIME_SLOTS[Math.round(p)].hhmm
            if (hhmm !== lastEmitRef.current) {
                lastEmitRef.current = hhmm
                onChangeRef.current(hhmm)
            }
        }

        const cancel = () => { if (rafRef.current) cancelAnimationFrame(rafRef.current); runningRef.current = false }

        const snap = () => {
            const from = posRef.current
            const to = clamp(Math.round(from), 0, TIME_SLOTS.length - 1)
            const done = () => { interactingRef.current = false }
            if (Math.abs(from - to) < 0.001) { setPos(to); done(); return }
            const start = performance.now(), dur = 240
            const ease = (t: number) => 1 - Math.pow(1 - t, 3)
            const tick = (now: number) => {
                const t = Math.min(1, (now - start) / dur)
                setPos(from + (to - from) * ease(t))
                if (t < 1) rafRef.current = requestAnimationFrame(tick)
                else done()
            }
            rafRef.current = requestAnimationFrame(tick)
        }

        const spin = () => {
            runningRef.current = true
            const max = TIME_SLOTS.length - 1
            let last = performance.now()
            const tick = (now: number) => {
                const dt = Math.min(40, now - last); last = now
                let pos = posRef.current + velRef.current * dt
                velRef.current *= Math.pow(0.985, dt)
                if (pos < 0) { pos = 0; velRef.current = 0 }
                if (pos > max) { pos = max; velRef.current = 0 }
                setPos(pos)
                if (Math.abs(velRef.current) > 0.001) rafRef.current = requestAnimationFrame(tick)
                else { runningRef.current = false; snap() }
            }
            rafRef.current = requestAnimationFrame(tick)
        }

        const momentum = () => {
            if (Math.abs(velRef.current) < 0.001) { snap(); return }
            if (!runningRef.current) spin()
        }

        const onMove = (e: PointerEvent) => {
            if (!dragRef.current) return
            const { lastY, lastT } = dragRef.current
            const now = performance.now()
            const dy = e.clientY - lastY
            const dt = Math.max(1, now - lastT)
            const dIdx = -dy / ITEM_H
            setPos(posRef.current + dIdx)
            velRef.current = dIdx / dt
            dragRef.current.lastY = e.clientY
            dragRef.current.lastT = now
        }

        const onUp = () => {
            window.removeEventListener("pointermove", onMove)
            window.removeEventListener("pointerup", onUp)
            document.body.style.cursor = ""
            dragRef.current = null
            momentum()
        }

        const onDown = (e: PointerEvent) => {
            e.preventDefault()
            cancel()
            interactingRef.current = true
            dragRef.current = { lastY: e.clientY, lastT: performance.now() }
            velRef.current = 0
            window.addEventListener("pointermove", onMove)
            window.addEventListener("pointerup", onUp)
            document.body.style.cursor = "grabbing"
        }

        const onWheel = (e: WheelEvent) => {
            e.preventDefault()
            interactingRef.current = true
            cancel()

            const DIRECT_SENSITIVITY = 0.006
            const dIdx = clamp(e.deltaY * DIRECT_SENSITIVITY, -0.6, 0.6)
            setPos(posRef.current + dIdx)

            const cap = 0.02
            velRef.current = clamp(dIdx * 0.15, -cap, cap)

            if (runningRef.current) return
            spin()
        }

        el.addEventListener("pointerdown", onDown)
        el.addEventListener("wheel", onWheel, { passive: false })
        return () => {
            el.removeEventListener("pointerdown", onDown)
            el.removeEventListener("wheel", onWheel)
            window.removeEventListener("pointermove", onMove)
            window.removeEventListener("pointerup", onUp)
            cancel()
        }
    }, [])

    return (
        <div className="relative rounded-lg border overflow-hidden h-[58px]" style={fieldStyle}>
            <div
                ref={wheelRef}
                className="absolute inset-0 cursor-grab touch-none select-none"
                style={{ WebkitMaskImage: "linear-gradient(180deg,transparent,#000 30%,#000 70%,transparent)", maskImage: "linear-gradient(180deg,transparent,#000 30%,#000 70%,transparent)" }}
            >
                <div ref={stackRef} style={{ willChange: "transform" }}>
                    {TIME_SLOTS.map((t) => (
                        <div key={t.hhmm} className="h-11 flex items-center justify-end gap-1.5 pr-[22px]">
                            <span className="font-mono text-[23px] font-bold theme-h1-color">{t.big}</span>
                            <span className="text-xs theme-subtext-color">{t.ampm}</span>
                        </div>
                    ))}
                </div>
            </div>
            <div className="absolute top-0 bottom-0 left-4 flex items-center font-mono text-[15px] font-bold tracking-wide uppercase theme-text pointer-events-none z-[2]">
                {label}
            </div>
        </div>
    )
}
