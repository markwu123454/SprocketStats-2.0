import { useEffect, useId, useMemo, useRef, useState } from "react"
import { useLocation, useNavigate, useSearchParams } from "react-router-dom"
import { ChevronLeft, Search } from "lucide-react"
import ControlSectionLayout from "./ControlSectionLayout"
import AbsenceCard from "@/components/attendance/AbsenceCard"
import { MeetingStrip, RosterStrip, StripLegend } from "@/components/attendance/MeetingStrip"
import Button from "@/components/ui/Button"
import EmptyState from "@/components/ui/EmptyState"
import Notice from "@/components/ui/Notice"
import Skeleton from "@/components/ui/Skeleton"
import { focusRing, typeBadge, typeH1, typeH2, typeTitle } from "@/lib/uiClasses"
import { useIsMobile } from "@/lib/useIsMobile"
import { useTaskPoints } from "@/lib/useTaskPoints"
import { useRoleLabels } from "@/lib/meetings"
import {
    attendanceRate, memberMatch, pastStrip, pointsPerHour, reportedAbsences, teamAttendance, upcomingStrip, useAttendance,
    type MemberAttendance,
} from "@/lib/attendance"

const PANEL = "rounded-2xl border theme-border theme-button-bg"
const LABEL = `${typeH2} theme-subtext-color`

function shortDate(iso: string): string {
    return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" })
}

function percent(rate: number | null): string {
    return rate === null ? "—" : `${Math.round(rate * 100)}%`
}

/** Task points per hour to one decimal, or a dash when it can't be worked out. */
function pts(value: number | null): string {
    return value === null ? "—" : value.toFixed(1)
}

