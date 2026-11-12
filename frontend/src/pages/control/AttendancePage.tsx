import { useEffect, useId, useMemo, useState } from "react"
import { ChevronDown, Search, X } from "lucide-react"
import ControlSectionLayout from "./ControlSectionLayout"
import Button from "@/components/ui/Button"
import Notice from "@/components/ui/Notice"
import Sheet from "@/components/ui/Sheet"
import Skeleton from "@/components/ui/Skeleton"
import EmptyState from "@/components/ui/EmptyState"
import { focusRing, inputClass, typeH2 } from "@/lib/uiClasses"
import { useIsMobile } from "@/lib/useIsMobile"
import { meetingTime, useRoleLabels } from "@/lib/meetings"
import {
    meetingsWithMisses, memberMatch, teamAttendance, useAttendance,
    type AbsenceScope, type MeetingMisses, type MemberAttendance,
} from "@/lib/attendance"

const CARD = "rounded-2xl border theme-border bg-[color-mix(in_oklch,var(--theme-bg)_92%,transparent)]"
const SEGMENTS = "flex gap-1 p-1 rounded-xl border theme-border bg-[color-mix(in_oklch,var(--theme-bg)_92%,transparent)]"
const segment = (on: boolean) =>
    `min-h-9 px-3.5 rounded-lg text-sm font-semibold transition-colors ${focusRing} ${on ? "theme-accent-fill" : "theme-subtext-color hover:opacity-90"}`
// A meeting card lists this many absentees before "Show all" -- with check-ins
// counted, a meeting can have a dozen or more.
const PREVIEW_MISSES = 3

type MobileTab = "members" | "meetings"

function shortDate(iso: string): string {
    return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" })
}

function reportedAt(iso: string): string {
    const d = new Date(iso)
    return `${shortDate(iso)}, ${d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}`
}

function summaryLine(row: MemberAttendance, scope: AbsenceScope): string {
    const n = row.missed.length
    return scope === "past"
        ? `Missed ${n} of ${row.expected.length} meetings since joining ${shortDate(row.member.created_at)}`
        : `${n} upcoming ${n === 1 ? "absence" : "absences"} reported`
}

