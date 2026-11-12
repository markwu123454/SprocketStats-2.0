import { Link } from "react-router-dom"
import { ChevronRight, UserX } from "lucide-react"
import { focusRing } from "@/lib/uiClasses"
import type { MeetingAbsence } from "@/lib/meetings"

/** Names shown before the rest collapse into "+N more". */
const MAX_NAMES = 6

interface NextMeetingAbsencesCardProps {
    /** Already filtered by the server to the members this viewer may see. */
    absences: MeetingAbsence[]
    /** e.g. "Build session · Today" */
    meetingLabel: string
}

/**
 * Dashboard card for leads, captains and mentors: who reported they'll miss
 * the current or next meeting. Names only -- reasons stay on the Meetings
 * page, one tap away, since the dashboard is the screen most likely to be
 * seen over someone's shoulder. The caller renders it only when someone's out.
 */
export default function NextMeetingAbsencesCard({ absences, meetingLabel }: NextMeetingAbsencesCardProps) {
    const shown = absences.slice(0, MAX_NAMES)
    const hidden = absences.length - shown.length
    return (
        <Link
            to="/meetings"
            className={`rounded-xl border p-5 flex flex-col gap-3 backdrop-blur-sm transition-opacity hover:opacity-90 ${focusRing}`}
            style={{ background: "var(--theme-bg)", borderColor: "var(--theme-border)" }}
        >
            <div className="flex items-center justify-between">
                <span className="text-sm font-medium theme-text opacity-70">Out next meeting</span>
                <UserX size={18} className="theme-text-contrast opacity-80" aria-hidden="true" />
            </div>
            <div className="min-w-0">
                <p className="text-lg font-semibold theme-text">{absences.length} absent</p>
                <p className="text-sm theme-subtext-color break-words">{meetingLabel}</p>
            </div>
            <ul className="flex flex-wrap gap-1.5" aria-label="Absent members">
                {shown.map(absence => (
                    <li key={absence.user_id} className="max-w-full truncate rounded-full border theme-border px-2.5 py-0.5 text-sm theme-text">
                        {absence.display_name}
                    </li>
                ))}
                {hidden > 0 && <li className="px-1 py-0.5 text-sm theme-subtext-color">+{hidden} more</li>}
            </ul>
            <span className="mt-auto flex items-center gap-1 text-sm font-semibold theme-text-contrast">See reasons<ChevronRight size={16} aria-hidden="true" /></span>
        </Link>
    )
}