export default function AttendancePage() {
    const { data, loading, error, retry } = useAttendance()
    const roleLabels = useRoleLabels(true)
    const roleOf = (role: string) => roleLabels.get(role) ?? role
    const isMobile = useIsMobile()
    const taskPoints = useTaskPoints()
    const navigate = useNavigate()
    const location = useLocation()
    const [params, setParams] = useSearchParams()
    const [query, setQuery] = useState("")
    const searchId = useId()
    const memberParam = params.get("member")

    // A meeting moves from upcoming to past while the page is open.
    const [now, setNow] = useState(Date.now)
    useEffect(() => {
        const timer = window.setInterval(() => setNow(Date.now()), 60000)
        return () => window.clearInterval(timer)
    }, [])

    const team = useMemo(() => teamAttendance(data, "past", now), [data, now])
    const upcomingById = useMemo(
        () => new Map(teamAttendance(data, "upcoming", now).map(row => [row.member.user_id, row])),
        [data, now],
    )

    // Search re-ranks by match quality; without one, the roster order stands.
    const visible = useMemo(() => {
        if (!query.trim()) return team
        return team
            .map(row => ({ row, score: memberMatch(query, row.member, roleLabels.get(row.member.role) ?? row.member.role) }))
            .filter((x): x is { row: MemberAttendance, score: number } => x.score !== null)
            .sort((a, b) => b.score - a.score)
            .map(x => x.row)
    }, [team, query, roleLabels])

    const chosen = team.find(row => row.member.user_id === memberParam)
    // Desktop always shows someone; phones show the list until a member is opened.
    const selected = chosen ?? (isMobile ? undefined : visible[0] ?? team[0])

    // Set when this visit pushed the member onto the history stack, so Back can pop it.
    const pushed = useRef(false)
    function select(id: string) {
        if (isMobile) {
            pushed.current = true
            setParams({ member: id })
        } else {
            setParams({ member: id }, { replace: true })
        }
    }
    function back() {
        if (pushed.current && location.key !== "default") navigate(-1)
        else setParams({}, { replace: true })
    }

    const pointsFor = (row: MemberAttendance): number | null =>
        taskPoints === null ? null : pointsPerHour(taskPoints.get(row.member.user_id) ?? 0, row.earnedSeconds)

    if (isMobile && chosen && !loading && !error) {
        return (
            <>
                <header className="sticky top-0 z-10 flex items-center gap-1 min-h-14 px-2 border-b theme-border theme-bg">
                    <button type="button" aria-label="Back to members" onClick={back}
                        className={`inline-flex items-center justify-center w-11 h-11 rounded-full theme-text ${focusRing}`}>
                        <ChevronLeft size={22} strokeWidth={2.2} aria-hidden="true"/>
                    </button>
                    <span className="text-base font-semibold theme-h1-color">Members</span>
                </header>
                <div className="px-4 pt-5 pb-8">
                    <MemberDetail row={chosen} upcomingRow={upcomingById.get(chosen.member.user_id)} role={roleOf(chosen.member.role)}
                        points={pointsFor(chosen)} phone/>
                </div>
            </>
        )
    }

    return (
        <ControlSectionLayout title="Attendance" wide>

            {error ? (
                <div className={`${PANEL} p-6`}>
                    <Notice>Couldn't load attendance. <Button variant="text" onClick={retry}>Try again</Button></Notice>
                </div>
            ) : loading ? (
                <div role="status" aria-label="Loading attendance" className="flex flex-wrap items-start gap-6">
                    <div className={`${PANEL} flex-[1_1_400px] min-w-0 p-4 md:p-6 flex flex-col gap-3`}>
                        <Skeleton className="h-12 w-full rounded-xl"/>
                        {Array.from({ length: 5 }, (_, i) => <Skeleton key={i} className="h-24 w-full rounded-xl"/>)}
                    </div>
                    <div className={`${PANEL} hidden md:flex flex-[999_1_520px] min-w-0 p-7 flex-col gap-6`}>
                        <Skeleton className="h-14 w-2/3"/>
                        <Skeleton className="h-20 w-full rounded-xl"/>
                        <Skeleton className="h-4 w-full"/>
                        <Skeleton className="h-28 w-full rounded-xl"/>
                    </div>
                </div>
            ) : (
                <div className="flex flex-wrap items-start gap-6">
                    <section aria-labelledby="attendance-members" className={`${isMobile ? "" : PANEL} flex-[1_1_400px] min-w-0 md:p-6 flex flex-col gap-4`}>
                        <h2 id="attendance-members" className={LABEL}>By member</h2>
                        <div className="flex flex-col gap-1.5">
                            <label htmlFor={searchId} className="text-sm font-semibold theme-h1-color">Search members</label>
                            <div className="flex items-center gap-2.5 min-h-12 px-3.5 rounded-xl border theme-outline bg-[var(--theme-button-bg)] md:bg-[var(--theme-bg)] focus-within:ring-2 focus-within:ring-[var(--theme-text-contrast)]">
                                <Search size={18} aria-hidden="true" className="shrink-0 theme-subtext-color"/>
                                <input id={searchId} type="search" value={query} onChange={e => setQuery(e.target.value)}
                                    placeholder="Name or role" autoComplete="off" spellCheck={false}
                                    className="flex-1 min-w-0 border-0 bg-transparent theme-text text-base py-3 outline-none placeholder:text-[var(--theme-subtext-color)]"/>
                            </div>
                        </div>
                        {team.length === 0 ? (
                            <EmptyState>No members yet.</EmptyState>
                        ) : (
                            <ul className={`flex flex-col ${isMobile ? "gap-2.5" : "gap-1 -mx-2"}`}>
                                {visible.map(row => (
                                    <li key={row.member.user_id}>
                                        <RosterRow row={row} role={roleOf(row.member.role)} points={pointsFor(row)} phone={isMobile}
                                            active={!isMobile && row.member.user_id === selected?.member.user_id}
                                            onSelect={() => select(row.member.user_id)}/>
                                    </li>
                                ))}
                            </ul>
                        )}
                        {team.length > 0 && visible.length === 0 && (
                            <p role="status" className="text-sm theme-subtext-color py-2">No members match. Try a different name or role.</p>
                        )}
                    </section>

                    {!isMobile && selected && (
                        <section aria-labelledby="attendance-member" className={`${PANEL} flex-[999_1_520px] min-w-0 p-7`}>
                            <MemberDetail row={selected} upcomingRow={upcomingById.get(selected.member.user_id)} role={roleOf(selected.member.role)}
                                points={pointsFor(selected)}/>
                        </section>
                    )}
                </div>
            )}
        </ControlSectionLayout>
    )
}

function RosterRow({ row, role, points, phone, active, onSelect }: {
    row: MemberAttendance, role: string, points: number | null, phone: boolean, active: boolean, onSelect: () => void,
}) {
    const { member, missed, expected } = row
    const counts = `${missed.length} of ${expected.length} missed`
    const surface = phone
        ? "min-h-12 border theme-border bg-[var(--theme-button-bg)] active:bg-[var(--theme-button-hover)]"
        // Selected sits on the surface, like the stat tiles, with an accent name (navigation.md).
        : active ? "border theme-border theme-bg" : "border border-transparent hover:bg-[var(--theme-button-hover)]"
    return (
        <button type="button" onClick={onSelect} aria-current={active ? "true" : undefined}
            aria-label={phone ? `${member.display_name}, ${role}, ${percent(attendanceRate(row))}, ${counts}. Open details.` : undefined}
            className={`w-full flex flex-col gap-2 px-4 py-3.5 rounded-xl text-left text-sm ${surface} ${focusRing}`}>
            <span className="flex justify-between items-baseline gap-3">
                <span className={`${typeTitle} ${active ? "theme-text-contrast" : "theme-h1-color"} min-w-0 break-words`}>{member.display_name}</span>
                <span className="text-base font-bold theme-text-contrast">{percent(attendanceRate(row))}</span>
            </span>
            <span className="flex justify-between gap-3 text-[13px] theme-subtext-color">
                <span className="min-w-0">{role} · {pts(points)} pts/hr{row.lastMissed ? ` · last missed ${shortDate(row.lastMissed)}` : ""}</span>
                <span className="whitespace-nowrap">{counts}</span>
            </span>
            <RosterStrip past={pastStrip(row)}/>
        </button>
    )
}

