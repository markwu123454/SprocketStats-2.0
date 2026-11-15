// Control Panel > Attendance.
//
// Data comes from `GET /meeting-hours/attendance`, which the backend scopes to
// what the viewer may see (leads: their subteam, captains/mentors: everyone)
// and to members expected at meetings. Everything here is pure shaping.
//
// The attendance system went live on a fixed date the backend reports as
// `active_from` (core/attendance_rules.py):
//   * A meeting starting on or after it requires a check-in. Once it is over,
//     a member who never checked in missed it, and they earn hours only for
//     the time they were checked in.
//   * A meeting before it doesn't count at all: no hours, no miss, no
//     absence counted (a reported absence is still listed). Without a
//     go-live date every meeting counts, in full.
// Hours are weighted by each meeting's multiplier (x1.0 to x2.0), and a
// member's attendance is hours earned as a share of hours possible. Every
// count on the page flows through `memberAttendance`.

import { useCallback, useEffect, useState } from "react"
import { hoursMultiplier, MEETINGS_API, type Meeting, type MeetingAbsence } from "./meetings"
import { TASK_BUCKETS, bucketLabel } from "./taskBuckets"

export type AbsenceScope = "past" | "upcoming"

export interface AttendanceMember {
    user_id: string
    display_name: string
    role: string
    /** Account creation; meetings before this don't count for the member. */
    created_at: string
    /** The role's subteam slug ("scouting", "cad", ...), or null for team-wide roles. */
    subteam?: string | null
    /** The role's level ("member", "lead", "captain"). */
    level?: string | null
}

/** How long one member was checked in during one meeting (capped at its length). */
export interface MeetingCheckin {
    meeting_id: string
    user_id: string
    seconds: number
}

export interface AttendanceData {
    meetings: Meeting[]
    members: AttendanceMember[]
    absences: MeetingAbsence[]
    checkins?: MeetingCheckin[]
    /** When the attendance system went live; meetings from then on require a check-in. */
    active_from?: string
    /** The viewer oversees the whole team (captains, mentors, the Scouting Lead), not one subteam. */
    team_wide?: boolean
}

export function useAttendance() {
    const [data, setData] = useState<AttendanceData>({ meetings: [], members: [], absences: [] })
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState(false)
    const [attempt, setAttempt] = useState(0)
    const retry = useCallback(() => setAttempt(value => value + 1), [])

    useEffect(() => {
        const controller = new AbortController()
        setLoading(true)
        setError(false)
        fetch(`${MEETINGS_API}/attendance`, { credentials: "include", signal: controller.signal })
            .then(response => {
                if (!response.ok) throw new Error(String(response.status))
                return response.json() as Promise<AttendanceData>
            })
            .then(setData)
            .catch(() => { if (!controller.signal.aborted) setError(true) })
            .finally(() => { if (!controller.signal.aborted) setLoading(false) })
        return () => controller.abort()
    }, [attempt])

    return { data, loading, error, retry }
}

/** A meeting is past once it has ended; anything else (live or ahead) is upcoming. */
export function isPastMeeting(meeting: Meeting, now: number): boolean {
    return Date.parse(meeting.end_time) <= now
}

export function inScope(meeting: Meeting, scope: AbsenceScope, now: number): boolean {
    return isPastMeeting(meeting, now) === (scope === "past")
}

function meetingSecondsOf(meeting: Meeting): number {
    return Math.max(0, (Date.parse(meeting.end_time) - Date.parse(meeting.start_time)) / 1000)
}

const pairKey = (meetingId: string, userId: string) => `${meetingId}|${userId}`

/** Absences indexed by meeting + member, for O(1) "did they report one?" lookups. */
export function indexAbsences(absences: MeetingAbsence[]): Map<string, MeetingAbsence> {
    return new Map(absences.map(a => [pairKey(a.meeting_id, a.user_id), a]))
}

export interface AttendanceIndex {
    absences: Map<string, MeetingAbsence>
    /** Seconds checked in, by meeting + member. */
    checkins: Map<string, number>
    /** Epoch ms the attendance system went live; Infinity when the backend didn't say. */
    activeFrom: number
}

export function indexAttendance(data: AttendanceData): AttendanceIndex {
    const activeFrom = data.active_from ? Date.parse(data.active_from) : NaN
    return {
        absences: indexAbsences(data.absences),
        checkins: new Map((data.checkins ?? []).map(c => [pairKey(c.meeting_id, c.user_id), c.seconds])),
        activeFrom: Number.isNaN(activeFrom) ? Infinity : activeFrom,
    }
}