export default function AttendancePage() {
    const { data, loading, error, retry } = useAttendance()
    const roleLabels = useRoleLabels(true)
    const roleOf = (role: string) => roleLabels.get(role) ?? role
    const isMobile = useIsMobile()
    const [scope, setScope] = useState<AbsenceScope>("past")
    const [mobileTab, setMobileTab] = useState<MobileTab>("members")
    // Desktop: filters the meetings column. Phones: opens the member sheet.
    const [memberId, setMemberId] = useState<string | null>(null)
    const [query, setQuery] = useState("")
    const searchId = useId()

    // A meeting moves from upcoming to past while the page is open.
    const [now, setNow] = useState(Date.now)
    useEffect(() => {
        const timer = window.setInterval(() => setNow(Date.now()), 60000)
        return () => window.clearInterval(timer)
    }, [])

    const team = useMemo(() => teamAttendance(data, scope, now), [data, scope, now])
    const selected = team.find(r => r.member.user_id === memberId)
    const filtered = selected && !isMobile ? selected : undefined
    const meetings = useMemo(() => meetingsWithMisses(filtered ? [filtered] : team, scope), [team, filtered, scope])

    // Search re-ranks by match quality; without one, the most-missed order stands.
    const visibleMembers = useMemo(() => {
        if (!query.trim()) return team
        return team
            .map(row => ({ row, score: memberMatch(query, row.member, roleLabels.get(row.member.role) ?? row.member.role) }))
            .filter((x): x is { row: typeof x.row, score: number } => x.score !== null)
            .sort((a, b) => b.score - a.score)
            .map(x => x.row)
    }, [team, query, roleLabels])

    function changeScope(next: AbsenceScope) {
        setScope(next)
        if (!isMobile) setMemberId(null)
    }

    const showMembers = !isMobile || mobileTab === "members"
    const showMeetings = !isMobile || mobileTab === "meetings"

    return (
        <ControlSectionLayout title="Attendance">
            <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-3 -mt-3">
                <p className="text-sm theme-subtext-color">Absences members reported for team meetings, counted from when each member joined.</p>
                <div className="flex flex-wrap gap-2 shrink-0 w-full sm:w-auto">
                    {isMobile && (
                        <div className={`${SEGMENTS} w-full sm:w-auto`} role="tablist" aria-label="View">
                            {(["members", "meetings"] as const).map(t => (
                                <button key={t} type="button" role="tab" aria-selected={mobileTab === t} onClick={() => setMobileTab(t)} className={`${segment(mobileTab === t)} flex-1`}>
                                    {t === "members" ? "Members" : "Meetings"}
                                </button>
                            ))}
                        </div>
                    )}
                    <div className={SEGMENTS} role="group" aria-label="Which meetings">
                        {(["past", "upcoming"] as const).map(s => (
                            <button key={s} type="button" aria-pressed={scope === s} onClick={() => changeScope(s)} className={segment(scope === s)}>
                                {s === "past" ? "Past" : "Upcoming"}
                            </button>
                        ))}
                    </div>
                </div>
            </div>

            {/* Reserved: team-wide hours attended as a % of meeting hours goes
                here once check-ins feed `memberAttendance` (see lib/attendance). */}

            {error ? (
                <div className={`${CARD} p-4`}>
                    <Notice>Couldn't load attendance. <Button variant="text" onClick={retry}>Try again</Button></Notice>
                </div>
            ) : loading ? (
                <div className="grid gap-4 md:grid-cols-[18rem_1fr]" role="status" aria-label="Loading attendance">
                    <Skeleton className="h-64 rounded-2xl"/>
                    <div className="hidden md:flex flex-col gap-3"><Skeleton className="h-28 rounded-2xl"/><Skeleton className="h-28 rounded-2xl"/></div>
                </div>
            ) : team.length === 0 ? (
                <div className={`${CARD} p-4`}><EmptyState>No members to show yet.</EmptyState></div>
            ) : (
                <div className="grid gap-4 md:grid-cols-[18rem_1fr] items-start">
                    {showMembers && (
                        <section className={`${CARD} p-2 flex flex-col md:sticky md:top-4 md:max-h-[calc(100vh-2rem)]`} aria-labelledby="attendance-members">
                            <h2 id="attendance-members" className={`${typeH2} theme-subtext-color px-2 pt-2 pb-2`}>By member</h2>
                            {/* Sticks while scrolling the roster on phones. */}
                            <div className="sticky top-0 z-10 -mx-2 px-3 pb-2 pt-1 md:static md:mx-0 md:px-1 md:pt-0 rounded-t-xl bg-[color-mix(in_oklch,var(--theme-bg)_96%,transparent)] md:bg-transparent">
                                <div className="relative">
                                    <label htmlFor={searchId} className="sr-only">Search members</label>
                                    <Search size={15} aria-hidden="true" className="absolute left-3 top-1/2 -translate-y-1/2 theme-subtext-color pointer-events-none"/>
                                    <input id={searchId} type="search" value={query} onChange={e => setQuery(e.target.value)} placeholder="Search name or role"
                                        autoComplete="off" spellCheck={false} className={`${inputClass} w-full pl-9`}/>
                                </div>
                            </div>
                            <ul className="flex flex-col md:overflow-y-auto md:min-h-0">
                                {visibleMembers.map(row => {
                                    const { member, missed, expected } = row
                                    const active = !isMobile && member.user_id === memberId
                                    return (
                                        <li key={member.user_id}>
                                            <button type="button" aria-pressed={isMobile ? undefined : active}
                                                aria-haspopup={isMobile ? "dialog" : undefined}
                                                onClick={() => setMemberId(active ? null : member.user_id)}
                                                className={`w-full min-h-11 flex items-center gap-3 px-2 py-2 rounded-xl text-left transition-colors ${focusRing} ${active ? "bg-[color-mix(in_oklch,var(--theme-text-contrast)_14%,transparent)]" : "hover:bg-[color-mix(in_oklch,var(--theme-text-contrast)_6%,transparent)]"}`}>
                                                <span className="flex-1 min-w-0">
                                                    <span className="block text-sm font-semibold theme-text truncate">{member.display_name}</span>
                                                    <span className="block text-xs theme-subtext-color truncate">
                                                        {roleOf(member.role)}{row.lastMissed ? ` · last ${shortDate(row.lastMissed)}` : ""}
                                                    </span>
                                                </span>
                                                <span className="shrink-0 text-right tabular-nums">
                                                    <span className={`block text-sm font-bold ${missed.length ? "theme-text-contrast" : "theme-subtext-color"}`}>{missed.length}</span>
                                                    {scope === "past" && <span className="block text-[11px] theme-subtext-color">of {expected.length}</span>}
                                                </span>
                                            </button>
                                        </li>
                                    )
                                })}
                            </ul>
                            {visibleMembers.length === 0 && <p className="px-2 py-3 text-sm theme-subtext-color">No members match “{query.trim()}”.</p>}
                        </section>
                    )}

                    {showMeetings && (
                        <section className="flex flex-col gap-3 min-w-0" aria-label="Meetings with absences">
                            {filtered && (
                                <div className={`${CARD} px-4 py-3 flex items-center gap-3`}>
                                    <div className="flex-1 min-w-0">
                                        <p className="text-sm font-semibold theme-text truncate">{filtered.member.display_name}</p>
                                        <p className="text-xs theme-subtext-color">{summaryLine(filtered, scope)}</p>
                                    </div>
                                    <Button variant="text" className="shrink-0" onClick={() => setMemberId(null)}><X size={14}/>Clear</Button>
                                </div>
                            )}
                            {meetings.length === 0 ? (
                                <div className={`${CARD} p-4`}>
                                    <EmptyState>{filtered
                                        ? `${filtered.member.display_name} hasn't missed ${scope === "past" ? "a past" : "an upcoming"} meeting.`
                                        : scope === "past" ? "No absences were reported for past meetings." : "No one has reported an absence for an upcoming meeting."}</EmptyState>
                                </div>
                            ) : meetings.map(entry => <MeetingCard key={entry.meeting.id} entry={entry} showCount={!filtered} roleOf={roleOf}/>)}
                        </section>
                    )}
                </div>
            )}

            {isMobile && selected && (
                <MemberSheet row={selected} scope={scope} roleOf={roleOf} onClose={() => setMemberId(null)}/>
            )}
        </ControlSectionLayout>
    )
}

