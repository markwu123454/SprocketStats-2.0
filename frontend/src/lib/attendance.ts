// Control Panel > Attendance.
//
// Data comes from `GET /meeting-hours/attendance`, which the backend scopes to
// what the viewer may see (leads: their subteam, captains/mentors: everyone)
// and to members expected at meetings. Everything here is pure shaping.
//
// Built to grow: today a member "missed" a meeting only if they reported an
// absence. Meeting check-ins will later join the payload, at which point
// `missedMeeting` also counts "never checked in", and hours attended can be
// shown against `meetingSeconds` as a percentage. Every count on the page
// flows through `memberAttendance`, so that change lands in one place.

import { useCallback, useEffect, useState } from "react"
import { MEETINGS_API, type Meeting, type MeetingAbsence } from "./meetings"

export type AbsenceScope = "past" | "upcoming"

export interface AttendanceMember {
    user_id: string
    display_name: string
    role: string
    /** Account creation; meetings before this don't count for the member. */
    created_at: string
}

export interface AttendanceData {
    meetings: Meeting[]
    members: AttendanceMember[]
    absences: MeetingAbsence[]
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

const absenceKey = (meetingId: string, userId: string) => `${meetingId}|${userId}`

/** Absences indexed by meeting + member, for O(1) "did they report one?" lookups. */
export function indexAbsences(absences: MeetingAbsence[]): Map<string, MeetingAbsence> {
    return new Map(absences.map(a => [absenceKey(a.meeting_id, a.user_id), a]))
}

/**
 * Whether `member` missed `meeting`. Today: they reported an absence. When
 * check-ins arrive this also becomes true for a past meeting with no check-in
 * overlapping it.
 */
export function missedMeeting(member: AttendanceMember, meeting: Meeting, absences: Map<string, MeetingAbsence>): MeetingAbsence | true | null {
    return absences.get(absenceKey(meeting.id, member.user_id)) ?? null
}

export interface MemberAttendance {
    member: AttendanceMember
    /** Meetings in scope the member was expected at (started after their account existed). */
    expected: Meeting[]
    /** The subset they missed, with the absence report when there is one. */
    missed: { meeting: Meeting, absence: MeetingAbsence | null }[]
    /** Total length of `expected` -- the denominator for a future hours-attended %. */
    meetingSeconds: number
    missedSeconds: number
    /** start_time of their latest missed meeting, if any. */
    lastMissed: string | null
}

export function memberAttendance(
    member: AttendanceMember, meetings: Meeting[], absences: Map<string, MeetingAbsence>, scope: AbsenceScope, now: number,
): MemberAttendance {
    const joined = Date.parse(member.created_at)
    const expected = meetings.filter(m => inScope(m, scope, now) && Date.parse(m.start_time) >= joined)
    const missed: MemberAttendance["missed"] = []
    for (const meeting of expected) {
        const hit = missedMeeting(member, meeting, absences)
        if (hit) missed.push({ meeting, absence: hit === true ? null : hit })
    }
    const byStart = (a: Meeting, b: Meeting) => Date.parse(a.start_time) - Date.parse(b.start_time)
    const lastMissed = missed.length ? missed.map(x => x.meeting).sort(byStart)[missed.length - 1].start_time : null
    return {
        member,
        expected,
        missed,
        meetingSeconds: expected.reduce((sum, m) => sum + meetingSecondsOf(m), 0),
        missedSeconds: missed.reduce((sum, x) => sum + meetingSecondsOf(x.meeting), 0),
        lastMissed,
    }
}

/** Every member's attendance in scope, most missed first, then by name. */
export function teamAttendance(data: AttendanceData, scope: AbsenceScope, now: number): MemberAttendance[] {
    const index = indexAbsences(data.absences)
    return data.members
        .map(member => memberAttendance(member, data.meetings, index, scope, now))
        .sort((a, b) => b.missed.length - a.missed.length || (a.member.display_name ?? "").localeCompare(b.member.display_name ?? ""))
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
