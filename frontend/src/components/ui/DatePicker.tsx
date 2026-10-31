import { useEffect, useId, useLayoutEffect, useRef, useState } from "react"
import { createPortal } from "react-dom"
import { Calendar, ChevronDown, ChevronLeft, ChevronRight } from "lucide-react"
import Button from "./Button"
import Sheet from "./Sheet"
import { useIsMobile } from "@/lib/useIsMobile"
import { focusRing, inputClass } from "@/lib/uiClasses"

interface DatePickerProps {
    value: string
    onChange: (value: string) => void
    label: string
    prefix?: string
    min?: string
    markedDates?: ReadonlySet<string>
    disabled?: boolean
}

function parseDate(value: string) {
    const [year, month, day] = value.split("-").map(Number)
    return new Date(year, month - 1, day)
}

function dateKey(date: Date) {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`
}

const dateLabel = (date: Date) => date.toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric", year: "numeric" })

/** Shared Sprocket calendar: anchored on desktop, a drag sheet on mobile. */
export default function DatePicker({ value, onChange, label, prefix, min, markedDates, disabled }: DatePickerProps) {
    const [open, setOpen] = useState(false)
    const [month, setMonth] = useState(() => parseDate(value || dateKey(new Date())))
    const [position, setPosition] = useState({ top: 0, left: 0 })
    const trigger = useRef<HTMLButtonElement>(null)
    const panel = useRef<HTMLDivElement>(null)
    const id = useId()
    const mobile = useIsMobile()
    const close = () => { setOpen(false); trigger.current?.focus() }

    useLayoutEffect(() => {
        if (!open || mobile || !panel.current || !trigger.current) return
        const anchor = trigger.current.getBoundingClientRect()
        const box = panel.current.getBoundingClientRect()
        setPosition({
            left: Math.max(16, Math.min(anchor.left, window.innerWidth - box.width - 16)),
            top: Math.max(16, Math.min(anchor.bottom + 4, window.innerHeight - box.height - 16)),
        })
        panel.current.querySelector<HTMLButtonElement>("[aria-pressed='true']:not(:disabled), [data-day]:not(:disabled)")?.focus()
    }, [open, mobile])

    useEffect(() => {
        if (!open || mobile) return
        const dismiss = () => { setOpen(false); trigger.current?.focus() }
        const scroll = (event: Event) => { if (!panel.current?.contains(event.target as Node)) dismiss() }
        window.addEventListener("resize", dismiss)
        window.addEventListener("scroll", scroll, true)
        return () => {
            window.removeEventListener("resize", dismiss)
            window.removeEventListener("scroll", scroll, true)
        }
    }, [open, mobile])

    const year = month.getFullYear()
    const monthIndex = month.getMonth()
    const offset = new Date(year, monthIndex, 1).getDay()
    const count = new Date(year, monthIndex + 1, 0).getDate()
    const calendar = <>
        <div className="flex items-center justify-between gap-2 mb-3">
            <Button variant="icon" aria-label="Previous month" onClick={() => setMonth(new Date(year, monthIndex - 1, 1))}><ChevronLeft size={16} /></Button>
            <span className="text-sm font-semibold theme-h1-color" aria-live="polite">{month.toLocaleDateString("en-US", { month: "long", year: "numeric" })}</span>
            <Button variant="icon" aria-label="Next month" onClick={() => setMonth(new Date(year, monthIndex + 1, 1))}><ChevronRight size={16} /></Button>
        </div>
        <div className="grid grid-cols-7 gap-1">
            {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map(day => <span key={day} className="text-center text-xs theme-subtext-color py-2">{day}</span>)}
            {Array.from({ length: offset }, (_, index) => <span key={`blank-${index}`} />)}
            {Array.from({ length: count }, (_, index) => {
                const date = new Date(year, monthIndex, index + 1)
                const key = dateKey(date)
                const selected = key === value
                return <button key={key} type="button" data-day aria-label={`${dateLabel(date)}${markedDates?.has(key) ? ", meeting scheduled" : ""}`}
                    aria-pressed={selected} aria-current={key === dateKey(new Date()) ? "date" : undefined}
                    disabled={!!min && key < min}
                    className={`relative h-11 min-w-0 rounded-lg font-mono text-sm disabled:opacity-40 disabled:cursor-not-allowed ${selected ? "theme-accent-fill font-bold" : "theme-text hover:theme-button-bg"} ${focusRing}`}
                    onClick={() => { onChange(key); close() }}>
                    {index + 1}
                    {markedDates?.has(key) && !selected && <span className="absolute bottom-1 left-1/2 -translate-x-1/2 w-1 h-1 rounded-full theme-accent-fill" />}
                </button>
            })}
        </div>
    </>

    return <>
        <button ref={trigger} type="button" disabled={disabled} aria-label={`${label}: ${value ? dateLabel(parseDate(value)) : "Choose date"}`}
            aria-haspopup="dialog" aria-expanded={open} aria-controls={open && !mobile ? id : undefined}
            className={`w-full min-w-0 h-11 flex items-center gap-2 text-left ${inputClass}`}
            onClick={() => { setMonth(parseDate(value || min || dateKey(new Date()))); setOpen(value => !value) }}>
            <Calendar size={16} className="theme-subtext-color shrink-0" aria-hidden="true" />
            {prefix && <span className="theme-subtext-color shrink-0">{prefix}</span>}
            <span className="truncate">{value ? dateLabel(parseDate(value)) : "Choose date"}</span>
            <ChevronDown size={14} className="theme-subtext-color shrink-0 ml-auto" aria-hidden="true" />
        </button>
        {open && (mobile ? <Sheet title={label} kind="menu" onClose={close}>{calendar}</Sheet> : createPortal(<>
            <div className="fixed inset-0 z-40" onClick={close} />
            <div ref={panel} id={id} role="dialog" aria-label={label}
                className="fixed z-40 w-96 max-w-[calc(100vw-2rem)] max-h-[calc(100dvh-2rem)] overflow-auto rounded-xl border p-3 shadow-lg theme-bg theme-border"
                style={position} onKeyDown={event => {
                    if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); close() }
                    if (event.key === "Tab") {
                        const buttons = [...event.currentTarget.querySelectorAll<HTMLButtonElement>("button:not(:disabled)")]
                        const first = buttons[0], last = buttons[buttons.length - 1]
                        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus() }
                        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus() }
                    }
                }}>{calendar}</div>
        </>, document.body))}
    </>
}