function TodaySeparator() {
    const today = new Date()
    return (
        <li role="separator" aria-label={`Today, ${today.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" })}`}
            className="list-none flex items-center gap-3 md:gap-3.5">
            <span className="flex-1 h-px bg-[var(--theme-border)]"/>
            <span className={`${typeBadge} theme-text-contrast`}>
                Today · {today.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })}
            </span>
            <span className="flex-1 h-px bg-[var(--theme-border)]"/>
        </li>
    )
}

/** One member: headline numbers, the meeting strip, and the absences they reported. */
function MemberDetail({ row, upcomingRow, role, points, phone = false }: {
    row: MemberAttendance, upcomingRow: MemberAttendance | undefined, role: string, points: number | null, phone?: boolean,
}) {
    const { member } = row
    const Name = phone ? "h1" : "h2"
    const Label = phone ? "h2" : "h3"
    const absences = upcomingRow ? reportedAbsences(row, upcomingRow) : { upcoming: [], past: [] }
    const total = row.expected.length
    const tiles: [string, number][] = [["Meetings", total], ["Attended", total - row.missed.length], ["Missed", row.missed.length]]
    const bigNumber = "text-[40px] md:text-5xl leading-none font-bold tracking-[-0.02em]"
    return (
        <div className="flex flex-col gap-5 md:gap-6">
            <div className="flex flex-wrap items-start justify-between gap-x-8 gap-y-3.5 md:gap-y-4">
                <div className="flex flex-col gap-0.5 min-w-0">
                    <Name id="attendance-member" className={`${typeH1} theme-h1-color break-words`}>{member.display_name}</Name>
                    <span className="theme-subtext-color">{role}</span>
                </div>
                <div className="flex flex-wrap gap-x-8 gap-y-3">
                    <div className="flex flex-col gap-0.5">
                        <span className={`${bigNumber} theme-text-contrast`}>{pts(points)}</span>
                        <span className="theme-subtext-color">task points / hr</span>
                    </div>
                    <div className="flex flex-col gap-0.5">
                        <span className={`${bigNumber} theme-h1-color`}>{percent(attendanceRate(row))}</span>
                        <span className="theme-subtext-color">of meeting hours</span>
                    </div>
                </div>
            </div>

            <dl className="grid grid-cols-3 gap-2.5 md:grid-cols-[repeat(auto-fit,minmax(140px,1fr))] md:gap-3">
                {tiles.map(([label, value]) => (
                    <div key={label} className="min-w-0 px-3.5 py-3 md:px-4 md:py-3.5 rounded-xl border theme-border theme-bg">
                        <dt className="text-[11px] md:text-xs font-semibold uppercase tracking-[0.08em] md:tracking-widest theme-subtext-color">{label}</dt>
                        <dd className="mt-0.5 md:mt-1 text-[22px] md:text-2xl font-bold theme-h1-color">{value}</dd>
                    </div>
                ))}
            </dl>

            <div className="flex flex-col gap-2.5">
                <Label className={LABEL}>Last 10 meetings, then upcoming</Label>
                <MeetingStrip past={pastStrip(row)} upcoming={upcomingRow ? upcomingStrip(upcomingRow) : []}/>
                <StripLegend/>
            </div>

            <Label className={LABEL}>Absences</Label>
            {absences.upcoming.length === 0 && absences.past.length === 0 ? (
                <p className="text-sm theme-subtext-color py-2 -mt-2">No absences for {member.display_name}.</p>
            ) : (
                <ul className="flex flex-col gap-3 md:gap-3.5 -mt-2">
                    {absences.upcoming.map(({ meeting, absence }) => <AbsenceCard key={meeting.id} meeting={meeting} absence={absence!} upcoming/>)}
                    {absences.upcoming.length > 0 && absences.past.length > 0 && <TodaySeparator/>}
                    {absences.past.map(({ meeting, absence }) => <AbsenceCard key={meeting.id} meeting={meeting} absence={absence!} upcoming={false}/>)}
                </ul>
            )}
        </div>
    )
}