/** Phones: one member's summary and missed meetings, opened from the roster. */
function MemberSheet({ row, scope, roleOf, onClose }: { row: MemberAttendance, scope: AbsenceScope, roleOf: (role: string) => string, onClose: () => void }) {
    const missed = [...row.missed].sort((a, b) => (scope === "past" ? -1 : 1) * (Date.parse(a.meeting.start_time) - Date.parse(b.meeting.start_time)))
    return (
        <Sheet title={row.member.display_name} onClose={onClose}>
            <div className="flex flex-col gap-3 pb-4">
                <div>
                    <p className="text-sm theme-subtext-color">{roleOf(row.member.role)}</p>
                    <p className="text-sm font-semibold theme-text">{summaryLine(row, scope)}</p>
                </div>
                {missed.length > 0 && (
                    <ul className="flex flex-col divide-y divide-[var(--theme-border)] border-t theme-border">
                        {missed.map(({ meeting, absence }) => (
                            <li key={meeting.id} className="py-3 min-w-0">
                                <div className="flex items-baseline justify-between gap-3">
                                    <p className="text-sm font-semibold theme-h1-color break-words min-w-0">{meeting.meeting_purpose || "Team meeting"}</p>
                                    <p className="shrink-0 text-xs theme-subtext-color">{new Date(meeting.start_time).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })}</p>
                                </div>
                                {absence ? <>
                                    <p className="text-sm theme-subtext-color break-words whitespace-pre-wrap">{absence.reason || "No reason given"}</p>
                                    <p className="text-[11px] theme-subtext-color opacity-80">Reported {reportedAt(absence.created_at)}</p>
                                </> : <p className="text-sm theme-subtext-color">Didn't check in</p>}
                            </li>
                        ))}
                    </ul>
                )}
            </div>
        </Sheet>
    )
}

