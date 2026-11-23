import { useEffect, useId, useMemo, useRef, useState } from "react"
import { useLocation, useNavigate, useSearchParams } from "react-router-dom"
import { ChevronLeft, Search } from "lucide-react"
import ControlSectionLayout from "./ControlSectionLayout"
import AbsenceCard from "@/components/attendance/AbsenceCard"
import {
    GroupTimeline, MeetingMetricsBody, MeetingMetricsPanel, PersonGrid, UpcomingAbsences,
} from "@/components/attendance/GroupAttendance"
import { MeetingStrip, RosterStrip, StripLegend } from "@/components/attendance/MeetingStrip"
import Button from "@/components/ui/Button"
import Dropdown from "@/components/ui/Dropdown"
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
    type MemberAttendance, type Miss, type PersonChip,
} from "@/lib/attendance"

const CONTROL = "rounded-lg border theme-outline theme-bg theme-text px-3 min-h-11 md:min-h-10 text-sm"
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
        setMeetingId(null)
        pushed.current = true
        setParams(next)
    }
    const openChip = (chip: PersonChip) => openMember(chip.userId, chip.meetingId)
    function pickGroup(id: string) {
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

    const metrics = summary && group && selectedMeeting >= 0 ? meetingMetrics(summary, selectedMeeting, group.label) : null
    const groupChoices = groups.map(g => ({ value: g.id, label: g.label }))
    const searching = query.trim() !== ""

    // One member: their page in place of the group view, on every screen, with a way back.
    if (chosen && !loading && !error) {
        return (
            <ControlSectionLayout title="Attendance" wide>
                <div className="w-full max-w-4xl">
                    <MemberDetail row={chosen} upcomingRow={upcomingById.get(chosen.member.user_id)} role={roleOf(chosen.member.role)}
                        points={pointsFor(chosen)} focus={absenceParam} backLabel={group?.label ?? "Attendance"} onBack={back}/>
                </div>
            </ControlSectionLayout>
        )
    }

    const memberCards = (rows: MemberAttendance[]) => (
        <ul className="grid gap-2.5 grid-cols-[repeat(auto-fill,minmax(min(100%,280px),1fr))]">
            {rows.map(row => (
                <li key={row.member.user_id}>
                    <RosterRow row={row} role={roleOf(row.member.role)} points={pointsFor(row)}
                        onSelect={() => openMember(row.member.user_id, undefined,
                            group?.members.some(m => m.user_id === row.member.user_id) ? group.id : homeGroup(groups, row.member)?.id)}/>
                </li>
            ))}
        </ul>
    )

    return (
        <ControlSectionLayout title="Attendance" wide>
            {error ? (
                <Notice>Couldn't load attendance. <Button variant="text" onClick={retry}>Try again</Button></Notice>
            ) : loading ? (
                <div role="status" aria-label="Loading attendance" className="flex flex-col gap-4 w-full max-w-6xl">
                    <Skeleton className="h-11 w-full max-w-md rounded-xl"/>
                    <Skeleton className="h-40 w-full rounded-xl"/>
                    <Skeleton className="h-56 w-full rounded-xl"/>
                </div>
            ) : !group || !summary ? (
                <EmptyState>No members yet.</EmptyState>
            ) : (
                <div className="flex flex-col gap-5 w-full max-w-6xl">
                    {/* ── Controls: which group, or search for anyone ─────────── */}
                    <div className="flex flex-wrap items-center gap-2 md:gap-3">
                        {!isMobile && (
                            <div className="w-56">
                                <Dropdown value={group.id} onChange={pickGroup} options={groupChoices} label="Group" triggerClassName={`${CONTROL} w-full`}/>
                            </div>
                        )}
                        <label htmlFor={searchId} className={`${CONTROL} flex-1 min-w-40 md:max-w-sm flex items-center gap-2 focus-within:ring-2 focus-within:ring-[var(--theme-text-contrast)]`}>
                            <Search size={16} aria-hidden="true" className="shrink-0 theme-subtext-color"/>
                            <input id={searchId} type="search" value={query} onChange={e => setQuery(e.target.value)}
                                placeholder="Search members" aria-label="Search members" autoComplete="off" spellCheck={false}
                                className="flex-1 min-w-0 bg-transparent outline-none text-base md:text-sm placeholder:text-[var(--theme-subtext-color)]"/>
                        </label>
                    </div>
                    {isMobile && !searching && (
                        <div className="flex gap-2 overflow-x-auto -mx-4 px-4 pb-0.5" style={{ scrollbarWidth: "none" }}>
                            {groups.map(g => {
                                const active = g.id === group.id
                                return (
                                    <button key={g.id} type="button" onClick={() => pickGroup(g.id)} aria-pressed={active}
                                        className={`shrink-0 min-h-9 px-3.5 rounded-full border text-sm whitespace-nowrap ${focusRing}`}
                                        style={{
                                            borderColor: active ? "var(--theme-text-contrast)" : "var(--theme-border)",
                                            color: active ? "var(--theme-text-contrast)" : "var(--theme-text)",
                                            background: active ? "var(--ag-grid-selected-bg)" : "transparent",
                                            fontWeight: active ? 600 : 400,
                                        }}>
                                        {g.label}
                                    </button>
                                )
                            })}
                        </div>
                    )}

                    {searching ? (
                        /* ── Search results: everyone who matches, any group ── */
                        <div className="flex flex-col gap-4">
                            {visibleGroups.length > 0 && (
                                <div className="flex flex-wrap items-center gap-2">
                                    <span className={LABEL}>Groups</span>
                                    {visibleGroups.map(g => (
                                        <button key={g.id} type="button" onClick={() => pickGroup(g.id)}
                                            className={`min-h-9 px-3.5 rounded-full border theme-border text-sm theme-text hover:bg-[var(--theme-button-hover)] ${focusRing}`}>
                                            {g.label}
                                        </button>
                                    ))}
                                </div>
                            )}
                            <h2 className={LABEL}>Members · {visible.length}</h2>
                            {visible.length === 0
                                ? <p role="status" className="text-sm theme-subtext-color">No members match. Try a different name or role.</p>
                                : memberCards(visible)}
                        </div>
                    ) : (
                        <>
                            <p className="text-sm theme-subtext-color -mt-1">
                                <span className="font-semibold theme-h1-color">{group.label}</span> · {people(summary.members.length)} · {percent(summary.rate)} attended · {summary.missed} missed · {summary.absentAhead} absent ahead
                            </p>

                            <UpcomingAbsences summary={summary} group={group} now={now} onOpen={openChip} chipLimit={isMobile ? 4 : 6} phone={isMobile}/>

                            {/* Meetings: tap one for who came and who didn't. */}
                            <section aria-label="Meetings timeline" className="flex flex-col gap-3 rounded-xl border theme-border theme-bg p-4 md:p-5">
                                <div className="flex flex-wrap justify-between items-baseline gap-2">
                                    <h2 className={LABEL}>Meetings</h2>
                                    <span className="text-xs theme-subtext-color">{isMobile ? "Tap" : "Choose"} a meeting for its details</span>
                                </div>
                                {summary.meetings.length === 0
                                    ? <p className="text-sm theme-subtext-color">No meetings yet.</p>
                                    : <GroupTimeline summary={summary} selected={selectedMeeting >= 0 ? selectedMeeting : null} onSelect={toggleMeeting} compact={isMobile}/>}
                            </section>
                            {metrics && !isMobile && <MeetingMetricsPanel metrics={metrics} onOpen={openChip} onClose={() => setMeetingId(null)}/>}
                            {metrics && isMobile && (
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

                            <section aria-label="Members" className="flex flex-col gap-2.5">
                                <h2 className={LABEL}>Members · {visible.length}</h2>
                                {visible.length === 0 ? <EmptyState>No members in {group.label} yet.</EmptyState> : memberCards(visible)}
                            </section>

                            <PersonGrid summary={summary} onOpen={id => openMember(id)} phone={isMobile}/>
                        </>
                    )}
                </div>
            )}
        </ControlSectionLayout>
    )
}

/** One member in a group: attendance rate, role, points per hour, and their last meetings. Opens their page. */
function RosterRow({ row, role, points, onSelect }: {
    row: MemberAttendance, role: string, points: number | null, onSelect: () => void,
}) {
    const { member, missed, expected } = row
    const counts = `${missed.length} of ${expected.length} missed`
    return (
        <button type="button" onClick={onSelect}
            aria-label={`${member.display_name}, ${role}, ${percent(attendanceRate(row))}, ${counts}. Open details.`}
            className={`w-full h-full flex flex-col gap-2 px-4 py-3.5 rounded-xl text-left text-sm border theme-border theme-bg hover:border-(--theme-outline) ${focusRing}`}>
            <span className="flex justify-between items-baseline gap-3">
                <span className={`${typeTitle} theme-h1-color min-w-0 break-words`}>{member.display_name}</span>
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
