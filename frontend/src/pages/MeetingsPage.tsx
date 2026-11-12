import { useEffect, useMemo, useState } from "react"
import { Link } from "react-router-dom"
import Button from "@/components/ui/Button"
import Notice from "@/components/ui/Notice"
import Skeleton from "@/components/ui/Skeleton"
import EmptyState from "@/components/ui/EmptyState"
import { useOnboardedUser } from "@/contexts/authContext"
import { MeetingAbsenceRow } from "@/components/meetings/MeetingAbsence"
import { can, getPerm } from "@/lib/permissions"
import { focusRing } from "@/lib/uiClasses"
import { absencesByMeeting, meetingDate, meetingTime, relativeDayLabel, upcomingMeetings, useMeetingAbsences, useMeetings, useRoleLabels } from "@/lib/meetings"

const CARD_BG = "bg-[color-mix(in_oklch,var(--theme-bg)_92%,transparent)]"
const eyebrow = "text-[11px] font-bold tracking-[0.1em] uppercase"

export default function MeetingsPage() {
    const user = useOnboardedUser()
    const { meetings, loading, error, retry } = useMeetings()
    const [absenceRevision, setAbsenceRevision] = useState(0)
    const { absences, loading: absencesLoading, error: absencesError, retry: retryAbsences } = useMeetingAbsences(absenceRevision)
    const grouped = useMemo(() => absencesByMeeting(absences), [absences])
    const canViewAbsences = ["lead", "captain", "mentor"].includes(getPerm(user.permissions, "level") as string)
    const roleLabels = useRoleLabels(canViewAbsences)
    const [now, setNow] = useState(Date.now)
    useEffect(() => {
        const timer = window.setInterval(() => setNow(Date.now()), 30000)
        return () => window.clearInterval(timer)
    }, [])
    const upcoming = upcomingMeetings(meetings, now)
    const canManage = can(user.permissions, "control_panel.meeting_time") || can(user.permissions, "control_panel.meeting_agenda")

    return (
        <div className="max-w-6xl mx-auto px-4 md:px-6 py-8 flex flex-col gap-4">
            <div className="max-w-3xl w-full mx-auto flex items-end justify-between gap-3">
                <div className="min-w-0">
                    <h1 className="text-2xl font-bold theme-h1-color">Meetings</h1>
                    <p className="text-sm theme-subtext-color mt-1">Upcoming dates and plans for the team.</p>
                </div>
                {canManage && <Link to="/control/meeting" aria-label="Manage meetings"
                    className={`shrink-0 inline-flex items-center justify-center min-h-11 md:min-h-10 rounded-full border theme-outline theme-text-contrast px-3.5 py-2 text-[13px] font-semibold bg-[color-mix(in_oklch,var(--theme-bg)_80%,transparent)] transition-opacity hover:opacity-90 active:opacity-70 ${focusRing}`}>Manage</Link>}
            </div>
            <div className="max-w-3xl w-full mx-auto flex flex-col gap-3.5">
                {loading ? <div className="flex flex-col gap-3.5" role="status" aria-label="Loading meetings">
                        {[0, 1, 2].map(i => <div key={i} className="flex gap-3.5"><Skeleton className="w-14 h-16 shrink-0 rounded-[14px]" /><Skeleton className="h-32 flex-1 rounded-2xl" /></div>)}
                    </div>
                    : error ? <div className={`rounded-2xl border theme-border p-3.5 ${CARD_BG}`}><Notice>Couldn't load meetings. <Button variant="text" onClick={retry}>Try again</Button></Notice></div>
                    : upcoming.length === 0 ? <div className={`rounded-2xl border theme-border p-3.5 ${CARD_BG}`}><EmptyState>No upcoming meetings scheduled. Check back soon for the next team meeting.</EmptyState></div>
                    : <>
                    {absencesError && <Notice>Couldn't load absences. <Button variant="text" onClick={retryAbsences}>Try again</Button></Notice>}
                    {upcoming.map((meeting, index) => {
                        const isNext = index === 0
                        const start = new Date(meeting.start_time)
                        const live = start.getTime() <= now
                        const mine = grouped.get(meeting.id)?.find(absence => absence.user_id === user.id)
                        const others = (grouped.get(meeting.id) ?? []).filter(absence => absence.user_id !== user.id)
                        const hasAgenda = meeting.agenda.trim() !== ""
                        return <article key={meeting.id} className="flex gap-3.5">
                            <div className={`w-14 shrink-0 self-start rounded-[14px] text-center py-2 ${isNext ? "bg-[var(--theme-text-contrast)]" : `border theme-outline ${CARD_BG}`}`} aria-hidden="true">
                                <div className={`${eyebrow} ${isNext ? "text-[var(--theme-bg)]" : "theme-subtext-color"}`}>{start.toLocaleDateString("en-US", { month: "short" })}</div>
                                <div className={`text-[26px] font-extrabold leading-none ${isNext ? "text-[var(--theme-bg)]" : "theme-text-contrast"}`}>{start.getDate()}</div>
                            </div>
                            <div className={`flex-1 min-w-0 rounded-2xl border theme-border p-3.5 ${CARD_BG}`}>
                                <span className="sr-only">{meetingDate(meeting.start_time)}</span>
                                {isNext && <p className={`${eyebrow} theme-text-contrast`}>{live ? "Live now" : `Next · ${relativeDayLabel(meeting.start_time, now)}`}</p>}
                                <h2 className="text-[19px] font-bold theme-h1-color break-words my-1">{meeting.meeting_purpose || "Team meeting"}</h2>
                                <p className="text-sm theme-subtext-color">{meetingTime(meeting)}{!isNext && !hasAgenda && " · No agenda"}</p>
                                {(isNext || hasAgenda) && <div className="mt-3 border-t border-dashed theme-border pt-2.5 text-[13px] theme-subtext-color">
                                    {hasAgenda
                                        ? <><p>Agenda</p><p className="mt-1 text-sm theme-text whitespace-pre-wrap break-words">{meeting.agenda}</p></>
                                        : <p>Agenda · none shared yet</p>}
                                </div>}
                                {!absencesLoading && !absencesError && <MeetingAbsenceRow meeting={meeting} mine={mine} others={canViewAbsences ? others : undefined} roleLabels={roleLabels} onChanged={() => setAbsenceRevision(value => value + 1)} />}
                            </div>
                        </article>
                    })}
                    </>}
            </div>
        </div>
    )
}
