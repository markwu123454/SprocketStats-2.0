import { useEffect, useRef, forwardRef } from "react"
import { useEventContext } from "@/contexts/eventContext"
import type { ItineraryItem } from "@/lib/eventApi"

function formatTime(iso: string): string {
    return new Date(iso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })
}

type Row =
    | { type: "day";  label: string }
    | { type: "item"; item: ItineraryItem; isPast: boolean }
    | { type: "now" }

function buildRows(items: ItineraryItem[], now: number): Row[] {
    const rows: Row[] = []
    let currentDay = ""
    let nowInserted = false

    for (let i = 0; i < items.length; i++) {
        const item    = items[i]
        const isPast  = new Date(item.dt).getTime() <= now
        const dayLabel = new Date(item.dt).toLocaleDateString("en-US", {
            weekday: "long", month: "long", day: "numeric",
        })

        if (dayLabel !== currentDay) {
            currentDay = dayLabel
            rows.push({ type: "day", label: dayLabel })
        }

        // Insert NOW line before the first future item (but only if there's at least one past item)
        if (!isPast && !nowInserted && i > 0) {
            rows.push({ type: "now" })
            nowInserted = true
        }

        rows.push({ type: "item", item, isPast })
    }

    // All items are past — append NOW at the end
    if (!nowInserted && items.some(i => new Date(i.dt).getTime() <= now)) {
        rows.push({ type: "now" })
    }

    return rows
}

export default function ItineraryPage() {
    const { info, loading } = useEventContext()
    const nowRef = useRef<HTMLDivElement>(null)

    useEffect(() => {
        if (nowRef.current) {
            nowRef.current.scrollIntoView({ behavior: "smooth", block: "center" })
        }
    }, [loading])

    if (loading) return <PageState>Loading…</PageState>
    if (!info?.itinerary?.length) return <PageState>Itinerary not yet posted.</PageState>

    const rows = buildRows(info.itinerary, Date.now())

    return (
        <div className="max-w-xl mx-auto px-4 py-6">
            <div
                className="rounded-xl border overflow-hidden"
                style={{ background: "var(--theme-bg)", borderColor: "var(--theme-border)" }}
            >
                {rows.map((row, i) => {
                    if (row.type === "day") return <DayHeader key={i} label={row.label} />
                    if (row.type === "now") return <NowLine key={i} ref={nowRef} />
                    return <ItemRow key={i} item={row.item} isPast={row.isPast} />
                })}
            </div>
        </div>
    )
}

function DayHeader({ label }: { label: string }) {
    return (
        <div
            className="px-4 py-2.5 border-b"
            style={{
                borderColor: "var(--theme-border)",
                background: "color-mix(in oklch, var(--theme-bg) 60%, var(--theme-border))",
            }}
        >
            <span
                className="text-[11px] font-bold tracking-wider uppercase"
                style={{ color: "var(--theme-subtext-color)" }}
            >
                {label}
            </span>
        </div>
    )
}

const NowLine = forwardRef<HTMLDivElement>((_, ref) => (
    <div
        ref={ref}
        className="flex items-center gap-2 px-4 py-1.5 border-y"
        style={{
            borderColor: "#ef4444",
            background: "#ef444410",
        }}
    >
        <div className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: "#ef4444" }} />
        <span className="text-[10px] font-bold tracking-widest uppercase" style={{ color: "#ef4444" }}>
            Now
        </span>
    </div>
))

function ItemRow({ item, isPast }: { item: ItineraryItem; isPast: boolean }) {
    return (
        <div
            className="flex items-start gap-3 px-4 py-3 border-b last:border-0 transition-opacity"
            style={{
                borderColor: "var(--theme-border)",
                opacity: isPast ? 0.4 : 1,
            }}
        >
            <span
                className="text-sm font-mono w-16 shrink-0 pt-0.5"
                style={{ color: "var(--theme-subtext-color)" }}
            >
                {formatTime(item.dt)}
            </span>
            <div className="flex flex-col gap-0.5">
                <span className="text-sm font-medium" style={{ color: "var(--theme-text)" }}>
                    {item.label}
                </span>
                {item.detail && (
                    <span className="text-xs" style={{ color: "var(--theme-subtext-color)" }}>
                        {item.detail}
                    </span>
                )}
            </div>
        </div>
    )
}

function PageState({ children }: { children: string }) {
    return (
        <div className="flex items-center justify-center py-16">
            <span className="text-sm" style={{ color: "var(--theme-subtext-color)" }}>{children}</span>
        </div>
    )
}