/** Seconds `member` was checked in during `meeting`, never more than its length. */
export function checkedInSeconds(member: AttendanceMember, meeting: Meeting, index: AttendanceIndex): number {
    return Math.min(index.checkins.get(pairKey(meeting.id, member.user_id)) ?? 0, meetingSecondsOf(meeting))
}

/** Whether `meeting` requires a check-in: it started once the attendance system was live. */
export function requiresCheckin(meeting: Meeting, index: AttendanceIndex): boolean {
    return Date.parse(meeting.start_time) >= index.activeFrom
}

/**
 * Whether `member` missed `meeting`: the absence they reported, `true` for a
 * no-show with no report, or null. Checking in to a finished meeting that
 * requires it cancels an absence reported for it.
 */
export function missedMeeting(member: AttendanceMember, meeting: Meeting, index: AttendanceIndex, now: number): MeetingAbsence | true | null {
    const absence = index.absences.get(pairKey(meeting.id, member.user_id)) ?? null
    if (!isPastMeeting(meeting, now) || !requiresCheckin(meeting, index)) return absence
    if (checkedInSeconds(member, meeting, index) > 0) return null
    return absence ?? true
}

/**
 * Hours `member` earned at a finished `meeting`, in seconds, after its
 * multiplier: the time they were checked in, or the whole meeting if it
 * predates the attendance system.
 */
export function earnedSeconds(member: AttendanceMember, meeting: Meeting, index: AttendanceIndex): number {
    const seconds = requiresCheckin(meeting, index) ? checkedInSeconds(member, meeting, index) : meetingSecondsOf(meeting)
    return seconds * hoursMultiplier(meeting)
}

export interface Miss {
    meeting: Meeting
    /** The report, or null for an unreported no-show. */
    absence: MeetingAbsence | null
}

export interface MemberAttendance {
    member: AttendanceMember
    /** Meetings in scope the member was expected at (started after their account existed). */
    expected: Meeting[]
    /** The subset they missed, with the absence report when there is one. */
    missed: Miss[]
    /** Hours on offer across the finished `expected` meetings, in seconds, after multipliers. */
    possibleSeconds: number
    /** Hours the member earned at them (see `earnedSeconds`). */
    earnedSeconds: number
    /** start_time of their latest missed meeting, if any. */
    lastMissed: string | null
    /** Absences reported for meetings before go-live: listed, never counted. */
    uncounted: Miss[]
}

export function memberAttendance(
    member: AttendanceMember, meetings: Meeting[], index: AttendanceIndex, scope: AbsenceScope, now: number,
): MemberAttendance {
    // Counted from when the member joined, and never before the attendance system went live.
    const joined = Date.parse(member.created_at)
    const from = Math.max(joined, index.activeFrom === Infinity ? -Infinity : index.activeFrom)
    const expected = meetings.filter(m => inScope(m, scope, now) && Date.parse(m.start_time) >= from)
    const uncounted: Miss[] = []
    for (const meeting of meetings) {
        const start = Date.parse(meeting.start_time)
        const absence = index.absences.get(pairKey(meeting.id, member.user_id))
        if (absence && start >= joined && start < from && inScope(meeting, scope, now)) uncounted.push({ meeting, absence })
    }
    const missed: Miss[] = []
    let possible = 0
    let earned = 0
    for (const meeting of expected) {
        if (isPastMeeting(meeting, now)) {
            possible += meetingSecondsOf(meeting) * hoursMultiplier(meeting)
            earned += earnedSeconds(member, meeting, index)
        }
        const hit = missedMeeting(member, meeting, index, now)
        if (hit) missed.push({ meeting, absence: hit === true ? null : hit })
    }
    const byStart = (a: Meeting, b: Meeting) => Date.parse(a.start_time) - Date.parse(b.start_time)
    const lastMissed = missed.length ? missed.map(x => x.meeting).sort(byStart)[missed.length - 1].start_time : null
    return { member, expected, missed, possibleSeconds: possible, earnedSeconds: earned, lastMissed, uncounted }
}

/** Hours earned as a share of hours possible (0-1), or null with no finished meetings to measure. */
export function attendanceRate(row: Pick<MemberAttendance, "possibleSeconds" | "earnedSeconds">): number | null {
    return row.possibleSeconds > 0 ? row.earnedSeconds / row.possibleSeconds : null
}

/**
 * Task points earned per hour at meetings, or null with no hours to divide by.
 * `earnedSeconds` is the member's past-scope total (already after multipliers).
 */
