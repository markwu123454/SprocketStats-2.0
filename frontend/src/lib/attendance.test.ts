import { describe, expect, it } from "vitest"
import {
    attendanceRate, fuzzyScore, meetingsWithMisses, memberMatch, teamAttendance, teamAttendanceRate,
    type AttendanceData, type AttendanceMember,
} from "./attendance"
import { hoursMultiplier, multiplierLabel, type Meeting, type MeetingAbsence } from "./meetings"

const now = Date.parse("2026-11-11T12:00:00Z")

const meeting = (id: string, start: string, end: string, hours_multiplier?: number): Meeting =>
    ({ id, start_time: start, end_time: end, meeting_purpose: null, agenda: "", hours_multiplier })
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

    it("lists every member, most missed first then by name, when hours are level", () => {
        expect(rows.map(r => [r.member.display_name, r.missed.length])).toEqual([["Zed", 2], ["Amy", 1], ["New Kid", 0], ["Perfect", 0]])
    })

    it("only expects meetings that started after the account was created", () => {
        const kid = rows.find(r => r.member.user_id === "u3")!
        expect(kid.expected.map(m => m.id)).toEqual(["recent"])
        expect(rows.find(r => r.member.user_id === "u4")!.expected).toHaveLength(3)
    })

    it("credits every meeting in full when the system has no go-live date", () => {
        const zed = rows[0]
        expect(zed.possibleSeconds).toBe((2 + 2 + 3) * 3600)
        expect(zed.earnedSeconds).toBe(zed.possibleSeconds)
        expect(zed.lastMissed).toBe("2026-11-08T17:00:00Z")
        expect(teamAttendanceRate(rows)).toBe(1)
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
            member: kid, expected: [], possibleSeconds: 0, earnedSeconds: 0, lastMissed: null,
            missed: [{ meeting: data.meetings[0], absence: null }],
        }, {
            member: member("z", "Zoe"), expected: [], possibleSeconds: 0, earnedSeconds: 0, lastMissed: null,
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

describe("once the attendance system is live", () => {
    // Live from Nov 6: "old" and "mid" (2h each) predate it. "recent" (3h, worth
    // double) and everything after require a check-in.
    const checkin = (meeting_id: string, user_id: string, hours: number) => ({ meeting_id, user_id, seconds: hours * 3600 })
    const live: AttendanceData = {
        ...data,
        meetings: data.meetings.map(m => m.id === "recent" ? meeting("recent", m.start_time, m.end_time, 2) : m),
        active_from: "2026-11-06T00:00:00Z",
        absences: [absence("old", "u1"), absence("recent", "u2"), absence("recent", "u4"), absence("next", "u3")],
        checkins: [
            checkin("recent", "u1", 3),     // Zed: all of it
            checkin("recent", "u4", 1.5),   // Perfect: half of it, despite reporting an absence
            checkin("live", "u1", 1),
        ],
    }
    const rows = teamAttendance(live, "past", now)
    const row = (id: string) => rows.find(r => r.member.user_id === id)!
    const missedIds = (id: string) => row(id).missed.map(x => x.meeting.id)
    const recent = live.meetings[2]

    it("marks not checking in as an absence, reported or not", () => {
        expect(row("u3").missed).toEqual([{ meeting: recent, absence: null }])
        expect(row("u2").missed).toEqual([{ meeting: recent, absence: live.absences[1] }])
    })

    it("lets checking in cancel a reported absence", () => {
        expect(missedIds("u4")).toEqual([])
    })

    it("never makes a no-show of a meeting before go-live", () => {
        // Nobody checked in to "old" or "mid"; only Zed's report for "old" shows.
        expect(missedIds("u1")).toEqual(["old"])
        expect(missedIds("u2")).toEqual(["recent"])
    })

    it("counts meetings before go-live as full hours, even with an absence reported", () => {
        // Zed: 2h + 2h in full, then all 3h of "recent" at x2.
        expect(row("u1").possibleSeconds).toBe((2 + 2 + 3 * 2) * 3600)
        expect(attendanceRate(row("u1"))).toBe(1)
    })

    it("earns hours only for time checked in after go-live, weighted by the multiplier", () => {
        expect(attendanceRate(row("u2"))).toBe((2 + 2) / 10)             // skipped the x2 meeting
        expect(attendanceRate(row("u4"))).toBe((2 + 2 + 1.5 * 2) / 10)   // half of it
        // New Kid joined after "mid": the x2 meeting is all they had, and they skipped it.
        expect(row("u3").possibleSeconds).toBe(6 * 3600)
        expect(attendanceRate(row("u3"))).toBe(0)
        expect(teamAttendanceRate(rows)).toBe((10 + 4 + 0 + 7) / (10 + 10 + 6 + 10))
    })

    it("lists the lowest share of hours first", () => {
        expect(rows.map(r => r.member.display_name)).toEqual(["New Kid", "Amy", "Perfect", "Zed"])
    })

    it("leaves live and future meetings to reported absences, with no rate", () => {
        const upcoming = teamAttendance(live, "upcoming", now)
        expect(upcoming.flatMap(r => r.missed.map(x => `${r.member.user_id}:${x.meeting.id}`))).toEqual(["u3:next"])
        expect(teamAttendanceRate(upcoming)).toBeNull()
    })

    it("groups no-shows by meeting", () => {
        const list = meetingsWithMisses(rows, "past")
        expect(list.map(m => m.meeting.id)).toEqual(["recent", "old"])
        // Reported first, then the unreported no-show.
        expect(list[0].misses.map(m => [m.member.display_name, m.absence !== null])).toEqual([["Amy", true], ["New Kid", false]])
    })
})

describe("hoursMultiplier", () => {
    it("defaults to 1 and stays between 1 and 2", () => {
        expect(hoursMultiplier({})).toBe(1)
        expect(hoursMultiplier({ hours_multiplier: null })).toBe(1)
        expect(hoursMultiplier({ hours_multiplier: 1.5 })).toBe(1.5)
        expect(hoursMultiplier({ hours_multiplier: 7 })).toBe(2)
        expect(hoursMultiplier({ hours_multiplier: 0 })).toBe(1)
    })

    it("labels a multiplier", () => {
        expect([1, 1.5, 1.25, 2].map(multiplierLabel)).toEqual(["×1.0", "×1.5", "×1.25", "×2.0"])
    })
})
