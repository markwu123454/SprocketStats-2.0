import { X } from "lucide-react"
import { meetingTime, type Meeting, type MeetingAbsence } from "@/lib/meetings"
import { typeBadge } from "@/lib/uiClasses"

function reportedAt(iso: string): string {
    const d = new Date(iso)
    const day = d.toLocaleDateString("en-US", { month: "short", day: "numeric" })
    return `${day}, ${d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}`
}

/** One reported absence. Upcoming meetings get a dashed border; finished ones a solid one. */
export default function AbsenceCard({ meeting, absence, upcoming }: { meeting: Meeting, absence: MeetingAbsence, upcoming: boolean }) {
    const start = new Date(meeting.start_time)
    const dash = upcoming ? "border-dashed" : "border-solid"
    return (
        <li className={`list-none flex gap-3.5 md:gap-4 md:flex-wrap items-start px-4 py-3.5 md:px-[18px] md:py-4 rounded-xl border theme-bg ${upcoming ? "border-dashed theme-outline" : "theme-border"}`}>
            <div aria-hidden="true" className={`flex flex-none flex-col items-center justify-center w-14 h-14 md:w-16 md:h-16 box-border rounded-xl border ${dash} theme-outline`}>
                <span className={`${typeBadge} theme-subtext-color`}>{start.toLocaleDateString("en-US", { month: "short" })}</span>
                <span className="text-[22px] md:text-2xl leading-none font-bold theme-h1-color">{start.getDate()}</span>
            </div>
            <div className="flex-1 min-w-0 md:basis-[280px] flex flex-col gap-1.5 md:gap-2.5">
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                    <div className="flex flex-col md:flex-row md:items-center md:gap-3 min-w-0">
                        <span className="text-base font-semibold theme-h1-color break-words">{meeting.meeting_purpose || "Team meeting"}</span>
                        <span className="text-[13px] md:text-sm theme-subtext-color">
                            <span className="sr-only">{start.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" })}, </span>
                            {start.toLocaleDateString("en-US", { weekday: "short" })} · {meetingTime(meeting)}
                        </span>
                    </div>
                    <span className="inline-flex items-center gap-1.5 min-h-6 md:min-h-7 text-[13px] font-semibold theme-text-contrast">
                        <X size={14} strokeWidth={2.5} aria-hidden="true"/>
                        {upcoming ? "Absent ahead of time" : "Absent"}
                    </span>
                </div>
                <div className="flex flex-col gap-1">
                    <span className="text-base theme-text break-words whitespace-pre-wrap">{absence.reason || "No reason given"}</span>
                    <span className="text-xs theme-subtext-color">Reported {reportedAt(absence.created_at)}</span>
                </div>
            </div>
        </li>
    )
}
