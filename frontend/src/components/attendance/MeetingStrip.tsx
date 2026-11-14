import { X } from "lucide-react"

// One box per meeting, oldest to newest. Shape carries the meaning, never colour alone:
// filled = attended, hollow = missed, hollow with an X = absent ahead of time, dashed = scheduled.
const BOX = "flex-1 min-w-0 box-border"
const FILLED = "bg-[var(--theme-text-contrast)]"
const HOLLOW = "border-2 border-solid theme-outline"
const DASHED = "border-2 border-dashed border-[var(--theme-subtext-color)]"

function plural(n: number): string {
    return n === 1 ? "meeting" : "meetings"
}

function pastLabel(past: ("attended" | "missed")[]): string {
    if (past.length === 0) return "No past meetings"
    const attended = past.filter(b => b === "attended").length
    return `${attended} of the last ${past.length} ${plural(past.length)} attended`
}

/** The small strip in a roster row: finished meetings only. */
export function RosterStrip({ past }: { past: ("attended" | "missed")[] }) {
    if (past.length === 0) return null
    return (
        <span role="img" aria-label={pastLabel(past)} className="flex gap-[3px]">
            {past.map((box, i) => <span key={i} className={`${BOX} max-w-[calc((100%-27px)/10)] h-2 rounded-[2px] ${box === "attended" ? FILLED : HOLLOW}`}/>)}
        </span>
    )
}

/** The detail strip: the last finished meetings, a gap, then the next scheduled ones. */
export function MeetingStrip({ past, upcoming }: { past: ("attended" | "missed")[], upcoming: ("absent" | "scheduled")[] }) {
    const label = upcoming.length ? `${pastLabel(past)}, then ${upcoming.length} scheduled` : pastLabel(past)
    // Capped so a short history reads as boxes, not a bar.
    const box = "max-w-10 h-[18px] md:h-4 rounded-[3px]"
    return (
        <div role="img" aria-label={label} className="flex gap-[3px]">
            {past.map((b, i) => <span key={`p${i}`} className={`${BOX} ${box} ${b === "attended" ? FILLED : HOLLOW}`}/>)}
            {past.length > 0 && upcoming.length > 0 && <span className="flex-none w-2.5 md:w-3.5"/>}
            {upcoming.map((b, i) => b === "absent"
                ? <span key={`u${i}`} className={`${BOX} ${box} ${HOLLOW} flex items-center justify-center theme-text`}>
                    <X size={10} strokeWidth={4} aria-hidden="true"/>
                </span>
                : <span key={`u${i}`} className={`${BOX} ${box} ${DASHED}`}/>)}
        </div>
    )
}

/** What each box shape means. */
export function StripLegend() {
    const item = "inline-flex items-center gap-1.5 md:gap-2"
    return (
        <div className="flex flex-wrap gap-x-4 gap-y-1.5 md:gap-x-5 md:gap-y-2 text-xs theme-subtext-color">
            <span className={item}><span aria-hidden="true" className={`w-3.5 h-2 rounded-[2px] ${FILLED}`}/>Attended</span>
            <span className={item}><span aria-hidden="true" className={`box-border w-3.5 h-2 rounded-[2px] ${HOLLOW}`}/>Missed</span>
            <span className={item}>
                <span aria-hidden="true" className={`box-border inline-flex items-center justify-center w-3.5 h-3.5 rounded-[3px] ${HOLLOW} theme-text`}>
                    <X size={8} strokeWidth={4}/>
                </span>
                Absent ahead of time
            </span>
            <span className={item}><span aria-hidden="true" className={`box-border w-3.5 h-2 rounded-[2px] ${DASHED}`}/>Scheduled</span>
        </div>
    )
}