export function pointsPerHour(points: number, earnedSeconds: number): number | null {
    return earnedSeconds > 0 ? points / (earnedSeconds / 3600) : null
}

/** How many finished meetings the strip shows, and how many scheduled ones follow. */
export const STRIP_PAST = 10
export const STRIP_UPCOMING = 5

const byStartAsc = (a: Meeting, b: Meeting) => Date.parse(a.start_time) - Date.parse(b.start_time)

/** The member's last finished meetings, oldest to newest: attended or missed. */
export function pastStrip(past: MemberAttendance): ("attended" | "missed")[] {
    const missed = new Set(past.missed.map(x => x.meeting.id))
    return [...past.expected].sort(byStartAsc).slice(-STRIP_PAST)
        .map(m => missed.has(m.id) ? "missed" : "attended")
}

/** The next meetings, soonest first: "absent" when the member reported an absence, else "scheduled". */
export function upcomingStrip(upcoming: MemberAttendance): ("absent" | "scheduled")[] {
    const reported = new Set(upcoming.missed.map(x => x.meeting.id))
    return [...upcoming.expected].sort(byStartAsc).slice(0, STRIP_UPCOMING)
        .map(m => reported.has(m.id) ? "absent" : "scheduled")
}

export interface ReportedAbsences {
    /** Upcoming meetings with a reported absence, latest first. */
    upcoming: Miss[]
    /** Finished meetings with a reported absence (not bare no-shows), latest first. */
    past: Miss[]
}

/** Only meetings where the member reported an absence, including uncounted ones before go-live. */
export function reportedAbsences(past: MemberAttendance, upcoming: MemberAttendance): ReportedAbsences {
    const latestFirst = (a: Miss, b: Miss) => byStartAsc(b.meeting, a.meeting)
    return {
        upcoming: upcoming.missed.filter(x => x.absence).sort(latestFirst),
        past: [...past.missed.filter(x => x.absence), ...past.uncounted].sort(latestFirst),
    }
}

/** Every member's attendance in scope: lowest share of hours first, then most missed, then by name. */
export function teamAttendance(data: AttendanceData, scope: AbsenceScope, now: number): MemberAttendance[] {
    const index = indexAttendance(data)
    return data.members
        .map(member => memberAttendance(member, data.meetings, index, scope, now))
        .sort((a, b) => (attendanceRate(a) ?? 1) - (attendanceRate(b) ?? 1)
            || b.missed.length - a.missed.length
            || (a.member.display_name ?? "").localeCompare(b.member.display_name ?? ""))
}

/**
 * Fuzzy match: every query character must appear in `text` in order (case
 * and accents ignored). Returns a score, higher is better -- runs of
 * consecutive characters and matches at word starts rank first -- or null
 * for no match. An empty query matches everything with score 0.
 */
