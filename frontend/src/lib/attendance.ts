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
//   * A meeting before it predates the kiosk: everyone is credited its full
//     length, and only a reported absence shows as a miss.
// Hours are weighted by each meeting's multiplier (x1.0 to x2.0), and a
// member's attendance is hours earned as a share of hours possible. Every
// count on the page flows through `memberAttendance`.

import { useCallback, useEffect, useState } from "react"
import { hoursMultiplier, MEETINGS_API, type Meeting, type MeetingAbsence } from "./meetings"

export type AbsenceScope = "past" | "upcoming"

export interface AttendanceMember {
    user_id: string
    display_name: string
    role: string
    /** Account creation; meetings before this don't count for the member. */
    created_at: string
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
}

export function memberAttendance(
    member: AttendanceMember, meetings: Meeting[], index: AttendanceIndex, scope: AbsenceScope, now: number,
): MemberAttendance {
    const joined = Date.parse(member.created_at)
    const expected = meetings.filter(m => inScope(m, scope, now) && Date.parse(m.start_time) >= joined)
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
    return { member, expected, missed, possibleSeconds: possible, earnedSeconds: earned, lastMissed }
}

/** Hours earned as a share of hours possible (0-1), or null with no finished meetings to measure. */
export function attendanceRate(row: Pick<MemberAttendance, "possibleSeconds" | "earnedSeconds">): number | null {
    return row.possibleSeconds > 0 ? row.earnedSeconds / row.possibleSeconds : null
}

/** `attendanceRate` over a whole set of members. */
export function teamAttendanceRate(rows: MemberAttendance[]): number | null {
    return attendanceRate({
        possibleSeconds: rows.reduce((sum, r) => sum + r.possibleSeconds, 0),
        earnedSeconds: rows.reduce((sum, r) => sum + r.earnedSeconds, 0),
    })
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

export interface MeetingMisses {
    meeting: Meeting
    misses: { member: AttendanceMember, absence: MeetingAbsence | null }[]
}

/**
 * Meetings in scope where someone in `rows` missed. Past
 * meetings come newest first, upcoming ones soonest first.
 */
export function meetingsWithMisses(rows: MemberAttendance[], scope: AbsenceScope): MeetingMisses[] {
    const byMeeting = new Map<string, MeetingMisses>()
    for (const row of rows) {
        for (const { meeting, absence } of row.missed) {
            const entry = byMeeting.get(meeting.id) ?? { meeting, misses: [] }
            entry.misses.push({ member: row.member, absence })
            byMeeting.set(meeting.id, entry)
        }
    }
    const dir = scope === "past" ? -1 : 1
    const list = [...byMeeting.values()]
    // Reported absences (they have a reason to read) first, then no-shows; each by name.
    for (const entry of list) {
        entry.misses.sort((a, b) => Number(!a.absence) - Number(!b.absence)
            || (a.member.display_name ?? "").localeCompare(b.member.display_name ?? ""))
    }
    return list.sort((a, b) => dir * (Date.parse(a.meeting.start_time) - Date.parse(b.meeting.start_time)))
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