function MeetingCard({ entry: { meeting, misses }, showCount, roleOf }: { entry: MeetingMisses, showCount: boolean, roleOf: (role: string) => string }) {
    const [expanded, setExpanded] = useState(false)
    const listId = useId()
    // Don't hide just one name behind a "+1 more".
    const collapsible = misses.length > PREVIEW_MISSES + 1
    const shown = collapsible && !expanded ? misses.slice(0, PREVIEW_MISSES) : misses
    const start = new Date(meeting.start_time)
    return (
        <article className={`${CARD} p-4 flex gap-3.5`}>
            <div className="w-12 shrink-0 self-start rounded-[12px] border theme-outline text-center py-1.5" aria-hidden="true">
                <div className="text-[10px] font-bold tracking-[.1em] uppercase theme-subtext-color">{start.toLocaleDateString("en-US", { month: "short" })}</div>
                <div className="text-[22px] font-extrabold leading-none theme-text-contrast">{start.getDate()}</div>
            </div>
            <div className="flex-1 min-w-0">
                <div className="flex items-baseline justify-between gap-3">
                    <h3 className="text-base font-bold theme-h1-color break-words min-w-0">{meeting.meeting_purpose || "Team meeting"}</h3>
                    {showCount && <span className="shrink-0 text-[13px] font-semibold theme-text-contrast">{misses.length} absent</span>}
                </div>
                <p className="text-sm theme-subtext-color">
                    <span className="sr-only">{start.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" })}, </span>
                    {start.toLocaleDateString("en-US", { weekday: "short" })} · {meetingTime(meeting)}
                </p>
                <ul id={listId} className="mt-2.5 flex flex-col border-t border-dashed theme-border">
                    {shown.map(({ member, absence }) => (
                        <li key={member.user_id} className="pt-2.5 min-w-0">
                            <div className="flex flex-wrap items-baseline gap-x-2">
                                <span className="text-sm font-semibold theme-text break-words">{member.display_name}</span>
                                <span className="text-xs theme-subtext-color">{roleOf(member.role)}</span>
                            </div>
                            {absence ? <>
                                <p className="text-sm theme-subtext-color break-words whitespace-pre-wrap">{absence.reason || "No reason given"}</p>
                                <p className="text-[11px] theme-subtext-color opacity-80">Reported {reportedAt(absence.created_at)}</p>
                            </> : <p className="text-sm theme-subtext-color">Didn't check in</p>}
                        </li>
                    ))}
                </ul>
                {collapsible && (
                    <button type="button" aria-expanded={expanded} aria-controls={listId} onClick={() => setExpanded(v => !v)}
                        className={`mt-2 -mb-2 min-h-11 inline-flex items-center gap-1 text-sm font-semibold theme-text-contrast rounded-lg ${focusRing}`}>
                        {expanded ? "Show less" : `Show all ${misses.length}`}
                        <ChevronDown size={15} aria-hidden="true" className={`transition-transform ${expanded ? "rotate-180" : ""}`}/>
                    </button>
                )}
            </div>
        </article>
    )
}
