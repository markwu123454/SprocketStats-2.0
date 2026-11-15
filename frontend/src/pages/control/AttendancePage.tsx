import { useEffect, useId, useMemo, useRef, useState } from "react"
import { useLocation, useNavigate, useSearchParams } from "react-router-dom"
import { Check, ChevronDown, ChevronLeft, ChevronRight, Search, Users } from "lucide-react"
import ControlSectionLayout from "./ControlSectionLayout"
import AbsenceCard from "@/components/attendance/AbsenceCard"
import {
    GroupTimeline, MeetingMetricsBody, MeetingMetricsPanel, PersonGrid, UpcomingAbsences,
} from "@/components/attendance/GroupAttendance"
import { MeetingStrip, RosterStrip, StripLegend } from "@/components/attendance/MeetingStrip"
import Button from "@/components/ui/Button"
import EmptyState from "@/components/ui/EmptyState"
import Notice from "@/components/ui/Notice"
import Sheet from "@/components/ui/Sheet"
import Skeleton from "@/components/ui/Skeleton"
import { focusRing, typeBadge, typeH1, typeH2, typeTitle } from "@/lib/uiClasses"
import { useIsMobile } from "@/lib/useIsMobile"
import { useTaskPoints } from "@/lib/useTaskPoints"
import { useRoleLabels } from "@/lib/meetings"
import {
    attendanceGroups, attendanceRate, fuzzyScore, groupSummary, homeGroup, meetingMetrics, memberMatch, pastStrip, pointsPerHour,
    reportedAbsences, teamAttendance, upcomingStrip, useAttendance,
    type AttendanceGroup, type GroupSummary, type MemberAttendance, type Miss, type PersonChip,
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

function people(n: number): string {
    return n === 1 ? "1 person" : `${n} people`
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
    const groupParam = params.get("group")
    const absenceParam = params.get("absence")
    // The meeting whose metrics are open (desktop panel, or the phone sheet).
    const [meetingId, setMeetingId] = useState<string | null>(null)
    const [pickerOpen, setPickerOpen] = useState(false)

    // A meeting moves from upcoming to past while the page is open.
    const [now, setNow] = useState(Date.now)
    useEffect(() => {
        const timer = window.setInterval(() => setNow(Date.now()), 60000)
        return () => window.clearInterval(timer)
    }, [])

    // Opening a person (often from the grid, far down the page) starts at the top of their page.
    // The app scrolls inside AppShell's <main>, not the window.
    useEffect(() => {
        if (!memberParam) return
        document.querySelector("main")?.scrollTo({ top: 0 })
        window.scrollTo({ top: 0 })
    }, [memberParam, absenceParam])

    const team = useMemo(() => teamAttendance(data, "past", now), [data, now])
    const upcomingById = useMemo(
        () => new Map(teamAttendance(data, "upcoming", now).map(row => [row.member.user_id, row])),
        [data, now],
    )
    const groups = useMemo(() => attendanceGroups(data), [data])
    const summaries = useMemo(() => new Map(groups.map(g => [g.id, groupSummary(data, g, now)])), [data, groups, now])

    const chosen = team.find(row => row.member.user_id === memberParam)
    const group = groups.find(g => g.id === groupParam) ?? (chosen ? homeGroup(groups, chosen.member) : undefined) ?? groups[0]
    const summary = group ? summaries.get(group.id) : undefined
    const selectedMeeting = summary && meetingId ? summary.meetings.findIndex(g => g.meeting.id === meetingId) : -1

    // Search spans everyone; without one, the list is the chosen group, in the roster order.
    const visible = useMemo(() => {
        if (!query.trim()) {
            const ids = new Set(group?.members.map(m => m.user_id))
            return team.filter(row => ids.has(row.member.user_id))
        }
        return team
            .map(row => ({ row, score: memberMatch(query, row.member, roleLabels.get(row.member.role) ?? row.member.role) }))
            .filter((x): x is { row: MemberAttendance, score: number } => x.score !== null)
            .sort((a, b) => b.score - a.score)
            .map(x => x.row)
    }, [team, query, roleLabels, group])
    const visibleGroups = query.trim() ? groups.filter(g => fuzzyScore(query, g.label) !== null) : groups

    // Set when this visit pushed a member onto the history stack, so Back can pop it.
    const pushed = useRef(false)
    function openMember(userId: string, absence?: string, inGroup = group?.id) {
        const next: Record<string, string> = { member: userId }
        if (inGroup) next.group = inGroup
        if (absence) next.absence = absence
        setPickerOpen(false)
        setMeetingId(null)
        if (isMobile) {
            pushed.current = true
            setParams(next)
        } else {
            setParams(next, { replace: true })
        }
    }
    const openChip = (chip: PersonChip) => openMember(chip.userId, chip.meetingId)
    function pickGroup(id: string) {
        setPickerOpen(false)
        setMeetingId(null)
        setQuery("")
        setParams({ group: id }, { replace: true })
    }
    function back() {
        if (pushed.current && location.key !== "default") navigate(-1)
        else setParams(group ? { group: group.id } : {}, { replace: true })
    }
    const toggleMeeting = (i: number) => {
        const id = summary?.meetings[i]?.meeting.id ?? null
        setMeetingId(prev => prev === id ? null : id)
    }

    const pointsFor = (row: MemberAttendance): number | null =>
        taskPoints === null ? null : pointsPerHour(taskPoints.get(row.member.user_id) ?? 0, row.earnedSeconds)

    if (isMobile && chosen && !loading && !error) {
        return (
            <>
                <header className="sticky top-0 z-10 flex items-center gap-1 min-h-14 px-2 border-b theme-border theme-bg">
                    <button type="button" aria-label={`Back to ${group?.label ?? "attendance"}`} onClick={back}
                        className={`inline-flex items-center justify-center w-11 h-11 rounded-full theme-text ${focusRing}`}>
                        <ChevronLeft size={22} strokeWidth={2.2} aria-hidden="true"/>
                    </button>
                    <span className="text-base font-semibold theme-h1-color">{group?.label ?? "Attendance"}</span>
                </header>
                <div className="px-4 pt-5 pb-8">
                    <MemberDetail row={chosen} upcomingRow={upcomingById.get(chosen.member.user_id)} role={roleOf(chosen.member.role)}
                        points={pointsFor(chosen)} focus={absenceParam} phone/>
                </div>
            </>
        )
    }

    const metrics = summary && group && selectedMeeting >= 0 ? meetingMetrics(summary, selectedMeeting, group.label) : null

    const searchBox = (
        <div className="flex flex-col gap-1.5">
            <label htmlFor={searchId} className="text-sm font-semibold theme-h1-color">Search members</label>
            <div className="flex items-center gap-2.5 min-h-12 px-3.5 rounded-xl border theme-outline bg-[var(--theme-button-bg)] md:bg-[var(--theme-bg)] focus-within:ring-2 focus-within:ring-[var(--theme-text-contrast)]">
                <Search size={18} aria-hidden="true" className="shrink-0 theme-subtext-color"/>
                <input id={searchId} type="search" value={query} onChange={e => setQuery(e.target.value)}
                    placeholder="Name, role or subteam" autoComplete="off" spellCheck={false}
                    className="flex-1 min-w-0 border-0 bg-transparent theme-text text-base py-3 outline-none placeholder:text-[var(--theme-subtext-color)]"/>
            </div>
        </div>
    )

    const groupList = visibleGroups.length > 0 && (
        <div className="flex flex-col gap-1.5">
            <h3 className={LABEL}>{groups.length === 1 ? "Subteam" : "Subteams"}</h3>
            <ul className={`flex flex-col ${isMobile ? "" : "gap-1 -mx-2"}`}>
                {visibleGroups.map(g => (
                    <li key={g.id}>
                        <GroupRow group={g} summary={summaries.get(g.id)!} phone={isMobile}
                            active={!chosen && g.id === group?.id} current={g.id === group?.id} onSelect={() => pickGroup(g.id)}/>
                    </li>
                ))}
            </ul>
        </div>
    )

    const memberList = (
        <div className="flex flex-col gap-1.5">
            <h3 className={LABEL}>{query.trim() ? "Members" : `Members · ${group?.label ?? ""}`}</h3>
            {team.length === 0 ? (
                <EmptyState>No members yet.</EmptyState>
            ) : visible.length === 0 ? (
                <p role="status" className="text-sm theme-subtext-color py-2">No members match. Try a different name or role.</p>
            ) : (
                <ul className={`flex flex-col ${isMobile ? "gap-2.5" : "gap-1 -mx-2"}`}>
                    {visible.map(row => (
                        <li key={row.member.user_id}>
                            <RosterRow row={row} role={roleOf(row.member.role)} points={pointsFor(row)} phone={isMobile}
                                active={!isMobile && row.member.user_id === chosen?.member.user_id}
                                onSelect={() => openMember(row.member.user_id, undefined,
                                    group?.members.some(m => m.user_id === row.member.user_id) ? group.id : homeGroup(groups, row.member)?.id)}/>
                        </li>
                    ))}
                </ul>
            )}
        </div>
    )

    return (
        <ControlSectionLayout title="Attendance" wide>

            {error ? (
                <div className={`${PANEL} p-6`}>
                    <Notice>Couldn't load attendance. <Button variant="text" onClick={retry}>Try again</Button></Notice>
                </div>
            ) : loading ? (
                <div role="status" aria-label="Loading attendance" className="flex flex-wrap items-start gap-6">
                    <div className={`${PANEL} flex-[1_1_360px] min-w-0 p-4 md:p-6 flex flex-col gap-3`}>
                        <Skeleton className="h-12 w-full rounded-xl"/>
                        {Array.from({ length: 5 }, (_, i) => <Skeleton key={i} className="h-24 w-full rounded-xl"/>)}
                    </div>
                    <div className={`${PANEL} hidden md:flex flex-[999_1_640px] min-w-0 p-7 flex-col gap-6`}>
                        <Skeleton className="h-28 w-full rounded-xl"/>
                        <Skeleton className="h-44 w-full rounded-xl"/>
                        <Skeleton className="h-60 w-full rounded-xl"/>
                    </div>
                </div>
            ) : !group || !summary ? (
                <EmptyState>No members yet.</EmptyState>
            ) : isMobile ? (
                <div className="flex flex-col gap-5">
                    <button type="button" onClick={() => setPickerOpen(true)} aria-haspopup="dialog"
                        className={`w-full min-h-16 flex items-center gap-3 px-3.5 py-2.5 rounded-[14px] border theme-outline theme-bg text-left ${focusRing}`}>
                        <GroupIcon/>
                        <span className="flex-1 min-w-0 flex flex-col gap-0.5">
                            <span className="text-[17px] font-bold theme-text-contrast">{group.label}</span>
                            <span className="text-[13px] theme-subtext-color">{people(summary.members.length)} · {percent(summary.rate)} attended · {summary.missed} missed</span>
                        </span>
                        <ChevronDown size={20} strokeWidth={2.2} aria-hidden="true" className="flex-none theme-subtext-color"/>
                    </button>

                    <section aria-label="Meetings timeline" className="flex flex-col gap-2.5 pt-4 pb-2.5 rounded-2xl border theme-border theme-bg">
                        <div className="flex justify-between items-baseline gap-2 px-4">
                            <h2 className={LABEL}>Timeline</h2>
                            <span className="text-xs theme-subtext-color">Tap a meeting for details</span>
                        </div>
                        <div className="px-2">
                            {summary.meetings.length === 0
                                ? <p className="px-2 text-sm theme-subtext-color">No meetings yet.</p>
                                : <GroupTimeline summary={summary} selected={selectedMeeting >= 0 ? selectedMeeting : null} onSelect={toggleMeeting} compact/>}
                        </div>
                    </section>

                    <UpcomingAbsences summary={summary} group={group} now={now} onOpen={openChip} chipLimit={4} phone/>
                    <PersonGrid summary={summary} onOpen={id => openMember(id)} phone/>

                    {metrics && (
                        <Sheet title={metrics.when} onClose={() => setMeetingId(null)}>
                            <div className="flex flex-col gap-4">
                                <div className="flex flex-col gap-1">
                                    <span className={`${typeBadge} theme-text-contrast`}>{metrics.tag}</span>
                                    {metrics.purpose && <span className="text-sm font-semibold theme-text">{metrics.purpose}</span>}
                                    <span className="text-sm theme-subtext-color">{metrics.note}</span>
                                </div>
                                <MeetingMetricsBody metrics={metrics} onOpen={openChip} phone/>
                            </div>
                        </Sheet>
                    )}
                    {pickerOpen && (
                        <Sheet title="Show attendance for" onClose={() => { setPickerOpen(false); setQuery("") }}>
                            <div className="flex flex-col gap-5">
                                {searchBox}
                                {groupList}
                                {memberList}
                            </div>
                        </Sheet>
                    )}
                </div>
            ) : (
                <div className="flex flex-wrap items-start gap-6">
                    <section aria-labelledby="attendance-members" className={`${PANEL} flex-[1_1_360px] max-w-[480px] min-w-0 p-6 flex flex-col gap-5`}>
                        <h2 id="attendance-members" className={LABEL}>By member</h2>
                        {searchBox}
                        {groupList}
                        {memberList}
                    </section>

                    <section aria-label={chosen ? "Member attendance" : `${group.label} attendance`}
                        className={`${PANEL} flex-[999_1_640px] min-w-0 p-7 xl:px-10 xl:py-9`}>
                        {chosen ? (
                            <MemberDetail row={chosen} upcomingRow={upcomingById.get(chosen.member.user_id)} role={roleOf(chosen.member.role)}
                                points={pointsFor(chosen)} focus={absenceParam} backLabel={group.label} onBack={() => pickGroup(group.id)}/>
                        ) : (
                            <div className="flex flex-col gap-8">
                                <div className="flex flex-col gap-4">
                                    <div className="flex flex-wrap justify-between items-baseline gap-3">
                                        <h2 className={LABEL}>{group.label} · Timeline</h2>
                                        <span className="text-sm theme-subtext-color">
                                            {percent(summary.rate)} attended · {summary.missed} missed · {summary.absentAhead} absent ahead
                                        </span>
                                    </div>
                                    {summary.meetings.length === 0
                                        ? <p className="text-sm theme-subtext-color">No meetings yet.</p>
                                        : <GroupTimeline summary={summary} selected={selectedMeeting >= 0 ? selectedMeeting : null} onSelect={toggleMeeting}/>}
                                </div>
                                {metrics && <MeetingMetricsPanel metrics={metrics} onOpen={openChip} onClose={() => setMeetingId(null)}/>}
                                <UpcomingAbsences summary={summary} group={group} now={now} onOpen={openChip} chipLimit={6}/>
                                <PersonGrid summary={summary} onOpen={id => openMember(id)}/>
                            </div>
                        )}
                    </section>
                </div>
            )}
        </ControlSectionLayout>
    )
}

function GroupIcon() {
    return (
        <span aria-hidden="true" className="flex-none flex items-center justify-center w-10 h-10 md:w-11 md:h-11 rounded-xl bg-[var(--theme-button-hover)] theme-text-contrast">
            <Users size={20} strokeWidth={2}/>
        </span>
    )
}

function GroupRow({ group, summary, phone, active, current, onSelect }: {
    group: AttendanceGroup, summary: GroupSummary, phone: boolean, active: boolean, current: boolean, onSelect: () => void,
}) {
    const absences = summary.missed + summary.absent
    const stats = `${people(summary.members.length)} · ${percent(summary.rate)} attended`
    if (phone) {
        return (
            <button type="button" onClick={onSelect} aria-current={current ? "true" : undefined}
                className={`w-full min-h-12 flex items-center justify-between gap-3 px-1 py-2 border-b border-[var(--ag-grid-row-border)] text-left ${focusRing}`}>
                <span className="flex flex-col gap-0.5 min-w-0">
                    <span className={`text-base font-bold ${current ? "theme-text-contrast" : "theme-h1-color"}`}>{group.label}</span>
                    <span className="text-xs theme-subtext-color">{people(summary.members.length)} · {absences} absences</span>
                </span>
                {current && <Check size={18} strokeWidth={2.4} aria-hidden="true" className="flex-none theme-text-contrast"/>}
            </button>
        )
    }
    return (
        <button type="button" onClick={onSelect} aria-current={active ? "true" : undefined}
            className={`w-full flex items-center gap-3.5 px-4 py-3.5 rounded-xl text-left border ${active ? "theme-outline theme-bg" : "border-transparent hover:bg-[var(--theme-button-hover)]"} ${focusRing}`}>
            <GroupIcon/>
            <span className="flex-1 min-w-0 flex flex-col gap-1">
                <span className={`${typeTitle} ${current ? "theme-text-contrast" : "theme-h1-color"}`}>{group.label}</span>
                <span className="text-[13px] theme-subtext-color">{stats}</span>
            </span>
            <span className="flex-none flex flex-col items-end gap-1 text-[13px] theme-subtext-color">
                {absences} absences
                <ChevronRight size={16} strokeWidth={2.2} aria-hidden="true"/>
            </span>
        </button>
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

/** The absence opened from the subteam view, with its reason up top. */
function FocusedAbsence({ miss, upcoming }: { miss: Miss, upcoming: boolean }) {
    const start = new Date(miss.meeting.start_time)
    const when = start.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })
    const kind = !miss.absence ? "Missed" : upcoming ? "Absent ahead · upcoming" : "Absent ahead of time"
    const reason = miss.absence ? (miss.absence.reason || "No reason given") : "No notice given"
    return (
        <div role="region" aria-label="Selected absence"
            className="flex flex-col gap-2 md:gap-2.5 px-[18px] py-4 md:px-7 md:py-6 rounded-2xl border-2 border-[var(--theme-text-contrast)] bg-[var(--ag-grid-chrome-bg)]">
            <div className="flex flex-wrap justify-between items-baseline gap-x-3 gap-y-1">
                <span className={`${typeBadge} theme-text-contrast`}>{when}</span>
                <span className={`text-sm ${miss.absence ? "theme-subtext-color" : "theme-danger"}`}>{kind}</span>
            </div>
            <span className={`${typeBadge} theme-subtext-color`}>Reason</span>
            <p className="text-[22px] md:text-2xl font-bold theme-h1-color break-words whitespace-pre-wrap">{reason}</p>
        </div>
    )
}

/** One member: headline numbers, the meeting strip, and the absences they reported. */
function MemberDetail({ row, upcomingRow, role, points, focus, backLabel, onBack, phone = false }: {
    row: MemberAttendance, upcomingRow: MemberAttendance | undefined, role: string, points: number | null,
    /** A meeting id: its absence is shown up top and highlighted in the list. */
    focus?: string | null,
    backLabel?: string, onBack?: () => void, phone?: boolean,
}) {
    const { member } = row
    const Name = phone ? "h1" : "h2"
    const Label = phone ? "h2" : "h3"
    const absences = upcomingRow ? reportedAbsences(row, upcomingRow) : { upcoming: [], past: [] }
    const total = row.expected.length
    const tiles: [string, number][] = [["Meetings", total], ["Attended", total - row.missed.length], ["Missed", row.missed.length]]
    const bigNumber = "text-[40px] md:text-5xl leading-none font-bold tracking-[-0.02em]"
    const focusUpcoming = focus ? upcomingRow?.missed.find(x => x.meeting.id === focus) : undefined
    const focusMiss = focusUpcoming ?? (focus ? [...row.missed, ...row.uncounted].find(x => x.meeting.id === focus) : undefined)
    return (
        <div className="flex flex-col gap-5 md:gap-6">
            {onBack && backLabel && (
                <button type="button" onClick={onBack}
                    className={`self-start inline-flex items-center gap-2 min-h-11 px-3.5 -mb-2 rounded-xl border theme-outline theme-button-bg theme-text text-sm ${focusRing}`}>
                    <ChevronLeft size={16} strokeWidth={2.2} aria-hidden="true"/>{backLabel}
                </button>
            )}
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

            {focusMiss && <FocusedAbsence miss={focusMiss} upcoming={!!focusUpcoming}/>}

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
                    {absences.upcoming.map(({ meeting, absence }) => <AbsenceCard key={meeting.id} meeting={meeting} absence={absence!} upcoming focused={meeting.id === focus}/>)}
                    {absences.upcoming.length > 0 && absences.past.length > 0 && <TodaySeparator/>}
                    {absences.past.map(({ meeting, absence }) => <AbsenceCard key={meeting.id} meeting={meeting} absence={absence!} upcoming={false} focused={meeting.id === focus}/>)}
                </ul>
            )}
        </div>
    )
}
