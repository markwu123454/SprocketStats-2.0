import { useEffect, useState } from "react"
import { Calendar, Clock, FileText, Settings } from "lucide-react"
import { Link } from "react-router-dom"
import Button from "@/components/ui/Button"
import Notice from "@/components/ui/Notice"
import Skeleton from "@/components/ui/Skeleton"
import EmptyState from "@/components/ui/EmptyState"
import TaskLeaderboard from "@/components/TaskLeaderboard"
import { useOnboardedUser } from "@/contexts/authContext"
import { can } from "@/lib/permissions"
import { buttonClass, cardClass, typeH2, typeTitle } from "@/lib/uiClasses"
import { meetingDate, meetingTime, upcomingMeetings, useMeetings } from "@/lib/meetings"

export default function MeetingsPage() {
    const user = useOnboardedUser()
    const { meetings, loading, error, retry } = useMeetings()
    const [now, setNow] = useState(Date.now)
    useEffect(() => {
        const timer = window.setInterval(() => setNow(Date.now()), 30000)
        return () => window.clearInterval(timer)
    }, [])
    const upcoming = upcomingMeetings(meetings, now)
    const canManage = can(user.permissions, "control_panel.meeting_time") || can(user.permissions, "control_panel.meeting_agenda")

    return (
        <div className="max-w-6xl mx-auto px-4 md:px-6 py-8 flex flex-col gap-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                    <h1 className="text-2xl font-bold theme-h1-color">Meetings</h1>
                    <p className="text-sm theme-subtext-color mt-1">Upcoming dates and plans for the team.</p>
                </div>
                {canManage && <Link to="/control/meeting" className={buttonClass({ variant: "outlined" })}><Settings size={16} aria-hidden="true" />Manage meetings</Link>}
            </div>
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 items-start">
            <section className={`${cardClass} theme-bg backdrop-blur-sm lg:col-span-2 min-w-0`} aria-labelledby="schedule-title">
                <div className="flex items-center gap-2">
                    <Calendar size={18} className="theme-text-contrast" aria-hidden="true" />
                    <h2 id="schedule-title" className={`${typeTitle} theme-text`}>Upcoming meetings</h2>
                </div>
                {loading ? <div className="flex flex-col gap-3" role="status" aria-label="Loading meetings"><Skeleton className="h-24 w-full" /><Skeleton className="h-24 w-full" /><Skeleton className="h-24 w-full" /></div>
                    : error ? <Notice>Couldn't load meetings. <Button variant="text" onClick={retry}>Try again</Button></Notice>
                    : upcoming.length === 0 ? <EmptyState>No upcoming meetings scheduled. Check back soon for the next team meeting.</EmptyState>
                    : <div className="flex flex-col divide-y theme-border">
                        {upcoming.map(meeting => {
                            const start = new Date(meeting.start_time)
                            const live = start.getTime() <= now
                            return <article key={meeting.id} className="grid grid-cols-1 sm:grid-cols-[5rem_1fr] gap-4 py-5">
                                <div className="rounded-lg border theme-border theme-bg p-3 flex sm:flex-col items-center justify-center gap-2 sm:gap-0 self-start">
                                    <span className={`${typeH2} theme-subtext-color`}>{start.toLocaleDateString("en-US", { month: "short" })}</span>
                                    <span className="text-2xl font-bold theme-text-contrast">{start.getDate()}</span>
                                </div>
                                <div className="min-w-0 flex flex-col gap-2">
                                    {live && <span className={`${typeH2} theme-text-contrast`}>Live now</span>}
                                    <h3 className={`${typeTitle} theme-text break-words`}>{meeting.meeting_purpose || "Team meeting"}</h3>
                                    <p className="text-sm theme-subtext-color">{meetingDate(meeting.start_time)}</p>
                                    <p className="text-sm theme-subtext-color flex items-center gap-2"><Clock size={14} className="shrink-0" aria-hidden="true" />{meetingTime(meeting)}</p>
                                    <div className="mt-2 rounded-lg border theme-border p-4">
                                        <h4 className={`${typeH2} theme-subtext-color flex items-center gap-2`}><FileText size={14} aria-hidden="true" />Agenda</h4>
                                        <p className="mt-2 text-sm theme-text whitespace-pre-wrap break-words">{meeting.agenda || "No agenda shared yet."}</p>
                                    </div>
                                </div>
                            </article>
                        })}
                    </div>}
            </section>
            <TaskLeaderboard />
            </div>
        </div>
    )
}
