import { describe, expect, it } from "vitest"
import { fuzzyScore, meetingsWithMisses, memberMatch, teamAttendance, type AttendanceData, type AttendanceMember } from "./attendance"
import type { Meeting, MeetingAbsence } from "./meetings"

const now = Date.parse("2026-11-11T12:00:00Z")

const meeting = (id: string, start: string, end: string): Meeting => ({ id, start_time: start, end_time: end, meeting_purpose: null, agenda: "" })
const absence = (meeting_id: string, user_id: string): MeetingAbsence => ({
    meeting_id, user_id, display_name: "", role: "cad_member", reason: "", created_at: "", updated_at: "",
})
const member = (user_id: string, display_name: string, created_at = "2026-01-01T00:00:00Z"): AttendanceMember => ({
    user_id, display_name, role: "cad_member", created_at,
})

const data: AttendanceData = {
    meetings: [
        meeting("old", "2026-11-01T17:00:00Z", "2026-11-01T19:00:00Z"),
        meeting("mid", "2026-11-04T17:00:00Z", "2026-11-04T19:00:00Z"),
        meeting("recent", "2026-11-08T17:00:00Z", "2026-11-08T20:00:00Z"),
        meeting("live", "2026-11-11T11:00:00Z", "2026-11-11T13:00:00Z"),
        meeting("next", "2026-11-15T17:00:00Z", "2026-11-15T19:00:00Z"),
    ],
    members: [
        member("u1", "Zed"),
        member("u2", "Amy"),
        // Joined after "old" and "mid": only "recent" counts as past for them.
        member("u3", "New Kid", "2026-11-05T00:00:00Z"),
        member("u4", "Perfect"),
    ],
    absences: [absence("old", "u1"), absence("recent", "u1"), absence("recent", "u2"), absence("live", "u2"), absence("next", "u3")],
}

describe("teamAttendance", () => {
    const rows = teamAttendance(data, "past", now)

    it("lists every member, most missed first, then by name", () => {
        expect(rows.map(r => [r.member.display_name, r.missed.length])).toEqual([["Zed", 2], ["Amy", 1], ["New Kid", 0], ["Perfect", 0]])
    })

    it("only expects meetings that started after the account was created", () => {
        const kid = rows.find(r => r.member.user_id === "u3")!
        expect(kid.expected.map(m => m.id)).toEqual(["recent"])
        expect(rows.find(r => r.member.user_id === "u4")!.expected).toHaveLength(3)
    })

    it("totals meeting and missed hours for a later attendance percentage", () => {
        const zed = rows[0]
        expect(zed.meetingSeconds).toBe((2 + 2 + 3) * 3600)
        expect(zed.missedSeconds).toBe((2 + 3) * 3600)
        expect(zed.lastMissed).toBe("2026-11-08T17:00:00Z")
    })

    it("treats a live meeting as upcoming", () => {
        const upcoming = teamAttendance(data, "upcoming", now)
        expect(upcoming.find(r => r.member.user_id === "u2")!.missed.map(x => x.meeting.id)).toEqual(["live"])
    })
})

describe("meetingsWithMisses", () => {
    it("groups misses by meeting, newest first for past", () => {
        const list = meetingsWithMisses(teamAttendance(data, "past", now), "past")
        expect(list.map(m => m.meeting.id)).toEqual(["recent", "old"])
        expect(list[0].misses.map(m => m.member.display_name)).toEqual(["Amy", "Zed"])
    })
})

describe("meetingsWithMisses ordering", () => {
    it("lists reported absences before no-shows", () => {
        const kid = member("k", "Aaron")
        const rows = [{
            member: kid, expected: [], meetingSeconds: 0, missedSeconds: 0, lastMissed: null,
            missed: [{ meeting: data.meetings[0], absence: null }],
        }, {
            member: member("z", "Zoe"), expected: [], meetingSeconds: 0, missedSeconds: 0, lastMissed: null,
            missed: [{ meeting: data.meetings[0], absence: absence("old", "z") }],
        }]
        expect(meetingsWithMisses(rows, "past")[0].misses.map(m => m.member.display_name)).toEqual(["Zoe", "Aaron"])
    })
})

describe("fuzzyScore", () => {
    it("matches characters in order, ignoring case and accents", () => {
        expect(fuzzyScore("jalv", "Jordan Alvarez")).not.toBeNull()
        expect(fuzzyScore("jose", "José")).not.toBeNull()
        expect(fuzzyScore("xyz", "Jordan")).toBeNull()
        expect(fuzzyScore("", "anything")).toBe(0)
    })

    it("ranks word-start and consecutive matches higher", () => {
        expect(fuzzyScore("sam", "Sam Lee")!).toBeGreaterThan(fuzzyScore("sam", "Isa Mendez")!)
    })

    it("searches role labels too, below an equal name hit", () => {
        const m = member("u", "Priya")
        expect(memberMatch("cad", m, "CAD Member")).not.toBeNull()
        expect(memberMatch("zzz", m, "CAD Member")).toBeNull()
    })
})