export function fuzzyScore(query: string, text: string): number | null {
    const fold = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase()
    const q = fold(query).replace(/\s+/g, "")
    if (!q) return 0
    const t = fold(text)
    let score = 0
    let qi = 0
    let prev = -2
    for (let ti = 0; ti < t.length && qi < q.length; ti++) {
        if (t[ti] !== q[qi]) continue
        score += 1
        if (ti === prev + 1) score += 2                      // consecutive run
        if (ti === 0 || /[\s\-_.']/.test(t[ti - 1])) score += 3 // word start
        prev = ti
        qi++
    }
    if (qi < q.length) return null
    return score - t.length * 0.01 // shorter names win ties
}

/** Best fuzzy score over a member's name and role label, or null. */
export function memberMatch(query: string, member: AttendanceMember, roleLabel: string): number | null {
    const name = fuzzyScore(query, member.display_name ?? "")
    const role = fuzzyScore(query, roleLabel)
    if (name === null && role === null) return null
    // A name hit outranks an equally good role hit.
    return Math.max(name ?? -Infinity, (role ?? -Infinity) - 1)
}


// ── Groups: subteams, and for whole-team viewers the leads and captains ──────

export interface AttendanceGroup {
    /** A subteam slug, or "leads" / "captains". */
    id: string
    label: string
    /** Whether this is a subteam (whose lead being out is worth flagging). */
    subteam: boolean
    members: AttendanceMember[]
}

/**
 * The groups the viewer can pick from. Each subteam holds its members and its
 * lead, in the task-board order. Whole-team viewers also get every lead as one
 * group, and the captains when there are any. Empty groups are left out.
 */
export function attendanceGroups(data: AttendanceData): AttendanceGroup[] {
    const slugs: string[] = TASK_BUCKETS.filter(b => b !== "general")
    for (const m of data.members) if (m.subteam && !slugs.includes(m.subteam)) slugs.push(m.subteam)
    const groups: AttendanceGroup[] = slugs.map(slug => ({
        id: slug, label: bucketLabel(slug), subteam: true, members: data.members.filter(m => m.subteam === slug),
    }))
    if (data.team_wide) {
        groups.push({ id: "leads", label: "Leads", subteam: false, members: data.members.filter(m => m.level === "lead") })
        groups.push({ id: "captains", label: "Captains", subteam: false, members: data.members.filter(m => m.level === "captain") })
    }
    return groups.filter(g => g.members.length > 0)
}

/** Where `member` belongs when no group was picked: their subteam, else the first group holding them. */
export function homeGroup(groups: AttendanceGroup[], member: AttendanceMember): AttendanceGroup | undefined {
    return groups.find(g => g.id === member.subteam) ?? groups.find(g => g.members.some(m => m.user_id === member.user_id))
}

/**
 * One member at one meeting. Past: attended, missed (no notice) or absent
 * (reported ahead of time). Upcoming: scheduled or absent. null when the
 * meeting doesn't count for them (before they joined or before go-live).
 */
export type MeetingMark = "attended" | "missed" | "absent" | "scheduled" | null

export function meetingMark(member: AttendanceMember, meeting: Meeting, index: AttendanceIndex, now: number): MeetingMark {
    const from = Math.max(Date.parse(member.created_at), index.activeFrom === Infinity ? -Infinity : index.activeFrom)
    if (Date.parse(meeting.start_time) < from) return null
    const hit = missedMeeting(member, meeting, index, now)
    if (!isPastMeeting(meeting, now)) return hit ? "absent" : "scheduled"
    if (hit === null) return "attended"
    return hit === true ? "missed" : "absent"
}

/** How many finished meetings the subteam view reaches back, and how many scheduled ones it looks ahead. */
export const GROUP_PAST = 30
export const GROUP_UPCOMING = 3

export interface GroupMeeting {
    meeting: Meeting
    past: boolean
    /** One mark per group member, in `members` order. */
    marks: MeetingMark[]
    /** Members the meeting counts for. */
    expected: number
    attended: number
    missed: number
    absent: number
}

export interface GroupSummary {
    members: AttendanceMember[]
    /** Finished meetings (oldest first), then upcoming ones (soonest first). */
    meetings: GroupMeeting[]
    /** Index into `meetings` of the first upcoming one (= meetings.length when none). */
    firstUpcoming: number
    /** Hours earned as a share of hours possible across the group, or null. */
    rate: number | null
    /** No-shows and reported absences at finished meetings. */
    missed: number
    absent: number
    /** Reported absences at the upcoming meetings shown. */
    absentAhead: number
    /** Average headcount share at the finished meetings shown (0-1), or null. */
    averageTurnout: number | null
}

export function groupSummary(data: AttendanceData, group: AttendanceGroup, now: number): GroupSummary {
    const index = indexAttendance(data)
    const members = [...group.members].sort((a, b) => (a.display_name ?? "").localeCompare(b.display_name ?? ""))
    const sorted = [...data.meetings].sort(byStartAsc)
    const shape = (meeting: Meeting): GroupMeeting => {
        const marks = members.map(m => meetingMark(m, meeting, index, now))
        const count = (k: MeetingMark) => marks.filter(x => x === k).length
        return {
            meeting, past: isPastMeeting(meeting, now), marks,
            expected: marks.filter(x => x !== null).length,
            attended: count("attended"), missed: count("missed"), absent: count("absent"),
        }
    }
    const past = sorted.filter(m => isPastMeeting(m, now)).map(shape).filter(g => g.expected > 0).slice(-GROUP_PAST)
    const upcoming = sorted.filter(m => !isPastMeeting(m, now)).slice(0, GROUP_UPCOMING).map(shape)

    let possible = 0, earned = 0, missed = 0, absent = 0
    for (const m of members) {
        const row = memberAttendance(m, data.meetings, index, "past", now)
        possible += row.possibleSeconds
        earned += row.earnedSeconds
        for (const miss of row.missed) if (miss.absence) absent++; else missed++
    }
    const turnouts = past.map(g => g.attended / g.expected)
    return {
        members,
        meetings: [...past, ...upcoming],
        firstUpcoming: past.length,
        rate: possible > 0 ? earned / possible : null,
        missed, absent,
        absentAhead: upcoming.reduce((n, g) => n + g.absent, 0),
        averageTurnout: turnouts.length ? turnouts.reduce((a, b) => a + b, 0) / turnouts.length : null,
    }
}

/** A member's totals over the meetings a group summary shows: no-shows and reported absences at finished ones. */
export function memberTotals(summary: GroupSummary, memberIndex: number): { missed: number, absent: number } {
    let missed = 0, absent = 0
    for (const g of summary.meetings) {
        if (!g.past) continue
        if (g.marks[memberIndex] === "missed") missed++
        else if (g.marks[memberIndex] === "absent") absent++
    }
    return { missed, absent }
}

// ── Subteam view: labels, dates and the metrics for one meeting ──────────────

const MARK_LABEL: Record<NonNullable<MeetingMark>, string> = {
    attended: "Attended", missed: "Missed", absent: "Absent ahead of time", scheduled: "Scheduled",
}

/** Spoken name for one mark ("Not counted" for a meeting before the member joined or before go-live). */
export function markLabel(mark: MeetingMark): string {
    return mark === null ? "Not counted" : MARK_LABEL[mark]
}

export const weekday = (iso: string) => new Date(iso).toLocaleDateString("en-US", { weekday: "short" })
export const monthDay = (iso: string) => new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" })
export const numericDay = (iso: string) => new Date(iso).toLocaleDateString("en-US", { month: "numeric", day: "numeric" })
export const pct = (part: number, whole: number) => whole > 0 ? Math.round(part / whole * 100) : 0

/** "today", "tomorrow" or "in N days", by calendar day. */
export function inDays(iso: string, now: number): string {
    const day = (t: number) => { const d = new Date(t); d.setHours(0, 0, 0, 0); return d.getTime() }
    const n = Math.round((day(Date.parse(iso)) - day(now)) / 86400000)
    return n <= 0 ? "today" : n === 1 ? "tomorrow" : `in ${n} days`
}

export interface PersonChip {
    userId: string
    name: string
    /** Open this person, focused on the given meeting's absence when there is one. */
    meetingId?: string
}

export interface MeetingMetrics {
    when: string
    tag: string
    purpose: string | null
    note: string
    tiles: { title: string, value: string, sub: string }[]
    groups: { title: string, mark: NonNullable<MeetingMark>, names: PersonChip[] }[]
}

/** The numbers and the names for one meeting of a group summary. */
export function meetingMetrics(summary: GroupSummary, i: number, groupLabel: string): MeetingMetrics {
    const g = summary.meetings[i]
    const n = g.expected
    const who = (mark: MeetingMark): PersonChip[] => summary.members
        .filter((_, k) => g.marks[k] === mark)
        .map(m => ({ userId: m.user_id, name: m.display_name, meetingId: mark === "missed" || mark === "absent" ? g.meeting.id : undefined }))
    const avg = summary.averageTurnout === null ? null : Math.round(summary.averageTurnout * 100)
    const when = `${weekday(g.meeting.start_time)} ${monthDay(g.meeting.start_time)}`
    if (g.past) {
        const here = pct(g.attended, n)
        const diff = avg === null ? null : here - avg
        return {
            when, tag: "Past meeting", purpose: g.meeting.meeting_purpose,
            note: diff === null ? "" : `${diff >= 0 ? "+" : ""}${diff} pts vs the ${groupLabel} average (${avg}%)`,
            tiles: [
                { title: "Attendance", value: `${here}%`, sub: `${g.attended} of ${n} present` },
                { title: "Missed", value: String(g.missed), sub: "no notice given" },
                { title: "Absent ahead", value: String(g.absent), sub: "told the team early" },
                { title: "Meeting", value: `${i + 1} of ${summary.firstUpcoming}`, sub: "shown here" },
            ],
            groups: [
                { title: "Attended", mark: "attended", names: who("attended") },
                { title: "Missed", mark: "missed", names: who("missed") },
                { title: "Absent ahead", mark: "absent", names: who("absent") },
            ],
        }
    }
    const coming = n - g.absent
    return {
        when, tag: "Upcoming", purpose: g.meeting.meeting_purpose,
        note: "Expected turnout from absences reported so far",
        tiles: [
            { title: "Expected", value: `${pct(coming, n)}%`, sub: `${coming} of ${n} coming` },
            { title: "Absent ahead", value: String(g.absent), sub: "already reported" },
            { title: `${groupLabel} avg`, value: avg === null ? "—" : `${avg}%`, sub: `last ${summary.firstUpcoming} meetings` },
        ],
        groups: [
            { title: "Scheduled", mark: "scheduled", names: who("scheduled") },
            { title: "Absent ahead", mark: "absent", names: who("absent") },
        ],
    }
}

